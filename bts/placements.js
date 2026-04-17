'use strict';

function _clone_team(team) {
	if (!team) return null;
	return JSON.parse(JSON.stringify(team));
}

function _parse_place_range(match_name) {
	if (!match_name) return null;

	const normalized = String(match_name).trim();
	const direct_match = /^(\d+)\s*\/\s*(\d+)$/.exec(normalized);
	if (direct_match) {
		return {
			place_from: Number(direct_match[1]),
			place_to: Number(direct_match[2]),
		};
	}

	const named_places = new Map([
		['Finale', [1, 2]],
		['3/4', [3, 4]],
		['5/6', [5, 6]],
		['7/8', [7, 8]],
		['9/10', [9, 10]],
		['11/12', [11, 12]],
		['13/14', [13, 14]],
		['15/16', [15, 16]],
		['17/18', [17, 18]],
		['19/20', [19, 20]],
		['21/22', [21, 22]],
		['23/24', [23, 24]],
		['25/26', [25, 26]],
		['27/28', [27, 28]],
		['29/30', [29, 30]],
		['31/32', [31, 32]],
	]);
	const named_range = named_places.get(normalized);
	if (!named_range) return null;
	return {
		place_from: named_range[0],
		place_to: named_range[1],
	};
}

function _get_winner_team_index(match) {
	if (typeof match?.team1_won === 'boolean') {
		return match.team1_won ? 0 : 1;
	}
	if (match?.btp_winner === 1 || match?.btp_winner === 2) {
		return match.btp_winner - 1;
	}
	return null;
}

function _is_finished_match(match) {
	return _get_winner_team_index(match) != null;
}

function _build_exact_placement_entries(match, range) {
	if (!match?.setup?.teams || match.setup.teams.length < 2) return [];
	const winner_team_index = _get_winner_team_index(match);
	if (winner_team_index == null) return [];

	const loser_team_index = winner_team_index === 0 ? 1 : 0;
	const winner_team = match.setup.teams[winner_team_index];
	const loser_team = match.setup.teams[loser_team_index];

	return [
		{
			place_from: range.place_from,
			place_to: range.place_from,
			team: _clone_team(winner_team),
			source: 'placement_match',
			confidence: 'exact',
			match_id: match._id,
			match_num: match?.setup?.match_num,
			event_name: match?.setup?.event_name,
		},
		{
			place_from: range.place_to,
			place_to: range.place_to,
			team: _clone_team(loser_team),
			source: 'placement_match',
			confidence: 'exact',
			match_id: match._id,
			match_num: match?.setup?.match_num,
			event_name: match?.setup?.event_name,
		},
	];
}

function _normalize_event_name(event_name) {
	const normalized = String(event_name || '').trim();
	if (normalized === '') return '';
	const separator_index = normalized.indexOf(' - ');
	if (separator_index === -1) return normalized;
	return normalized.slice(0, separator_index).trim();
}

function _stage_sort_key(meta) {
	const display_order = Number(meta?.stage_display_order);
	if (Number.isFinite(display_order)) {
		return display_order;
	}
	const draw_position = Number(meta?.draw_position);
	if (Number.isFinite(draw_position)) {
		return draw_position;
	}
	return Number.MAX_SAFE_INTEGER;
}

function _group_matches_by_stage(matches, event_name) {
	const groups = new Map();
	for (const match of matches || []) {
		if (!match?.setup) continue;
		if (_normalize_event_name(match.setup.event_name) !== event_name) continue;
		const key = match.setup.stage_id != null ? `stage:${match.setup.stage_id}` : `event:${event_name}`;
		if (!groups.has(key)) {
			groups.set(key, {
				key,
				stage_id: match.setup.stage_id,
				stage_display_order: match.setup.stage_display_order,
				draw_position: match.setup.draw_position,
				matches: [],
			});
		}
		groups.get(key).matches.push(match);
	}
	return [...groups.values()].sort((a, b) => {
		const cmp = _stage_sort_key(a) - _stage_sort_key(b);
		if (cmp !== 0) return cmp;
		return String(a.key).localeCompare(String(b.key));
	});
}

function _is_group_match(match) {
	const match_name = String(match?.setup?.match_name || '').trim();
	const phase_block_key = String(match?.setup?.phase_block_key || '').trim();
	return /^G\d+$/i.test(match_name) || /^G\d+$/i.test(phase_block_key);
}

function _get_team_key(team) {
	const players = Array.isArray(team?.players) ? team.players : [];
	return players.map((player) => {
		if (player?.btp_id != null) return `btp:${player.btp_id}`;
		if (player?.name) return `name:${player.name}`;
		return `player:${JSON.stringify(player || null)}`;
	}).join('|');
}

function _get_score_totals(match) {
	const totals = {
		sets_for: [0, 0],
		points_for: [0, 0],
	};
	if (!Array.isArray(match?.network_score)) {
		return totals;
	}
	for (const set of match.network_score) {
		if (!Array.isArray(set) || set.length < 2) continue;
		const team1 = Number(set[0]) || 0;
		const team2 = Number(set[1]) || 0;
		totals.points_for[0] += team1;
		totals.points_for[1] += team2;
		if (team1 > team2) {
			totals.sets_for[0] += 1;
		} else if (team2 > team1) {
			totals.sets_for[1] += 1;
		}
	}
	return totals;
}

function _compare_group_stats(a, b) {
	if (a.matches_won !== b.matches_won) return b.matches_won - a.matches_won;
	const a_set_diff = a.sets_for - a.sets_against;
	const b_set_diff = b.sets_for - b.sets_against;
	if (a_set_diff !== b_set_diff) return b_set_diff - a_set_diff;
	const a_point_diff = a.points_for - a.points_against;
	const b_point_diff = b.points_for - b.points_against;
	if (a_point_diff !== b_point_diff) return b_point_diff - a_point_diff;
	if (a.points_for !== b.points_for) return b.points_for - a.points_for;
	return 0;
}

function _sort_group_tie_group(group, pair_results) {
	if (group.length !== 2) return null;
	const left = group[0];
	const right = group[1];
	const pair_key = [left.team_key, right.team_key].sort().join('::');
	const pair = pair_results.get(pair_key);
	if (!pair || pair.winner_team_key == null) return null;
	if (pair.winner_team_key === left.team_key) return [left, right];
	if (pair.winner_team_key === right.team_key) return [right, left];
	return null;
}

function _compute_group_placements(matches, options = {}) {
	const event_name = options.event_name;
	const relevant_matches = matches.filter((match) => {
		if (!match?.setup) return false;
		if (event_name != null && match.setup.event_name !== event_name) return false;
		return _is_group_match(match);
	});

	if (relevant_matches.length === 0) {
		return {
			event_name,
			placements: [],
		};
	}

	const standings = new Map();
	const pair_results = new Map();

	for (const match of relevant_matches) {
		if (!match?.setup?.teams || match.setup.teams.length < 2) {
			return { event_name, placements: [] };
		}
		const team_keys = match.setup.teams.slice(0, 2).map(_get_team_key);
		if (!team_keys[0] || !team_keys[1] || team_keys[0] === team_keys[1]) {
			return { event_name, placements: [] };
		}
		for (let team_index = 0; team_index < 2; team_index += 1) {
			const team_key = team_keys[team_index];
			if (!standings.has(team_key)) {
				standings.set(team_key, {
					team_key,
					team: _clone_team(match.setup.teams[team_index]),
					matches_played: 0,
					matches_won: 0,
					matches_lost: 0,
					sets_for: 0,
					sets_against: 0,
					points_for: 0,
					points_against: 0,
				});
			}
		}

		const winner_team_index = _get_winner_team_index(match);
		if (winner_team_index == null) {
			return { event_name, placements: [] };
		}

		const loser_team_index = winner_team_index === 0 ? 1 : 0;
		const score_totals = _get_score_totals(match);
		const team1 = standings.get(team_keys[0]);
		const team2 = standings.get(team_keys[1]);
		team1.matches_played += 1;
		team2.matches_played += 1;
		team1.matches_won += winner_team_index === 0 ? 1 : 0;
		team2.matches_won += winner_team_index === 1 ? 1 : 0;
		team1.matches_lost += loser_team_index === 0 ? 1 : 0;
		team2.matches_lost += loser_team_index === 1 ? 1 : 0;
		team1.sets_for += score_totals.sets_for[0];
		team1.sets_against += score_totals.sets_for[1];
		team2.sets_for += score_totals.sets_for[1];
		team2.sets_against += score_totals.sets_for[0];
		team1.points_for += score_totals.points_for[0];
		team1.points_against += score_totals.points_for[1];
		team2.points_for += score_totals.points_for[1];
		team2.points_against += score_totals.points_for[0];

		const pair_key = [...team_keys].sort().join('::');
		pair_results.set(pair_key, {
			winner_team_key: team_keys[winner_team_index],
		});
	}

	const team_count = standings.size;
	if (team_count < 2) {
		return { event_name, placements: [] };
	}
	const expected_matches = (team_count * (team_count - 1)) / 2;
	if (relevant_matches.length !== expected_matches) {
		return { event_name, placements: [] };
	}

	const base_sorted = [...standings.values()].sort((a, b) => {
		const cmp = _compare_group_stats(a, b);
		if (cmp !== 0) return cmp;
		return a.team_key.localeCompare(b.team_key);
	});

	const resolved = [];
	for (let idx = 0; idx < base_sorted.length;) {
		const group = [base_sorted[idx]];
		idx += 1;
		while (idx < base_sorted.length && _compare_group_stats(group[0], base_sorted[idx]) === 0) {
			group.push(base_sorted[idx]);
			idx += 1;
		}
		if (group.length === 1) {
			resolved.push(group[0]);
			continue;
		}
		const tie_break = _sort_group_tie_group(group, pair_results);
		if (!tie_break) {
			return { event_name, placements: [] };
		}
		resolved.push(...tie_break);
	}

	return {
		event_name,
		placements: resolved.map((entry, index) => ({
			place_from: index + 1,
			place_to: index + 1,
			team: _clone_team(entry.team),
			source: 'group_matches',
			confidence: 'derived',
			event_name,
		})),
	};
}

function _extract_btp_rankings(matches, event_name) {
	for (const match of matches || []) {
		if (!match?.setup) continue;
		if (event_name != null && match.setup.event_name !== event_name) continue;
		if (!Array.isArray(match.setup.btp_group_rankings) || match.setup.btp_group_rankings.length === 0) continue;
		return match.setup.btp_group_rankings
			.map((entry) => ({
				place_from: Number(entry.place_from),
				place_to: Number(entry.place_to ?? entry.place_from),
				team: _clone_team(entry.team),
				source: entry.source || 'btp_ranking',
				confidence: entry.confidence || 'authoritative',
				event_name: entry.event_name || event_name || match.setup.event_name,
			}))
			.filter((entry) => Number.isFinite(entry.place_from) && Number.isFinite(entry.place_to) && entry.team);
	}
	return [];
}

function _extract_btp_rankings_from_stage(matches, event_name) {
	return _extract_btp_rankings(matches, event_name);
}

function compute_event_placements(matches, options = {}) {
	const event_name = _normalize_event_name(options.event_name);
	const relevant_matches = matches.filter((match) => {
		if (!match?.setup) return false;
		if (event_name != null && _normalize_event_name(match.setup.event_name) !== event_name) return false;
		return true;
	});

	const stage_groups = _group_matches_by_stage(relevant_matches, event_name);
	for (const stage_group of stage_groups) {
		const btp_rankings = _extract_btp_rankings_from_stage(stage_group.matches, event_name);
		if (btp_rankings.length > 0) {
			btp_rankings.sort((a, b) => {
				if (a.place_from !== b.place_from) return a.place_from - b.place_from;
				if (a.place_to !== b.place_to) return a.place_to - b.place_to;
				return 0;
			});
			return {
				event_name: event_name != null ? event_name : (btp_rankings[0]?.event_name || null),
				placements: btp_rankings,
			};
		}

		const exact = [];
		for (const match of stage_group.matches) {
			if (!_is_finished_match(match)) continue;
			const range = _parse_place_range(match?.setup?.match_name);
			if (!range) continue;
			if ((range.place_to - range.place_from) !== 1) continue;
			exact.push(..._build_exact_placement_entries(match, range));
		}
		exact.sort((a, b) => {
			if (a.place_from !== b.place_from) return a.place_from - b.place_from;
			if (a.place_to !== b.place_to) return a.place_to - b.place_to;
			return (a.match_num || 0) - (b.match_num || 0);
		});
		if (exact.length > 0) {
			return {
				event_name: event_name != null ? event_name : (exact[0]?.event_name || null),
				placements: exact,
			};
		}

		const group = _compute_group_placements(stage_group.matches, { event_name });
		if (group.placements.length > 0) {
			return group;
		}
	}

	return {
		event_name,
		placements: [],
	};
}

async function get_tournament_placements(app, tournament_key) {
	const matches = await app.db.matches.find_async({ tournament_key });
	const event_names = [...new Set(
		matches
			.map((match) => _normalize_event_name(match?.setup?.event_name))
			.filter((name) => typeof name === 'string' && name !== '')
	)].sort();

	return event_names.map((event_name) => compute_event_placements(matches, { event_name }));
}

module.exports = {
	compute_event_placements,
	get_tournament_placements,
	_parse_place_range,
	_compute_group_placements,
};
