'use strict';

const assert = require('assert');

const { _describe, _it } = require('./tutils.js');
const bupws_v2 = require('../bts/bupws_v2');

_describe('bupws v2 display state', () => {
	const called_timestamp = 1770000000000;
	const pick_side_timestamp = called_timestamp + 5000;

	function build_state(warmup, presses) {
		return bupws_v2.build_display_state_v2({}, {
			tournament: { key: 'default' },
			court: { _id: 'default_6', num: 6 },
			display: { client_id: 'display-1' },
			display_settings: { displaymode_style: 'tournamentcourt', d_show_pause: true },
			match: {
				_id: 'match-1',
				presses: presses || [],
				setup: {
					match_id: 'match-1',
					state: 'called',
					called_timestamp,
					counting: '3x21',
					warmup,
					warmup_start: 180,
					warmup_ready: 150,
					teams: [
						{ players: [{ firstname: 'Max', lastname: 'Mustermann', btp_id: 1 }] },
						{ players: [{ firstname: 'Erika', lastname: 'Beispiel', btp_id: 2 }] },
					],
				},
			},
		});
	}

	function assert_timer(timer, expected) {
		assert(timer);
		Object.keys(expected).forEach((key) => {
			assert.strictEqual(timer[key], expected[key], key);
		});
	}

	_it('includes call-down warmup timer before the first tablet press', () => {
		const state = build_state('call-down');

		assert_timer(state.timers.active_timer, {
			start: called_timestamp,
			duration: 180000,
			exigent: 30499,
			upwards: false,
			restart: false,
		});
	});

	_it('includes call-up warmup timer before the first tablet press', () => {
		const state = build_state('call-up');

		assert_timer(state.timers.active_timer, {
			start: called_timestamp,
			duration: undefined,
			exigent: undefined,
			upwards: true,
			restart: false,
		});
	});

	_it('starts choise warmup timer after side selection', () => {
		const without_pick_side = build_state('choise');
		assert.strictEqual(without_pick_side.timers.active_timer, null);

		const state = build_state('choise', [
			{ type: 'pick_side', timestamp: pick_side_timestamp, team1_left: true },
		]);

		assert_timer(state.timers.active_timer, {
			start: pick_side_timestamp,
			duration: 180000,
			exigent: 30499,
			upwards: false,
			restart: true,
		});
	});

	_it('starts bwf-2016 warmup timer after side selection', () => {
		const without_pick_side = build_state('bwf-2016');
		assert.strictEqual(without_pick_side.timers.active_timer, null);

		const state = build_state('bwf-2016', [
			{ type: 'pick_side', timestamp: pick_side_timestamp, team1_left: true },
		]);

		assert_timer(state.timers.active_timer, {
			start: pick_side_timestamp,
			duration: 120000,
			exigent: 30499,
			upwards: false,
			restart: true,
		});
	});

	_it('starts legacy warmup timer after side selection', () => {
		const without_pick_side = build_state('legacy');
		assert.strictEqual(without_pick_side.timers.active_timer, null);

		const state = build_state('legacy', [
			{ type: 'pick_side', timestamp: pick_side_timestamp, team1_left: true },
		]);

		assert_timer(state.timers.active_timer, {
			start: pick_side_timestamp,
			duration: 120000,
			exigent: 5499,
			upwards: false,
			restart: true,
		});
	});

	_it('does not expose a timer for warmup mode none', () => {
		const state = build_state('none', [
			{ type: 'pick_side', timestamp: pick_side_timestamp, team1_left: true },
		]);

		assert.strictEqual(state.timers.active_timer, null);
	});
});
