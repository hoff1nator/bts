'use strict';

const tournament_debug_flags = new Map();

function normalize_key(tournament_key) {
	return tournament_key || 'default';
}

function set_tournament_debug(tournament_key, enabled) {
	tournament_debug_flags.set(normalize_key(tournament_key), enabled === true);
}

function set_from_tournament(tournament) {
	if (!tournament || !tournament.key) {
		return;
	}
	set_tournament_debug(tournament.key, tournament.bts_debug_output_enabled === true);
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

function log(app, tournament_key, ...args) {
	if (enabled(app, tournament_key)) {
		console.log(...args);
	}
}

module.exports = {
	any_enabled,
	enabled,
	log,
	set_from_tournament,
	set_tournament_debug,
};
