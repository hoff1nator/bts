'use strict';

const assert = require('assert');
const path = require('path');
const utils = require('./utils');
const bupws = require('./bupws');
const bupws_v2 = require('./bupws_v2');
const calc = require('../static/bup/dev/js/calc.js');

const DISPLAY_PREVIEW_SETUP = Object.freeze({
	match_id: 'tdemo_match_42',
	match_num: 42,
	counting: '3x21',
	match_name: 'Finale',
	event_name: 'MX O55',
	umpire_name: 'Ulli Unparteiisch',
	service_judge_name: '',
	court_id: 'tdemo_5',
	is_doubles: true,
	team_competition: false,
	teams: [
		{
			name: 'TV Musterstadt',
			players: [
				{ name: 'Max Emil Mustermann', firstname: 'Max', middlename: 'Emil', lastname: 'Mustermann', nationality: 'GER' },
				{ name: 'Lena Beispiel', firstname: 'Lena', middlename: '', lastname: 'Beispiel', nationality: 'GER' },
			],
		},
		{
			name: 'BC Beispielheim',
			players: [
				{ name: 'Timo Testfeld', firstname: 'Timo', middlename: '', lastname: 'Testfeld', nationality: 'GER' },
				{ name: 'Mia Sophie Demo', firstname: 'Mia', middlename: 'Sophie', lastname: 'Demo', nationality: 'GER' },
			],
		},
	],
});

function display_preview_full_score_sequence() {
	return [
		[1, 0],
		[1, 1],
		[2, 1],
		[3, 1],
		[3, 2],
		[4, 2],
		[5, 2],
		[5, 3],
		[6, 3],
		[7, 3],
		[8, 3],
		[8, 4],
		[9, 4],
		[10, 4],
		[11, 4],
		[11, 5],
		[12, 5],
		[13, 5],
		[13, 6],
		[14, 6],
		[15, 6],
		[15, 7],
		[16, 7],
		[17, 7],
		[17, 8],
		[18, 8],
		[18, 9],
		[19, 9],
		[20, 9],
		[20, 10],
		[21, 10],
	];
}

function build_display_preview_presses(target_score, last_score_timestamp_ms, now_ms) {
	const sequence = display_preview_full_score_sequence();
	const target_index = sequence.findIndex(score => score[0] === target_score[0] && score[1] === target_score[1]);
	const used_sequence = target_index >= 0 ? sequence.slice(0, target_index + 1) : sequence;
	const fixed_last_score_ts = Number.isFinite(last_score_timestamp_ms) ? last_score_timestamp_ms : null;
	const start_ts = fixed_last_score_ts != null
		? (fixed_last_score_ts - Math.max(used_sequence.length - 1, 0) * 1000 - 1000)
		: (now_ms - (used_sequence.length + 10) * 1000);
	const presses = [{
		type: 'editmode_set-finished_games',
		scores: [[21, 18]],
		by_side: false,
		timestamp: start_ts,
	}, {
		type: 'pick_side',
		team1_left: true,
		timestamp: start_ts + 100,
	}, {
		type: 'pick_server',
		team_id: 0,
		player_id: 0,
		timestamp: start_ts + 200,
	}, {
		type: 'pick_receiver',
		team_id: 1,
		player_id: 0,
		timestamp: start_ts + 300,
	}, {
		type: 'love-all',
		timestamp: start_ts + 400,
	}];
	let previous_score = [0, 0];
	used_sequence.forEach((score, idx) => {
		let side = 'left';
		if (score[1] > previous_score[1]) {
			side = 'right';
		}
		presses.push({
			type: 'score',
			side,
			timestamp: start_ts + 1000 + idx * 1000,
		});
		previous_score = score;
	});
	return presses;
}

function build_display_preview_network_state(setup, target_score, last_score_timestamp_ms, now_ms) {
	const presses = build_display_preview_presses(target_score, last_score_timestamp_ms, now_ms);
	const temp_state = {
		setup,
		metadata: {
			id: setup.match_id,
			start: null,
			end: null,
			updated: now_ms,
		},
	};
	calc.init_state(temp_state, null, presses, true);
	calc.state(temp_state);
	return {
		presses,
		network_score: calc.netscore(temp_state, true),
		network_team1_serving: temp_state.game.team1_serving,
		network_teams_player1_even: temp_state.game.teams_player1_even.slice(),
		network_team0_left: temp_state.game.team1_left,
	};
}

function create_display_preview_event(app, variant) {
	const now_ms = app?.clock ? app.clock.now_ms() : Date.now();
	let target_score = [12, 5];
	let last_score_timestamp_ms = now_ms - 2000;
	if (variant === 'live') {
		target_score = [10, 4];
		last_score_timestamp_ms = now_ms - 1500;
	}
	const setup = JSON.parse(JSON.stringify(DISPLAY_PREVIEW_SETUP));
	const network_state = build_display_preview_network_state(setup, target_score, last_score_timestamp_ms, now_ms);
	return {
		type: 'bup-export',
		version: 2,
		event: {
			staticnet_message: 'BTS Display-Vorschau',
			id: `bts_display_preview_${variant}`,
			tournament_name: 'BTS Display-Vorschau',
			matches: [{
				setup,
				presses_json: JSON.stringify(network_state.presses),
				network_score: network_state.network_score,
				network_team1_serving: network_state.network_team1_serving,
				network_teams_player1_even: network_state.network_teams_player1_even,
				network_team0_left: network_state.network_team0_left,
			}],
			courts: [{
				court_id: 'tdemo_5',
				label: 5,
				match_id: 'tdemo_match_42',
			}],
		},
	};
}

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
		const match_repr = bupws.create_match_representation(req.app, tournament, match);
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

function display_preview_handler(req, res) {
	const variant = req.params.variant === 'live' ? 'live' : 'primary';
	const reply = create_display_preview_event(req.app, variant);
	res.header('Content-Type', 'application/json');
	res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
	res.setHeader('Pragma', 'no-cache');
	res.setHeader('Expires', '0');
	res.send(JSON.stringify(reply, null, 2));
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

		let matches = db_matches.map(dbm => bupws.create_match_representation(req.app, tournament, dbm));
		const recently_finished = [];
		matches = matches.filter(m => {
			if (!m || !m.setup) return false;
			if (m.setup.state === 'finished') {
				if (m.end_ts && m.end_ts > now - 60000) {
					recently_finished.push(m);
				}
				return false;
			}
			// The DB query already scoped this to matches with a court_id
			// assigned, so no further narrowing is needed here.
			return true;
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

		const ctc_enabled = !!tournament.courts_to_call_enabled;
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
		event.battery_by_court = bupws_v2.get_battery_by_court();
		event.recently_finished = recently_finished;

		res.json({status: 'ok', event});
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
.status-green  .court-timer { color: #4caf50; }
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
var _STRINGS = (${JSON.stringify(lang)} === 'de') ? {
	title: 'Feldübersicht',
	no_game: 'Kein Spiel',
	not_called: 'Noch nicht aufgerufen',
	oncourt: 'Auf dem Feld',
	waiting: 'Warte auf Spieler',
	second_call: '⚠ 2. Aufruf',
	final_call: '⚠ Letzter Aufruf',
	present: 'Spieler anwesend',
	last_update: 'Letztes Update: ',
} : {
	title: 'Court Overview',
	no_game: 'No game',
	not_called: 'Not called yet',
	oncourt: 'On court',
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
	var container = document.getElementById('courts');

	var by_court = {};
	for (var i = 0; i < matches.length; i++) {
		var m = matches[i];
		var cid = m.setup && m.setup.court_id;
		if (cid && !by_court[cid]) by_court[cid] = m;
	}

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
		} else if (!match.setup.now_on_court) {
			card.classList.add('status-purple');
			status_el.textContent = _STRINGS.not_called;
			set_players_el(players_el, match.setup);
			var event_text = match.setup.event_name || '';
			if (match.setup.match_name) event_text += (event_text ? ' – ' : '') + match.setup.match_name;
			event_el.textContent = event_text;
		} else if (call_settings && call_settings.courts_to_call_enabled && !match.setup.teams_present) {
			var status_color, status_text;
			if (call_settings.final_call_enabled && match.setup.final_call_at) {
				status_color = 'status-alert';
				status_text = _STRINGS.final_call;
			} else if (call_settings.second_call_enabled && match.setup.second_call_at) {
				status_color = 'status-orange';
				status_text = _STRINGS.second_call;
			} else {
				status_color = 'status-yellow';
				status_text = _STRINGS.waiting;
			}
			card.classList.add(status_color);
			status_el.textContent = status_text;
			set_players_el(players_el, match.setup);
			if (match.setup.called_to_court_at) {
				timer_el.textContent = format_duration(Date.now() - match.setup.called_to_court_at);
				timer_el.dataset.since = match.setup.called_to_court_at;
			}
			var event_text = match.setup.event_name || '';
			if (match.setup.match_name) event_text += (event_text ? ' – ' : '') + match.setup.match_name;
			event_el.textContent = event_text;
		} else {
			card.classList.add('status-green');
			status_el.textContent = (call_settings && call_settings.courts_to_call_enabled) ? _STRINGS.present : _STRINGS.oncourt;
			set_players_el(players_el, match.setup);
			if (match.setup.called_timestamp) {
				timer_el.textContent = format_duration(Date.now() - match.setup.called_timestamp);
				timer_el.dataset.since = match.setup.called_timestamp;
			}
			var event_text = match.setup.event_name || '';
			if (match.setup.match_name) event_text += (event_text ? ' – ' : '') + match.setup.match_name;
			event_el.textContent = event_text;
		}

		var bat_el = document.createElement('div');
		bat_el.className = 'court-battery';
		var bat = battery_by_court && battery_by_court[court.court_id];
		if (bat && typeof bat.level === 'number') {
			var pct = Math.round(bat.level * 100);
			var icon = bat.charging ? '⚡' : '🔋';
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
	match_edit:1, score:1, match_called_on_court:1,
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


// Courts-to-call: a staff-facing kiosk page (no admin login) for calling
// matches to free courts and re-announcing overdue ones. Fully integrated
// with v2's own call mechanism: "Call" invokes
// match_utils.call_next_candidate_on_court(), the same candidate-selection
// and call_match() waterfall automatic calling uses (officials, BTP sync,
// etc. all happen the normal way) - this page just lets a human trigger it
// on demand, which matters when a tournament has
// call_next_possible_scheduled_match_in_preparation turned off (manual
// mode) and needs someone to press the button instead.
function courts_to_call_data_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	const now = Date.now();
	req.app.db.fetch_all([{
		queryFunc: '_findOne',
		collection: 'tournaments',
		query: {key: tournament_key},
	}, {
		collection: 'courts',
		query: {tournament_key},
	}, {
		collection: 'matches',
		query: {tournament_key},
	}, {
		collection: 'umpires',
		query: {tournament_key},
	}], function(err, tournament, courts, matches, umpires) {
		if (err || !tournament) {
			res.json({status: 'error', message: err ? err.message : 'Tournament not found'});
			return;
		}

		const match_automation = require('./match_automation');
		const current_tournament = {...tournament, courts, matches, umpires};
		const occupied_court_ids = new Set(
			matches
				.filter(m => m.setup && m.setup.now_on_court && m.setup.court_id)
				.map(m => m.setup.court_id)
		);

		const to_call = [];
		courts
			.filter(c => c.is_active !== false && !occupied_court_ids.has(c._id))
			.forEach(court => {
				const candidates = match_automation.find_call_on_court_candidates(current_tournament, court._id, {now_ts: now});
				if (candidates && candidates.length > 0) {
					to_call.push({
						court: {court_id: court._id, label: court.name || String(court.num)},
						match: bupws.create_match_representation(req.app, tournament, candidates[0]),
					});
				}
			});

		const reminders = matches
			.filter(m => m.setup && m.setup.now_on_court && !m.setup.teams_present && (m.setup.second_call_at || m.setup.final_call_at))
			.map(m => bupws.create_match_representation(req.app, tournament, m));

		const ctc_enabled = !!tournament.courts_to_call_enabled;
		res.json({
			status: 'ok',
			to_call,
			reminders,
			call_settings: {
				courts_to_call_enabled: ctc_enabled,
				second_call_enabled: ctc_enabled && tournament.second_call_enabled !== false,
				final_call_enabled: ctc_enabled && tournament.final_call_enabled !== false,
				automatic_calling_enabled: !!tournament.call_next_possible_scheduled_match_in_preparation,
			},
		});
	});
}

function courts_to_call_call_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	const court_id = req.body && req.body.court_id;
	if (!court_id) {
		res.json({status: 'error', message: 'Missing court_id'});
		return;
	}
	req.app.db.tournaments.findOne({key: tournament_key}, (err, tournament) => {
		if (err || !tournament) {
			res.json({status: 'error', message: err ? err.message : 'Tournament not found'});
			return;
		}
		const match_utils = require('./match_utils');
		match_utils.call_next_candidate_on_court(req.app, tournament, tournament_key, court_id)
			.then(() => res.json({status: 'ok'}))
			.catch((callErr) => res.json({status: 'error', message: callErr && (callErr.message || String(callErr))}));
	});
}

// Manual re-announce: lets staff mark a match as needing a 2nd/final call
// right now, ahead of (or in addition to) the automatic escalation timer
// (see match_utils.start_call_escalation_manager). Same fields, same
// broadcast - just human-triggered instead of time-triggered.
function courts_to_call_escalate_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	const match_id = req.body && req.body.match_id;
	const level = req.body && req.body.level;
	if (!match_id || (level !== 1 && level !== 2)) {
		res.json({status: 'error', message: 'Missing match_id or invalid level'});
		return;
	}
	const update = (level === 2) ? {'setup.final_call_at': Date.now()} : {'setup.second_call_at': Date.now()};
	req.app.db.matches.update({_id: match_id, tournament_key}, {$set: update}, {}, (err, numAffected) => {
		if (err || numAffected !== 1) {
			res.json({status: 'error', message: err ? err.message : 'Match not found'});
			return;
		}
		const admin = require('./admin');
		admin.notify_change(req.app, tournament_key, 'match_edit', {match__id: match_id});
		res.json({status: 'ok'});
	});
}

function courts_to_call_handler(req, res) {
	const tournament_key = req.params.tournament_key;
	req.app.db.tournaments.findOne({key: tournament_key}, function(req_err, tournament) {
		if (req_err || !tournament) {
			res.status(404).send('Tournament not found');
			return;
		}
		_courts_to_call_render(res, tournament_key, tournament);
	});
}

function _courts_to_call_render(res, tournament_key, tournament) {
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
.match-call-btn { font-size: 2.5vmin; background: #7b1fa2; color: #fff; border: none; border-radius: 1vmin; padding: 1vmin 2vmin; cursor: pointer; flex-shrink: 0; }
.second-call .match-call-btn { background: #f57c00; }
.final-call  .match-call-btn { background: #e91e8c; }
#empty-msg { color: #555; font-size: 2.5vmin; margin-top: 3vmin; text-align: center; }
#auto-note { color: #666; font-size: 1.6vmin; margin-bottom: 1vmin; }
#last-update { font-size: 1.5vmin; color: #555; margin-top: 1vmin; flex-shrink: 0; }
</style>
</head>
<body>
<h1>Courts to Call</h1>
<div id="auto-note"></div>
<div id="match-list"></div>
<div id="last-update"></div>
<script>
var TOURNAMENT_KEY = ${JSON.stringify(tournament_key)};
var POLL_INTERVAL = 5000;
var _STRINGS = (${JSON.stringify(tournament.language || 'de')} === 'de') ? {
	title: 'Feldaufruf',
	second_call: '⚠ 2. Aufruf',
	final_call: '⚠ Letzter Aufruf',
	call_btn: 'Aufrufen',
	remind_btn_2: '2. Aufruf auslösen',
	remind_btn_3: 'Letzten Aufruf auslösen',
	all_called: 'Nichts zu tun – alle Felder sind versorgt.',
	auto_on: 'Automatischer Feldaufruf ist aktiv – diese Liste sollte meist leer sein.',
	auto_off: 'Automatischer Feldaufruf ist deaktiviert – bitte manuell aufrufen.',
	last_update: 'Letztes Update: ',
} : {
	title: 'Courts to Call',
	second_call: '⚠ 2nd Call',
	final_call: '⚠ Final Call',
	call_btn: 'Call',
	remind_btn_2: 'Trigger 2nd call',
	remind_btn_3: 'Trigger final call',
	all_called: 'Nothing to do – all courts are covered.',
	auto_on: 'Automatic calling is on – this list should usually be empty.',
	auto_off: 'Automatic calling is off – please call matches manually.',
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

var _busy = {};

function post(url, body, cb) {
	var xhr = new XMLHttpRequest();
	xhr.open('POST', url);
	xhr.setRequestHeader('Content-Type', 'application/json');
	xhr.onload = function() {
		try {
			var data = JSON.parse(xhr.responseText);
			cb(data.status === 'ok' ? null : data.message, data);
		} catch (e) {
			cb('parse error');
		}
	};
	xhr.onerror = function() { cb('network error'); };
	xhr.send(JSON.stringify(body));
}

function make_call_row(court, match) {
	var row = document.createElement('div');
	row.className = 'match-row';
	var busy_key = 'call:' + court.court_id;
	row.addEventListener('click', function() {
		if (_busy[busy_key]) return;
		_busy[busy_key] = true;
		row.classList.add('calling');
		post('/h/' + encodeURIComponent(TOURNAMENT_KEY) + '/courts-to-call/call', {court_id: court.court_id}, function(err) {
			delete _busy[busy_key];
			if (err) row.classList.remove('calling');
			poll();
		});
	});

	var court_el = document.createElement('div');
	court_el.className = 'match-court';
	court_el.textContent = court.label;
	row.appendChild(court_el);

	var info_el = document.createElement('div');
	info_el.className = 'match-info';
	var players_el = document.createElement('div');
	players_el.className = 'match-players';
	players_el.textContent = players_str(match.setup, 0) + ' vs ' + players_str(match.setup, 1);
	info_el.appendChild(players_el);
	var event_text = match.setup.event_name || '';
	if (match.setup.match_name) event_text += (event_text ? ' – ' : '') + match.setup.match_name;
	if (event_text) {
		var event_el = document.createElement('div');
		event_el.className = 'match-event';
		event_el.textContent = event_text;
		info_el.appendChild(event_el);
	}
	row.appendChild(info_el);

	var btn = document.createElement('button');
	btn.className = 'match-call-btn';
	btn.textContent = _STRINGS.call_btn;
	row.appendChild(btn);
	return row;
}

function make_reminder_row(match) {
	var level = match.setup.final_call_at ? 2 : 1;
	var row = document.createElement('div');
	row.className = 'match-row ' + (level === 2 ? 'final-call' : 'second-call');
	var raw_id = String(match.setup.match_id || '').replace(/^bts_/, '');
	var busy_key = 'esc:' + raw_id;
	row.addEventListener('click', function() {
		if (_busy[busy_key] || level >= 2) return;
		_busy[busy_key] = true;
		row.classList.add('calling');
		post('/h/' + encodeURIComponent(TOURNAMENT_KEY) + '/courts-to-call/escalate', {match_id: raw_id, level: 2}, function(err) {
			delete _busy[busy_key];
			if (err) row.classList.remove('calling');
			poll();
		});
	});

	var court_el = document.createElement('div');
	court_el.className = 'match-court';
	court_el.textContent = match.setup.court_id || '';
	row.appendChild(court_el);

	var info_el = document.createElement('div');
	info_el.className = 'match-info';
	var label_el = document.createElement('div');
	label_el.className = 'match-call-label';
	label_el.textContent = level === 2 ? _STRINGS.final_call : _STRINGS.second_call;
	info_el.appendChild(label_el);
	var players_el = document.createElement('div');
	players_el.className = 'match-players';
	players_el.textContent = players_str(match.setup, 0) + ' vs ' + players_str(match.setup, 1);
	info_el.appendChild(players_el);
	row.appendChild(info_el);

	var btn = document.createElement('button');
	btn.className = 'match-call-btn';
	btn.textContent = level === 2 ? _STRINGS.final_call : _STRINGS.remind_btn_3;
	if (level === 2) btn.disabled = true;
	row.appendChild(btn);
	return row;
}

function render(data) {
	var container = document.getElementById('match-list');
	container.innerHTML = '';

	document.getElementById('auto-note').textContent =
		data.call_settings && data.call_settings.automatic_calling_enabled ? _STRINGS.auto_on : _STRINGS.auto_off;

	if ((!data.reminders || data.reminders.length === 0) && (!data.to_call || data.to_call.length === 0)) {
		var empty = document.createElement('div');
		empty.id = 'empty-msg';
		empty.textContent = _STRINGS.all_called;
		container.appendChild(empty);
	} else {
		(data.reminders || []).forEach(function(m) { container.appendChild(make_reminder_row(m)); });
		(data.to_call || []).forEach(function(entry) { container.appendChild(make_call_row(entry.court, entry.match)); });
	}

	document.getElementById('last-update').textContent = _STRINGS.last_update + new Date().toLocaleTimeString();
}

function poll() {
	var xhr = new XMLHttpRequest();
	xhr.open('GET', '/h/' + encodeURIComponent(TOURNAMENT_KEY) + '/courts-to-call/data');
	xhr.onload = function() {
		if (xhr.status !== 200) return;
		try {
			var data = JSON.parse(xhr.responseText);
			if (data.status !== 'ok') return;
			render(data);
		} catch(e) {}
	};
	xhr.send();
}

poll();
setInterval(poll, POLL_INTERVAL);

var _ws_refresh_types = {
	match_edit:1, score:1, match_called_on_court:1,
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

module.exports = {
	logo_handler,
	matchinfo_handler,
	display_preview_handler,
	rotating_display_handler,
	matches_handler,
	court_overview_handler,
	courts_to_call_data_handler,
	courts_to_call_call_handler,
	courts_to_call_escalate_handler,
	courts_to_call_handler,
};
