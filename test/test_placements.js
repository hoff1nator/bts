'use strict';

const assert = require('assert');

const { _describe, _it } = require('./tutils.js');
const placements = require('../bts/placements.js');

function makeTeam(name) {
	return {
		name,
		players: [{ name }],
	};
}

function makeMatch(overrides = {}) {
	return {
		_id: overrides._id || 'm1',
		team1_won: overrides.team1_won,
		btp_winner: overrides.btp_winner,
		network_score: overrides.network_score,
		setup: {
			match_num: overrides.match_num || 1,
			event_name: overrides.event_name || 'ME U17',
			match_name: overrides.match_name || 'Finale',
			teams: overrides.teams || [makeTeam('A'), makeTeam('B')],
		},
	};
}

_describe('placements', () => {
	_it('parses direct and named placement ranges', () => {
		assert.deepStrictEqual(placements._parse_place_range('1/2'), { place_from: 1, place_to: 2 });
		assert.deepStrictEqual(placements._parse_place_range('Finale'), { place_from: 1, place_to: 2 });
		assert.deepStrictEqual(placements._parse_place_range('5/6'), { place_from: 5, place_to: 6 });
		assert.strictEqual(placements._parse_place_range('HF'), null);
	});

	_it('computes exact placements from finals and place matches', () => {
		const matches = [
			makeMatch({
				_id: 'final',
				match_num: 65,
				event_name: 'ME U17',
				match_name: '1/2',
				teams: [makeTeam('Winner Final'), makeTeam('Runner-up')],
				team1_won: true,
			}),
			makeMatch({
				_id: 'third',
				match_num: 64,
				event_name: 'ME U17',
				match_name: '3/4',
				teams: [makeTeam('Third Place'), makeTeam('Fourth Place')],
				team1_won: true,
			}),
			makeMatch({
				_id: 'fifth',
				match_num: 63,
				event_name: 'ME U17',
				match_name: '5/6',
				teams: [makeTeam('Sixth Place'), makeTeam('Fifth Place')],
				team1_won: false,
			}),
		];

		const result = placements.compute_event_placements(matches, { event_name: 'ME U17' });

		assert.deepStrictEqual(result.placements.map((p) => ({
			place_from: p.place_from,
			place_to: p.place_to,
			name: p.team.name,
		})), [
			{ place_from: 1, place_to: 1, name: 'Winner Final' },
			{ place_from: 2, place_to: 2, name: 'Runner-up' },
			{ place_from: 3, place_to: 3, name: 'Third Place' },
			{ place_from: 4, place_to: 4, name: 'Fourth Place' },
			{ place_from: 5, place_to: 5, name: 'Fifth Place' },
			{ place_from: 6, place_to: 6, name: 'Sixth Place' },
		]);
	});

	_it('ignores unfinished and non-placement matches', () => {
		const matches = [
			makeMatch({
				_id: 'hf',
				match_num: 49,
				event_name: 'ME U17',
				match_name: 'HF',
				teams: [makeTeam('A'), makeTeam('B')],
				team1_won: true,
			}),
			makeMatch({
				_id: 'open-final',
				match_num: 65,
				event_name: 'ME U17',
				match_name: '1/2',
				teams: [makeTeam('A'), makeTeam('B')],
				team1_won: undefined,
			}),
		];

		const result = placements.compute_event_placements(matches, { event_name: 'ME U17' });

		assert.deepStrictEqual(result.placements, []);
	});

	_it('groups placements by event from the database wrapper', async () => {
		const matches = [
			makeMatch({
				_id: 'me-final',
				match_num: 65,
				event_name: 'ME U17',
				match_name: '1/2',
				teams: [makeTeam('ME Winner'), makeTeam('ME Runner-up')],
				team1_won: true,
			}),
			makeMatch({
				_id: 'je-final',
				match_num: 68,
				event_name: 'JE U13',
				match_name: '1/2',
				teams: [makeTeam('JE Winner'), makeTeam('JE Runner-up')],
				team1_won: false,
			}),
		];
		const app = {
			db: {
				matches: {
					find_async: async () => matches,
				},
			},
		};

		const result = await placements.get_tournament_placements(app, 'default');

		assert.deepStrictEqual(result.map((event) => ({
			event_name: event.event_name,
			places: event.placements.map((placement) => placement.place_from),
		})), [
			{ event_name: 'JE U13', places: [1, 2] },
			{ event_name: 'ME U17', places: [1, 2] },
		]);
	});

	_it('derives placements from complete group matches', () => {
		const matches = [
			makeMatch({
				_id: 'g1',
				event_name: 'E U11',
				match_name: 'G1',
				teams: [makeTeam('Alpha'), makeTeam('Bravo')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				_id: 'g2',
				event_name: 'E U11',
				match_name: 'G2',
				teams: [makeTeam('Alpha'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 9], [21, 11]],
			}),
			makeMatch({
				_id: 'g3',
				event_name: 'E U11',
				match_name: 'G3',
				teams: [makeTeam('Alpha'), makeTeam('Delta')],
				team1_won: true,
				network_score: [[21, 8], [21, 7]],
			}),
			makeMatch({
				_id: 'g4',
				event_name: 'E U11',
				match_name: 'G4',
				teams: [makeTeam('Bravo'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 18], [21, 16]],
			}),
			makeMatch({
				_id: 'g5',
				event_name: 'E U11',
				match_name: 'G5',
				teams: [makeTeam('Bravo'), makeTeam('Delta')],
				team1_won: true,
				network_score: [[21, 17], [21, 19]],
			}),
			makeMatch({
				_id: 'g6',
				event_name: 'E U11',
				match_name: 'G6',
				teams: [makeTeam('Charlie'), makeTeam('Delta')],
				team1_won: true,
				network_score: [[21, 15], [21, 14]],
			}),
		];

		const result = placements.compute_event_placements(matches, { event_name: 'E U11' });

		assert.deepStrictEqual(result.placements.map((p) => ({
			place_from: p.place_from,
			name: p.team.name,
			source: p.source,
		})), [
			{ place_from: 1, name: 'Alpha', source: 'group_matches' },
			{ place_from: 2, name: 'Bravo', source: 'group_matches' },
			{ place_from: 3, name: 'Charlie', source: 'group_matches' },
			{ place_from: 4, name: 'Delta', source: 'group_matches' },
		]);
	});

	_it('does not derive placements from incomplete group matches', () => {
		const matches = [
			makeMatch({
				_id: 'g1',
				event_name: 'E U11',
				match_name: 'G1',
				teams: [makeTeam('Alpha'), makeTeam('Bravo')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				_id: 'g2',
				event_name: 'E U11',
				match_name: 'G2',
				teams: [makeTeam('Alpha'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 9], [21, 11]],
			}),
		];

		const result = placements.compute_event_placements(matches, { event_name: 'E U11' });

		assert.deepStrictEqual(result.placements, []);
	});

	_it('prefers authoritative BTP rankings over local group metrics', () => {
		const matches = [
			makeMatch({
				_id: 'g1',
				event_name: 'E U11',
				match_name: 'G1',
				teams: [makeTeam('Alpha'), makeTeam('Bravo')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				_id: 'g2',
				event_name: 'E U11',
				match_name: 'G2',
				teams: [makeTeam('Alpha'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 9], [21, 11]],
				setup: undefined,
			}),
		];
		matches[1].setup = {
			match_num: 1,
			event_name: 'E U11',
			match_name: 'G2',
			teams: [makeTeam('Alpha'), makeTeam('Charlie')],
			btp_group_rankings: [
				{ place_from: 1, place_to: 1, team: makeTeam('Bravo'), source: 'btp_ranking' },
				{ place_from: 2, place_to: 2, team: makeTeam('Alpha'), source: 'btp_ranking' },
				{ place_from: 3, place_to: 3, team: makeTeam('Charlie'), source: 'btp_ranking' },
			],
		};

		const result = placements.compute_event_placements(matches, { event_name: 'E U11' });

		assert.deepStrictEqual(result.placements.map((p) => ({
			place_from: p.place_from,
			name: p.team.name,
			source: p.source,
		})), [
			{ place_from: 1, name: 'Bravo', source: 'btp_ranking' },
			{ place_from: 2, name: 'Alpha', source: 'btp_ranking' },
			{ place_from: 3, name: 'Charlie', source: 'btp_ranking' },
		]);
	});
});
