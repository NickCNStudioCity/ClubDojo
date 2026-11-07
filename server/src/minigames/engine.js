// Minigame engine: runs every lobby on the server so no client can cheat a score.
// Each minigame spot on a map gets one lobby. Lifecycle (shared by all games):
//   lobby  -> countdown -> playing -> results -> lobby (play again) ...
// A game module only implements the "playing" part; see docs/minigames/README.md.
const P = require('../../../shared/protocol');

const COUNTDOWN_MS = 3000;
const RESULTS_MS = 8000;
const REWARD_CAP = { coins: 500, xp: 250 }; // per match, after the admin multiplier

function createEngine({ db, registry, sendTo, toRoom, onRewarded, log = () => {} }) {
  const lobbies = new Map(); // key -> lobby
  const byPlayer = new Map(); // accountId -> lobby

  const fail = (code, message) => { const e = new Error(message); e.code = code; throw e; };

  // ---------- settings (admin: enable/disable, reward multiplier, tuning) ----------
  function settings(gameId) {
    const game = registry.get(gameId);
    const saved = db.getJsonSetting(`minigame:${gameId}`) || {};
    return {
      enabled: saved.enabled !== false,
      multiplier: Number.isFinite(saved.multiplier) ? saved.multiplier : 1,
      tuning: { ...(game ? game.defaults : {}), ...(saved.tuning || {}) },
    };
  }
  function setSettings(gameId, patch) {
    const cur = db.getJsonSetting(`minigame:${gameId}`) || {};
    const next = { ...cur };
    if (patch.enabled !== undefined) next.enabled = !!patch.enabled;
    if (patch.multiplier !== undefined) next.multiplier = Math.max(0, Math.min(5, Number(patch.multiplier) || 0));
    db.setJsonSetting(`minigame:${gameId}`, next);
    if (next.enabled === false) for (const l of [...lobbies.values()]) if (l.game.id === gameId) close(l, 'This minigame was closed by a Grandmaster.');
    return settings(gameId);
  }

  // ---------- messaging ----------
  function lobbyPayload(l) {
    return {
      key: l.key, game: l.game.id, name: l.game.name, color: l.game.color, phase: l.phase, endsAt: l.endsAt || null,
      hostId: l.hostId, min: l.game.minPlayers, max: l.game.maxPlayers,
      players: [...l.players.values()].map((p) => ({ id: p.id, name: p.loadout.name, ready: p.ready, loadout: p.loadout })),
    };
  }
  function toLobby(l, msg) { for (const id of l.players.keys()) sendTo(id, msg); }
  function pushLobby(l) { toLobby(l, { t: 'mg:lobby', lobby: lobbyPayload(l) }); pushSpots(l.roomId); }
  function spotStatus(roomId) {
    const out = {};
    for (const l of lobbies.values()) if (l.roomId === roomId) out[l.spotId] = { phase: l.phase, count: l.players.size, max: l.game.maxPlayers };
    return out;
  }
  function pushSpots(roomId) { toRoom(roomId, { t: 'mg:spots', roomId, spots: spotStatus(roomId) }); }

  // ---------- timers owned by a lobby (all cleared when a phase ends) ----------
  function after(l, ms, fn) {
    const h = setTimeout(() => { l.timers.delete(h); guard(l, fn); }, ms);
    l.timers.add(h);
    return h;
  }
  function every(l, ms, fn) {
    const h = setInterval(() => guard(l, fn), ms);
    l.timers.add(h);
    return h;
  }
  function clearTimers(l) { for (const h of l.timers) { clearTimeout(h); clearInterval(h); } l.timers.clear(); }
  function guard(l, fn) {
    try { fn(); } catch (e) {
      log(`[minigame] ${l.game.id} crashed: ${e.stack || e}`);
      abort(l, 'The minigame hit an error and was stopped. No rewards this time.');
    }
  }

  // ---------- lifecycle ----------
  function join(session, roomId, spot) {
    const id = session.account.id;
    if (byPlayer.has(id)) fail('busy', 'You are already in a minigame lobby.');
    const game = registry.get(spot.game);
    if (!game) fail('bad', 'That minigame is not installed on this server.');
    if (!settings(game.id).enabled) fail('closed', `${game.name} is closed right now.`);
    const key = P.spotKey(roomId, spot);
    let l = lobbies.get(key);
    if (!l) {
      l = { key, roomId, spotId: spot.id, game, players: new Map(), hostId: id, phase: 'lobby', timers: new Set(), instance: null, endsAt: null };
      lobbies.set(key, l);
    }
    if (l.phase !== 'lobby') fail('busy', `${game.name} is in the middle of a round. Wait for it to finish.`);
    if (l.players.size >= game.maxPlayers) fail('full', `${game.name} is full.`);
    l.players.set(id, { id, ready: false, loadout: P.loadoutFromNinja({ ...session.ninja, account_id: id }) });
    byPlayer.set(id, l);
    pushLobby(l);
    return lobbyPayload(l);
  }

  function leave(accountId, reason) {
    const l = byPlayer.get(accountId);
    if (!l) return false;
    byPlayer.delete(accountId);
    l.players.delete(accountId);
    sendTo(accountId, { t: 'mg:closed', key: l.key, reason: reason || null });
    if (l.players.size === 0) { clearTimers(l); safeCall(l, 'dispose'); lobbies.delete(l.key); pushSpots(l.roomId); return true; }
    if (l.hostId === accountId) l.hostId = l.players.keys().next().value;
    if (l.phase === 'playing') safeCall(l, 'leave', accountId);
    if (l.phase === 'countdown' && l.players.size < l.game.minPlayers) { clearTimers(l); l.phase = 'lobby'; l.endsAt = null; }
    pushLobby(l);
    return true;
  }

  function setReady(accountId, ready) {
    const l = mine(accountId);
    if (l.phase !== 'lobby') return lobbyPayload(l);
    l.players.get(accountId).ready = !!ready;
    const all = [...l.players.values()].every((p) => p.ready);
    if (all && l.players.size >= l.game.minPlayers) startCountdown(l);
    else pushLobby(l);
    return lobbyPayload(l);
  }

  function start(accountId) {
    const l = mine(accountId);
    if (l.hostId !== accountId) fail('bad', 'Only the first ninja in the lobby can start.');
    if (l.phase !== 'lobby') fail('bad', 'Already starting.');
    if (l.players.size < l.game.minPlayers) fail('bad', `${l.game.name} needs at least ${l.game.minPlayers} ninjas.`);
    startCountdown(l);
    return lobbyPayload(l);
  }

  function startCountdown(l) {
    l.phase = 'countdown';
    l.endsAt = Date.now() + COUNTDOWN_MS;
    pushLobby(l);
    after(l, COUNTDOWN_MS, () => startPlaying(l));
  }

  function startPlaying(l) {
    l.phase = 'playing';
    l.endsAt = null;
    l.ended = false;
    pushLobby(l);
    const ctx = makeContext(l);
    l.instance = l.game.create(ctx) || {};
    if (l.instance.start) l.instance.start();
    if (l.game.tickRate > 0) {
      let last = Date.now();
      every(l, Math.round(1000 / l.game.tickRate), () => {
        const now = Date.now();
        if (l.instance.tick) l.instance.tick((now - last) / 1000);
        last = now;
      });
    }
  }

  function makeContext(l) {
    const isIn = (id) => l.players.has(id);
    return {
      game: l.game.id,
      settings: settings(l.game.id).tuning,
      players: [...l.players.values()].map((p) => ({ id: p.id, name: p.loadout.name, loadout: p.loadout })),
      isPlaying: isIn,
      send: (id, data) => { if (isIn(id)) sendTo(id, { t: 'mg:msg', key: l.key, data }); },
      broadcast: (data) => toLobby(l, { t: 'mg:msg', key: l.key, data }),
      after: (ms, fn) => after(l, ms, fn),
      every: (ms, fn) => every(l, ms, fn),
      cancel: (h) => { clearTimeout(h); clearInterval(h); l.timers.delete(h); },
      now: () => Date.now(),
      randomInt: (n) => Math.floor(Math.random() * n),
      end: (results) => finish(l, results),
      log: (...a) => log(`[minigame:${l.game.id}]`, ...a),
    };
  }

  function finish(l, results) {
    if (l.ended || l.phase !== 'playing') return;
    l.ended = true;
    clearTimers(l);
    safeCall(l, 'dispose');
    l.instance = null;
    const mult = settings(l.game.id).multiplier;
    const rows = (results || [])
      .filter((r) => l.players.has(r.id))
      .map((r) => ({ id: r.id, score: Math.max(0, Math.floor(Number(r.score) || 0)), detail: r.detail || null }))
      .sort((a, b) => b.score - a.score);
    let place = 0, prev = null;
    rows.forEach((r, i) => { if (r.score !== prev) { place = i + 1; prev = r.score; } r.place = place; });
    for (const r of rows) {
      const base = l.game.rewards ? l.game.rewards(r, { players: rows.length }) : { coins: r.score, xp: Math.floor(r.score / 2) };
      r.coins = Math.min(REWARD_CAP.coins, Math.max(0, Math.round((base.coins || 0) * mult)));
      r.xp = Math.min(REWARD_CAP.xp, Math.max(0, Math.round((base.xp || 0) * mult)));
      r.name = l.players.get(r.id).loadout.name;
      db.recordMinigameScore(r.id, l.game.id, r.score, r.place, rows.length);
      if (r.coins || r.xp) db.addRewards(r.id, r.coins, r.xp);
      onRewarded(r.id);
    }
    log(`[minigame] ${l.game.id} at ${l.key} finished: ${rows.map((r) => `${r.name}=${r.score}`).join(', ')}`);
    l.phase = 'results';
    l.endsAt = Date.now() + RESULTS_MS;
    toLobby(l, { t: 'mg:results', key: l.key, game: l.game.id, results: rows });
    pushLobby(l);
    after(l, RESULTS_MS, () => backToLobby(l));
  }

  function backToLobby(l) {
    l.phase = 'lobby';
    l.endsAt = null;
    for (const p of l.players.values()) p.ready = false;
    pushLobby(l);
  }

  function abort(l, reason) {
    clearTimers(l);
    safeCall(l, 'dispose');
    l.instance = null;
    l.ended = true;
    toLobby(l, { t: 'mg:notice', key: l.key, text: reason });
    backToLobby(l);
  }

  function close(l, reason) {
    for (const id of [...l.players.keys()]) leave(id, reason);
  }

  function input(accountId, data) {
    const l = byPlayer.get(accountId);
    if (!l || l.phase !== 'playing' || !l.instance || !l.instance.input) return;
    guard(l, () => l.instance.input(accountId, data && typeof data === 'object' ? data : {}));
  }

  function safeCall(l, method, ...args) {
    if (!l.instance || typeof l.instance[method] !== 'function') return;
    try { l.instance[method](...args); } catch (e) { log(`[minigame] ${l.game.id}.${method} failed: ${e.message}`); }
  }

  function mine(accountId) {
    const l = byPlayer.get(accountId);
    if (!l) fail('bad', 'You are not in a minigame.');
    return l;
  }

  // Close lobbies whose spot was removed or moved by a map edit.
  function syncRoom(room) {
    const ids = new Set((room.minigames || []).map((s) => `${s.id}|${s.game}|${s.x}|${s.y}`));
    for (const l of [...lobbies.values()]) {
      if (l.roomId !== room.id) continue;
      const spot = (room.minigames || []).find((s) => s.id === l.spotId);
      if (!spot || !ids.has(`${spot.id}|${spot.game}|${spot.x}|${spot.y}`) || spot.game !== l.game.id) close(l, 'This minigame spot was changed by a Grandmaster.');
    }
  }

  function adminList() {
    return registry.list().map((g) => ({
      ...g, settings: g.available ? settings(g.id) : null,
      lobbies: [...lobbies.values()].filter((l) => l.game.id === g.id).map(lobbyPayload),
      top: g.available ? db.topMinigameScores(g.id, 5) : [],
    }));
  }

  function lobbyCounts() {
    const out = {};
    for (const l of lobbies.values()) out[l.key] = { phase: l.phase, count: l.players.size, max: l.game.maxPlayers };
    return out;
  }

  function shutdown() { for (const l of lobbies.values()) { clearTimers(l); safeCall(l, 'dispose'); } lobbies.clear(); byPlayer.clear(); }

  return {
    join, leave, setReady, start, input, settings, setSettings, spotStatus, syncRoom, adminList, lobbyCounts, shutdown,
    lobbyOf: (id) => byPlayer.get(id) || null,
  };
}

module.exports = { createEngine, COUNTDOWN_MS, RESULTS_MS, REWARD_CAP };
