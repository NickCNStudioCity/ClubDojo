// Scripted checks for the Basketball rules: release timing, scoring, hot spots, Chi and Shadow
// Clones, smoke bombs, input validation, the buzzer, and how bots score over a full round.
// Runs on a simulated clock. Run: npm run check:basketball
const assert = require('assert');
const game = require('../server/src/minigames/games/basketball');

const HOOP_X = 0.9;
const sweetAt = (x) => 520 + (HOOP_X - x) * 260;

function setup({ players = 1, roundMs = 60000, seed = 1 } = {}) {
  let now = 0, n = seed, hid = 0, ended = null;
  const timers = new Map();
  const msgs = [];
  const all = Array.from({ length: players }, (_, i) => ({ id: i + 1, name: `P${i + 1}`, loadout: {} }));
  const ctx = {
    game: game.id, settings: { ...game.defaults, roundMs }, players: all, isPlaying: () => true,
    send: () => {}, broadcast: (d) => msgs.push(d),
    after: (ms, fn) => { const h = ++hid; timers.set(h, { at: now + ms, fn }); return h; },
    every: () => 0, cancel: (h) => timers.delete(h), now: () => now,
    randomInt: (m) => { n = (n * 16807) % 2147483647; return n % m; },
    end: (r) => { ended = ended || r; }, log: () => {},
  };
  const inst = game.create(ctx);
  inst.start();
  const tick = () => {
    for (const [h, t] of [...timers]) if (t.at <= now) { timers.delete(h); t.fn(); }
    if (!ended) inst.tick(1 / game.tickRate);
  };
  const advance = (ms) => {
    const end = now + ms;
    while (now < end) { const step = Math.min(1000 / game.tickRate, end - now); now += step; tick(); }
  };
  const row = (id) => {
    const states = msgs.filter((m) => m.type === 'state');
    return states[states.length - 1].lanes.find((l) => l.id === id);
  };
  const shots = (id) => msgs.filter((m) => m.type === 'shot' && m.id === id);
  // Exact release: jump, wait with no ticks moving the ninja, let go after holdMs.
  const shoot = (id, holdMs) => {
    inst.input(id, { type: 'charge' });
    now += holdMs;
    inst.input(id, { type: 'release' });
    const s = shots(id);
    return s[s.length - 1];
  };
  return { inst, msgs, advance, shoot, shots, row, ended: () => ended, clock: () => now, setClock: (v) => { now = v; } };
}

// Move a player away from the hot spot, or onto it, by walking until x is close.
function walkTo(g, id, x) {
  for (let i = 0; i < 200; i++) {
    g.advance(1000 / game.tickRate);
    const r = g.row(id);
    if (Math.abs(r.x - x) < 0.02) { g.inst.input(id, { type: 'move', dir: 0 }); return r; }
    g.inst.input(id, { type: 'move', dir: Math.sign(x - r.x) });
  }
  throw new Error('walkTo did not arrive');
}

const tests = {
  'a perfect release always goes in, and misses need bad timing'() {
    for (let seed = 1; seed < 30; seed++) {
      const g = setup({ seed });
      g.advance(100);
      const x = g.row(1).x;
      const s = g.shoot(1, sweetAt(x));
      assert.strictEqual(s.grade, 'perfect');
      assert.strictEqual(s.made, true);
    }
  },
  'early is an airball, late is a brick'() {
    const g = setup();
    g.advance(100);
    const x = g.row(1).x;
    const a = g.shoot(1, 150);
    assert.deepStrictEqual([a.grade, a.kind, a.made, a.points], ['off', 'air', false, 0]);
    g.advance(800);
    const b = g.shoot(1, sweetAt(x) + 300);
    assert.deepStrictEqual([b.grade, b.kind, b.made], ['off', 'brick', false]);
  },
  'cannot shoot before the ball is back, and release needs a charge'() {
    const g = setup();
    g.advance(100);
    const x = g.row(1).x;
    g.inst.input(1, { type: 'release' });
    assert.strictEqual(g.shots(1).length, 0);
    g.shoot(1, sweetAt(x));
    g.shoot(1, sweetAt(x));
    assert.strictEqual(g.shots(1).length, 1);
  },
  'the ninja cannot walk during a jump'() {
    const g = setup();
    g.advance(100);
    const x = g.row(1).x;
    g.inst.input(1, { type: 'move', dir: 1 });
    g.inst.input(1, { type: 'charge' });
    g.advance(300);
    assert.strictEqual(g.row(1).x, x);
  },
  'a jump held too long shoots by itself'() {
    const g = setup();
    g.advance(100);
    g.inst.input(1, { type: 'charge' });
    g.advance(1400);
    assert.strictEqual(g.shots(1).length, 1);
    assert.strictEqual(g.shots(1)[0].kind, 'brick');
  },
  'zones pay 2, 3 and 4, and a perfect in the paint is a dunk'() {
    const g = setup({ seed: 5 });
    g.advance(100);
    const score = (x) => {
      const r = walkTo(g, 1, x);
      g.advance(800);
      return g.shoot(1, sweetAt(g.row(1).x), r);
    };
    const near = score(0.75);
    assert.strictEqual(near.dunk, true);
    assert.strictEqual(near.zone, 2);
    assert.strictEqual(near.points, 2 + 1 + 2 + (near.hot ? 2 : 0));
    assert.strictEqual(score(0.3).zone, 3);
    assert.strictEqual(score(0.12).zone, 4);
  },
  'Chi fills from makes and Shadow Clones double the points'() {
    const g = setup({ seed: 9 });
    g.advance(100);
    g.inst.input(1, { type: 'focus' });
    assert.ok(!g.msgs.some((m) => m.type === 'focus'), 'needs a full bar');
    const x = g.row(1).x;
    for (let i = 0; i < 3; i++) { g.shoot(1, sweetAt(x)); g.advance(700); }
    const before = g.row(1);
    assert.ok(before.c >= 100, `expected a full bar, got ${before.c}`);
    g.inst.input(1, { type: 'focus' });
    assert.ok(g.msgs.some((m) => m.type === 'focus'));
    const s = g.shoot(1, sweetAt(x));
    assert.strictEqual(s.focus, true);
    assert.strictEqual(s.points % 2, 0);
    g.advance(100);
    assert.strictEqual(g.row(1).c, 0);
  },
  'four makes in a row smoke the top rival'() {
    const g = setup({ seed: 3 });
    g.advance(100);
    const x = g.row(1).x;
    for (let i = 0; i < 4; i++) { g.shoot(1, sweetAt(x)); g.advance(700); }
    const smoke = g.msgs.find((m) => m.type === 'smoke' && m.from === 1);
    assert.ok(smoke, 'a smoke bomb was thrown');
    assert.notStrictEqual(smoke.to, 1);
  },
  'the last 10 seconds count double, and a late make is a buzzer beater'() {
    const g = setup({ roundMs: 12000, seed: 2 });
    g.advance(3000);
    assert.ok(g.msgs.some((m) => m.type === 'final'));
    const x = g.row(1).x;
    const s = g.shoot(1, sweetAt(x));
    assert.strictEqual(s.final, true);
    assert.strictEqual(s.points % 2, 0);
    g.advance(12000 - g.clock() - 900);
    const b = g.shoot(1, sweetAt(x));
    assert.strictEqual(b.buzzer, true);
  },
  'a jump still on at the horn is shot, then the round ends after the standings'() {
    const g = setup({ roundMs: 2000 });
    g.advance(1900);
    g.inst.input(1, { type: 'charge' });
    g.advance(200);
    assert.ok(g.msgs.some((m) => m.type === 'buzzer'));
    assert.strictEqual(g.shots(1).length, 1);
    assert.strictEqual(g.ended(), null);
    const n = g.shots(1).length;
    g.inst.input(1, { type: 'charge' });
    assert.strictEqual(g.shots(1).length, n);
    g.advance(3200);
    assert.ok(g.ended());
  },
  'junk input is ignored'() {
    const g = setup();
    g.advance(100);
    for (const m of [null, {}, { type: 'move', dir: 'x' }, { type: 'move', dir: 99 }, { type: 'nope' }, 5, 'a']) g.inst.input(1, m);
    g.inst.input(999, { type: 'charge' });
    g.advance(100);
    assert.ok(Number.isFinite(g.row(1).x));
    assert.ok(g.row(1).x >= 0.08 && g.row(1).x <= 0.85);
  },
  'a bot takes over when a player leaves, and everyone leaving ends the round'() {
    const g = setup({ players: 2 });
    g.advance(100);
    g.inst.leave(2);
    assert.ok(g.msgs.some((m) => m.type === 'takeover' && m.id === 2));
    g.advance(4000);
    assert.ok(g.shots(2).length > 0, 'the bot keeps shooting');
    assert.strictEqual(g.ended(), null);
    g.inst.leave(1);
    assert.ok(g.ended());
  },
  'bots play a believable round'() {
    const totals = [];
    for (let seed = 1; seed <= 20; seed++) {
      const g = setup({ seed: seed * 101 });
      g.advance(61000);
      for (let i = 0; i < 3; i++) totals.push({ i, score: g.row(`__bot${i}`).s, shots: g.shots(`__bot${i}`).length });
    }
    const avg = (i, f) => totals.filter((t) => t.i === i).reduce((a, t) => a + t[f], 0) / 20;
    for (let i = 0; i < 3; i++) console.log(`       bot ${i}: ${avg(i, 'score').toFixed(0)} points from ${avg(i, 'shots').toFixed(0)} shots`);
    assert.ok(avg(2, 'score') > avg(0, 'score'), 'better bots score more');
    for (const t of totals) assert.ok(t.score > 0 && t.shots >= 15, 'bots stay busy');
  },
  'rewards stay in line with other games'() {
    assert.deepStrictEqual(game.rewards({ score: 200, place: 1 }, { players: 1 }), { coins: 100, xp: 50 });
    assert.deepStrictEqual(game.rewards({ score: 200, place: 1 }, { players: 3 }), { coins: 115, xp: 50 });
  },
};

let failed = 0;
console.log('Checking Basketball');
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
console.log(failed ? `\n${failed} check(s) failed.` : '\nBasketball looks good.');
process.exitCode = failed ? 1 : 0;
