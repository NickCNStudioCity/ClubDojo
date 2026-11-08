// Sled Race (server rules). Up to four ninjas sled down a mountain run. Steer to dodge rocks and
// rolling snowballs, grab ryo coins, ride boost pads, slide across ice, and hit jump ramps to fly
// over trouble and land tricks. Hold tuck to go faster (but steer slower), ride close behind a
// rival to draft, and skim past hazards for close-call bonuses.
//
// Courses: every round is a freshly generated run with its own layout, mix of sections, time of day
// and name. Set trackMode to 'daily' for three fixed courses a day instead (Pine Run, Frost Gully,
// Summit Dash), which also turns on personal bests and ghosts per course.
//
// After the race nobody is kicked out: riders can sit at the finish for up to sitMs, and the results
// come as soon as everyone has pressed Continue.
//
// Everything is simulated here; clients only send inputs and draw the state the server
// broadcasts. Guide: docs/minigames/README.md
//
// Lanes: x runs from -1 (far left) to 1 (far right). Distance y runs from 0 to trackLength.
const LANE_MIN = -1;
const LANE_MAX = 1;
const HIT_X = 0.22; // how close sideways counts as hitting a rock, pad or ramp
const BALL_X = 0.2; // ...or a rolling snowball
const PICK_X = 0.26; // coins are a little more forgiving
const HIT_Y = 14; // how close along the track counts as touching something
const CLOSE_X = 0.12; // passing a hazard within this much of a hit counts as a close call
const ICE_HW = 0.3; // half-width of an ice patch
const DRAFT_GAP = [12, 70]; // a rival this far ahead of you...
const DRAFT_X = 0.22; // ...and this close sideways gives you a draft
const STATE_EVERY = 2; // broadcast every Nth tick (tickRate 20 -> 10 updates a second)
const FINISH_POINTS = [60, 40, 25, 15]; // bonus for finishing 1st, 2nd, 3rd, 4th; then 5
const MAX_TRICKS_PER_JUMP = 2;
const TRICK_GAP_MS = 380; // time between two tricks in one jump

const NAME_A = ['Frozen', 'Whispering', 'Howling', 'Crystal', 'Moonlit', 'Thunder', 'Silver', 'Blizzard', 'Hidden', 'Ancient'];
const NAME_B = ['Ridge', 'Gully', 'Pass', 'Chute', 'Glade', 'Summit', 'Hollow', 'Run', 'Descent', 'Drift'];
const THEMES = ['morning', 'sunset', 'night'];

// The three daily courses. `deck` sets how often each kind of section appears.
const COURSES = [
  { id: 'pine', name: 'Pine Run', theme: 'morning',
    deck: { rocks: 5, ramp: 3, coins: 2, gate: 2, slalom: 2, boost: 2, snowball: 1, ice: 1 } },
  { id: 'gully', name: 'Frost Gully', theme: 'sunset',
    deck: { rocks: 4, ramp: 2, coins: 2, gate: 1, slalom: 2, boost: 2, snowball: 1, ice: 4 } },
  { id: 'summit', name: 'Summit Dash', theme: 'night',
    deck: { rocks: 4, ramp: 3, coins: 2, gate: 2, slalom: 1, boost: 2, snowball: 3, ice: 1 } },
];

module.exports = {
  id: 'sled-race',
  name: 'Sled Race',
  description: 'Race down a brand new run every time: dodge rocks and snowballs, grab coins and hit the ramps for tricks.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#2c8fbf',
  icon: '🛷',
  tickRate: 20,

  // Tuning values; read through ctx.settings so admins can change them later.
  defaults: {
    trackMode: 'random', // 'random': a new course every round; 'daily': today's three fixed courses
    trackLength: 2800, // distance to the finish line
    roundMs: 75000, // time limit; anyone still sledding is ranked by distance
    sitMs: 60000, // how long riders may sit at the finish before the results come up
    baseSpeed: 85, // distance per second on clear snow
    steerRate: 1.15, // lane widths per second
    stunMs: 900, // slow-down after hitting a rock or snowball
    boostMs: 1400, // length of a speed boost
    boostSpeed: 45, // extra speed while boosted
    tuckSpeed: 24, // extra speed at a full tuck
    tuckSteer: 0.5, // steering is multiplied by (1 - tuckSteer) at a full tuck
    draftSpeed: 16, // extra speed while drafting behind a rival
    iceSpeed: 12, // extra speed on ice, where steering slides
    iceGrip: 1.4, // how quickly steering takes hold on ice (per second)
    airMs: 800, // time in the air after a ramp
    trickPoints: 5, // style points for a trick (times the combo multiplier)
    doubleBonus: 4, // extra style points for a second trick in the same jump
    coinPoints: 1, // style points per coin
    closeCallPoints: 2, // style points for skimming past a hazard
    styleMax: 60, // style points are capped so a round's rewards stay fair
  },

  // Points: 1 per 1% of the track covered, a finish bonus by place, and style points from coins,
  // tricks and close calls. Coins follow the score.
  rewards(result, { players }) {
    const winBonus = result.place === 1 && players > 1 ? 10 : 0;
    return { coins: result.score * 2 + winBonus, xp: Math.floor(result.score * 0.8) + winBonus };
  },

  create(ctx) {
    const s = ctx.settings;
    const sleds = new Map();
    const daily = s.trackMode === 'daily';
    const course = daily ? COURSES[ctx.randomInt(COURSES.length)] : randomCourse(ctx);
    const day = dayKey(new Date());
    const sceneSeed = ctx.randomInt(100000); // scatters the trees and drifts differently each round
    let raceOver = false; // everyone is down, or time ran out; riders can stay until the sit timer ends
    const leftFinish = new Set(); // riders who pressed Continue
    const rand = seededRandom(daily ? hashString(`${day}:${course.id}`) : ctx.randomInt(2 ** 31));
    const obstacles = makeTrack(rand, s.trackLength, course.deck);
    let finishCount = 0;
    let ticks = 0;
    let done = false;
    let timeout = null;
    let startedAt = 0;

    for (const p of ctx.players) {
      sleds.set(p.id, {
        x: 0, y: 0, dir: 0, vx: 0, tuck: false, tuckAmt: 0, drafting: false, onIce: false,
        stunUntil: 0, boostUntil: 0, airUntil: 0, jumpTricks: 0, lastTrickAt: -1e9,
        coins: 0, tricks: 0, rocks: 0, closeCalls: 0, combo: 0, bestCombo: 0, style: 0,
        finishedAt: null, place: null, hits: new Set(),
      });
    }
    // Spread the starting sleds across the lanes
    const ids = [...sleds.keys()];
    ids.forEach((id, i) => { sleds.get(id).x = ids.length === 1 ? 0 : -0.6 + (1.2 * i) / (ids.length - 1); });

    function alive(id) { return sleds.has(id) && ctx.isPlaying(id); }
    function unfinished() { return [...sleds.keys()].filter((id) => alive(id) && sleds.get(id).finishedAt === null); }
    const mult = (sl) => 1 + Math.min(2, Math.floor(sl.combo / 5)); // x1, x2 at 5, x3 at 10
    function addStyle(sl, pts) { sl.style = Math.min(s.styleMax, sl.style + pts); }
    function bumpCombo(sl) { sl.combo++; sl.bestCombo = Math.max(sl.bestCombo, sl.combo); }

    function snapshot() {
      const now = ctx.now();
      const players = {};
      for (const [id, sl] of sleds) {
        if (!ctx.isPlaying(id)) continue;
        players[id] = [
          round(sl.x, 3), round(sl.y, 1), sl.finishedAt !== null ? 1 : 0,
          now < sl.stunUntil ? 1 : 0, now < sl.boostUntil ? 1 : 0, now < sl.airUntil ? 1 : 0,
          round(sl.tuckAmt, 2), sl.drafting ? 1 : 0, sl.combo, sl.style, sl.onIce ? 1 : 0,
        ];
      }
      return players;
    }

    function finish() {
      if (done) return;
      done = true;
      if (timeout) ctx.cancel(timeout);
      ctx.end(ctx.players.map((p) => {
        const sl = sleds.get(p.id);
        if (!sl) return { id: p.id, score: 0 }; // left mid-round; the engine drops this row
        const progress = Math.min(1, sl.y / s.trackLength);
        const bonus = sl.place ? (FINISH_POINTS[sl.place - 1] || 5) : 0;
        return {
          id: p.id,
          score: Math.round(progress * 100) + bonus + sl.style,
          detail: {
            place: sl.place, ms: sl.finishedAt === null ? null : sl.finishedAt - startedAt, course: course.id,
            hits: sl.rocks, coins: sl.coins, tricks: sl.tricks, closeCalls: sl.closeCalls, bestCombo: sl.bestCombo,
          },
        };
      }), { endingMs: 700 }); // the finish was already on screen, so go straight to the fade
    }

    // The race is over (everyone down, or out of time). Stop the clock and let riders stay put.
    function stopRace() {
      if (raceOver || done) return;
      raceOver = true;
      if (timeout) ctx.cancel(timeout);
      ctx.broadcast({ type: 'over', players: snapshot(), sitMs: s.sitMs });
      ctx.after(s.sitMs, finish);
      checkLeft();
    }
    // Everyone has pressed Continue, or nobody is left: on to the results.
    function checkLeft() {
      if (done) return;
      const here = [...sleds.keys()].filter(alive);
      if (!here.length) return finish();
      if (raceOver && here.every((id) => leftFinish.has(id))) finish();
    }
    function checkEnd() {
      if (done || raceOver) return;
      if (![...sleds.keys()].some(alive)) return finish();
      if (unfinished().length === 0) stopRace();
    }

    function crash(id, sl, now, kind) {
      sl.stunUntil = now + s.stunMs;
      sl.boostUntil = 0;
      sl.rocks++;
      sl.combo = 0;
      sl.vx *= 0.3;
      ctx.broadcast({ type: 'hit', id, kind });
    }

    function tick(dt) {
      if (done || raceOver) return;
      ticks++;
      const now = ctx.now();
      const t = now - startedAt;
      const racing = unfinished();
      for (const id of racing) {
        const sl = sleds.get(id);
        const stunned = now < sl.stunUntil;
        const boosted = now < sl.boostUntil;
        const air = now < sl.airUntil;
        const want = sl.tuck && !stunned ? 1 : 0;
        sl.tuckAmt += clamp(want - sl.tuckAmt, -dt * 4, dt * 2.2);
        sl.drafting = !air && racing.some((o) => {
          if (o === id) return false;
          const r = sleds.get(o);
          const gap = r.y - sl.y;
          return gap > DRAFT_GAP[0] && gap < DRAFT_GAP[1] && Math.abs(r.x - sl.x) < DRAFT_X;
        });
        const speed = s.baseSpeed * (stunned ? 0.35 : 1) + (boosted ? s.boostSpeed : 0)
          + sl.tuckAmt * s.tuckSpeed + (sl.drafting ? s.draftSpeed : 0) + (sl.onIce ? s.iceSpeed : 0);
        // Steering: instant on snow; on ice the sled keeps sliding and only slowly takes the turn
        const target = sl.dir * s.steerRate * (1 - s.tuckSteer * sl.tuckAmt) * (air ? 0.45 : 1);
        if (sl.onIce) sl.vx += (target - sl.vx) * Math.min(1, dt * s.iceGrip);
        else sl.vx = target;
        const nx = sl.x + sl.vx * dt;
        sl.x = clamp(nx, LANE_MIN, LANE_MAX);
        if (sl.x !== nx) sl.vx = 0; // stopped by the snow bank
        const prevY = sl.y;
        sl.y = Math.min(s.trackLength, sl.y + speed * dt);

        sl.onIce = false;
        for (const ob of obstacles) {
          if (ob.kind === 'ice') {
            if (!air && sl.y >= ob.y && sl.y <= ob.y + ob.len && Math.abs(sl.x - ob.x) < ICE_HW) sl.onIce = true;
            continue;
          }
          if (sl.y < ob.y - HIT_Y - 2 || prevY > ob.y + HIT_Y + 2) continue; // not near it this tick
          const ox = ob.kind === 'snowball' ? ballX(ob, t) : ob.x;
          const dx = Math.abs(sl.x - ox);
          const hazard = ob.kind === 'rock' || ob.kind === 'snowball';
          // Close call: leaving a hazard's reach without touching it, but only just
          if (hazard && prevY <= ob.y + HIT_Y && sl.y > ob.y + HIT_Y && !sl.hits.has(ob.n) && !air
            && dx < (ob.kind === 'snowball' ? BALL_X : HIT_X) + CLOSE_X) {
            sl.hits.add(ob.n);
            sl.closeCalls++;
            bumpCombo(sl);
            addStyle(sl, s.closeCallPoints);
            ctx.send(id, { type: 'close', id, n: ob.n, combo: sl.combo, style: sl.style });
            continue;
          }
          if (Math.abs(sl.y - ob.y) > HIT_Y || sl.hits.has(ob.n)) continue;
          if (dx > (ob.kind === 'coin' ? PICK_X : ob.kind === 'snowball' ? BALL_X : HIT_X)) continue;
          if (ob.kind === 'coin') {
            sl.hits.add(ob.n);
            sl.coins++;
            bumpCombo(sl);
            addStyle(sl, s.coinPoints);
            ctx.send(id, { type: 'hit', id, kind: 'coin', n: ob.n, combo: sl.combo, style: sl.style });
            continue;
          }
          if (air) continue; // flying over it; it can still be hit after landing
          sl.hits.add(ob.n);
          if (hazard) crash(id, sl, now, ob.kind);
          else if (ob.kind === 'ramp') {
            sl.airUntil = now + s.airMs;
            sl.jumpTricks = 0;
            ctx.broadcast({ type: 'hit', id, kind: 'ramp', ms: s.airMs });
          } else {
            sl.boostUntil = now + s.boostMs;
            bumpCombo(sl);
            ctx.broadcast({ type: 'hit', id, kind: 'boost', combo: sl.combo });
          }
        }

        if (sl.y >= s.trackLength) {
          finishCount++;
          sl.finishedAt = now;
          sl.place = finishCount;
          ctx.broadcast({
            type: 'finish', id, place: sl.place, ms: now - startedAt, coins: sl.coins, tricks: sl.tricks,
            style: sl.style, rocks: sl.rocks, closeCalls: sl.closeCalls, bestCombo: sl.bestCombo,
          });
        }
      }
      if (ticks % STATE_EVERY === 0) ctx.broadcast({ type: 'state', t, players: snapshot() });
      checkEnd();
    }

    return {
      tick,
      start() {
        startedAt = ctx.now();
        const par = (s.trackLength / s.baseSpeed) * 1000; // a clean run with no tuck and no boosts
        ctx.broadcast({
          type: 'track', length: s.trackLength, roundMs: s.roundMs, seed: sceneSeed,
          course: { id: course.id, name: course.name, theme: course.theme, day, key: daily ? `${day}:${course.id}` : null },
          medals: { gold: Math.round(par * 0.8), silver: Math.round(par * 0.88), bronze: Math.round(par * 0.96) },
          obstacles: obstacles.map((ob) => {
            const out = { x: round(ob.x, 3), y: round(ob.y, 1), kind: ob.kind, n: ob.n };
            if (ob.kind === 'snowball') Object.assign(out, { amp: ob.amp, period: ob.period, phase: round(ob.phase, 3) });
            if (ob.kind === 'ice') out.len = ob.len;
            return out;
          }),
        });
        ctx.broadcast({ type: 'state', t: 0, players: snapshot() });
        timeout = ctx.after(s.roundMs, stopRace);
      },
      input(id, msg) {
        if (done || !alive(id) || !msg) return;
        const sl = sleds.get(id);
        if (msg.type === 'done') {
          if (raceOver || sl.finishedAt !== null) { leftFinish.add(id); checkLeft(); }
          return;
        }
        if (raceOver) return;
        if (msg.type === 'steer') {
          const dir = Number(msg.dir);
          if (dir === -1 || dir === 0 || dir === 1) sl.dir = dir;
        } else if (msg.type === 'tuck') {
          sl.tuck = msg.on === true;
        } else if (msg.type === 'trick') {
          const now = ctx.now();
          // Up to two tricks per jump, a moment apart, and only with enough air left to land them
          if (sl.finishedAt !== null || sl.airUntil - now < 220 || sl.jumpTricks >= MAX_TRICKS_PER_JUMP
            || now - sl.lastTrickAt < TRICK_GAP_MS) return;
          sl.jumpTricks++;
          sl.lastTrickAt = now;
          sl.tricks++;
          bumpCombo(sl);
          const double = sl.jumpTricks === 2;
          addStyle(sl, s.trickPoints * mult(sl) + (double ? s.doubleBonus : 0));
          sl.boostUntil = sl.airUntil + (double ? 1300 : 900); // landing boost
          // Holding a direction turns the spin into a flip
          ctx.broadcast({ type: 'trick', id, kind: sl.dir === 0 ? 'spin' : 'flip', double, combo: sl.combo, style: sl.style });
        }
      },
      leave(id) {
        sleds.delete(id);
        ctx.broadcast({ type: 'left', id });
        checkEnd();
        checkLeft();
      },
      dispose() {
        done = true;
      },
    };
  },
};

// A one-off course: its own name, time of day and mix of sections. Always at least two ramps.
function randomCourse(ctx) {
  const between = (a, b) => a + ctx.randomInt(b - a + 1);
  return {
    id: 'random',
    name: `${NAME_A[ctx.randomInt(NAME_A.length)]} ${NAME_B[ctx.randomInt(NAME_B.length)]}`,
    theme: THEMES[ctx.randomInt(THEMES.length)],
    deck: { rocks: between(3, 6), ramp: between(2, 4), coins: between(2, 3), gate: between(1, 3), slalom: between(1, 3), boost: between(1, 3), snowball: between(1, 3), ice: between(1, 4) },
  };
}

// Where a rolling snowball is at race time t (ms). The client uses the same formula.
function ballX(ob, t) { return ob.x + ob.amp * Math.sin((2 * Math.PI * t) / ob.period + ob.phase); }

// Lay out the run as a series of short sections drawn from a shuffled deck. Rocks never block
// more than two of the four lanes at once, and the run gets busier further down.
// rand(n) returns an integer 0..n-1.
function makeTrack(rand, length, mix) {
  const lanes = [-0.75, -0.25, 0.25, 0.75];
  const out = [];
  let n = 0;
  const add = (x, y, kind, extra) => out.push({ x, y, kind, n: n++, ...extra });
  const pick = (arr) => arr[rand(arr.length)];

  // A welcome line of coins down the middle so new players learn what coins are
  for (let i = 0; i < 4; i++) add(0, 120 + i * 24, 'coin');

  const deck = [];
  let first = true;
  const refill = () => {
    const cards = Object.entries(mix).flatMap(([k, c]) => Array(c).fill(k));
    // Every course gets at least two ramps in its top half, wherever the shuffle puts the rest
    const fixed = first ? cards.splice(cards.indexOf('ramp'), 1).concat(cards.splice(cards.indexOf('ramp'), 1)) : [];
    for (let i = cards.length - 1; i > 0; i--) { const j = rand(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    if (fixed.length) { cards.splice(1 + rand(3), 0, fixed[0]); cards.splice(6 + rand(3), 0, fixed[1]); }
    first = false;
    deck.push(...cards);
  };

  let y = 260;
  while (y < length - 200) {
    const d = y / length; // 0 at the top, 1 at the bottom
    if (!deck.length) refill();
    const kind = deck.shift();
    let used = 80;

    if (kind === 'rocks') {
      const count = d > 0.45 && rand(3) === 0 ? 2 : 1;
      const start = rand(lanes.length);
      for (let i = 0; i < count; i++) add(lanes[(start + i * 2) % lanes.length], y + i * 24, 'rock');
      if (rand(3) === 0) add(lanes[(start + 1) % lanes.length], y + 10, 'coin'); // reward the gap
    } else if (kind === 'coins') {
      const lane = pick(lanes);
      for (let i = 0; i < 5; i++) add(lane, y + i * 22, 'coin');
      used = 120;
    } else if (kind === 'slalom') {
      // A coin trail that weaves from one side to the other
      const a = pick(lanes.slice(0, 2)), b = pick(lanes.slice(2));
      const [from, to] = rand(2) ? [a, b] : [b, a];
      for (let i = 0; i < 9; i++) add(from + (to - from) * (0.5 - 0.5 * Math.cos((i / 8) * Math.PI)), y + i * 20, 'coin');
      if (d > 0.3) add(from < 0 ? 0.75 : -0.75, y + 20, 'rock');
      used = 190;
    } else if (kind === 'ramp') {
      // Ramp, then rocks to fly over and a line of coins in the air
      const li = rand(lanes.length);
      const lane = lanes[li];
      add(lane, y, 'ramp');
      add(lane, y + 46, 'rock');
      if (d > 0.35) add(lanes[li === 0 ? 1 : li - 1], y + 46, 'rock');
      for (let i = 0; i < 3; i++) add(lane, y + 26 + i * 18, 'coin');
      used = 140;
    } else if (kind === 'gate') {
      // Two rocks leave one gap; a coin sits in the gap
      const gap = rand(3); // the gap is between lanes[gap] and lanes[gap + 1]
      lanes.forEach((l, i) => { if (i !== gap && i !== gap + 1) add(l, y, 'rock'); });
      add((lanes[gap] + lanes[gap + 1]) / 2, y, 'coin');
      if (d > 0.55) add(pick(lanes), y + 70, 'rock');
      used = 110;
    } else if (kind === 'ice') {
      // A sheet of ice: fast, but steering slides. Coins lure you across it; lower down a rock waits at the end.
      const x = pick([-0.5, 0, 0.5]);
      const len = 80 + rand(40);
      add(x, y, 'ice', { len });
      const side = x <= 0 ? 1 : -1;
      for (let i = 0; i < 4; i++) add(x + side * (i / 3) * 0.25, y + 12 + i * 20, 'coin');
      if (d > 0.4) add(x, y + len + 24, 'rock');
      used = len + 40;
    } else if (kind === 'snowball') {
      // A big snowball rolling back and forth across the run
      add(0, y, 'snowball', { amp: 0.8, period: 2600 + rand(1200), phase: rand(628) / 100 });
      if (rand(2)) add(pick(lanes), y + 50, 'coin');
      used = 90;
    } else {
      const lane = pick(lanes);
      add(lane, y, 'boost');
      for (let i = 0; i < 3; i++) add(lane, y + 40 + i * 22, 'coin');
      used = 120;
    }
    y += used + 30 + rand(Math.round(60 - 30 * d));
  }
  return out.sort((a, b) => a.y - b.y);
}

// Small seeded random number generator (mulberry32), so a daily course is the same everywhere.
function seededRandom(seed) {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function dayKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round(v, d) { const f = 10 ** d; return Math.round(v * f) / f; }
