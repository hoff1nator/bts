'use strict';

const assert = require('assert');

const { _describe, _it } = require('./tutils.js');
const match_utils = require('../bts/match_utils.js');

function make_match() {
	return {
		_id: 'm1',
		setup: {
			now_on_court: true,
			state: 'running',
			teams: [
				{
					players: [
						{ btp_id: 11, name: 'Player 11', checked_in: true, tablet_break_active: true },
						{ btp_id: 12, name: 'Player 12', checked_in: true, tablet_break_active: true },
					],
				},
				{
					players: [
						{ btp_id: 21, name: 'Player 21', checked_in: true, tablet_break_active: true },
						{ btp_id: 22, name: 'Player 22', checked_in: true, tablet_break_active: true },
					],
				},
			],
		},
	};
}

_describe('match utils player state helpers', () => {
	_it('ignores incomplete on-court setup without crashing', async () => {
		const match = make_match();

		const result = await match_utils.calc_match_set_player_on_court(match, {
			court_id: 'default_5',
			teams: [{ players: [] }],
		});

		assert.strictEqual(result, null);
		assert.strictEqual(match.setup.state, 'running');
	});

	_it('sets player on court by BTP id instead of fixed player position', async () => {
		const match = make_match();

		const result = await match_utils.calc_match_set_player_on_court(match, {
			court_id: 'default_5',
			teams: [
				{ players: [{ btp_id: 12 }] },
				{ players: [{ btp_id: 22 }] },
			],
		});

		assert.strictEqual(result, match);
		assert.strictEqual(match.setup.state, 'blocked');
		assert.strictEqual(match.setup.teams[0].players[0].now_playing_on_court, undefined);
		assert.strictEqual(match.setup.teams[0].players[1].now_playing_on_court, 'default_5');
		assert.strictEqual(match.setup.teams[1].players[0].now_playing_on_court, undefined);
		assert.strictEqual(match.setup.teams[1].players[1].now_playing_on_court, 'default_5');
		assert.strictEqual(match.setup.teams[0].players[1].tablet_break_active, false);
		assert.strictEqual(match.setup.teams[1].players[1].tablet_break_active, false);
	});

	_it('does not block a match against its own players when it is the one just called', async () => {
		const match = make_match();

		// This mirrors call_match/switch_court: after a match is persisted
		// as on-court, set_player_on_court re-queries every match in the
		// tournament (including this one) and checks each against the
		// just-called match's own player list - without excluding the
		// match's own _id, it always matches itself here and used to
		// overwrite its own state to 'blocked' as a side effect of being
		// called, which then stuck forever (BTP sync treats 'blocked' as
		// sticky while still on court).
		const result = await match_utils.calc_match_set_player_on_court(match, {
			court_id: 'default_5',
			teams: match.setup.teams,
		}, match._id);

		assert.strictEqual(result, null);
		assert.strictEqual(match.setup.state, 'running');
		assert.strictEqual(match.setup.teams[0].players[0].now_playing_on_court, undefined);
	});

	_it('still blocks a different match sharing a player with the one just called', async () => {
		const match = make_match();
		match._id = 'm2';

		const result = await match_utils.calc_match_set_player_on_court(match, {
			court_id: 'default_5',
			teams: [{ players: [{ btp_id: 11 }] }, { players: [] }],
		}, 'm1');

		assert.strictEqual(result, match);
		assert.strictEqual(match.setup.state, 'blocked');
	});

	_it('ignores incomplete tablet-operator setup without crashing', async () => {
		const match = make_match();

		const result = await match_utils.calc_match_set_player_on_tablet(match, {
			court_id: 'default_5',
			tabletoperators: null,
		});

		assert.strictEqual(result, null);
		assert.strictEqual(match.setup.teams[0].players[0].checked_in, true);
	});

	_it('sets tablet operator by BTP id instead of fixed player position', async () => {
		const match = make_match();

		const result = await match_utils.calc_match_set_player_on_tablet(match, {
			court_id: 'default_6',
			tabletoperators: [{ btp_id: 21 }],
		});

		assert.strictEqual(result, match);
		assert.strictEqual(match.setup.teams[0].players[0].now_tablet_on_court, undefined);
		assert.strictEqual(match.setup.teams[1].players[0].now_tablet_on_court, 'default_6');
		assert.strictEqual(match.setup.teams[1].players[0].checked_in, false);
	});
});
