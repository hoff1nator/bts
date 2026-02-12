'use strict';

const assert = require('assert');
const async = require('async');
const path = require('path');

const admin = require('./admin');
const btp_manager = require('./btp_manager');
const stournament = require('./stournament');
const ticker_manager = require('./ticker_manager');
const utils = require('./utils');

// Returns true iff all params are met
function _require_params(req, res, keys) {
	for (const k of keys) {
		if (! Object.prototype.hasOwnProperty.call(req.body, k)) {
			res.json({
				status: 'error',
				message: 'Missing field ' + k + ' in request',
			});
			return false;
		}
	}
	return true;
}

function courts_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	stournament.get_courts(req.app.db, tournament_key, function(err, courts) {
		const reply = (err ? {
			status: 'error',
			message: err.message,
		} : {
			status: 'ok',
			courts,
		});

		res.json(reply);
	});
}

function create_match_representation(tournament, match) {
	const setup = match.setup;
	setup.match_id = 'bts_' + match._id;
	setup.team_competition = tournament.is_team;
	setup.nation_competition = tournament.is_nation_competition;
	for (const t of setup.teams) {
		if (!t.players) continue;

		for (const p of t.players) {
			if (p.lastname) continue;

			const asian_m = /^([A-Z]+)\s+(.*)$/.exec(p.name);
			if (asian_m) {
				p.lastname = asian_m[1];
				p.firstname = asian_m[2];
				p._guess_info = 'bts_asian';
				continue;
			}

			const m = /^(.*)\s+(\S+)$/.exec(p.name);
			if (m) {
				p.firstname = m[1];
				p.lastname = m[2];
				p._guess_info = 'bts_western';
			} else {
				p.firstname = '';
				p.lastname = p.name;
				p._guess_info = 'bts_single';
			}
		}
	}

	const res = {
		setup,
		network_score: match.network_score,
		network_team1_left: match.network_team1_left,
		network_team1_serving: match.network_team1_serving,
		network_teams_player1_even: match.network_teams_player1_even,
	};
	if (match.presses) {
		res.presses_json = JSON.stringify(match.presses);
	}
	return res;
}

function create_event_representation(tournament) {
	const res = {
		id: 'bts_' + tournament.key,
		tournament_name: tournament.name,
	};
	if (tournament.logo_id) {
		res.tournament_logo_url = `/h/${encodeURIComponent(tournament.key)}/logo/${tournament.logo_id}`;
	}
	res.tournament_logo_background_color = tournament.logo_background_color || '#000000';
	res.tournament_logo_foreground_color = tournament.logo_foreground_color || '#aaaaaa';
	return res;
}

function matches_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	const now = Date.now();
	const show_still = now - 60000;
	const query = {
		tournament_key,
		$or: [
			{
				$and: [
					{
						team1_won: {
							$ne: true,
						},
					},
					{
						team1_won: {
							$ne: false,
						},
					},
				],
			},
			{
				end_ts: {
					$gt: show_still,
				},
			},
		],
	};
	if (req.query.court) {
		query['setup.court_id'] = req.query.court;
	} else {
		query['setup.court_id'] = {$exists: true};
	}

	req.app.db.fetch_all([{
		queryFunc: '_findOne',
		collection: 'tournaments',
		query: {key: tournament_key},
	}, {
		collection: 'matches',
		query,
	}, {
		collection: 'courts',
		query: {tournament_key},
	}], function(err, tournament, db_matches, db_courts) {
		if (err) {
			res.json({
				status: 'error',
				message: err.message,
			});
			return;
		}

		let matches = db_matches.map(dbm => create_match_representation(tournament, dbm));
		if (tournament.only_now_on_court) {
			matches = matches.filter(m => m?.setup.now_on_court);
		}

		db_courts.sort(utils.cmp_key('num'));
		const courts = db_courts.map(function(dc) {
			var res = {
				court_id: dc._id,
				label: dc.num,
			};
			if (dc.match_id) {
				res.match_id = 'bts_' + dc.match_id;
			}
			return res;
		});

		const event = create_event_representation(tournament);
		event.matches = matches;
		event.courts = courts;

		const reply = {
			status: 'ok',
			event,
		};
		res.json(reply);
	});
}

function matchinfo_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	const match_id = req.params.match_id;

	const query = {
		tournament_key,
		_id: match_id,
	};

	req.app.db.fetch_all([{
		collection: 'tournaments',
		query: {key: tournament_key},
	}, {
		collection: 'matches',
		query,
	}], function(err, tournaments, matches) {
		if (err) {
			res.json({
				status: 'error',
				message: err.message,
			});
			return;
		}

		if (tournaments.length !== 1) {
			res.json({
				status: 'error',
				message: 'Cannot find tournament',
			});
			return;
		}

		if (matches.length !== 1) {
			res.json({
				status: 'error',
				message: 'Cannot find match',
			});
			return;
		}

		const [tournament] = tournaments;
		const [match] = matches;
		const event = create_event_representation(tournament);
		const match_repr = create_match_representation(tournament, match);
		if (match_repr.presses_json) {
			// Parse JSON-in-JSON (for performance reasons) for nicer output
			match_repr.presses = JSON.parse(match_repr.presses_json);
			delete match_repr.presses_json;
		}
		event.matches = [match_repr];

		const reply = {
			status: 'ok',
			event,
		};
		res.header('Content-Type', 'application/json');
        res.send(JSON.stringify(reply, null, 4));
	});
}

function score_handler(req, res) {
	if (!_require_params(req, res, ['duration_ms', 'end_ts', 'network_score', 'team1_won', 'presses'])) return;

	const tournament_key = req.params.tournament_key;
	const match_id = req.params.match_id;
	const query = {
		_id: match_id,
		tournament_key,
	};
	const update = {
		network_score: req.body.network_score,
		network_team1_left: req.body.network_team1_left,
		network_team1_serving: req.body.network_team1_serving,
		network_teams_player1_even: req.body.network_teams_player1_even,
		team1_won: req.body.team1_won,
		presses: req.body.presses,
		duration_ms: req.body.duration_ms,
		end_ts: req.body.end_ts,
	};
	if (update.team1_won !== undefined) {
		update.btp_winner = (update.team1_won === true) ? 1 : 2;
		update.btp_needsync = true;
	}
	if (req.body.shuttle_count) {
		update.shuttle_count = req.body.shuttle_count;
	}

	const court_q = {
		tournament_key,
		_id: req.body.court_id,
	};
	const db = req.app.db;
 
	async.waterfall([
		cb => db.matches.update(query, {$set: update}, {returnUpdatedDocs: true}, (err, _, match) => cb(err, match)),
		(match, cb) => {
			if (!match) {
				return cb(new Error('Cannot find match ' + JSON.stringify(match)));
			}
			return cb(null, match);
		},
		(match, cb) => db.courts.findOne(court_q, (err, court) => cb(err, match, court)),
		(match, court, cb) => {
			if (court.match_id === match_id) {
				cb(null, match, court, false);
				return;
			}

			db.courts.update(court_q, {$set: {match_id: match_id}}, {}, (err) => {
				cb(err, match, court, true);
			});
		},
		(match, court, changed_court, cb) => {
			if (changed_court) {
				admin.notify_change(req.app, tournament_key, 'court_current_match', {
					match_id,
					court_id: court._id,
				});
			}
			cb(null, match, changed_court);
		},
		(match, changed_court, cb) => {
			btp_manager.update_score(req.app, match);

			cb(null, match, changed_court);
		},
		(match, changed_court, cb) => {
			if (changed_court) {
				ticker_manager.pushall(req.app, tournament_key);
			} else {
				ticker_manager.update_score(req.app, match);
			}

			cb();
		},
	], function(err) {
		if (err) {
			res.json({
				status: 'error',
				message: err.message,
			});
			return;
		}

		admin.notify_change(req.app, tournament_key, 'score', {
			match_id,
			network_score: update.network_score,
			team1_won: update.team1_won,
			shuttle_count: update.shuttle_count,
		});
		res.json({status: 'ok'});
	});
}

function court_overview_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Court Overview</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
	background: #111;
	color: #eee;
	font-family: sans-serif;
	padding: 2vmin;
	display: flex;
	flex-direction: column;
	height: 100%;
}
h1 { font-size: 3vmin; margin-bottom: 1.5vmin; color: #ccc; flex-shrink: 0; }
#courts {
	flex: 1 1 0;
	display: grid;
	gap: 2vmin;
	min-height: 0;
}
.court-card {
	border-radius: 1.5vmin;
	padding: 2vmin;
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	transition: background 0.4s, border-color 0.4s;
	border: 3px solid transparent;
	overflow: hidden;
	min-height: 0;
}
.court-card.status-red    { background: #2d0a0a; border-color: #c62828; }
.court-card.status-yellow { background: #2d2200; border-color: #f9a825; }
.court-card.status-green  { background: #0d2818; border-color: #2e7d32; }
.court-name { font-size: 3.5vmin; font-weight: bold; margin-bottom: 1vmin; }
.court-status { font-size: 2vmin; color: #aaa; margin-bottom: 0.5vmin; }
.court-players { font-size: 2.2vmin; color: #ddd; line-height: 1.4; }
.court-timer { font-size: 2vmin; color: #f9a825; margin-top: 0.5vmin; }
.status-dot {
	display: inline-block;
	width: 1.2vmin; height: 1.2vmin;
	min-width: 8px; min-height: 8px;
	border-radius: 50%;
	margin-right: 0.8vmin;
	vertical-align: middle;
}
.status-red .status-dot    { background: #c62828; }
.status-yellow .status-dot { background: #f9a825; }
.status-green .status-dot  { background: #2e7d32; }
#last-update { font-size: 1.5vmin; color: #555; margin-top: 1vmin; flex-shrink: 0; }
</style>
</head>
<body>
<h1>Court Overview</h1>
<div id="courts"></div>
<div id="last-update"></div>
<script>
var TOURNAMENT_KEY = ${JSON.stringify(tournament_key)};
var POLL_INTERVAL = 5000;
var _waiting_since = {};  // match_id -> timestamp when first seen without teams_present

function players_str(setup, team_idx) {
	var team = setup.teams && setup.teams[team_idx];
	if (!team || !team.players || team.players.length === 0) return 'N.N.';
	if (setup.is_doubles && team.players.length > 1) {
		return team.players[0].name + ' / ' + team.players[1].name;
	}
	return team.players[0].name;
}

function format_duration(ms) {
	var s = Math.floor(ms / 1000);
	var m = Math.floor(s / 60);
	s = s % 60;
	return m + 'min ' + (s < 10 ? '0' : '') + s + 's';
}

function render(courts, matches) {
	var now = Date.now();
	var container = document.getElementById('courts');

	// Build match index by court_id
	var by_court = {};
	for (var i = 0; i < matches.length; i++) {
		var m = matches[i];
		var cid = m.setup && m.setup.court_id;
		if (cid && !by_court[cid]) {
			by_court[cid] = m;
		}
	}

	// Track waiting_since for yellow matches
	for (var i = 0; i < courts.length; i++) {
		var court = courts[i];
		var match = by_court[court.court_id];
		if (match && !match.setup.teams_present) {
			var mid = match.setup.match_id;
			if (!_waiting_since[mid]) {
				_waiting_since[mid] = now;
			}
		}
	}
	// Clean up old entries
	var active_ids = {};
	for (var i = 0; i < matches.length; i++) {
		active_ids[matches[i].setup.match_id] = true;
	}
	Object.keys(_waiting_since).forEach(function(mid) {
		if (!active_ids[mid]) delete _waiting_since[mid];
	});

	container.innerHTML = '';
	for (var i = 0; i < courts.length; i++) {
		var court = courts[i];
		var match = by_court[court.court_id];

		var card = document.createElement('div');
		card.className = 'court-card';

		var name_el = document.createElement('div');
		name_el.className = 'court-name';

		var dot = document.createElement('span');
		dot.className = 'status-dot';
		name_el.appendChild(dot);
		name_el.appendChild(document.createTextNode(court.label || court.court_id));
		card.appendChild(name_el);

		var status_el = document.createElement('div');
		status_el.className = 'court-status';

		var players_el = document.createElement('div');
		players_el.className = 'court-players';

		var timer_el = document.createElement('div');
		timer_el.className = 'court-timer';

		if (!match) {
			card.classList.add('status-red');
			status_el.textContent = 'No game';
		} else if (!match.setup.teams_present) {
			card.classList.add('status-yellow');
			status_el.textContent = 'Waiting for players';
			players_el.textContent = players_str(match.setup, 0) + ' vs ' + players_str(match.setup, 1);
			var mid = match.setup.match_id;
			var since = _waiting_since[mid] || now;
			timer_el.textContent = format_duration(now - since);
		} else {
			card.classList.add('status-green');
			status_el.textContent = 'Players present';
			players_el.textContent = players_str(match.setup, 0) + ' vs ' + players_str(match.setup, 1);
		}

		card.appendChild(status_el);
		card.appendChild(players_el);
		if (timer_el.textContent) card.appendChild(timer_el);
		container.appendChild(card);
	}

	document.getElementById('last-update').textContent = 'Last update: ' + new Date().toLocaleTimeString();
}

var _last_courts = [];
var _last_matches = [];

function update_grid_layout(n) {
	if (n === 0) return;
	var grid = document.getElementById('courts');
	// Find the number of columns that best fills the screen aspect ratio
	var W = grid.clientWidth;
	var H = grid.clientHeight;
	var best_cols = 1;
	var best_score = -1;
	for (var cols = 1; cols <= n; cols++) {
		var rows = Math.ceil(n / cols);
		var cell_w = (W - (cols - 1) * 16) / cols;
		var cell_h = (H - (rows - 1) * 16) / rows;
		// Score: how close cell aspect ratio is to 4:3, penalise leftover empty cells
		var ratio = cell_w / cell_h;
		var target = 4 / 3;
		var score = -Math.abs(ratio - target) - (cols * rows - n) * 0.3;
		if (score > best_score) {
			best_score = score;
			best_cols = cols;
		}
	}
	var best_rows = Math.ceil(n / best_cols);
	grid.style.gridTemplateColumns = 'repeat(' + best_cols + ', 1fr)';
	grid.style.gridTemplateRows = 'repeat(' + best_rows + ', 1fr)';
}

var _grid_initialised = false;

function render_and_store(courts, matches) {
	_last_courts = courts;
	_last_matches = matches;
	if (!_grid_initialised && courts.length > 0) {
		update_grid_layout(courts.length);
		_grid_initialised = true;
	}
	render(courts, matches);
}

window.addEventListener('resize', function() {
	update_grid_layout(_last_courts.length);
});

poll();
setInterval(poll, POLL_INTERVAL);
setInterval(function() { render(_last_courts, _last_matches); }, 1000);

function poll() {
	var xhr = new XMLHttpRequest();
	xhr.open('GET', '/h/' + encodeURIComponent(TOURNAMENT_KEY) + '/matches');
	xhr.onload = function() {
		if (xhr.status !== 200) return;
		try {
			var data = JSON.parse(xhr.responseText);
			if (data.status !== 'ok') return;
			var courts = (data.event && data.event.courts) || [];
			var matches = (data.event && data.event.matches) || [];
			render_and_store(courts, matches);
		} catch(e) {}
	};
	xhr.send();
}
</script>
</body>
</html>`;
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache');
	res.send(html);
}

// Allowed keys for partial setup updates from bup clients
const SETUP_UPDATE_KEYS = ['teams_present'];

function setup_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	const match_id = req.params.match_id;

	const update = {};
	for (const k of SETUP_UPDATE_KEYS) {
		if (Object.prototype.hasOwnProperty.call(req.body, k)) {
			update['setup.' + k] = req.body[k];
		}
	}

	if (Object.keys(update).length === 0) {
		return res.json({status: 'error', message: 'No valid setup fields provided'});
	}

	const query = {_id: match_id, tournament_key};
	req.app.db.matches.update(query, {$set: update}, {returnUpdatedDocs: true}, function(err, numAffected) {
		if (err) {
			return res.json({status: 'error', message: err.message});
		}
		if (numAffected !== 1) {
			return res.json({status: 'error', message: 'Cannot find match ' + match_id});
		}
		admin.notify_change(req.app, tournament_key, 'match_setup_update', {match_id, update});
		res.json({status: 'ok'});
	});
}

function logo_handler(req, res) {
	const {tournament_key, logo_id} = req.params;
	assert(tournament_key);
	assert(logo_id);
	const m = /^[-0-9a-f]+\.(gif|png|jpg|jpeg|svg|webp)$/.exec(logo_id);
	assert(m, `Invalid logo ${logo_id}`);
	const mime = {
		gif: 'image/gif',
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		svg: 'image/svg+xml',
		webp: 'image/webp',
	}[m[1]];
	assert(mime, `Unsupported ext ${JSON.stringify(m[1])}`);

	const fn = path.join(utils.root_dir(), 'data', 'logos', path.basename(logo_id));
	res.setHeader('Content-Type', mime);
	res.setHeader('Cache-Control', 'public, max-age=31536000');
	res.sendFile(fn);
}

module.exports = {
	court_overview_handler,
	courts_handler,
	logo_handler,
	matches_handler,
	matchinfo_handler,
	score_handler,
	setup_handler,
};
