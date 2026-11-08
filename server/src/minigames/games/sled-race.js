// Sled Race (server rules). Up to four ninjas sled down a mountain run. Steer to dodge rocks,
// grab ryo coins, ride boost pads, and hit jump ramps to fly over trouble and land a trick.
// Hold tuck to go faster (but steer slower), and ride close behind a rival to draft.
// Everything is simulated here; clients only send inputs and draw the state the server
// broadcasts. Guide: docs/minigames/README.md
//
// Lanes: x runs from -1 (far left) to 1 (far right). Distance y runs from 0 to trackLength.
const LANE_MIN = -1;
const LANE_MAX = 1;
const HIT_X = 0.22; // how close sideways counts as hitting a rock, pad or ramp
const PICK_X = 0.26; // coins are a little more forgiving
const HIT_Y = 14; // how close along the track counts as touching something
const DRAFT_GAP = [12, 70]; // a rival this far ahead of you...
const DRAFT_X = 0.22; // ...and this close sideways gives you a draft
const STATE_EVERY = 2; // broadcast every Nth tick (tickRate 20 -> 10 updates a second)
const FINISH_POINTS = [60, 40, 25, 15]; // bonus for finishing 1st, 2nd, 3rd, 4th; then 5

module.exports = {
  id: 'sled-race',
  name: 'Sled Race',
  description: 'Race down the mountain: dodge rocks, grab coins, hit the ramps for tricks, and tuck to go faster.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#2c8fbf',
  icon: '🛷',
  tickRate: 20,

  // Tuning values; read through ctx.settings so admins can change them later.
  defaults: {
    trackLength: 2800, // distance to the finish line
    roundMs: 75000, // time limit; anyone still sledding is ranked by distance
    baseSpeed: 85, // distance per second on clear snow
    steerRate: 1.15, // lane widths per second
    stunMs: 900, // slow-down after hitting a rock
    boostMs: 1400, // length of a speed boost
    boostSpeed: 45, // extra speed while boosted
    tuckSpeed: 24, // extra speed at a full tuck
    tuckSteer: 0.5, // steering is multiplied by (1 - tuckSteer) at a full tuck
    draftSpeed: 16, // extra speed while drafting behind a rival
    airMs: 800, // time in the air after a ramp
    trickPoints: 5, // style points for a trick (times the combo multiplier)
    coinPoints: 1, // style points per coin
    styleMax: 60, // style points are capped so a round's rewards stay fair
  },

  // Points: 1 per 1% of the track covered, a finish bonus by place, and style points from coins
  // and tricks. Coins follow the score.
  rewards(result, { players }) {
    const winBonus = result.place === 1 && players > 1 ? 10 : 0;
    return { coins: result.score * 2 + winBonus, xp: Math.floor(result.score * 0.8) + winBonus };
  },

  create(ctx) {
    const s = ctx.settings;
    const sleds = new Map();
    const obstacles = makeTrack(ctx, s.trackLength);
    let finishCount = 0;
    let ticks = 0;
    let done = false;
    let timeout = null;
    let startedAt = 0;

    for (const p of ctx.players) {
      sleds.set(p.id, {
        x: 0, y: 0, dir: 0, tuck: false, tuckAmt: 0, drafting: false,
        stunUntil: 0, boostUntil: 0, airUntil: 0, trickDone: true,
        coins: 0, tricks: 0, rocks: 0, combo: 0, bestCombo: 0, style: 0,
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
          round(sl.tuckAmt, 2), sl.drafting ? 1 : 0, sl.combo, sl.style,
        ];
      }
      return players;
    }

    function finish() {
      if (done) return;
      done = true;
      if (timeout) ctx.cancel(timeout);
      ctx.broadcast({ type: 'over', players: snapshot() });
      ctx.end(ctx.players.map((p) => {
        const sl = sleds.get(p.id);
        if (!sl) return { id: p.id, score: 0 }; // left mid-round; the engine drops this row
        const progress = Math.min(1, sl.y / s.trackLength);
        const bonus = sl.place ? (FINISH_POINTS[sl.place - 1] || 5) : 0;
        return {
          id: p.id,
          score: Math.round(progress * 100) + bonus + sl.style,
          detail: {
            place: sl.place, ms: sl.finishedAt === null ? null : sl.finishedAt - startedAt,
            hits: sl.rocks, coins: sl.coins, tricks: sl.tricks, bestCombo: sl.bestCombo,
          },
        };
      }));
    }

    function checkEnd() {
      if (!done && unfinished().length === 0) finish();
    }

    function tick(dt) {
      if (done) return;
      ticks++;
      const now = ctx.now();
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
          + sl.tuckAmt * s.tuckSpeed + (sl.drafting ? s.draftSpeed : 0);
        const steer = s.steerRate * (1 - s.tuckSteer * sl.tuckAmt) * (air ? 0.45 : 1);
        sl.x = clamp(sl.x + sl.dir * steer * dt, LANE_MIN, LANE_MAX);
        sl.y = Math.min(s.trackLength, sl.y + speed * dt);

        for (const ob of obstacles) {
          if (Math.abs(sl.y - ob.y) > HIT_Y || sl.hits.has(ob.n)) continue;
          if (Math.abs(sl.x - ob.x) > (ob.kind === 'coin' ? PICK_X : HIT_X)) continue;
          if (ob.kind === 'coin') {
            sl.hits.add(ob.n);
            sl.coins++;
            bumpCombo(sl);
            addStyle(sl, s.coinPoints);
            ctx.send(id, { type: 'hit', id, kind: 'coin', n: ob.n, combo: sl.combo, style: sl.style });
            continue;
          }
          if (now < sl.airUntil) continue; // flying over it; it can still be hit after landing
          sl.hits.add(ob.n);
          if (ob.kind === 'rock') {
            sl.stunUntil = now + s.stunMs;
            sl.boostUntil = 0;
            sl.rocks++;
            sl.combo = 0;
            ctx.broadcast({ type: 'hit', id, kind: 'rock' });
          } else if (ob.kind === 'ramp') {
            sl.airUntil = now + s.airMs;
            sl.trickDone = false;
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
          ctx.broadcast({ type: 'finish', id, place: sl.place, ms: now - startedAt, coins: sl.coins, tricks: sl.tricks, style: sl.style });
        }
      }
      if (ticks % STATE_EVERY === 0) ctx.broadcast({ type: 'state', t: now - startedAt, players: snapshot() });
      checkEnd();
    }

    return {
      tick,
      start() {
        startedAt = ctx.now();
        const par = (s.trackLength / s.baseSpeed) * 1000; // a clean run with no tuck and no boosts
        ctx.broadcast({
          type: 'track', length: s.trackLength, roundMs: s.roundMs,
          medals: { gold: Math.round(par * 0.8), silver: Math.round(par * 0.88), bronze: Math.round(par * 0.96) },
          obstacles: obstacles.map(({ x, y, kind, n }) => ({ x: round(x, 3), y: round(y, 1), kind, n })),
        });
        ctx.broadcast({ type: 'state', t: 0, players: snapshot() });
        timeout = ctx.after(s.roundMs, finish);
      },
      input(id, msg) {
        if (done || !alive(id) || !msg) return;
        const sl = sleds.get(id);
        if (msg.type === 'steer') {
          const dir = Number(msg.dir);
          if (dir === -1 || dir === 0 || dir === 1) sl.dir = dir;
        } else if (msg.type === 'tuck') {
          sl.tuck = msg.on === true;
        } else if (msg.type === 'trick') {
          const now = ctx.now();
          // One trick per jump, and only with enough air left to land it
          if (sl.trickDone || sl.finishedAt !== null || sl.airUntil - now < 220) return;
          sl.trickDone = true;
          sl.tricks++;
          bumpCombo(sl);
          addStyle(sl, s.trickPoints * mult(sl));
          sl.boostUntil = sl.airUntil + 900; // landing boost
          ctx.broadcast({ type: 'trick', id, combo: sl.combo, style: sl.style });
        }
      },
      leave(id) {
        sleds.delete(id);
        checkEnd();
      },
      dispose() {
        done = true;
      },
    };
  },
};

// Lay out the run as a series of short sections. Rocks never block more than two of the four
// lanes at once, and the run gets busier further down. The layout is random per round and is
// sent to every client when the round starts.
function makeTrack(ctx, length) {
  const lanes = [-0.75, -0.25, 0.25, 0.75];
  const out = [];
  let n = 0;
  const add = (x, y, kind) => out.push({ x, y, kind, n: n++ });
  const pick = (arr) => arr[ctx.randomInt(arr.length)];

  // A welcome line of coins down the middle so new players learn what coins are
  for (let i = 0; i < 4; i++) add(0, 120 + i * 24, 'coin');

  // Sections come from a shuffled deck, so every run gets a fair mix of ramps, boosts and coins
  const deck = [];
  const refill = () => {
    const cards = ['rocks', 'rocks', 'rocks', 'rocks', 'rocks', 'ramp', 'ramp', 'ramp', 'coins', 'coins', 'gate', 'gate', 'slalom', 'slalom', 'boost', 'boost'];
    for (let i = cards.length - 1; i > 0; i--) { const j = ctx.randomInt(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    deck.push(...cards);
  };

  let y = 260;
  while (y < length - 200) {
    const d = y / length; // 0 at the top, 1 at the bottom
    if (!deck.length) refill();
    const kind = deck.shift();
    let used = 80;

    if (kind === 'rocks') {
      const count = d > 0.45 && ctx.randomInt(3) === 0 ? 2 : 1;
      const start = ctx.randomInt(lanes.length);
      for (let i = 0; i < count; i++) add(lanes[(start + i * 2) % lanes.length], y + i * 24, 'rock');
      if (ctx.randomInt(3) === 0) add(lanes[(start + 1) % lanes.length], y + 10, 'coin'); // reward the gap
    } else if (kind === 'coins') {
      const lane = pick(lanes);
      for (let i = 0; i < 5; i++) add(lane, y + i * 22, 'coin');
      used = 120;
    } else if (kind === 'slalom') {
      // A coin trail that weaves from one side to the other
      const a = pick(lanes.slice(0, 2)), b = pick(lanes.slice(2));
      const [from, to] = ctx.randomInt(2) ? [a, b] : [b, a];
      for (let i = 0; i < 9; i++) add(from + (to - from) * (0.5 - 0.5 * Math.cos((i / 8) * Math.PI)), y + i * 20, 'coin');
      if (d > 0.3) add(from < 0 ? 0.75 : -0.75, y + 20, 'rock');
      used = 190;
    } else if (kind === 'ramp') {
      // Ramp, then rocks to fly over and a line of coins in the air
      const li = ctx.randomInt(lanes.length);
      const lane = lanes[li];
      add(lane, y, 'ramp');
      add(lane, y + 46, 'rock');
      if (d > 0.35) add(lanes[li === 0 ? 1 : li - 1], y + 46, 'rock');
      for (let i = 0; i < 3; i++) add(lane, y + 26 + i * 18, 'coin');
      used = 140;
    } else if (kind === 'gate') {
      // Two rocks leave one gap; a coin sits in the gap
      const gap = ctx.randomInt(3); // the gap is between lanes[gap] and lanes[gap + 1]
      lanes.forEach((l, i) => { if (i !== gap && i !== gap + 1) add(l, y, 'rock'); });
      add((lanes[gap] + lanes[gap + 1]) / 2, y, 'coin');
      if (d > 0.55) add(pick(lanes), y + 70, 'rock');
      used = 110;
    } else {
      const lane = pick(lanes);
      add(lane, y, 'boost');
      for (let i = 0; i < 3; i++) add(lane, y + 40 + i * 22, 'coin');
      used = 120;
    }
    y += used + 30 + ctx.randomInt(Math.round(60 - 30 * d));
  }
  return out.sort((a, b) => a.y - b.y);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round(v, d) { const f = 10 ** d; return Math.round(v * f) / f; }
