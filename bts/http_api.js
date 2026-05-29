'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const utils = require('./utils');
const bupws = require('./bupws');
const admin = require('./admin');
const stournament = require('./stournament');

function logo_handler(req, res) {
	const {tournament_key, logo_id} = req.params;
	assert(tournament_key);
	assert(logo_id);
	const filetype = logo_id.split(".")[1];
	const mime = {
		gif: 'image/gif',
		png: 'image/png',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		svg: 'image/svg+xml',
		webp: 'image/webp',
	}[filetype];
	assert(mime, `Unsupported ext ${JSON.stringify(filetype)}`);
	const fn = path.join(utils.root_dir(), 'data', 'logos', path.basename(logo_id));
	res.setHeader('Content-Type', mime);
	res.setHeader('Cache-Control', 'public, max-age=31536000');
	res.sendFile(fn);
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
		const event = bupws.create_event_representation(tournament);
		const match_repr = bupws.create_match_representation(tournament, match);
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


function matches_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	const now = Date.now();
	const show_still = now - 60000;
	const query = {
		tournament_key,
		$or: [
			{$and: [{team1_won: {$ne: true}}, {team1_won: {$ne: false}}]},
			{end_ts: {$gt: show_still}},
		],
	};
	if (req.query.court && typeof req.query.court === 'string') {
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
			res.json({status: 'error', message: err.message});
			return;
		}

		const ctc_enabled = !!tournament.courts_to_call_enabled;
		let matches = db_matches.map(dbm => bupws.create_match_representation(tournament, dbm));
		const recently_finished = [];
		matches = matches.filter(m => {
			if (!m || !m.setup) return false;
			if (m.setup.state === 'finished') {
				if (m.end_ts && m.end_ts > now - 60000) {
					recently_finished.push(m);
				}
				return false;
			}
			if (m.setup.now_on_court) return true;
			if (m.setup.called_to_court) return true;
			if (m.setup.state === 'oncourt') return true;
			if (m.setup.called_timestamp) return true;
			return false;
		});

		db_courts.sort(utils.cmp_key('num'));
		const courts = db_courts.map(function(dc) {
			return {
				court_id: dc._id,
				label: dc.name || dc.num,
				description: dc.name || String(dc.num),
				match_id: dc.match_id ? ('bts_' + dc.match_id) : undefined,
			};
		});

		const event = bupws.create_event_representation(tournament);
		event.matches = matches;
		event.courts = courts;
		event.call_settings = {
			courts_to_call_enabled: ctc_enabled,
			second_call_enabled: ctc_enabled && tournament.second_call_enabled !== false,
			second_call_s: tournament.second_call_s || 420,
			final_call_enabled: ctc_enabled && tournament.final_call_enabled !== false,
			final_call_s: tournament.final_call_s || 300,
		};
		event.battery_by_court = bupws.get_battery_by_court();
		event.recently_finished = recently_finished;

		res.json({status: 'ok', event});
	});
}

// Allowed keys and expected types for partial setup updates from bup clients
const SETUP_UPDATE_SCHEMA = {
	teams_present: 'boolean',
	team1_present: 'boolean',
	team2_present: 'boolean',
	called_to_court: 'boolean',
	called_to_court_at: 'number',
	second_call_at: 'number',
	final_call_at: 'number',
};

function setup_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	const match_id = req.params.match_id;

	const update = {};
	for (const [k, expected_type] of Object.entries(SETUP_UPDATE_SCHEMA)) {
		if (Object.prototype.hasOwnProperty.call(req.body, k)) {
			const val = req.body[k];
			if (typeof val !== expected_type) {
				return res.json({status: 'error', message: 'Invalid type for ' + k});
			}
			update['setup.' + k] = val;
		}
	}

	if (Object.keys(update).length === 0) {
		return res.json({status: 'error', message: 'No valid setup fields provided'});
	}

	const query = {_id: match_id, tournament_key};
	req.app.db.matches.update(query, {$set: update}, {returnUpdatedDocs: true}, function(err, numAffected, updatedMatch) {
		if (err) {
			return res.json({status: 'error', message: err.message});
		}
		if (numAffected !== 1) {
			return res.json({status: 'error', message: 'Cannot find match ' + match_id});
		}
		admin.notify_change(req.app, tournament_key, 'match_setup_update', {match_id, update});
		// Push update to bup clients so result mode sees called_to_court / teams_present immediately
		const court_id = updatedMatch && updatedMatch.setup && updatedMatch.setup.court_id;
		bupws.handle_score_change(req.app, tournament_key, court_id);
		res.json({status: 'ok'});
	});
}

function court_overview_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	req.app.db.tournaments.findOne({key: tournament_key}, function(err, tournament) {
		_court_overview_render(res, tournament_key, tournament || {});
	});
}

function _court_overview_render(res, tournament_key, tournament) {
	const lang = tournament.language || 'de';
	const court_free_sound = tournament.court_free_sound || '';
	const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Court Overview</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html {
	--font-lg: 22px;
	--font-md: 16px;
	--font-sm: 14px;
}
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
	transition: background 0.4s, border-color 0.4s;
	border: 3px solid transparent;
	overflow: hidden;
	min-height: 0;
}
.court-card.status-red    { background: #2d0a0a; border-color: #c62828; }
.court-card.status-purple { background: #1e0a2e; border-color: #7b1fa2; }
.court-card.status-yellow { background: #2d2200; border-color: #f9a825; }
.court-card.status-orange { background: #2e1800; border-color: #f57c00; }
.court-card.status-alert  { background: #2a0020; border-color: #e91e8c; }
.court-card.status-green  { background: #0d2818; border-color: #2e7d32; }
.court-name { font-size: var(--font-lg); font-weight: bold; margin-bottom: 0.3em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.court-status { font-size: var(--font-sm); color: #aaa; margin-bottom: 0.2em; }
.court-players { font-size: var(--font-md); color: #ddd; line-height: 1.3; overflow: hidden; }
.court-players-vs { font-size: var(--font-sm); color: #888; line-height: 1.2; }
.court-timer { font-size: var(--font-sm); color: #f9a825; }
.status-orange .court-timer { color: #f57c00; }
.status-alert  .court-timer { color: #e91e8c; }
.court-event { font-size: var(--font-sm); color: #bbb; margin-bottom: 0.2em; font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-dot {
	display: inline-block;
	width: 1.2vmin; height: 1.2vmin;
	min-width: 8px; min-height: 8px;
	border-radius: 50%;
	margin-right: 0.8vmin;
	vertical-align: middle;
}
.status-red .status-dot    { background: #c62828; }
.status-purple .status-dot { background: #7b1fa2; }
.status-yellow .status-dot { background: #f9a825; }
.status-orange .status-dot { background: #f57c00; }
.status-alert .status-dot  { background: #e91e8c; }
.status-green .status-dot  { background: #2e7d32; }
.court-link { text-decoration: none; color: inherit; display: flex; flex-direction: column; flex: 1; min-height: 0; justify-content: space-between; }
.court-card { cursor: pointer; }
.court-timer-row { display: flex; justify-content: space-between; align-items: center; margin-top: 0.2em; }
.court-battery { font-size: var(--font-sm); color: #888; margin-left: auto; text-align: right; }
.court-battery.bat-low { color: #f44336; }
.court-battery.bat-mid { color: #f9a825; }
.court-result { font-size: var(--font-md); color: #e57373; font-weight: bold; margin-top: 0.2em; }
#last-update { font-size: 1.5vmin; color: #555; margin-top: 1vmin; flex-shrink: 0; }
</style>
</head>
<body>
<h1>Court Overview</h1>
<div id="courts"></div>
<div id="last-update"></div>
<script>
var TOURNAMENT_KEY = ${JSON.stringify(tournament_key)};
var POLL_INTERVAL = 30000;
var _waiting_since = {};
var SECOND_CALL_MS = ${JSON.stringify((tournament.second_call_s || 420) * 1000)};
var FINAL_CALL_MS  = ${JSON.stringify((tournament.final_call_s || 300) * 1000)};
var _STRINGS = (${JSON.stringify(lang)} === 'de') ? {
	title: 'Feldübersicht',
	no_game: 'Kein Spiel',
	not_called: 'Noch nicht aufgerufen',
	waiting: 'Warte auf Spieler',
	second_call: '⚠ 2. Aufruf',
	final_call: '⚠ Letzter Aufruf',
	present: 'Spieler anwesend',
	last_update: 'Letztes Update: ',
} : {
	title: 'Court Overview',
	no_game: 'No game',
	not_called: 'Not called yet',
	waiting: 'Waiting for players',
	second_call: '⚠ 2nd Call',
	final_call: '⚠ Final Call',
	present: 'Players present',
	last_update: 'Last update: ',
};
document.title = _STRINGS.title;
document.querySelector('h1').textContent = _STRINGS.title;

function players_str(setup, team_idx) {
	var team = setup.teams && setup.teams[team_idx];
	if (!team || !team.players || team.players.length === 0) return 'N.N.';
	if (setup.is_doubles && team.players.length > 1) {
		return team.players[0].name + ' / ' + team.players[1].name;
	}
	return team.players[0].name;
}

function set_players_el(el, setup) {
	el.innerHTML = '';
	var t0 = document.createElement('div');
	t0.textContent = players_str(setup, 0);
	if (setup.team1_present && !setup.teams_present) t0.style.color = '#4caf50';
	var vs = document.createElement('div');
	vs.className = 'court-players-vs';
	vs.textContent = 'vs.';
	var t1 = document.createElement('div');
	t1.textContent = players_str(setup, 1);
	if (setup.team2_present && !setup.teams_present) t1.style.color = '#4caf50';
	el.appendChild(t0);
	el.appendChild(vs);
	el.appendChild(t1);
}

function format_duration(ms) {
	var s = Math.floor(ms / 1000);
	var m = Math.floor(s / 60);
	s = s % 60;
	return m + 'min ' + (s < 10 ? '0' : '') + s + 's';
}

function format_score(network_score) {
	if (!network_score || network_score.length === 0) return '';
	return network_score.map(function(g) { return g[0] + '–' + g[1]; }).join('  ');
}

function render(courts, matches, call_settings, battery_by_court) {
	var now = Date.now();
	var courts_to_call_enabled = call_settings && call_settings.courts_to_call_enabled;
	var second_call_enabled = call_settings ? call_settings.second_call_enabled : true;
	var final_call_enabled = call_settings ? call_settings.final_call_enabled : true;
	var second_call_ms = (call_settings && call_settings.second_call_s) ? call_settings.second_call_s * 1000 : SECOND_CALL_MS;
	var final_call_ms = (call_settings && call_settings.final_call_s) ? call_settings.final_call_s * 1000 : FINAL_CALL_MS;
	var container = document.getElementById('courts');

	var by_court = {};
	for (var i = 0; i < matches.length; i++) {
		var m = matches[i];
		var cid = m.setup && m.setup.court_id;
		if (cid && !by_court[cid]) by_court[cid] = m;
	}

	for (var i = 0; i < courts.length; i++) {
		var court = courts[i];
		var match = by_court[court.court_id];
		if (match && !match.setup.teams_present) {
			var mid = match.setup.match_id;
			if (!_waiting_since[mid]) _waiting_since[mid] = now;
		}
	}
	var active_ids = {};
	for (var i = 0; i < matches.length; i++) active_ids[matches[i].setup.match_id] = true;
	Object.keys(_waiting_since).forEach(function(mid) { if (!active_ids[mid]) delete _waiting_since[mid]; });

	container.innerHTML = '';
	for (var i = 0; i < courts.length; i++) {
		var court = courts[i];
		var match = by_court[court.court_id];

		var card = document.createElement('div');
		card.className = 'court-card';

		var link = document.createElement('a');
		link.className = 'court-link';
		var court_num = (court.court_id || '').replace(/^.*_/, '');
		link.href = '/r' + court_num;
		link.target = '_blank';

		var name_el = document.createElement('div');
		name_el.className = 'court-name';
		var dot = document.createElement('span');
		dot.className = 'status-dot';
		name_el.appendChild(dot);
		name_el.appendChild(document.createTextNode(court.label || court.court_id));

		var status_el = document.createElement('div');
		status_el.className = 'court-status';
		var players_el = document.createElement('div');
		players_el.className = 'court-players';
		var timer_el = document.createElement('div');
		timer_el.className = 'court-timer';
		timer_el.dataset.courtId = court.court_id;
		var event_el = document.createElement('div');
		event_el.className = 'court-event';

		if (!match) {
			card.classList.add('status-red');
			var finished = _last_finished[court.court_id];
			if (finished) {
				status_el.textContent = _STRINGS.no_game;
				set_players_el(players_el, finished.setup);
				var score_str = format_score(finished.network_score);
				if (score_str) {
					var result_el = document.createElement('div');
					result_el.className = 'court-result';
					result_el.textContent = score_str;
					players_el.appendChild(result_el);
				}
				var event_text = finished.setup.event_name || '';
				if (finished.setup.match_name) event_text += (event_text ? ' – ' : '') + finished.setup.match_name;
				event_el.textContent = event_text;
			} else {
				status_el.textContent = _STRINGS.no_game;
			}
		} else if (courts_to_call_enabled && !match.setup.called_to_court) {
			card.classList.add('status-purple');
			status_el.textContent = _STRINGS.not_called;
			set_players_el(players_el, match.setup);
			var event_text = match.setup.event_name || '';
			if (match.setup.match_name) event_text += (event_text ? ' \u2013 ' : '') + match.setup.match_name;
			event_el.textContent = event_text;
		} else if (!match.setup.teams_present) {
			var mid = match.setup.match_id;
			var since = match.setup.called_to_court_at || _waiting_since[mid] || match.setup.court_assigned_at || now;
			var waited = now - since;
			var status_color;
			var status_text;
			if (final_call_enabled && match.setup.final_call_at) {
				status_color = 'status-alert';
				status_text = _STRINGS.final_call;
			} else if (second_call_enabled && match.setup.second_call_at) {
				status_color = 'status-orange';
				status_text = _STRINGS.second_call;
			} else {
				status_color = 'status-yellow';
				status_text = _STRINGS.waiting;
			}
			card.classList.add(status_color);
			status_el.textContent = status_text;
			set_players_el(players_el, match.setup);
			timer_el.textContent = format_duration(waited);
			timer_el.dataset.since = since;
			var event_text = match.setup.event_name || '';
			if (match.setup.match_name) event_text += (event_text ? ' \u2013 ' : '') + match.setup.match_name;
			event_el.textContent = event_text;
		} else {
			card.classList.add('status-green');
			status_el.textContent = _STRINGS.present;
			set_players_el(players_el, match.setup);
			var event_text = match.setup.event_name || '';
			if (match.setup.match_name) event_text += (event_text ? ' \u2013 ' : '') + match.setup.match_name;
			event_el.textContent = event_text;
		}

		var bat_el = document.createElement('div');
		bat_el.className = 'court-battery';
		var bat = battery_by_court && battery_by_court[court.court_id];
		if (bat && typeof bat.level === 'number') {
			var pct = Math.round(bat.level * 100);
			var icon = bat.charging ? '⚡' : (pct <= 20 ? '🔋' : '🔋');
			bat_el.textContent = icon + ' ' + pct + '%';
			if (pct <= 15) bat_el.classList.add('bat-low');
			else if (pct <= 30) bat_el.classList.add('bat-mid');
		}

		link.appendChild(name_el);
		if (event_el.textContent) link.appendChild(event_el);
		link.appendChild(status_el);
		link.appendChild(players_el);
		if (timer_el.textContent || bat_el.textContent) {
			var bottom_row = document.createElement('div');
			bottom_row.className = 'court-timer-row';
			if (timer_el.textContent) bottom_row.appendChild(timer_el);
			if (bat_el.textContent) bottom_row.appendChild(bat_el);
			link.appendChild(bottom_row);
		}
		card.appendChild(link);
		container.appendChild(card);
	}
	document.getElementById('last-update').textContent = _STRINGS.last_update + new Date().toLocaleTimeString();
}

var _last_courts = [];
var _last_matches = [];
var _last_call_settings = {};
var _last_battery = {};
var _last_court_count = -1;

var COURT_FREE_SOUND = ${JSON.stringify(court_free_sound)};
var _sound_files = {
	old_spice: '/static/audio/old_spice.mp3',
	roadrunner: '/static/audio/roadrunner.mp3',
};
var _prev_occupied_courts = null;
var _last_finished = {};
var _notification_audio = null;
var _audio_unlocked = false;

if (COURT_FREE_SOUND && _sound_files[COURT_FREE_SOUND]) {
	_notification_audio = new Audio(_sound_files[COURT_FREE_SOUND]);
	_notification_audio.preload = 'auto';
	function _unlock_audio() {
		if (_audio_unlocked) return;
		_notification_audio.volume = 0;
		_notification_audio.play().then(function() {
			_notification_audio.pause();
			_notification_audio.currentTime = 0;
			_notification_audio.volume = 1;
			_audio_unlocked = true;
		}).catch(function() {});
	}
	document.addEventListener('click', _unlock_audio, {once: false});
	document.addEventListener('touchstart', _unlock_audio, {once: false});
}

function _play_court_free_sound() {
	if (!COURT_FREE_SOUND || !_notification_audio) return;
	try {
		_notification_audio.currentTime = 0;
		_notification_audio.volume = 1;
		_notification_audio.play().catch(function() {});
	} catch(e) {}
}

function _check_court_freed(courts, matches, recently_finished) {
	var by_court = {};
	for (var i = 0; i < matches.length; i++) {
		var m = matches[i];
		if (m.setup && m.setup.court_id) by_court[m.setup.court_id] = true;
	}
	for (var i = 0; i < recently_finished.length; i++) {
		var rf = recently_finished[i];
		if (rf.setup && rf.setup.court_id && !_last_finished[rf.setup.court_id]) {
			_last_finished[rf.setup.court_id] = rf;
		}
	}
	var occupied = {};
	for (var i = 0; i < courts.length; i++) {
		var cid = courts[i].court_id;
		if (by_court[cid]) occupied[cid] = true;
	}
	if (_prev_occupied_courts !== null) {
		var freed = false;
		for (var cid in _prev_occupied_courts) {
			if (_prev_occupied_courts[cid] && !occupied[cid]) {
				freed = true;
			}
		}
		if (freed) _play_court_free_sound();
	}
	for (var cid in occupied) {
		delete _last_finished[cid];
	}
	_prev_occupied_courts = occupied;
}

function update_grid_layout(n) {
	if (n === 0) return;
	var grid = document.getElementById('courts');
	var W = grid.clientWidth, H = grid.clientHeight, gap = 16;
	var best_cols = 1, best_score = -1;
	for (var cols = 1; cols <= n; cols++) {
		var rows = Math.ceil(n / cols);
		var cell_w = (W - (cols - 1) * gap) / cols;
		var cell_h = (H - (rows - 1) * gap) / rows;
		var ratio = cell_w / cell_h;
		var score = -Math.abs(ratio - 4/3) - (cols * rows - n) * 0.3;
		if (score > best_score) { best_score = score; best_cols = cols; }
	}
	var best_rows = Math.ceil(n / best_cols);
	grid.style.gridTemplateColumns = 'repeat(' + best_cols + ', 1fr)';
	grid.style.gridTemplateRows = 'repeat(' + best_rows + ', 1fr)';
	var cell_w = (W - (best_cols - 1) * gap) / best_cols;
	var cell_h = (H - (best_rows - 1) * gap) / best_rows;
	var cell_min = Math.min(cell_w, cell_h);
	document.documentElement.style.setProperty('--font-lg', Math.min(Math.max(cell_min * 0.13, 11), 28) + 'px');
	document.documentElement.style.setProperty('--font-md', Math.min(Math.max(cell_min * 0.10, 9), 22) + 'px');
	document.documentElement.style.setProperty('--font-sm', Math.min(Math.max(cell_min * 0.085, 8), 18) + 'px');
}

function render_and_store(courts, matches, call_settings, battery_by_court) {
	_last_courts = courts;
	_last_matches = matches;
	_last_call_settings = call_settings || {};
	_last_battery = battery_by_court || {};
	if (courts.length !== _last_court_count) {
		update_grid_layout(courts.length);
		_last_court_count = courts.length;
	}
	render(courts, matches, _last_call_settings, _last_battery);
}

window.addEventListener('resize', function() { update_grid_layout(_last_courts.length); });

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
			var call_settings = (data.event && data.event.call_settings) || {};
			var battery_by_court = (data.event && data.event.battery_by_court) || {};
			var recently_finished = (data.event && data.event.recently_finished) || [];
			_check_court_freed(courts, matches, recently_finished);
			render_and_store(courts, matches, call_settings, battery_by_court);
		} catch(e) {}
	};
	xhr.send();
}

poll();
setInterval(poll, POLL_INTERVAL);
setInterval(function() {
	var now = Date.now();
	document.querySelectorAll('.court-timer[data-since]').forEach(function(el) {
		var since = parseInt(el.dataset.since, 10);
		if (since) el.textContent = format_duration(now - since);
	});
}, 1000);

var _ws_refresh_types = {
	match_edit:1, score:1, match_setup_update:1, match_called_on_court:1,
	court_current_match:1, update_player_status:1, match_preparation_call:1
};
function ws_connect() {
	var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
	var sock = new WebSocket(proto + '//' + location.host + '/ws/admin');
	sock.onmessage = function(ev) {
		try {
			var msg = JSON.parse(ev.data);
			if (msg.type === 'change' && _ws_refresh_types[msg.ctype]) poll();
		} catch(e) {}
	};
	sock.onclose = function() { setTimeout(ws_connect, 3000); };
	sock.onerror = function() { sock.close(); };
}
ws_connect();
</script>
</body>
</html>`;
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache');
	res.send(html);
}

function courts_to_call_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	req.app.db.tournaments.findOne({key: tournament_key}, function(err, tournament) {
		if (err || !tournament) {
			res.status(404).send('Tournament not found');
			return;
		}
		_courts_to_call_render(res, tournament_key, tournament);
	});
}

function _courts_to_call_render(res, tournament_key, tournament) {
	const second_call_enabled = tournament.second_call_enabled !== false;
	const final_call_enabled = tournament.final_call_enabled !== false;
	const second_call_ms = (tournament.second_call_s || 420) * 1000;
	const final_call_ms = (tournament.final_call_s || 300) * 1000;
	const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Courts to Call</title>
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
}
h1 { font-size: 3vmin; margin-bottom: 1.5vmin; color: #ccc; flex-shrink: 0; }
#match-list { flex: 1; overflow-y: auto; }
.match-row {
	display: flex;
	align-items: center;
	background: #1e0a2e;
	border: 2px solid #7b1fa2;
	border-radius: 1.5vmin;
	padding: 2vmin 2.5vmin;
	margin-bottom: 1.5vmin;
	cursor: pointer;
	transition: background 0.2s, opacity 0.2s;
	user-select: none;
}
.match-row:active { background: #2e1048; }
.match-row.calling { opacity: 0.4; pointer-events: none; }
.match-row.second-call { background: #2e1800; border-color: #f57c00; }
.match-row.second-call:active { background: #3e2200; }
.match-row.final-call { background: #2a0020; border-color: #e91e8c; }
.match-row.final-call:active { background: #3a0030; }
.match-court { font-size: 3vmin; font-weight: bold; min-width: 12vmin; color: #ce93d8; }
.match-row.second-call .match-court { color: #ffb74d; }
.match-row.final-call  .match-court { color: #e91e8c; }
.match-call-label { font-size: 1.6vmin; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.3vmin; }
.second-call .match-call-label { color: #f57c00; }
.final-call  .match-call-label { color: #e91e8c; }
.match-info { flex: 1; }
.match-players { font-size: 2.5vmin; color: #eee; }
.match-event { font-size: 2vmin; color: #bbb; font-style: italic; margin-top: 0.4vmin; }
.match-timer { font-size: 1.8vmin; color: #888; margin-top: 0.3vmin; }
.match-call-btn { font-size: 2.5vmin; background: #7b1fa2; color: #fff; border: none; border-radius: 1vmin; padding: 1vmin 2vmin; cursor: pointer; flex-shrink: 0; }
#empty-msg { color: #555; font-size: 2.5vmin; margin-top: 3vmin; text-align: center; }
#last-update { font-size: 1.5vmin; color: #555; margin-top: 1vmin; flex-shrink: 0; }
</style>
</head>
<body>
<h1>Courts to Call</h1>
<div id="match-list"></div>
<div id="last-update"></div>
<script>
var TOURNAMENT_KEY = ${JSON.stringify(tournament_key)};
var POLL_INTERVAL = 30000;
var _called_ids        = {};
var _called_at         = {};
var _second_called_at  = {};
var _first_seen_called = {};
var _reminded_ids      = {};
var SECOND_CALL_ENABLED = ${JSON.stringify(second_call_enabled)};
var FINAL_CALL_ENABLED  = ${JSON.stringify(final_call_enabled)};
var SECOND_CALL_MS = ${JSON.stringify(second_call_ms)};
var FINAL_CALL_MS  = ${JSON.stringify(final_call_ms)};
var _STRINGS = (${JSON.stringify(tournament.language || 'de')} === 'de') ? {
	title: 'Feldaufruf',
	second_call: '⚠ 2. Aufruf',
	final_call: '⚠ Letzter Aufruf',
	call_btn: 'Aufrufen',
	called_btn: 'Aufgerufen',
	on_court_for: 'Auf dem Feld seit: ',
	called_ago: ' aufgerufen',
	all_called: 'Alle Felder wurden aufgerufen.',
	last_update: 'Letztes Update: ',
} : {
	title: 'Courts to Call',
	second_call: '⚠ 2nd Call',
	final_call: '⚠ Final Call',
	call_btn: 'Call',
	called_btn: 'Called',
	on_court_for: 'On court for: ',
	called_ago: ' ago',
	all_called: 'All courts have been called.',
	last_update: 'Last update: ',
};
document.title = _STRINGS.title;
document.querySelector('h1').textContent = _STRINGS.title;

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

var _call_queue = [];
var _call_running = false;
var _poll_deferred = false;

function _call_flush() {
	if (_call_running || _call_queue.length === 0) return;
	_call_running = true;
	var job = _call_queue.shift();
	var xhr = new XMLHttpRequest();
	xhr.open('POST', '/h/' + encodeURIComponent(TOURNAMENT_KEY) + '/m/' + encodeURIComponent(job.raw_id) + '/setup');
	xhr.setRequestHeader('Content-Type', 'application/json');
	xhr.onload = function() {
		if (xhr.status !== 200 && job.on_fail) job.on_fail();
		_call_running = false;
		if (_call_queue.length > 0) {
			_call_flush();
		} else if (_poll_deferred) {
			_poll_deferred = false;
			poll();
		}
	};
	xhr.onerror = function() {
		if (job.on_fail) job.on_fail();
		_call_running = false;
		if (_call_queue.length > 0) {
			_call_flush();
		} else if (_poll_deferred) {
			_poll_deferred = false;
			poll();
		}
	};
	xhr.send(JSON.stringify(job.body));
}

function call_match(match_id, raw_id, row, is_reminder, level) {
	_called_at[match_id] = Date.now();
	if (!is_reminder) {
		_called_ids[match_id] = true;
		row.classList.add('calling');
		setTimeout(function() { if (row.parentNode) row.parentNode.removeChild(row); }, 400);
		_call_queue.push({
			raw_id: raw_id,
			body: {called_to_court: true, called_to_court_at: _called_at[match_id]},
			on_fail: function() { delete _called_ids[match_id]; },
		});
	} else if (level === 2) {
		_reminded_ids[match_id] = level;
		var final_call_ts = Date.now();
		row.classList.add('calling');
		setTimeout(function() { if (row.parentNode) row.parentNode.removeChild(row); }, 400);
		_call_queue.push({
			raw_id: raw_id,
			body: {final_call_at: final_call_ts},
		});
	} else {
		_reminded_ids[match_id] = level;
		var second_call_ts = Date.now();
		_second_called_at[match_id] = second_call_ts;
		row.classList.add('calling');
		setTimeout(function() { if (row.parentNode) row.parentNode.removeChild(row); }, 400);
		_call_queue.push({
			raw_id: raw_id,
			body: {second_call_at: second_call_ts},
		});
	}
	_call_flush();
}

function call_level(match_id, called_at_ts, second_call_at_ts, final_call_at_ts, now) {
	if (FINAL_CALL_ENABLED) {
		if (final_call_at_ts) return 2;
		var t2 = second_call_at_ts || _second_called_at[match_id] || 0;
		if (t2 && (now - t2) >= FINAL_CALL_MS) return 2;
	}
	if (SECOND_CALL_ENABLED) {
		if (second_call_at_ts || _second_called_at[match_id]) return 1;
		var t = called_at_ts || _called_at[match_id] || _first_seen_called[match_id] || 0;
		if (t && (now - t) >= SECOND_CALL_MS) return 1;
	}
	return 0;
}

function make_row(setup, court_label, level, now) {
	var raw_id = setup.match_id.replace(/^bts_/, '');
	var is_reminder = (level > 0);
	var row = document.createElement('div');
	var cls = 'match-row';
	if (level === 2) cls += ' final-call';
	else if (level === 1) cls += ' second-call';
	row.className = cls;
	(function(match_id, raw_id, row, is_reminder, level) {
		row.addEventListener('click', function() { call_match(match_id, raw_id, row, is_reminder, level); });
	})(setup.match_id, raw_id, row, is_reminder, level);

	var court_el = document.createElement('div');
	court_el.className = 'match-court';
	court_el.textContent = court_label;
	row.appendChild(court_el);

	var info_el = document.createElement('div');
	info_el.className = 'match-info';

	if (is_reminder) {
		var label_el = document.createElement('div');
		label_el.className = 'match-call-label';
		label_el.textContent = level === 2 ? _STRINGS.final_call : _STRINGS.second_call;
		info_el.appendChild(label_el);
	}

	var players_el = document.createElement('div');
	players_el.className = 'match-players';
	var p0 = document.createElement('span');
	p0.textContent = players_str(setup, 0);
	if (setup.team1_present) p0.style.color = '#4caf50';
	var pvs = document.createElement('span');
	pvs.textContent = ' vs ';
	var p1 = document.createElement('span');
	p1.textContent = players_str(setup, 1);
	if (setup.team2_present) p1.style.color = '#4caf50';
	players_el.appendChild(p0);
	players_el.appendChild(pvs);
	players_el.appendChild(p1);
	info_el.appendChild(players_el);

	var event_text = setup.event_name || '';
	if (setup.match_name) event_text += (event_text ? ' \u2013 ' : '') + setup.match_name;
	if (event_text) {
		var event_el = document.createElement('div');
		event_el.className = 'match-event';
		event_el.textContent = event_text;
		info_el.appendChild(event_el);
	}

	var t_ref = is_reminder ? (setup.called_to_court_at || _called_at[setup.match_id] || 0) : setup.court_assigned_at;
	if (t_ref) {
		var timer_el = document.createElement('div');
		timer_el.className = 'match-timer';
		timer_el.textContent = (is_reminder ? _STRINGS.called_btn + ' ' : _STRINGS.on_court_for) + format_duration(now - t_ref) + (is_reminder ? _STRINGS.called_ago : '');
		info_el.appendChild(timer_el);
	}

	row.appendChild(info_el);
	var btn = document.createElement('button');
	btn.className = 'match-call-btn';
	btn.textContent = is_reminder ? _STRINGS.called_btn : _STRINGS.call_btn;
	row.appendChild(btn);
	return row;
}

function render(courts, matches) {
	var now = Date.now();
	var court_labels = {};
	for (var i = 0; i < courts.length; i++) court_labels[courts[i].court_id] = courts[i].label || courts[i].court_id;

	var to_call = [], reminders = [];
	for (var i = 0; i < matches.length; i++) {
		var m = matches[i];
		if (!m.setup || !m.setup.court_id) continue;
		var mid = m.setup.match_id;
		if (!m.setup.called_to_court && _called_ids[mid]) {
			delete _called_ids[mid];
			delete _called_at[mid];
			delete _second_called_at[mid];
			delete _first_seen_called[mid];
			delete _reminded_ids[mid];
		}
		if (!m.setup.called_to_court && !_called_ids[mid]) {
			to_call.push(m);
		} else if (m.setup.called_to_court && !m.setup.teams_present) {
			var mid = m.setup.match_id;
			if (!m.setup.called_to_court_at) {
				var backfill_ts = now;
				m.setup.called_to_court_at = backfill_ts;
				var raw_id_bf = mid.replace(/^bts_/, '');
				var xhr_bf = new XMLHttpRequest();
				xhr_bf.open('POST', '/h/' + encodeURIComponent(TOURNAMENT_KEY) + '/m/' + encodeURIComponent(raw_id_bf) + '/setup');
				xhr_bf.setRequestHeader('Content-Type', 'application/json');
				xhr_bf.send(JSON.stringify({called_to_court_at: backfill_ts}));
			}
			if (!_first_seen_called[mid]) _first_seen_called[mid] = m.setup.called_to_court_at;
			var lvl = call_level(mid, m.setup.called_to_court_at, m.setup.second_call_at, m.setup.final_call_at, now);
			if (m.setup.final_call_at && !_reminded_ids[mid]) {
				_reminded_ids[mid] = 2;
			} else if (m.setup.second_call_at && !_reminded_ids[mid]) {
				_reminded_ids[mid] = lvl - 1;
			}
			if (lvl > 0 && lvl > (_reminded_ids[mid] || 0)) reminders.push({m: m, level: lvl});
		}
	}

	to_call.sort(function(a, b) {
		var ta = a.setup.court_assigned_at || 0, tb = b.setup.court_assigned_at || 0;
		if (ta !== tb) return ta - tb;
		return (a.setup.match_num || 0) - (b.setup.match_num || 0);
	});
	reminders.sort(function(a, b) {
		if (b.level !== a.level) return b.level - a.level;
		var ta = a.m.setup.called_to_court_at || _called_at[a.m.setup.match_id] || 0;
		var tb = b.m.setup.called_to_court_at || _called_at[b.m.setup.match_id] || 0;
		return ta - tb;
	});

	var container = document.getElementById('match-list');
	container.innerHTML = '';

	if (reminders.length === 0 && to_call.length === 0) {
		var empty = document.createElement('div');
		empty.id = 'empty-msg';
		empty.textContent = _STRINGS.all_called;
		container.appendChild(empty);
		document.getElementById('last-update').textContent = _STRINGS.last_update + new Date().toLocaleTimeString();
		return;
	}

	for (var i = 0; i < reminders.length; i++) {
		var r = reminders[i];
		container.appendChild(make_row(r.m.setup, court_labels[r.m.setup.court_id] || r.m.setup.court_id, r.level, now));
	}
	for (var i = 0; i < to_call.length; i++) {
		var m = to_call[i];
		container.appendChild(make_row(m.setup, court_labels[m.setup.court_id] || m.setup.court_id, 0, now));
	}

	document.getElementById('last-update').textContent = _STRINGS.last_update + new Date().toLocaleTimeString();
}

function poll() {
	if (_call_queue.length > 0 || _call_running) {
		_poll_deferred = true;
		return;
	}
	var xhr = new XMLHttpRequest();
	xhr.open('GET', '/h/' + encodeURIComponent(TOURNAMENT_KEY) + '/matches');
	xhr.onload = function() {
		if (xhr.status !== 200) return;
		try {
			var data = JSON.parse(xhr.responseText);
			if (data.status !== 'ok') return;
			render((data.event && data.event.courts) || [], (data.event && data.event.matches) || []);
		} catch(e) {}
	};
	xhr.send();
}

poll();
setInterval(poll, POLL_INTERVAL);

var _ws_refresh_types = {
	match_edit:1, score:1, match_setup_update:1, match_called_on_court:1,
	court_current_match:1, update_player_status:1, match_preparation_call:1
};
function ws_connect() {
	var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
	var sock = new WebSocket(proto + '//' + location.host + '/ws/admin');
	sock.onmessage = function(ev) {
		try {
			var msg = JSON.parse(ev.data);
			if (msg.type === 'change' && _ws_refresh_types[msg.ctype]) poll();
		} catch(e) {}
	};
	sock.onclose = function() { setTimeout(ws_connect, 3000); };
	sock.onerror = function() { sock.close(); };
}
ws_connect();
</script>
</body>
</html>`;
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache');
	res.send(html);
}

function tshirt_sizes_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	const match_id = req.params.match_id;
	const players = req.body.players;

	if (!Array.isArray(players) || players.length === 0) {
		return res.json({status: 'error', message: 'Missing players array'});
	}
	for (const p of players) {
		if (!p.name || typeof p.name !== 'string') {
			return res.json({status: 'error', message: 'Invalid player name'});
		}
		if (!p.size || typeof p.size !== 'string') {
			return res.json({status: 'error', message: 'Invalid size'});
		}
	}

	const data_dir = path.join(utils.root_dir(), 'data');
	const file_path = path.join(data_dir, 'tshirt_sizes.txt');
	const timestamp = new Date().toISOString();
	const lines = players.map(p => {
		const firstname = (p.firstname || '').replace(/[\t\n]/g, ' ');
		const lastname = (p.lastname || '').replace(/[\t\n]/g, ' ');
		const event_name = (p.event_name || '').replace(/[\t\n]/g, ' ');
		const size = p.size.replace(/[\t\n]/g, ' ');
		return firstname + '\t' + lastname + '\t' + event_name + '\t' + size + '\t' + match_id + '\t' + timestamp;
	});
	try {
		fs.appendFileSync(file_path, lines.join('\n') + '\n');
	} catch (err) {
		return res.json({status: 'error', message: 'Failed to save: ' + err.message});
	}
	res.json({status: 'ok'});
}

function tshirt_overview_handler(req, res) {
	const data_dir = path.join(utils.root_dir(), 'data');
	const file_path = path.join(data_dir, 'tshirt_sizes.txt');

	let rows = [];
	try {
		const raw = fs.readFileSync(file_path, 'utf8').trim();
		if (raw) {
			rows = raw.split('\n').map(line => {
				const cols = line.split('\t');
				return {
					firstname: cols[0] || '',
					lastname: cols[1] || '',
					event_name: cols[2] || '',
					size: cols[3] || '',
					match_id: cols[4] || '',
					timestamp: cols[5] || '',
				};
			});
		}
	} catch (e) {
		// file doesn't exist yet — empty table
	}

	const rows_json = JSON.stringify(rows).replace(/</g, '\\u003c');

	const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>T-Shirt Größen</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
	background: #1a1a2e;
	color: #eee;
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	padding: 3vmin;
}
h1 {
	text-align: center;
	font-size: 2.4em;
	margin-bottom: 0.3em;
	color: #fff;
}
.subtitle {
	text-align: center;
	color: #888;
	font-size: 1em;
	margin-bottom: 2em;
}
.controls {
	display: flex;
	gap: 1em;
	justify-content: center;
	flex-wrap: wrap;
	margin-bottom: 1.5em;
}
.controls input[type="text"] {
	padding: 0.5em 1em;
	font-size: 1em;
	background: #16213e;
	color: #eee;
	border: 1px solid #555;
	border-radius: 6px;
	width: 250px;
}
.controls input[type="text"]:focus {
	outline: none;
	border-color: #4fc3f7;
}
.controls select {
	padding: 0.5em 1em;
	font-size: 1em;
	background: #16213e;
	color: #eee;
	border: 1px solid #555;
	border-radius: 6px;
}
table {
	width: 100%;
	max-width: 900px;
	margin: 0 auto;
	border-collapse: collapse;
}
thead th {
	background: #0f3460;
	color: #4fc3f7;
	padding: 0.8em 1em;
	text-align: left;
	font-size: 0.95em;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	border-bottom: 2px solid #4fc3f7;
	cursor: pointer;
	user-select: none;
	white-space: nowrap;
}
thead th:hover {
	background: #1a4a7a;
}
thead th .sort-arrow {
	margin-left: 0.3em;
	font-size: 0.8em;
	color: #888;
}
thead th .sort-arrow.active {
	color: #4fc3f7;
}
tbody tr {
	border-bottom: 1px solid #222;
	transition: background 0.15s;
}
tbody tr:hover {
	background: #16213e;
}
tbody td {
	padding: 0.7em 1em;
	font-size: 1em;
}
.size-badge {
	display: inline-block;
	background: #0d2818;
	color: #4caf50;
	border: 1px solid #4caf50;
	border-radius: 4px;
	padding: 0.15em 0.6em;
	font-weight: bold;
	font-size: 0.95em;
}
.summary {
	max-width: 900px;
	margin: 2em auto 0;
	display: flex;
	gap: 1em;
	flex-wrap: wrap;
	justify-content: center;
}
.summary-card {
	background: #16213e;
	border: 1px solid #333;
	border-radius: 8px;
	padding: 0.8em 1.5em;
	text-align: center;
	min-width: 80px;
}
.summary-card .count {
	font-size: 1.8em;
	font-weight: bold;
	color: #4caf50;
}
.summary-card .label {
	font-size: 0.85em;
	color: #888;
	margin-top: 0.2em;
}
.empty-msg {
	text-align: center;
	color: #666;
	font-size: 1.2em;
	margin-top: 4em;
}
</style>
</head>
<body>
<h1>T-Shirt Größen</h1>
<div class="subtitle" id="subtitle"></div>
<div class="controls">
	<input type="text" id="search" placeholder="Suchen…">
	<select id="filter-size"><option value="">Alle Größen</option></select>
	<select id="filter-event"><option value="">Alle Disziplinen</option></select>
</div>
<table id="tbl">
	<thead>
		<tr>
			<th data-col="lastname">Nachname <span class="sort-arrow" id="sort-lastname">▲</span></th>
			<th data-col="firstname">Vorname <span class="sort-arrow" id="sort-firstname"></span></th>
			<th data-col="event_name">Disziplin <span class="sort-arrow" id="sort-event_name"></span></th>
			<th data-col="size">Größe <span class="sort-arrow" id="sort-size"></span></th>
		</tr>
	</thead>
	<tbody id="tbody"></tbody>
</table>
<div class="summary" id="summary"></div>
<script>
var ALL = ${rows_json};
var sortCol = 'lastname';
var sortAsc = true;

function unique(arr, key) {
	var s = {};
	for (var i = 0; i < arr.length; i++) if (arr[i][key]) s[arr[i][key]] = 1;
	return Object.keys(s).sort();
}

function initFilters() {
	var sizes = unique(ALL, 'size');
	var events = unique(ALL, 'event_name');
	var sf = document.getElementById('filter-size');
	for (var i = 0; i < sizes.length; i++) {
		var o = document.createElement('option');
		o.value = sizes[i]; o.textContent = sizes[i];
		sf.appendChild(o);
	}
	var ef = document.getElementById('filter-event');
	for (var i = 0; i < events.length; i++) {
		var o = document.createElement('option');
		o.value = events[i]; o.textContent = events[i];
		ef.appendChild(o);
	}
}

function filtered() {
	var q = document.getElementById('search').value.toLowerCase();
	var fs = document.getElementById('filter-size').value;
	var fe = document.getElementById('filter-event').value;
	return ALL.filter(function(r) {
		if (fs && r.size !== fs) return false;
		if (fe && r.event_name !== fe) return false;
		if (q && (r.firstname + ' ' + r.lastname + ' ' + r.event_name).toLowerCase().indexOf(q) < 0) return false;
		return true;
	});
}

function cmp(a, b) {
	var va = (a[sortCol] || '').toLowerCase();
	var vb = (b[sortCol] || '').toLowerCase();
	if (va < vb) return sortAsc ? -1 : 1;
	if (va > vb) return sortAsc ? 1 : -1;
	return 0;
}

function render() {
	var rows = filtered().sort(cmp);
	var tbody = document.getElementById('tbody');
	tbody.innerHTML = '';
	for (var i = 0; i < rows.length; i++) {
		var r = rows[i];
		var tr = document.createElement('tr');
		tr.innerHTML = '<td>' + esc(r.lastname) + '</td><td>' + esc(r.firstname) + '</td><td>' + esc(r.event_name) + '</td><td><span class="size-badge">' + esc(r.size) + '</span></td>';
		tbody.appendChild(tr);
	}
	document.getElementById('subtitle').textContent = rows.length + ' Einträge';
	renderSummary(rows);
	updateSortArrows();
}

function renderSummary(rows) {
	var counts = {};
	for (var i = 0; i < rows.length; i++) {
		var s = rows[i].size;
		counts[s] = (counts[s] || 0) + 1;
	}
	var keys = Object.keys(counts).sort();
	var el = document.getElementById('summary');
	el.innerHTML = '';
	for (var i = 0; i < keys.length; i++) {
		el.innerHTML += '<div class="summary-card"><div class="count">' + counts[keys[i]] + '</div><div class="label">' + esc(keys[i]) + '</div></div>';
	}
}

function updateSortArrows() {
	var cols = ['lastname','firstname','event_name','size'];
	for (var i = 0; i < cols.length; i++) {
		var el = document.getElementById('sort-' + cols[i]);
		if (cols[i] === sortCol) {
			el.textContent = sortAsc ? '▲' : '▼';
			el.className = 'sort-arrow active';
		} else {
			el.textContent = '';
			el.className = 'sort-arrow';
		}
	}
}

function esc(s) {
	var d = document.createElement('div');
	d.textContent = s || '';
	return d.innerHTML;
}

document.querySelectorAll('thead th').forEach(function(th) {
	th.addEventListener('click', function() {
		var col = th.getAttribute('data-col');
		if (sortCol === col) sortAsc = !sortAsc;
		else { sortCol = col; sortAsc = true; }
		render();
	});
});

document.getElementById('search').addEventListener('input', render);
document.getElementById('filter-size').addEventListener('change', render);
document.getElementById('filter-event').addEventListener('change', render);

initFilters();
render();
</script>
</body>
</html>`;

	res.send(html);
}

function active_players_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	req.app.db.fetch_all([{
		queryFunc: '_findOne',
		collection: 'tournaments',
		query: {key: tournament_key},
	}, {
		collection: 'matches',
		query: {
			tournament_key,
			$and: [{team1_won: {$ne: true}}, {team1_won: {$ne: false}}],
		},
	}], function(err, tournament, db_matches) {
		if (err || !tournament) {
			res.status(404).send('Tournament not found');
			return;
		}
		_active_players_render(res, tournament, db_matches);
	});
}

function _active_players_render(res, tournament, db_matches) {
	const lang = tournament.language || 'de';
	const by_event = {};
	for (const m of db_matches) {
		if (!m.setup || !m.setup.teams) continue;
		if (m.setup.incomplete) continue;
		const event_name = m.setup.event_name || '?';
		if (!by_event[event_name]) by_event[event_name] = {};
		for (const team of m.setup.teams) {
			if (!team.players) continue;
			for (const p of team.players) {
				if (!p.name) continue;
				by_event[event_name][p.name] = true;
			}
		}
	}

	const events_sorted = Object.keys(by_event).sort();
	const sections_json = JSON.stringify(events_sorted.map(ev => ({
		event: ev,
		players: Object.keys(by_event[ev]).sort(),
	}))).replace(/</g, '\\u003c');

	const is_de = lang === 'de';
	const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>${is_de ? 'Aktive Spieler' : 'Active Players'}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
	background: #1a1a2e;
	color: #eee;
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	padding: 3vmin;
}
h1 {
	text-align: center;
	font-size: 2.2em;
	margin-bottom: 0.2em;
	color: #fff;
}
.subtitle {
	text-align: center;
	color: #888;
	font-size: 1em;
	margin-bottom: 2em;
}
.controls {
	display: flex;
	gap: 1em;
	justify-content: center;
	flex-wrap: wrap;
	margin-bottom: 1.5em;
}
.controls input[type="text"] {
	padding: 0.5em 1em;
	font-size: 1em;
	background: #16213e;
	color: #eee;
	border: 1px solid #555;
	border-radius: 6px;
	width: 250px;
}
.controls input[type="text"]:focus {
	outline: none;
	border-color: #4fc3f7;
}
.controls select {
	padding: 0.5em 1em;
	font-size: 1em;
	background: #16213e;
	color: #eee;
	border: 1px solid #555;
	border-radius: 6px;
}
.event-section {
	max-width: 900px;
	margin: 0 auto 2em;
}
.event-header {
	background: #0f3460;
	color: #4fc3f7;
	padding: 0.6em 1em;
	font-size: 1.1em;
	font-weight: bold;
	border-radius: 6px 6px 0 0;
	display: flex;
	justify-content: space-between;
	align-items: center;
}
.event-count {
	background: #4fc3f7;
	color: #0f3460;
	border-radius: 12px;
	padding: 0.1em 0.7em;
	font-size: 0.85em;
	font-weight: bold;
}
.player-list {
	background: #16213e;
	border: 1px solid #333;
	border-top: none;
	border-radius: 0 0 6px 6px;
	padding: 0.5em 0;
}
.player-row {
	padding: 0.45em 1em;
	font-size: 1em;
	border-bottom: 1px solid #1a1a2e;
}
.player-row:last-child { border-bottom: none; }
.empty-msg {
	text-align: center;
	color: #666;
	font-size: 1.2em;
	margin-top: 4em;
}
#last-update {
	text-align: center;
	font-size: 0.85em;
	color: #555;
	margin-top: 2em;
}
</style>
</head>
<body>
<h1>${is_de ? 'Aktive Spieler' : 'Active Players'}</h1>
<div class="subtitle" id="subtitle"></div>
<div class="controls">
	<input type="text" id="search" placeholder="${is_de ? 'Suchen…' : 'Search…'}">
	<select id="filter-event"><option value="">${is_de ? 'Alle Disziplinen' : 'All Events'}</option></select>
</div>
<div id="sections"></div>
<div id="last-update"></div>
<script>
var ALL = ${sections_json};

function initFilters() {
	var ef = document.getElementById('filter-event');
	for (var i = 0; i < ALL.length; i++) {
		var o = document.createElement('option');
		o.value = ALL[i].event; o.textContent = ALL[i].event;
		ef.appendChild(o);
	}
}

function render() {
	var q = document.getElementById('search').value.toLowerCase();
	var fe = document.getElementById('filter-event').value;
	var container = document.getElementById('sections');
	container.innerHTML = '';
	var total = 0;

	for (var i = 0; i < ALL.length; i++) {
		var sec = ALL[i];
		if (fe && sec.event !== fe) continue;
		var players = sec.players;
		if (q) {
			players = players.filter(function(p) { return p.toLowerCase().indexOf(q) >= 0; });
		}
		if (players.length === 0) continue;
		total += players.length;

		var div = document.createElement('div');
		div.className = 'event-section';

		var hdr = document.createElement('div');
		hdr.className = 'event-header';
		var hdr_text = document.createElement('span');
		hdr_text.textContent = sec.event;
		var badge = document.createElement('span');
		badge.className = 'event-count';
		badge.textContent = players.length;
		hdr.appendChild(hdr_text);
		hdr.appendChild(badge);
		div.appendChild(hdr);

		var list = document.createElement('div');
		list.className = 'player-list';
		for (var j = 0; j < players.length; j++) {
			var row = document.createElement('div');
			row.className = 'player-row';
			row.textContent = players[j];
			list.appendChild(row);
		}
		div.appendChild(list);
		container.appendChild(div);
	}

	document.getElementById('subtitle').textContent = total + ${is_de ? "' Spieler in ' + (fe ? '1 Disziplin' : ALL.length + ' Disziplinen')" : "' players in ' + (fe ? '1 event' : ALL.length + ' events')"};
	document.getElementById('last-update').textContent = ${is_de ? "'Letztes Update: '" : "'Last update: '"} + new Date().toLocaleTimeString();
}

document.getElementById('search').addEventListener('input', render);
document.getElementById('filter-event').addEventListener('change', render);
initFilters();
render();
</script>
</body>
</html>`;
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache');
	res.send(html);
}

function mixed_overview_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	req.app.db.fetch_all([{
		queryFunc: '_findOne',
		collection: 'tournaments',
		query: {key: tournament_key},
	}, {
		collection: 'matches',
		query: {tournament_key},
	}], function(err, tournament, db_matches) {
		if (err || !tournament) {
			res.status(404).send('Tournament not found');
			return;
		}
		_mixed_overview_render(res, tournament, db_matches);
	});
}

function _mixed_overview_render(res, tournament, db_matches) {
	const singles_active = new Set();
	const groups = {};

	for (const m of db_matches) {
		if (!m.setup || !m.setup.teams) continue;
		const ev = m.setup.event_name || '';
		const is_singles = ev.startsWith('HE') || ev.startsWith('DE');
		const is_mixed = ev.startsWith('MX');
		const is_finished = (m.team1_won === true || m.team1_won === false);

		if (is_singles && !is_finished) {
			for (const team of m.setup.teams) {
				if (!team.players) continue;
				for (const p of team.players) {
					if (p.name) singles_active.add(p.name);
				}
			}
		}

		if (is_mixed) {
			const group_name = ev.replace(/^MX\s*-?\s*/, '') || 'MX';
			if (!groups[group_name]) groups[group_name] = {};
			for (const team of m.setup.teams) {
				if (!team.players || team.players.length === 0) continue;
				const names = team.players.map(p => p.name || 'N.N.');
				const key = names.join(' / ');
				if (key === 'N.N.' || key === 'N.N. / N.N.') continue;
				if (!groups[group_name][key]) {
					groups[group_name][key] = names;
				}
			}
		}
	}

	const group_names = Object.keys(groups).sort();
	const classes = {};
	for (const gn of group_names) {
		const klasse_match = gn.match(/Kl(?:asse)?\.?\s*\d+/i);
		const klasse = klasse_match ? klasse_match[0] : gn;
		if (!classes[klasse]) classes[klasse] = [];
		const team_keys = Object.keys(groups[gn]).sort();
		const teams = team_keys.map(function(tk) {
			const players = groups[gn][tk];
			const any_in_singles = players.some(n => n !== 'N.N.' && singles_active.has(n));
			return {
				label: tk,
				players: players.map(n => ({
					name: n,
					in_singles: (n !== 'N.N.' && singles_active.has(n)),
				})),
				blocked: any_in_singles,
			};
		});
		classes[klasse].push({group: gn, teams: teams});
	}

	const class_names = Object.keys(classes).sort();
	const data = class_names.map(cn => ({class_name: cn, groups: classes[cn]}));
	const data_json = JSON.stringify(data).replace(/</g, '\\u003c');

	const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>Mixed Übersicht</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
	background: #1a1a2e;
	color: #eee;
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	padding: 3vmin;
}
h1 {
	text-align: center;
	font-size: 2.2em;
	margin-bottom: 0.2em;
	color: #fff;
}
.subtitle {
	text-align: center;
	color: #888;
	font-size: 1em;
	margin-bottom: 1.5em;
}
.legend {
	display: flex;
	gap: 2em;
	justify-content: center;
	margin-bottom: 2em;
	flex-wrap: wrap;
}
.legend-item {
	display: flex;
	align-items: center;
	gap: 0.4em;
	font-size: 0.9em;
	color: #aaa;
}
.legend-dot {
	width: 12px; height: 12px;
	border-radius: 50%;
	display: inline-block;
}
.legend-dot.blocked { background: #c62828; }
.legend-dot.free { background: #4caf50; }
.class-section {
	max-width: 1100px;
	margin: 0 auto;
	padding-bottom: 2em;
	margin-bottom: 2em;
	border-bottom: 2px solid #4fc3f7;
}
.class-section:last-child {
	border-bottom: none;
	margin-bottom: 0;
	padding-bottom: 0;
}
.class-header {
	font-size: 1.4em;
	font-weight: bold;
	color: #fff;
	margin-bottom: 1.2em;
}
.class-groups {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
	gap: 1.5em;
}
.group-card {
	background: #16213e;
	border: 1px solid #333;
	border-radius: 10px;
	overflow: hidden;
}
.group-header {
	background: #0f3460;
	color: #4fc3f7;
	padding: 0.7em 1em;
	font-size: 1.15em;
	font-weight: bold;
	display: flex;
	justify-content: space-between;
	align-items: center;
}
.group-count {
	font-size: 0.8em;
	color: #888;
	font-weight: normal;
}
.team-row {
	padding: 0.6em 1em;
	border-bottom: 1px solid #1a1a2e;
	display: flex;
	align-items: center;
	gap: 0.6em;
}
.team-row:last-child { border-bottom: none; }
.team-dot {
	width: 10px; height: 10px;
	border-radius: 50%;
	flex-shrink: 0;
}
.team-dot.blocked { background: #c62828; }
.team-dot.free { background: #4caf50; }
.team-players {
	flex: 1;
	display: flex;
	gap: 0.3em;
	flex-wrap: wrap;
	align-items: center;
}
.player-name {
	font-size: 1em;
}
.player-name.in-singles {
	color: #ef5350;
	font-weight: bold;
}
.player-name.free {
	color: #a5d6a7;
}
.player-sep {
	color: #555;
	font-size: 0.85em;
}
#last-update {
	text-align: center;
	font-size: 0.85em;
	color: #555;
	margin-top: 2em;
}
</style>
</head>
<body>
<h1>Mixed Übersicht</h1>
<div class="subtitle" id="subtitle"></div>
<div class="legend">
	<div class="legend-item"><span class="legend-dot blocked"></span> Spielt noch Einzel</div>
	<div class="legend-item"><span class="legend-dot free"></span> Einzel beendet</div>
</div>
<div id="classes"></div>
<div id="last-update"></div>
<script>
var ALL = ${data_json};

function render() {
	var container = document.getElementById('classes');
	container.innerHTML = '';
	var total_teams = 0, total_blocked = 0;

	for (var ci = 0; ci < ALL.length; ci++) {
		var cls = ALL[ci];
		var section = document.createElement('div');
		section.className = 'class-section';

		var cls_hdr = document.createElement('div');
		cls_hdr.className = 'class-header';
		cls_hdr.textContent = cls.class_name;
		section.appendChild(cls_hdr);

		var grid = document.createElement('div');
		grid.className = 'class-groups';

		for (var i = 0; i < cls.groups.length; i++) {
			var g = cls.groups[i];
			var card = document.createElement('div');
			card.className = 'group-card';

			var hdr = document.createElement('div');
			hdr.className = 'group-header';
			var hdr_name = document.createElement('span');
			hdr_name.textContent = g.group;
			var hdr_count = document.createElement('span');
			hdr_count.className = 'group-count';
			hdr_count.textContent = g.teams.length + ' Teams';
			hdr.appendChild(hdr_name);
			hdr.appendChild(hdr_count);
			card.appendChild(hdr);

			for (var j = 0; j < g.teams.length; j++) {
				var t = g.teams[j];
				total_teams++;
				if (t.blocked) total_blocked++;

				var row = document.createElement('div');
				row.className = 'team-row';

				var dot = document.createElement('span');
				dot.className = 'team-dot ' + (t.blocked ? 'blocked' : 'free');
				row.appendChild(dot);

				var pl = document.createElement('div');
				pl.className = 'team-players';
				for (var k = 0; k < t.players.length; k++) {
					if (k > 0) {
						var sep = document.createElement('span');
						sep.className = 'player-sep';
						sep.textContent = ' / ';
						pl.appendChild(sep);
					}
					var sp = document.createElement('span');
					sp.className = 'player-name ' + (t.players[k].in_singles ? 'in-singles' : 'free');
					sp.textContent = t.players[k].name;
					pl.appendChild(sp);
				}
				row.appendChild(pl);
				card.appendChild(row);
			}
			grid.appendChild(card);
		}
		section.appendChild(grid);
		container.appendChild(section);
	}

	document.getElementById('subtitle').textContent = total_teams + ' Teams · ' + (total_teams - total_blocked) + ' bereit · ' + total_blocked + ' warten auf Einzel';
	document.getElementById('last-update').textContent = 'Letztes Update: ' + new Date().toLocaleTimeString();
}

render();
</script>
</body>
</html>`;
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache');
	res.send(html);
}

function rotating_display_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	const interval = parseInt(req.query.interval, 10) || 20;
	const style = req.query.style || 'ostbek1';
	const pages_param = req.query.pages;

	var default_pages = [
		'/admin/t/' + encodeURIComponent(tournament_key) + '/upcoming',
		'/bupdev/#btsh_e=' + encodeURIComponent(tournament_key) + '&display&dm_style=' + encodeURIComponent(style),
	];

	var pages = default_pages;
	if (pages_param) {
		try {
			pages = JSON.parse(pages_param);
		} catch (e) {
			pages = default_pages;
		}
	}

	const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Rotating Display</title>
<style>
* { margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
iframe { width: 100%; height: 100%; border: none; position: absolute; top: 0; left: 0; }
iframe.hidden { opacity: 0; pointer-events: none; }
iframe.visible { opacity: 1; }
</style>
</head>
<body>
<iframe id="frame-a" class="visible"></iframe>
<iframe id="frame-b" class="hidden"></iframe>
<script>
var PAGES = ${JSON.stringify(pages)};
var INTERVAL = ${interval} * 1000;
var current = 0;
var frameA = document.getElementById('frame-a');
var frameB = document.getElementById('frame-b');
var activeFrame = frameA;
var backFrame = frameB;

frameA.src = PAGES[0];

setInterval(function() {
	current = (current + 1) % PAGES.length;
	var url = PAGES[current];
	if (url.indexOf('#') < 0) {
		var bust = '_t=' + Date.now();
		url += (url.indexOf('?') >= 0 ? '&' : '?') + bust;
	}
	backFrame.src = 'about:blank';
	setTimeout(function() {
		backFrame.src = url;
		backFrame.onload = function() {
			activeFrame.className = 'hidden';
			backFrame.className = 'visible';
			var tmp = activeFrame;
			activeFrame = backFrame;
			backFrame = tmp;
		};
	}, 50);
}, INTERVAL);
</script>
</body></html>`;
	res.setHeader('Content-Type', 'text/html; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache');
	res.send(html);
}

module.exports = {
	logo_handler,
	matchinfo_handler,
	matches_handler,
	setup_handler,
	court_overview_handler,
	courts_to_call_handler,
	tshirt_sizes_handler,
	tshirt_overview_handler,
	active_players_handler,
	mixed_overview_handler,
	rotating_display_handler,
};
