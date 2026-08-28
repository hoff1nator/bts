'use strict';

const assert = require('assert');

const { _describe, _it } = require('./tutils.js');
const match_utils = require('../bts/match_utils.js');
const database = require('../bts/database');

function insert(db, collection, doc) {
	return new Promise((resolve, reject) => {
		db[collection].insert(doc, (err, inserted) => {
			if (err) return reject(err);
			resolve(inserted);
		});
	});
}

function find_one(db, collection, query) {
	return new Promise((resolve, reject) => {
		db[collection].findOne(query, (err, doc) => {
			if (err) return reject(err);
			resolve(doc);
		});
	});
}

_describe('match utils call escalation', () => {
	_it('add_called_timestamp also sets called_to_court/called_to_court_at', (done) => {
		const app = { clock: { now_ms: () => 5000 } };
		const match = { setup: {} };
		match_utils.add_called_timestamp(app, match, (err) => {
			assert.strictEqual(err, null);
			assert.strictEqual(match.setup.called_timestamp, 5000);
			assert.strictEqual(match.setup.called_to_court, true);
			assert.strictEqual(match.setup.called_to_court_at, 5000);
			assert.strictEqual(match.setup.state, 'oncourt');
			done();
		});
	});

	_it('remove_called_timestamp clears call-escalation and presence fields', (done) => {
		const match = {
			setup: {
				called_timestamp: 5000,
				called_to_court: true,
				called_to_court_at: 5000,
				second_call_at: 6000,
				final_call_at: 7000,
				teams_present: true,
				team1_present: true,
				team2_present: true,
				call_reminder_ack_level: 2,
			},
		};
		match_utils.remove_called_timestamp(match, (err) => {
			assert.strictEqual(err, null);
			assert.strictEqual(match.setup.called_to_court, undefined);
			assert.strictEqual(match.setup.called_to_court_at, undefined);
			assert.strictEqual(match.setup.second_call_at, undefined);
			assert.strictEqual(match.setup.final_call_at, undefined);
			assert.strictEqual(match.setup.teams_present, undefined);
			assert.strictEqual(match.setup.call_reminder_ack_level, undefined);
			assert.strictEqual(match.setup.state, 'scheduled');
			done();
		});
	});

	_it('sets second_call_at once the second-call threshold elapses', async () => {
		const db = await database.init_test();
		const now = 1000000;
		const app = { db, clock: { now_ms: () => now } };
		const tournament = {
			key: 'esc1',
			courts_to_call_enabled: true,
			second_call_s: 60,
			final_call_s: 60,
		};
		await insert(db, 'matches', {
			_id: 'm1',
			tournament_key: 'esc1',
			setup: {
				now_on_court: true,
				called_to_court: true,
				called_to_court_at: now - 61000,
				teams: [{ players: [] }, { players: [] }],
			},
		});

		await new Promise((resolve) => {
			match_utils.escalate_call_levels_for_tournament(app, tournament);
			setTimeout(resolve, 50);
		});

		const updated = await find_one(db, 'matches', { _id: 'm1' });
		assert.strictEqual(updated.setup.second_call_at, now - 1000);
		assert.strictEqual(updated.setup.final_call_at, undefined);
	});

	_it('sets final_call_at once the final-call threshold elapses after second call', async () => {
		const db = await database.init_test();
		const now = 1000000;
		const app = { db, clock: { now_ms: () => now } };
		const tournament = {
			key: 'esc2',
			courts_to_call_enabled: true,
			second_call_s: 60,
			final_call_s: 60,
		};
		await insert(db, 'matches', {
			_id: 'm2',
			tournament_key: 'esc2',
			setup: {
				now_on_court: true,
				called_to_court: true,
				called_to_court_at: now - 200000,
				second_call_at: now - 61000,
				teams: [{ players: [] }, { players: [] }],
			},
		});

		await new Promise((resolve) => {
			match_utils.escalate_call_levels_for_tournament(app, tournament);
			setTimeout(resolve, 50);
		});

		const updated = await find_one(db, 'matches', { _id: 'm2' });
		assert.strictEqual(updated.setup.final_call_at, now - 1000);
	});

	_it('does not escalate once teams_present is confirmed', async () => {
		const db = await database.init_test();
		const now = 1000000;
		const app = { db, clock: { now_ms: () => now } };
		const tournament = {
			key: 'esc3',
			courts_to_call_enabled: true,
			second_call_s: 60,
			final_call_s: 60,
		};
		await insert(db, 'matches', {
			_id: 'm3',
			tournament_key: 'esc3',
			setup: {
				now_on_court: true,
				called_to_court: true,
				called_to_court_at: now - 200000,
				teams_present: true,
				teams: [{ players: [] }, { players: [] }],
			},
		});

		await new Promise((resolve) => {
			match_utils.escalate_call_levels_for_tournament(app, tournament);
			setTimeout(resolve, 50);
		});

		const updated = await find_one(db, 'matches', { _id: 'm3' });
		assert.strictEqual(updated.setup.second_call_at, undefined);
	});

	_it('does not escalate before the threshold has elapsed', async () => {
		const db = await database.init_test();
		const now = 1000000;
		const app = { db, clock: { now_ms: () => now } };
		const tournament = {
			key: 'esc4',
			courts_to_call_enabled: true,
			second_call_s: 60,
			final_call_s: 60,
		};
		await insert(db, 'matches', {
			_id: 'm4',
			tournament_key: 'esc4',
			setup: {
				now_on_court: true,
				called_to_court: true,
				called_to_court_at: now - 10000,
				teams: [{ players: [] }, { players: [] }],
			},
		});

		await new Promise((resolve) => {
			match_utils.escalate_call_levels_for_tournament(app, tournament);
			setTimeout(resolve, 50);
		});

		const updated = await find_one(db, 'matches', { _id: 'm4' });
		assert.strictEqual(updated.setup.second_call_at, undefined);
	});
});
