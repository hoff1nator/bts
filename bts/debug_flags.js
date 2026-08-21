'use strict';

const tournament_debug_flags = new Map();
const tournament_auto_call_trace_flags = new Map();

function normalize_key(tournament_key) {
	return tournament_key || 'default';
}

function set_tournament_debug(tournament_key, enabled) {
	tournament_debug_flags.set(normalize_key(tournament_key), enabled === true);
}

function set_tournament_auto_call_trace(tournament_key, enabled) {
	tournament_auto_call_trace_flags.set(normalize_key(tournament_key), enabled === true);
}

function set_from_tournament(tournament) {
	if (!tournament || !tournament.key) {
		return;
	}
	set_tournament_debug(tournament.key, tournament.bts_debug_output_enabled === true);
	set_tournament_auto_call_trace(tournament.key, tournament.bts_auto_call_trace_enabled === true);
}

function enabled(app, tournament_key) {
	if (process.env.BTS_DEBUG_OUTPUT === '1') {
		return true;
	}
	if (process.env.BTS_DEBUG_OUTPUT === '0') {
		return false;
	}
	const key = normalize_key(tournament_key);
	if (tournament_debug_flags.has(key)) {
		return tournament_debug_flags.get(key) === true;
	}
	return app?.config?.bts_debug_output_enabled === true;
}

function any_enabled(app) {
	if (process.env.BTS_DEBUG_OUTPUT === '1') {
		return true;
	}
	if (process.env.BTS_DEBUG_OUTPUT === '0') {
		return false;
	}
	for (const value of tournament_debug_flags.values()) {
		if (value === true) {
			return true;
		}
	}
	return app?.config?.bts_debug_output_enabled === true;
}

function auto_call_trace_enabled(app, tournament_key) {
	if (process.env.BTS_AUTO_CALL_TRACE === '1') {
		return true;
	}
	if (process.env.BTS_AUTO_CALL_TRACE === '0') {
		return false;
	}
	const key = normalize_key(tournament_key);
	if (tournament_auto_call_trace_flags.has(key)) {
		return tournament_auto_call_trace_flags.get(key) === true;
	}
	return app?.config?.bts_auto_call_trace_enabled === true;
}

function log(app, tournament_key, ...args) {
	if (typeof args[0] === 'string' && args[0].includes('[bts] auto_call_trace:')) {
		if (auto_call_trace_enabled(app, tournament_key)) {
			console.log(...args);
		}
		return;
	}
	if (enabled(app, tournament_key)) {
		console.log(...args);
	}
}

module.exports = {
	any_enabled,
	auto_call_trace_enabled,
	enabled,
	log,
	set_from_tournament,
	set_tournament_auto_call_trace,
	set_tournament_debug,
};
