'use strict';

const assert = require('assert');

const { _describe, _it } = require('./tutils.js');
const bupws_v2 = require('../bts/bupws_v2');
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

function make_ws(court_id) {
	const sent = [];
	return {
		readyState: 1,
		last_tournament_key: 'pres1',
		court_id,
		sendmsg: (msg) => sent.push(msg),
		_sent: sent,
	};
}

_describe('bupws_v2 presence update', () => {
	_it('sets team1_present on a single-team confirm, without teams_present yet', async () => {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1000 } };
		await insert(db, 'tournaments', { key: 'pres1' });
		await insert(db, 'matches', {
			_id: 'm1',
			tournament_key: 'pres1',
			setup: { now_on_court: true, court_id: 'c1', teams: [{ players: [] }, { players: [] }] },
		});
		const ws = make_ws('c1');

		await bupws_v2.async_handle_presence_update(app, ws, {
			tournament_key: 'pres1',
			match_id: 'm1',
			team1_present: true,
		});

		const updated = await find_one(db, 'matches', { _id: 'm1' });
		assert.strictEqual(updated.setup.team1_present, true);
		assert.strictEqual(updated.setup.team2_present, undefined);
		assert.strictEqual(updated.setup.teams_present, undefined);
	});

	_it('sets teams_present once both teams have confirmed across two calls', async () => {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1000 } };
		await insert(db, 'tournaments', { key: 'pres2' });
		await insert(db, 'matches', {
			_id: 'm2',
			tournament_key: 'pres2',
			setup: { now_on_court: true, court_id: 'c1', team1_present: true, teams: [{ players: [] }, { players: [] }] },
		});
		const ws = make_ws('c1');
		ws.last_tournament_key = 'pres2';

		await bupws_v2.async_handle_presence_update(app, ws, {
			tournament_key: 'pres2',
			match_id: 'm2',
			team2_present: true,
		});

		const updated = await find_one(db, 'matches', { _id: 'm2' });
		assert.strictEqual(updated.setup.team1_present, true);
		assert.strictEqual(updated.setup.team2_present, true);
		assert.strictEqual(updated.setup.teams_present, true);
	});

	_it('rejects presence updates for a match that is not on court', async () => {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1000 } };
		await insert(db, 'tournaments', { key: 'pres3' });
		await insert(db, 'matches', {
			_id: 'm3',
			tournament_key: 'pres3',
			setup: { now_on_court: false, court_id: 'c1', teams: [{ players: [] }, { players: [] }] },
		});
		const ws = make_ws('c1');
		ws.last_tournament_key = 'pres3';

		await bupws_v2.async_handle_presence_update(app, ws, {
			tournament_key: 'pres3',
			match_id: 'm3',
			team1_present: true,
		});

		const updated = await find_one(db, 'matches', { _id: 'm3' });
		assert.strictEqual(updated.setup.team1_present, undefined);
		assert.strictEqual(ws._sent.length, 1);
		assert.strictEqual(ws._sent[0].type, 'error');
	});

	_it('rejects presence updates from a panel assigned to a different court', async () => {
		const db = await database.init_test();
		const app = { db, clock: { now_ms: () => 1000 } };
		await insert(db, 'tournaments', { key: 'pres4' });
		await insert(db, 'matches', {
			_id: 'm4',
			tournament_key: 'pres4',
			setup: { now_on_court: true, court_id: 'c1', teams: [{ players: [] }, { players: [] }] },
		});
		const ws = make_ws('c2');
		ws.last_tournament_key = 'pres4';

		await bupws_v2.async_handle_presence_update(app, ws, {
			tournament_key: 'pres4',
			match_id: 'm4',
			team1_present: true,
		});

		const updated = await find_one(db, 'matches', { _id: 'm4' });
		assert.strictEqual(updated.setup.team1_present, undefined);
		assert.strictEqual(ws._sent.length, 1);
		assert.strictEqual(ws._sent[0].type, 'error');
	});
});
