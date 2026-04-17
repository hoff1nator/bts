'use strict';

const assert = require('assert');

const { _describe, _it } = require('./tutils.js');
const ccsvexport = require('../static/js/ccsvexport.js');

function makeTeam(player1, player2 = null) {
	const players = [{ name: player1 }];
	if (player2) players.push({ name: player2 });
	return { players };
}

function makeMatch(overrides = {}) {
	return {
		team1_won: overrides.team1_won,
		btp_winner: overrides.btp_winner,
		network_score: overrides.network_score,
		setup: {
			match_name: overrides.match_name || 'Finale',
			event_name: overrides.event_name || 'HE U19',
			teams: overrides.teams || [makeTeam('Alice Winner'), makeTeam('Bob Runner-up')],
			scheduled_date: overrides.scheduled_date,
			scheduled_time_str: overrides.scheduled_time_str,
			stage_id: overrides.stage_id,
			stage_display_order: overrides.stage_display_order,
			draw_position: overrides.draw_position,
		},
	};
}

_describe('ccsvexport', () => {
	_it('splits the tournament title for certificate lines', () => {
		assert.deepStrictEqual(
			ccsvexport.split_tournament_title('Nord-Cup - Badmintonverband Bremen'),
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
			}
		);
	});

	_it('maps event names to discipline and age group', () => {
		assert.deepStrictEqual(
			ccsvexport.parse_event_name('HD U19'),
			{ disziplin: 'Herrendoppel', ak: 'U19', code: 'HD', kind: 'double' }
		);
		assert.deepStrictEqual(
			ccsvexport.parse_event_name('ME U17'),
			{ disziplin: 'Mädcheneinzel', ak: 'U17', code: 'ME', kind: 'single' }
		);
	});

	_it('builds certificate rows for finals and place matches', () => {
		const rows = ccsvexport.build_certificate_rows([
			makeMatch({
				match_name: 'Finale',
				event_name: 'HE U19',
				teams: [makeTeam('Anton Sieger'), makeTeam('Bela Zweiter')],
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'HD U19',
				teams: [makeTeam('Carl Eins', 'Dora Zwei'), makeTeam('Emil Drei', 'Frieda Vier')],
				team1_won: false,
			}),
		], {
			name: 'Nord-Cup - Badmintonverband Bremen',
		}, {
			now: new Date('2026-04-19T10:00:00Z'),
		});

		assert.deepStrictEqual(rows, [
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Herrendoppel',
				ak: 'U19',
				platz: '4. Platz',
				spieler_1: 'Carl Eins',
				spieler_2: 'Dora Zwei',
				event_name: 'HD U19',
				place: 4,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Herrendoppel',
				ak: 'U19',
				platz: '3. Platz',
				spieler_1: 'Emil Drei',
				spieler_2: 'Frieda Vier',
				event_name: 'HD U19',
				place: 3,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Herreneinzel',
				ak: 'U19',
				platz: '2. Platz',
				spieler_1: 'Bela Zweiter',
				spieler_2: '',
				event_name: 'HE U19',
				place: 2,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Herreneinzel',
				ak: 'U19',
				platz: '1. Platz',
				spieler_1: 'Anton Sieger',
				spieler_2: '',
				event_name: 'HE U19',
				place: 1,
			},
		]);
	});

	_it('creates a semicolon-separated csv table for Word', () => {
		const table = ccsvexport.certificate_rows_to_table([
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Bremen',
				datum: '19.04.2026',
				disziplin: 'Herreneinzel',
				ak: 'U19',
				platz: '1. Platz',
				spieler_1: 'Max Mustermann',
				spieler_2: '',
			},
		]);

		assert.strictEqual(
			ccsvexport.make_csv(table),
			'Veranstaltung #1;Veranstaltung #2;Datum;Disziplin;AK;Platz;Spieler #1;Spieler #2\r\nNord-Cup;Bremen;19.04.2026;Herreneinzel;U19;1. Platz;Max Mustermann;'
		);
	});

	_it('creates an xlsx workbook buffer for Word/Excel import', () => {
		const table = ccsvexport.certificate_rows_to_table([
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Bremen',
				datum: '19.04.2026',
				disziplin: 'Herreneinzel',
				ak: 'U19',
				platz: '1. Platz',
				spieler_1: 'Max Mustermann',
				spieler_2: '',
			},
		]);

		const workbook = ccsvexport.make_xlsx(table);
		assert.ok(workbook instanceof ArrayBuffer);
		assert.ok(workbook.byteLength > 100);
	});

	_it('supports export overrides for title, date, discipline selection and max place', () => {
		const rows = ccsvexport.build_certificate_rows([
			makeMatch({
				match_name: 'Finale',
				event_name: 'HE U19',
				teams: [makeTeam('Anton Sieger'), makeTeam('Bela Zweiter')],
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'HD U19',
				teams: [makeTeam('Carl Eins', 'Dora Zwei'), makeTeam('Emil Drei', 'Frieda Vier')],
				team1_won: false,
			}),
		], {
			name: 'Nord-Cup - Badmintonverband Bremen',
		}, {
			veranstaltung_1: 'BTS Nord',
			veranstaltung_2: 'Urkunden 2026',
			datum: '2026-04-20',
			max_place: 3,
			selected_event_names: new Set(['HD U19']),
		});

		assert.deepStrictEqual(rows, [
			{
				veranstaltung_1: 'BTS Nord',
				veranstaltung_2: 'Urkunden 2026',
				datum: '20.04.2026',
				disziplin: 'Herrendoppel',
				ak: 'U19',
				platz: '3. Platz',
				spieler_1: 'Emil Drei',
				spieler_2: 'Frieda Vier',
				event_name: 'HD U19',
				place: 3,
			},
		]);
	});

	_it('lists certificate disciplines from placement matches', () => {
		const result = ccsvexport.get_certificate_event_options([
			makeMatch({
				match_name: 'Finale',
				event_name: 'HE U19',
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'HD U19',
				team1_won: true,
			}),
			makeMatch({
				match_name: 'G1',
				event_name: 'ME U17',
			}),
		]);

		assert.deepStrictEqual(result, [
			{
				event_name: 'HD U19',
				label: 'Herrendoppel U19',
				disziplin: 'Herrendoppel',
				ak: 'U19',
				code: 'HD',
				kind: 'double',
				available_places: [3, 4],
				latest_scheduled_date: '',
				latest_scheduled_time: '',
				latest_scheduled_timestamp: '',
			},
			{
				event_name: 'HE U19',
				label: 'Herreneinzel U19',
				disziplin: 'Herreneinzel',
				ak: 'U19',
				code: 'HE',
				kind: 'single',
				available_places: [1, 2],
				latest_scheduled_date: '',
				latest_scheduled_time: '',
				latest_scheduled_timestamp: '',
			},
		]);
	});

	_it('detects whether all relevant places are available for a discipline', () => {
		const stats = ccsvexport.build_certificate_event_stats([
			makeMatch({
				match_name: 'Finale',
				event_name: 'HE U19',
				team1_won: true,
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'HE U19',
				team1_won: true,
			}),
		]);

		assert.strictEqual(
			ccsvexport.event_is_complete_for_max_place(stats[0], 3),
			true
		);
		assert.strictEqual(
			ccsvexport.event_is_complete_for_max_place(stats[0], 5),
			false
		);
	});

	_it('builds certificate rows for complete group-only events', () => {
		const rows = ccsvexport.build_certificate_rows([
			makeMatch({
				match_name: 'G1',
				event_name: 'E U11',
				teams: [makeTeam('Alpha'), makeTeam('Bravo')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				match_name: 'G2',
				event_name: 'E U11',
				teams: [makeTeam('Alpha'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 9], [21, 11]],
			}),
			makeMatch({
				match_name: 'G3',
				event_name: 'E U11',
				teams: [makeTeam('Alpha'), makeTeam('Delta')],
				team1_won: true,
				network_score: [[21, 8], [21, 7]],
			}),
			makeMatch({
				match_name: 'G4',
				event_name: 'E U11',
				teams: [makeTeam('Bravo'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 18], [21, 16]],
			}),
			makeMatch({
				match_name: 'G5',
				event_name: 'E U11',
				teams: [makeTeam('Bravo'), makeTeam('Delta')],
				team1_won: true,
				network_score: [[21, 17], [21, 19]],
			}),
			makeMatch({
				match_name: 'G6',
				event_name: 'E U11',
				teams: [makeTeam('Charlie'), makeTeam('Delta')],
				team1_won: true,
				network_score: [[21, 15], [21, 14]],
			}),
		], {
			name: 'Nord-Cup - Badmintonverband Bremen',
		}, {
			now: new Date('2026-04-19T10:00:00Z'),
			max_place: 3,
		});

		assert.deepStrictEqual(rows, [
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Einzel',
				ak: 'U11',
				platz: '3. Platz',
				spieler_1: 'Charlie',
				spieler_2: '',
				event_name: 'E U11',
				place: 3,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Einzel',
				ak: 'U11',
				platz: '2. Platz',
				spieler_1: 'Bravo',
				spieler_2: '',
				event_name: 'E U11',
				place: 2,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Einzel',
				ak: 'U11',
				platz: '1. Platz',
				spieler_1: 'Alpha',
				spieler_2: '',
				event_name: 'E U11',
				place: 1,
			},
		]);
	});

	_it('lists complete group-only disciplines for certificate export', () => {
		const result = ccsvexport.get_certificate_event_options([
			makeMatch({
				match_name: 'G1',
				event_name: 'E U11',
				teams: [makeTeam('Alpha'), makeTeam('Bravo')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				match_name: 'G2',
				event_name: 'E U11',
				teams: [makeTeam('Alpha'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 9], [21, 11]],
			}),
			makeMatch({
				match_name: 'G3',
				event_name: 'E U11',
				teams: [makeTeam('Bravo'), makeTeam('Charlie')],
				team1_won: true,
				network_score: [[21, 18], [21, 16]],
			}),
		]);

		assert.deepStrictEqual(result, [
			{
				event_name: 'E U11',
				label: 'Einzel U11',
				disziplin: 'Einzel',
				ak: 'U11',
				code: 'E',
				kind: 'single',
				available_places: [1, 2, 3],
				latest_scheduled_date: '',
				latest_scheduled_time: '',
				latest_scheduled_timestamp: '',
			},
		]);
	});

	_it('includes the latest scheduled match date in certificate event options', () => {
		const result = ccsvexport.get_certificate_event_options([
			makeMatch({
				match_name: 'Finale',
				event_name: 'HE U19',
				team1_won: true,
				scheduled_date: '2026-04-19',
				scheduled_time_str: '14:00',
			}),
			makeMatch({
				match_name: '3/4',
				event_name: 'HE U19',
				team1_won: true,
				scheduled_date: '2026-04-20',
				scheduled_time_str: '09:30',
			}),
		]);

		assert.deepStrictEqual(result, [
			{
				event_name: 'HE U19',
				label: 'Herreneinzel U19',
				disziplin: 'Herreneinzel',
				ak: 'U19',
				code: 'HE',
				kind: 'single',
				available_places: [1, 2, 3, 4],
				latest_scheduled_date: '2026-04-20',
				latest_scheduled_time: '09:30',
				latest_scheduled_timestamp: '2026-04-20 09:30',
			},
		]);
	});

	_it('prefers authoritative BTP rankings for certificate rows', () => {
		const matches = [
			makeMatch({
				match_name: 'G1',
				event_name: 'E U11',
				teams: [makeTeam('Alpha'), makeTeam('Bravo')],
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
		];
		matches[0].setup.btp_group_rankings = [
			{ place_from: 1, place_to: 1, team: makeTeam('Bravo'), source: 'btp_ranking' },
			{ place_from: 2, place_to: 2, team: makeTeam('Alpha'), source: 'btp_ranking' },
		];

		const rows = ccsvexport.build_certificate_rows(matches, {
			name: 'Nord-Cup - Badmintonverband Bremen',
		}, {
			now: new Date('2026-04-19T10:00:00Z'),
			max_place: 2,
		});

		assert.deepStrictEqual(rows, [
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Einzel',
				ak: 'U11',
				platz: '2. Platz',
				spieler_1: 'Alpha',
				spieler_2: '',
				event_name: 'E U11',
				place: 2,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Einzel',
				ak: 'U11',
				platz: '1. Platz',
				spieler_1: 'Bravo',
				spieler_2: '',
				event_name: 'E U11',
				place: 1,
			},
		]);
	});

	_it('merges group and playoff draw names into one certificate discipline option', () => {
		const result = ccsvexport.get_certificate_event_options([
			makeMatch({
				match_name: 'G1',
				event_name: 'ME U17 - Gruppe A',
				team1_won: true,
				network_score: [[21, 10], [21, 12]],
			}),
			makeMatch({
				match_name: 'G2',
				event_name: 'ME U17 - Gruppe B',
				team1_won: true,
				network_score: [[21, 11], [21, 13]],
			}),
			makeMatch({
				match_name: 'Finale',
				event_name: 'ME U17 - Position 1-4',
				team1_won: true,
			}),
		]);

		assert.deepStrictEqual(result, [
			{
				event_name: 'ME U17',
				label: 'Mädcheneinzel U17',
				disziplin: 'Mädcheneinzel',
				ak: 'U17',
				code: 'ME',
				kind: 'single',
				available_places: [1, 2],
				latest_scheduled_date: '',
				latest_scheduled_time: '',
				latest_scheduled_timestamp: '',
			},
		]);
	});

	_it('prefers the best stage when group and playoff stages exist for one discipline', () => {
		const result = ccsvexport.build_certificate_rows([
			makeMatch({
				match_name: 'G1',
				event_name: 'ME U17 - Gruppe A',
				team1_won: true,
				teams: [makeTeam('Group Winner'), makeTeam('Group Runner-up')],
				network_score: [[21, 10], [21, 12]],
				stage_id: 'group-stage',
				stage_display_order: 2,
				draw_position: 1,
			}),
			makeMatch({
				match_name: 'Finale',
				event_name: 'ME U17 - Position 1-4',
				team1_won: true,
				teams: [makeTeam('Playoff Winner'), makeTeam('Playoff Runner-up')],
				stage_id: 'playoff-stage',
				stage_display_order: 1,
				draw_position: 1,
			}),
		], {
			name: 'Nord-Cup - Badmintonverband Bremen',
		}, {
			now: new Date('2026-04-19T10:00:00Z'),
			max_place: 2,
		});

		assert.deepStrictEqual(result, [
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Mädcheneinzel',
				ak: 'U17',
				platz: '2. Platz',
				spieler_1: 'Playoff Runner-up',
				spieler_2: '',
				event_name: 'ME U17',
				place: 2,
			},
			{
				veranstaltung_1: 'Nord-Cup',
				veranstaltung_2: 'Badmintonverband Bremen',
				datum: '19.04.2026',
				disziplin: 'Mädcheneinzel',
				ak: 'U17',
				platz: '1. Platz',
				spieler_1: 'Playoff Winner',
				spieler_2: '',
				event_name: 'ME U17',
				place: 1,
			},
		]);
	});
});
