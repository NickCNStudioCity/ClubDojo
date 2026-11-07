// Checks every installed minigame without starting a server:
//   - the server module passes the registry checks
//   - a client file exists at shared/client/minigames/games/<id>.js and registers the same id
//   - a match with idle players (and one with random inputs) ends on its own and reports
//     a score for every player, using simulated time so even long rounds finish instantly
// Run: npm run check:minigames
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const registry = require('../server/src/minigames/registry');

const root = path.resolve(__dirname, '..');
const MAX_VIRTUAL_MS = 15 * 60 * 1000;
let failures = 0;
const ok = (msg) => console.log(`  ok   ${msg}`);
const bad = (msg) => { console.log(`  FAIL ${msg}`); failures++; };

function checkClient(id) {
  const file = path.join(root, 'shared/client/minigames/games', `${id}.js`);
  if (!fs.existsSync(file)) return bad(`${id}: missing client file ${path.relative(root, file)}`);
  let registered = null;
  const sandbox = { ClubDojoMinigames: { register: (def) => { registered = def; } }, console };
  try { vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file }); } catch (e) { return bad(`${id}: client file throws on load: ${e.message}`); }
  if (!registered) return bad(`${id}: client file does not call ClubDojoMinigames.register`);
  if (registered.id !== id) return bad(`${id}: client registers id "${registered.id}"`);
  if (typeof registered.mount !== 'function') return bad(`${id}: client module has no mount(ctx)`);
  ok(`${id}: client module registers`);
}

// Runs one match on a virtual clock. inputFn(ctx, instance, players, lastMsg) may send inputs.
function simulate(game, playerCount, inputFn) {
  let now = 0, seq = 0, ended = null, endCalls = 0;
  const timers = new Map();
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: i + 1, name: `Bot ${i + 1}`,
    loadout: { v: 1, id: i + 1, name: `Bot ${i + 1}`, color: '#20262e', headband: '#e8453c', belt: 'white', accessories: {} },
  }));
  const messages = [];
  const ctx = {
    game: game.id, settings: { ...game.defaults }, players,
    isPlaying: (id) => players.some((p) => p.id === id),
    send: (id, data) => messages.push({ to: id, data }),
    broadcast: (data) => messages.push({ to: '*', data }),
    after: (ms, fn) => { const h = ++seq; timers.set(h, { at: now + ms, fn }); return h; },
    every: (ms, fn) => { const h = ++seq; timers.set(h, { at: now + ms, fn, every: ms }); return h; },
    cancel: (h) => timers.delete(h),
    now: () => now,
    randomInt: (n) => Math.floor(Math.random() * n),
    end: (results) => { endCalls++; if (!ended) ended = results; },
    log: () => {},
  };
  const instance = game.create(ctx) || {};
  if (instance.start) instance.start();
  let lastTick = 0;
  const tickMs = game.tickRate > 0 ? Math.round(1000 / game.tickRate) : 0;
  while (!ended && now < MAX_VIRTUAL_MS) {
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    const nextTimer = next ? next[1].at : Infinity;
    const nextTick = tickMs ? lastTick + tickMs : Infinity;
    if (nextTimer === Infinity && nextTick === Infinity) break;
    if (nextTick <= nextTimer) { now = nextTick; if (instance.tick) instance.tick(tickMs / 1000); lastTick = now; }
    else {
      now = nextTimer;
      const [h, t] = next;
      if (t.every) t.at += t.every; else timers.delete(h);
      t.fn();
    }
    if (inputFn && messages.length) inputFn(instance, players, messages.splice(0));
  }
  if (instance.dispose) instance.dispose();
  return { ended, endCalls, now, players };
}

function checkServer(game) {
  for (const [label, count, inputFn] of [
    ['idle players', game.minPlayers, null],
    ['idle full lobby', game.maxPlayers, null],
    ['random inputs', game.maxPlayers, (inst, players) => {
      if (!inst.input) return;
      for (const p of players) inst.input(p.id, { type: 'tap', scroll: Math.floor(Math.random() * 8), x: Math.random(), y: Math.random(), action: 'random' });
    }],
  ]) {
    let r;
    try { r = simulate(game, count, inputFn); } catch (e) { bad(`${game.id} (${label}): threw ${e.stack.split('\n').slice(0, 2).join(' ')}`); continue; }
    if (!r.ended) { bad(`${game.id} (${label}): never called ctx.end within ${MAX_VIRTUAL_MS / 60000} virtual minutes`); continue; }
    if (r.endCalls > 1) bad(`${game.id} (${label}): called ctx.end ${r.endCalls} times (engine keeps the first)`);
    const ids = new Set(r.ended.map((x) => x.id));
    const missing = r.players.filter((p) => !ids.has(p.id));
    if (missing.length) { bad(`${game.id} (${label}): no result for ${missing.map((p) => p.name).join(', ')}`); continue; }
    if (r.ended.some((x) => !Number.isFinite(Number(x.score)))) { bad(`${game.id} (${label}): a score is not a number`); continue; }
    ok(`${game.id} (${label}, ${count} player${count > 1 ? 's' : ''}): ended after ${(r.now / 1000).toFixed(1)}s of game time`);
  }
  if (game.rewards) {
    const rw = game.rewards({ id: 1, score: 10, place: 1 }, { players: 2 });
    if (!rw || !Number.isFinite(rw.coins) || !Number.isFinite(rw.xp)) bad(`${game.id}: rewards() must return { coins, xp } numbers`);
    else ok(`${game.id}: rewards() for 10 points = ${rw.coins} coins, ${rw.xp} XP (before multiplier and cap)`);
  }
}

console.log('Checking installed minigames');
for (const game of registry.installed()) {
  checkClient(game.id);
  checkServer(game);
}
console.log(failures ? `\n${failures} problem(s) found.` : '\nAll minigames look good.');
process.exitCode = failures ? 1 : 0;
