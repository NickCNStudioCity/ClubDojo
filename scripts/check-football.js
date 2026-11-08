// Checks the Football rules by playing scripted rounds on a virtual clock, with no server.
// Run: npm run check:football
const assert = require('assert');
const game = require('../server/src/minigames/games/football');

// A match on a virtual clock. rand(n) defaults to the middle value, which means no wobble.
function match(playerCount, rand) {
  let now = 0, seq = 0, ended = null, endCalls = 0;
  const timers = new Map();
  const present = new Set(Array.from({ length: playerCount }, (_, i) => i + 1));
  const msgs = [];
  const ctx = {
    game: game.id, settings: { ...game.defaults },
    players: [...present].map((id) => ({ id, name: `P${id}`, loadout: {} })),
    isPlaying: (id) => present.has(id),
    send: () => {},
    broadcast: (d) => msgs.push(JSON.parse(JSON.stringify(d))),
    after: (ms, fn) => { const h = ++seq; timers.set(h, { at: now + ms, fn }); return h; },
    every: () => { throw new Error('football has no repeating timers'); },
    cancel: (h) => timers.delete(h),
    now: () => now,
    randomInt: rand || ((n) => Math.floor(n / 2)),
    end: (r) => { endCalls++; if (!ended) ended = r; },
    log: () => {},
  };
  const inst = game.create(ctx);
  inst.start();
  const m = {
    inst, msgs, ctx,
    get now() { return now; }, get ended() { return ended; }, get endCalls() { return endCalls; },
    wait(ms) { // run timers due in the next ms milliseconds
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn();
      }
      now = until;
    },
    last: (type) => [...msgs].reverse().find((x) => x.type === type),
    all: (type) => msgs.filter((x) => x.type === type),
    leave(id) { present.delete(id); inst.leave(id); },
    drain() { for (let i = 0; i < 20000 && !ended; i++) m.wait(250); },
    // Run a whole kick for player id: aimAt and powerAt are meter positions on the first rising sweep.
    kick(id, aimYd, power, extra = {}) {
      inst.input(id, { type: 'press' });                          // starts the aim meter
      if (extra.beforeAim) extra.beforeAim();
      const aimU = (aimYd / 12 + 1) / 2;
      m.wait((aimU / 2) * 1800);
      inst.input(id, { type: 'press' });                          // locks the aim
      m.wait(power * 1000);
      inst.input(id, { type: 'press' });                          // locks the power
      return m.last('attempt');
    },
    pause() { m.wait(game.defaults.pauseMs); },
  };
  return m;
}

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}

// At 35 yards the sweet spot starts at power 0.495. Calm air unless a test says otherwise.
const SWEET = 0.53;
// randomInt that gives wind 0, no wobble, right-hand lantern at 0.65 of the goal, and no post-in.
const still = (n) => (n === 2 ? 1 : Math.floor(n / 2));

console.log('Checking Football rules');

test('a straight, well-struck kick is good and scores the distance points', () => {
  const m = match(2, still);
  assert.strictEqual(m.last('turn').wind, 0);
  const a = m.kick(1, 0, SWEET);
  assert.strictEqual(a.outcome, 'good', JSON.stringify(a));
  assert.ok(a.made);
  assert.strictEqual(a.parts.base, 3);
  assert.strictEqual(a.parts.perfect, 2, 'dead centre is a Perfect');
  assert.strictEqual(a.points, 5);
});

test('too little power drops short, however good the aim', () => {
  const m = match(2, still);
  const a = m.kick(1, 0, 0.3);
  assert.strictEqual(a.outcome, 'short');
  assert.strictEqual(a.points, 0);
});

test('too much power hooks the ball off line', () => {
  const m = match(2, still);
  for (let i = 0; i < 3; i++) m.inst.input(1, { type: 'dist', step: -1 });   // 20 yards: the easiest kick to overhit
  const a = m.kick(1, 0, 0.97);
  assert.strictEqual(a.dist, 20);
  assert.ok(Math.abs(a.landing) > a.half, `landing ${a.landing}`);
  assert.strictEqual(a.made, false);
});

test('wind pushes the ball, so aiming into it scores', () => {
  const windy = (n) => (n === 7 ? 6 : (n === 2 ? 1 : Math.floor(n / 2)));   // wind +3 every turn
  const blown = match(2, windy).kick(1, 2, SWEET);
  assert.strictEqual(blown.outcome, 'wide', 'aiming right of centre drifts wide');
  const m = match(2, windy);
  assert.strictEqual(m.last('turn').wind, 3);
  const a = m.kick(1, -3.6, SWEET);
  assert.strictEqual(a.outcome, 'good', JSON.stringify(a));
  assert.strictEqual(a.parts.perfect, 2);
});

test('hitting the lantern pays its bonus instead of a Perfect', () => {
  const m = match(2, still);
  const t = m.last('turn');
  const half = 3.25;                                         // 35 yards
  const a = m.kick(1, t.lantern * half, SWEET);
  assert.strictEqual(a.outcome, 'good', JSON.stringify(a));
  assert.strictEqual(a.parts.lantern, 3);
  assert.strictEqual(a.parts.perfect, 0);
});

test('clipping an upright can go in or out', () => {
  for (const [roll, expected] of [[1, 'post-in'], [0, 'post-out']]) {
    let armed = false;
    const rand = (n) => (n === 2 ? (armed ? roll : 1) : Math.floor(n / 2));
    const m = match(2, rand);
    m.inst.input(1, { type: 'press' });
    m.wait((((3.25 / 12) + 1) / 2 / 2) * 1800);
    m.inst.input(1, { type: 'press' });
    armed = true;
    m.wait(SWEET * 1000);
    m.inst.input(1, { type: 'press' });
    const a = m.last('attempt');
    assert.strictEqual(a.outcome, expected, JSON.stringify(a));
    assert.strictEqual(a.made, expected === 'post-in');
    assert.strictEqual(a.parts.perfect, 0);
  }
});

test('streaks add a capped bonus, and a miss resets them', () => {
  const m = match(1, still);
  const bonus = [];
  for (let i = 0; i < 4; i++) {
    bonus.push(m.kick(1, 0, SWEET).parts.streak);
    m.pause();
    m.wait(8000);                                            // the bot takes its kick
  }
  assert.deepStrictEqual(bonus, [0, 1, 2, 3]);
  const a = m.kick(1, 0, 0.1);
  assert.strictEqual(a.streak, 0);
});

test('the fifth kick is golden and counts double', () => {
  const m = match(1, still);
  let t;
  for (let i = 0; i < 4; i++) { t = m.last('turn'); assert.strictEqual(t.golden, false); m.kick(1, 0, 0.1); m.pause(); m.wait(8000); }
  t = m.last('turn');
  assert.strictEqual(t.golden, true);
  const a = m.kick(1, 0, SWEET);
  assert.strictEqual(a.points, (3 + 2) * 2);
});

test('solo: the bot takes all five kicks and the last kick is seen before the end', () => {
  const m = match(1, still);
  for (let i = 0; i < 5; i++) { m.kick(1, 0, 0.1); m.pause(); m.wait(8000); }
  const botKicks = m.all('attempt').filter((a) => a.id === '__bot').length;
  m.drain();
  assert.strictEqual(m.all('attempt').filter((a) => a.id === '__bot').length, 5, `bot kicked ${botKicks} before draining`);
  assert.ok(m.last('final'), 'final standings were shown');
  assert.ok(m.ended.length === 1 && m.ended[0].id === 1, 'only real players get results');
  assert.strictEqual(m.endCalls, 1);
});

test('beating the bot pays a bonus that reaches the final score', () => {
  const m = match(1, still);
  for (let i = 0; i < 5; i++) m.inst.input(1, { type: 'dist', step: 1 });      // 60 yards: outscore the bot
  for (let i = 0; i < 5; i++) { assert.ok(m.kick(1, 0, 0.85).made); m.pause(); m.wait(8000); }
  m.drain();
  const f = m.last('final');
  const you = f.standings.find((x) => x.id === 1);
  assert.strictEqual(f.standings[0].id, 1);
  assert.strictEqual(f.bonus, 5);
  assert.strictEqual(m.ended[0].score, you.score);
  const lost = match(1, still);
  for (let i = 0; i < 5; i++) { lost.kick(1, 0, 0.1); lost.pause(); lost.wait(8000); }
  lost.drain();
  assert.strictEqual(lost.last('final').bonus, 0, 'no bonus for losing');
});

test('a full table of four all get five kicks', () => {
  const m = match(4, still);
  for (let i = 0; i < 20; i++) {
    const t = m.last('turn');
    m.kick(t.id, 0, 0.1); m.pause();
  }
  m.drain();
  for (const id of [1, 2, 3, 4]) assert.strictEqual(m.all('attempt').filter((a) => a.id === id).length, 5);
});

test('only the kicker can act, and only in the right order', () => {
  const m = match(2, still);
  m.inst.input(2, { type: 'press' });
  m.inst.input(2, { type: 'dist', step: 1 });
  assert.strictEqual(m.all('phase').length, 0);
  assert.strictEqual(m.all('dist').length, 0);
  m.inst.input(1, { type: 'press' });                        // now aiming
  m.inst.input(1, { type: 'dist', step: 1 });
  assert.strictEqual(m.all('dist').length, 0, 'distance is fixed once the swing starts');
  m.inst.input(1, null);
  m.inst.input(1, { type: 'nonsense', at: 'x' });
  m.inst.input(99, { type: 'gust' });
  assert.strictEqual(m.all('gust').length, 0);
});

test('a press time can only be a little older than the real one', () => {
  const m = match(2, still);
  m.inst.input(1, { type: 'press' });
  m.wait(900);                                               // the marker is at the far right
  m.inst.input(1, { type: 'press', at: 450 });               // claims centre, 450ms ago: not believed
  assert.ok(m.last('phase').aim > 6, `aim ${m.last('phase').aim}`);
  const n = match(2, still);
  n.inst.input(1, { type: 'press' });
  n.wait(500);
  n.inst.input(1, { type: 'press', at: 400 });               // a 100ms-old press is honoured
  assert.ok(Math.abs(n.last('phase').aim - (((400 / 1800) * 2 - 0.5) * 24)) < 0.02, `aim ${n.last('phase').aim}`);
  const o = match(2, still);
  o.inst.input(1, { type: 'press' });
  o.wait(450);
  o.inst.input(1, { type: 'press', at: 9e9 });               // a press from the future is the present
  assert.ok(Math.abs(o.last('phase').aim) < 0.02, `aim ${o.last('phase').aim}`);
});

test('a Gust Scroll strengthens the wind, once per ninja and once per turn', () => {
  const rand = (n) => (n === 7 ? 5 : (n === 2 ? 1 : Math.floor(n / 2)));   // wind +2
  const m = match(3, rand);
  assert.strictEqual(m.last('turn').wind, 2);
  m.inst.input(1, { type: 'gust' });
  assert.strictEqual(m.all('gust').length, 0, 'the kicker cannot gust');
  m.inst.input(2, { type: 'gust' });
  assert.strictEqual(m.last('gust').wind, 4);
  m.inst.input(3, { type: 'gust' });
  assert.strictEqual(m.all('gust').length, 1, 'one gust per turn');
  m.inst.input(1, { type: 'press' });
  m.wait(100);
  m.inst.input(1, { type: 'press' });
  m.inst.input(3, { type: 'gust' });
  assert.strictEqual(m.all('gust').length, 1, 'no gusts once the aim is locked');
  m.wait(530);
  m.inst.input(1, { type: 'press' });
  assert.strictEqual(m.last('attempt').wind, 4);
  m.pause();
  m.inst.input(2, { type: 'press' });                        // kicker 2's turn; scroll 2 is spent
  m.inst.input(1, { type: 'gust' });
  assert.strictEqual(m.last('gust').from, 1);
  m.wait(10);
});

test('a gust read during the turn of the bot throws its kick off line', () => {
  const m = match(1, still);
  m.kick(1, 0, 0.1); m.pause();
  assert.strictEqual(m.last('turn').id, '__bot');
  m.inst.input(1, { type: 'gust' });
  m.wait(8000);
  const a = m.last('attempt');
  assert.strictEqual(a.id, '__bot');
  assert.strictEqual(Math.abs(a.wind), 2);
  assert.ok(Math.abs(a.landing) >= 2, `landing ${a.landing}`);
});

test('a kick that times out is a miss, and the next limit is shorter', () => {
  const m = match(2, still);
  assert.strictEqual(m.last('turn').ms, game.defaults.turnMs);
  m.wait(game.defaults.turnMs + 1);
  const a = m.last('attempt');
  assert.strictEqual(a.outcome, 'timeout');
  m.pause();
  m.wait(game.defaults.turnMs + 1);                          // player 2 also idles
  m.pause();
  assert.strictEqual(m.last('turn').id, 1);
  assert.ok(m.last('turn').ms < game.defaults.turnMs, 'an idle ninja gets a shorter clock');
});

test('the kicker leaving moves play on; everyone leaving ends it once', () => {
  const m = match(2, still);
  m.leave(1);
  assert.strictEqual(m.last('turn').id, 2);
  m.leave(2);
  assert.ok(m.ended);
  assert.strictEqual(m.endCalls, 1);
  const n = match(2, still);
  n.kick(1, 0, 0.1);
  n.leave(2);                                                // leaves during the replay pause
  n.pause();
  assert.strictEqual(n.last('turn').id, 1, 'play continues with the one left');
});

test('rewards pay about two coins a point', () => {
  assert.deepStrictEqual(game.rewards({ score: 20 }, { players: 2 }), { coins: 40, xp: 20 });
});

console.log(failures ? `\n${failures} problem(s) found.` : '\nFootball rules look good.');
process.exitCode = failures ? 1 : 0;
