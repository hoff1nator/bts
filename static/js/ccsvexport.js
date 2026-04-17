'use strict';

var ccsvexport = (function() {

function get_xlsx_api() {
	if (typeof xlsx !== 'undefined' && xlsx) {
		return xlsx;
	}
	if (typeof XLSX !== 'undefined' && XLSX) {
		return XLSX;
	}
	throw new Error('XLSX library is not available');
}

function pad(value, len) {
	let str = String(value);
	while (str.length < len) {
		str = '0' + str;
	}
	return str;
}

function make_csv(table) {
	return table.map((row) => {
		return row.map((val) => {
			const str = '' + (val == null ? '' : val);
			if (/^[-:#_a-z0-9A-Z. ]*$/.test(str)) {
				return str;
			}
			return '"' + str.replace(/"/g, '""') + '"';
		}).join(';');
	}).join('\r\n');
}

function format_date_for_certificate(date) {
	const day = pad(date.getDate(), 2);
	const month = pad(date.getMonth() + 1, 2);
	const year = date.getFullYear();
	return `${day}.${month}.${year}`;
}

function normalize_certificate_date(value, fallback_date) {
	const raw = String(value || '').trim();
	if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
		return raw;
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
		const [year, month, day] = raw.split('-');
		return `${day}.${month}.${year}`;
	}
	return format_date_for_certificate(fallback_date || new Date());
}

function split_tournament_title(tournament_name, tournament) {
	if (tournament?.certificate_title_line_1 || tournament?.certificate_title_line_2) {
		return {
			veranstaltung_1: tournament.certificate_title_line_1 || '',
			veranstaltung_2: tournament.certificate_title_line_2 || '',
		};
	}

	const raw = String(tournament_name || '').trim();
	if (raw.includes('\n')) {
		const parts = raw.split(/\r?\n/);
		return {
			veranstaltung_1: (parts[0] || '').trim(),
			veranstaltung_2: parts.slice(1).join(' ').trim(),
		};
	}

	const dash_index = raw.indexOf(' - ');
	if (dash_index !== -1) {
		return {
			veranstaltung_1: raw.slice(0, dash_index).trim(),
			veranstaltung_2: raw.slice(dash_index + 3).trim(),
		};
	}

	return {
		veranstaltung_1: raw,
		veranstaltung_2: '',
	};
}

function normalize_certificate_event_name(event_name) {
	const normalized = String(event_name || '').trim();
	if (normalized === '') return '';
	const separatorIndex = normalized.indexOf(' - ');
	if (separatorIndex === -1) return normalized;
	return normalized.slice(0, separatorIndex).trim();
}

function stage_sort_key(meta) {
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

function get_stage_group_key(match) {
	const setup = match?.setup || {};
	if (setup.stage_id != null) {
		return `stage:${setup.stage_id}`;
	}
	return `event:${normalize_certificate_event_name(setup.event_name)}`;
}

function build_event_match_index(matches) {
	const event_map = new Map();
	for (const match of matches || []) {
		const event_name = normalize_certificate_event_name(match?.setup?.event_name);
		if (event_name === '') continue;
		if (!event_map.has(event_name)) {
			event_map.set(event_name, []);
		}
		event_map.get(event_name).push(match);
	}
	return event_map;
}

function group_matches_by_stage(matches, event_name) {
	const groups = new Map();
	for (const match of matches || []) {
		const setup = match?.setup;
		if (!setup) continue;
		if (normalize_certificate_event_name(setup.event_name) !== event_name) continue;
		const key = get_stage_group_key(match);
		if (!groups.has(key)) {
			groups.set(key, {
				key,
				stage_id: setup.stage_id,
				stage_name: setup.stage_name,
				stage_display_order: setup.stage_display_order,
				draw_position: setup.draw_position,
				matches: [],
			});
		}
		groups.get(key).matches.push(match);
	}
	return [...groups.values()].sort((a, b) => {
		const cmp = stage_sort_key(a) - stage_sort_key(b);
		if (cmp !== 0) return cmp;
		return String(a.key).localeCompare(String(b.key));
	});
}

function parse_event_name(event_name) {
	const normalized = normalize_certificate_event_name(event_name);
	const match = /^([A-Z]+)\s+([OU]\s*\d+)\b/i.exec(normalized);
	const code = match ? match[1].toUpperCase() : normalized.split(/\s+/)[0].toUpperCase();
	const ak = match ? match[2].replace(/\s+/g, '') : '';
	const kind = ({
		HE: 'single',
		DE: 'single',
		JE: 'single',
		ME: 'single',
		E: 'single',
		S: 'single',
		HD: 'double',
		DD: 'double',
		JD: 'double',
		MD: 'double',
		D: 'double',
		GD: 'double',
		MX: 'double',
	})[code] || null;

	const discipline = {
		HE: 'Herreneinzel',
		DE: 'Dameneinzel',
		HD: 'Herrendoppel',
		DD: 'Damendoppel',
		GD: 'Gemischtes Doppel',
		MX: 'Gemischtes Doppel',
		JE: 'Jungeneinzel',
		ME: 'Mädcheneinzel',
		JD: 'Jungendoppel',
		MD: 'Mädchendoppel',
		E: 'Einzel',
		D: 'Doppel',
		S: 'Einzel',
	}[code] || normalized;

	return {
		disziplin: discipline,
		ak,
		code,
		kind,
	};
}

function parse_place_range(match_name) {
	const normalized = String(match_name || '').trim();
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

function get_winner_team_index(match) {
	if (typeof match?.team1_won === 'boolean') {
		return match.team1_won ? 0 : 1;
	}
	if (match?.btp_winner === 1 || match?.btp_winner === 2) {
		return match.btp_winner - 1;
	}
	return null;
}

function is_group_match(match) {
	const match_name = String(match?.setup?.match_name || '').trim();
	const phase_block_key = String(match?.setup?.phase_block_key || '').trim();
	return /^G\d+$/i.test(match_name) || /^G\d+$/i.test(phase_block_key);
}

function get_team_key(team) {
	const players = Array.isArray(team?.players) ? team.players : [];
	return players.map((player) => {
		if (player?.btp_id != null) return `btp:${player.btp_id}`;
		if (player?.name) return `name:${player.name}`;
		return `player:${JSON.stringify(player || null)}`;
	}).join('|');
}

function clone_team(team) {
	return JSON.parse(JSON.stringify(team || null));
}

function get_score_totals(match) {
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

function compare_group_stats(a, b) {
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

function sort_group_tie_group(group, pair_results) {
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

function compute_group_placements(matches, event_name) {
	const relevant_matches = (matches || []).filter((match) => {
		if (!match?.setup) return false;
		if (normalize_certificate_event_name(match.setup.event_name) !== event_name) return false;
		return is_group_match(match);
	});

	if (relevant_matches.length === 0) return [];

	const standings = new Map();
	const pair_results = new Map();

	for (const match of relevant_matches) {
		if (!match?.setup?.teams || match.setup.teams.length < 2) return [];
		const team_keys = match.setup.teams.slice(0, 2).map(get_team_key);
		if (!team_keys[0] || !team_keys[1] || team_keys[0] === team_keys[1]) return [];

		for (let team_index = 0; team_index < 2; team_index += 1) {
			const team_key = team_keys[team_index];
			if (!standings.has(team_key)) {
				standings.set(team_key, {
					team_key,
					team: clone_team(match.setup.teams[team_index]),
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

		const winner_team_index = get_winner_team_index(match);
		if (winner_team_index == null) return [];

		const loser_team_index = winner_team_index === 0 ? 1 : 0;
		const score_totals = get_score_totals(match);
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
	if (team_count < 2) return [];
	const expected_matches = (team_count * (team_count - 1)) / 2;
	if (relevant_matches.length !== expected_matches) return [];

	const base_sorted = [...standings.values()].sort((a, b) => {
		const cmp = compare_group_stats(a, b);
		if (cmp !== 0) return cmp;
		return a.team_key.localeCompare(b.team_key);
	});

	const resolved = [];
	for (let idx = 0; idx < base_sorted.length;) {
		const group = [base_sorted[idx]];
		idx += 1;
		while (idx < base_sorted.length && compare_group_stats(group[0], base_sorted[idx]) === 0) {
			group.push(base_sorted[idx]);
			idx += 1;
		}
		if (group.length === 1) {
			resolved.push(group[0]);
			continue;
		}
		const tie_break = sort_group_tie_group(group, pair_results);
		if (!tie_break) return [];
		resolved.push(...tie_break);
	}

	return resolved.map((entry, index) => ({
		place_from: index + 1,
		place_to: index + 1,
		team: clone_team(entry.team),
		source: 'group_matches',
		confidence: 'derived',
		event_name,
	}));
}

function get_btp_stage_placements(stage_matches, event_name) {
	for (const match of stage_matches || []) {
		if (!Array.isArray(match?.setup?.btp_group_rankings) || match.setup.btp_group_rankings.length === 0) continue;
		return match.setup.btp_group_rankings
			.map((entry) => ({
				place_from: Number(entry.place_from),
				place_to: Number(entry.place_to ?? entry.place_from),
				team: clone_team(entry.team),
				event_name: entry.event_name || event_name,
				source: entry.source || 'btp_ranking',
				confidence: entry.confidence || 'authoritative',
			}))
			.filter((entry) => Number.isFinite(entry.place_from) && Number.isFinite(entry.place_to) && entry.team)
			.sort((a, b) => a.place_from - b.place_from);
	}
	return [];
}

function get_exact_stage_placements(stage_matches, event_name) {
	const exact_placements = [];
	for (const match of stage_matches || []) {
		const match_event_name = normalize_certificate_event_name(match?.setup?.event_name);
		if (match_event_name !== event_name) continue;
		const winner_team_index = get_winner_team_index(match);
		if (winner_team_index == null) continue;
		const range = parse_place_range(match?.setup?.match_name);
		if (!range) continue;
		if ((range.place_to - range.place_from) !== 1) continue;
		if (!match?.setup?.teams || match.setup.teams.length < 2) continue;
		exact_placements.push({
			place_from: range.place_from,
			place_to: range.place_from,
			team: clone_team(match.setup.teams[winner_team_index]),
			event_name,
			source: 'placement_match',
			confidence: 'exact',
		});
		exact_placements.push({
			place_from: range.place_to,
			place_to: range.place_to,
			team: clone_team(match.setup.teams[winner_team_index === 0 ? 1 : 0]),
			event_name,
			source: 'placement_match',
			confidence: 'exact',
		});
	}
	return exact_placements.sort((a, b) => a.place_from - b.place_from);
}

function compute_event_placements(matches, event_name) {
	const stage_groups = group_matches_by_stage(matches, event_name);
	for (const stage_group of stage_groups) {
		const exact = get_exact_stage_placements(stage_group.matches, event_name);
		if (exact.length > 0) {
			return exact;
		}
		const btp = get_btp_stage_placements(stage_group.matches, event_name);
		if (btp.length > 0) {
			return btp;
		}
		const grouped = compute_group_placements(stage_group.matches, event_name);
		if (grouped.length > 0) {
			return grouped;
		}
	}
	return [];
}

function get_player_display_name(player) {
	if (!player) return '';
	if (player.name) return player.name;
	const firstname = player.firstname || '';
	const lastname = player.lastname || '';
	return `${firstname} ${lastname}`.trim();
}

function format_place_label(place_from, place_to) {
	if (place_from === place_to) {
		return `${place_from}. Platz`;
	}
	return `${place_from}.-${place_to}. Platz`;
}

function get_latest_scheduled_match_info(matches, event_name) {
	let latest = null;
	for (const match of matches || []) {
		if (normalize_certificate_event_name(match?.setup?.event_name) !== event_name) continue;
		const scheduled_date = String(match?.setup?.scheduled_date || '').trim();
		if (!scheduled_date) continue;
		const scheduled_time = String(match?.setup?.scheduled_time_str || '').trim();
		const timestamp = `${scheduled_date} ${scheduled_time || '00:00'}`;
		if (!latest || timestamp > latest.timestamp) {
			latest = {
				date: scheduled_date,
				time: scheduled_time,
				timestamp,
			};
		}
	}
	return latest;
}

function build_certificate_rows(matches, tournament, options = {}) {
	const title = {
		...split_tournament_title(tournament?.name, tournament),
	};
	if (options.veranstaltung_1 != null) {
		title.veranstaltung_1 = String(options.veranstaltung_1 || '').trim();
	}
	if (options.veranstaltung_2 != null) {
		title.veranstaltung_2 = String(options.veranstaltung_2 || '').trim();
	}
	const now = options.now || new Date();
	const datum = normalize_certificate_date(options.datum, now);
	const selected_event_names = options.selected_event_names instanceof Set
		? options.selected_event_names
		: null;
	const max_place = Number.isFinite(Number(options.max_place))
		? Number(options.max_place)
		: Infinity;
	const rows = [];
	const event_match_index = build_event_match_index(matches);
	const event_names = [...event_match_index.keys()];

	for (const event_name of event_names) {
		if (selected_event_names && !selected_event_names.has(event_name)) continue;
		const event_info = parse_event_name(event_name);
		const event_matches = event_match_index.get(event_name) || [];
		const placements = compute_event_placements(event_matches, event_name);
		for (const entry of placements) {
			if (entry.place_from !== entry.place_to) continue;
			if (entry.place_from > max_place) continue;
			const players = entry.team?.players || [];
			rows.push({
				veranstaltung_1: title.veranstaltung_1,
				veranstaltung_2: title.veranstaltung_2,
				datum,
				disziplin: event_info.disziplin,
				ak: event_info.ak,
				platz: format_place_label(entry.place_from, entry.place_to),
				spieler_1: get_player_display_name(players[0]),
				spieler_2: get_player_display_name(players[1]),
				event_name,
				place: entry.place_from,
			});
		}
	}

	rows.sort((a, b) => {
		let cmp = cbts_utils.natcmp(a.ak, b.ak);
		if (cmp !== 0) return cmp;
		cmp = cbts_utils.natcmp(a.disziplin, b.disziplin);
		if (cmp !== 0) return cmp;
		return Number(b.place || 0) - Number(a.place || 0);
	});

	return rows;
}

function certificate_rows_to_table(rows) {
	const header = [
		'Veranstaltung #1',
		'Veranstaltung #2',
		'Datum',
		'Disziplin',
		'AK',
		'Platz',
		'Spieler #1',
		'Spieler #2',
	];

	const table = rows.map((row) => ([
		row.veranstaltung_1,
		row.veranstaltung_2,
		row.datum,
		row.disziplin,
		row.ak,
		row.platz,
		row.spieler_1,
		row.spieler_2,
	]));
	table.unshift(header);
	return table;
}

function build_certificate_event_stats(matches) {
	const event_map = new Map();
	const event_match_index = build_event_match_index(matches);
	const event_names = [...event_match_index.keys()];
	for (const event_name of event_names) {
		const event_matches = event_match_index.get(event_name) || [];
		const placements = compute_event_placements(event_matches, event_name);
		if (placements.length === 0) continue;
		if (!event_map.has(event_name)) {
			const parsed = parse_event_name(event_name);
			event_map.set(event_name, {
				event_name,
				label: parsed.ak ? `${parsed.disziplin} ${parsed.ak}` : parsed.disziplin,
				disziplin: parsed.disziplin,
				ak: parsed.ak,
				code: parsed.code,
				kind: parsed.kind,
				available_places: new Set(),
			});
		}
		const event_entry = event_map.get(event_name);
		for (const placement of placements) {
			event_entry.available_places.add(placement.place_from);
		}
		const latest_scheduled_match = get_latest_scheduled_match_info(event_matches, event_name);
		event_entry.latest_scheduled_date = latest_scheduled_match?.date || '';
		event_entry.latest_scheduled_time = latest_scheduled_match?.time || '';
		event_entry.latest_scheduled_timestamp = latest_scheduled_match?.timestamp || '';
	}
	return [...event_map.values()].sort((a, b) => {
		let cmp = cbts_utils.natcmp(a.ak, b.ak);
		if (cmp !== 0) return cmp;
		cmp = cbts_utils.natcmp(a.disziplin, b.disziplin);
		if (cmp !== 0) return cmp;
		return cbts_utils.natcmp(a.event_name, b.event_name);
	});
}

function get_certificate_event_options(matches) {
	return build_certificate_event_stats(matches).map((event_entry) => ({
		event_name: event_entry.event_name,
		label: event_entry.label,
		disziplin: event_entry.disziplin,
		ak: event_entry.ak,
		code: event_entry.code,
		kind: event_entry.kind,
		available_places: [...event_entry.available_places].sort((a, b) => a - b),
		latest_scheduled_date: event_entry.latest_scheduled_date || '',
		latest_scheduled_time: event_entry.latest_scheduled_time || '',
		latest_scheduled_timestamp: event_entry.latest_scheduled_timestamp || '',
	}));
}

function event_is_complete_for_max_place(event_entry, max_place) {
	const limit = Number(max_place);
	if (!Number.isFinite(limit) || limit < 1) {
		return false;
	}
	const available_places = event_entry?.available_places instanceof Set
		? event_entry.available_places
		: new Set(event_entry?.available_places || []);
	for (let place = 1; place <= limit; place += 1) {
		if (!available_places.has(place)) {
			return false;
		}
	}
	return true;
}

function export_winners(options = {}) {
	return export_certificate_file('csv', options);
}

function build_certificate_export_data(options = {}) {
	const rows = build_certificate_rows(curt.matches, curt, {
		now: new Date(),
		...options,
	});
	const table = certificate_rows_to_table(rows);
	return {
		rows,
		table,
	};
}

function make_xlsx(table) {
	const xlsx_api = get_xlsx_api();
	const worksheet = xlsx_api.utils.aoa_to_sheet(table);
	const workbook = xlsx_api.utils.book_new();
	xlsx_api.utils.book_append_sheet(workbook, worksheet, 'Urkunden');
	return xlsx_api.write(workbook, {
		bookType: 'xlsx',
		type: 'array',
	});
}

function export_certificate_file(format, options = {}) {
	const { table } = build_certificate_export_data(options);
	if (format === 'xlsx') {
		const xlsx_data = make_xlsx(table);
		const blob = new Blob([xlsx_data], {
			type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		});
		save_file(blob, 'urkunden.xlsx');
		return;
	}

	const csv = make_csv(table);
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
	save_file(blob, 'urkunden.csv');
}

return {
	build_certificate_rows,
	build_certificate_export_data,
	certificate_rows_to_table,
	build_certificate_event_stats,
	event_is_complete_for_max_place,
	export_certificate_file,
	export_winners,
	format_place_label,
	get_certificate_event_options,
	make_xlsx,
	make_csv,
	normalize_certificate_date,
	normalize_certificate_event_name,
	parse_event_name,
	parse_place_range,
	split_tournament_title,
};

})();

/*@DEV*/
if ((typeof module !== 'undefined') && (typeof require !== 'undefined')) {
	var cbts_utils = require('./cbts_utils');
	var xlsx = require('xlsx');
	var save_file = function() {};
	try {
		save_file = require('../bup/bup/js/save_file.js');
	} catch (e) {
		try {
			save_file = require('../bup/js/save_file.js');
		} catch (ignored) {
		}
	}

	module.exports = ccsvexport;
}
/*/@DEV*/
