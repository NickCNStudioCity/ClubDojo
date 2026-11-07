// Sled Race (server rules). Up to four ninjas sled down a snowy slope, steering left and right
// to dodge rocks and catch speed boosts. Everything is simulated here; clients only send steer
// inputs and draw the state the server broadcasts. Guide: docs/minigames/README.md
//
// Lanes: x runs from -1 (far left) to 1 (far right). Distance y runs from 0 to trackLength.
const LANE_MIN = -1;
const LANE_MAX = 1;
const HIT_X = 0.22; // how close sideways counts as hitting an obstacle
const HIT_Y = 14; // how close along the track counts as hitting an obstacle
const STATE_EVERY = 2; // broadcast every Nth tick (tickRate 20 -> 10 updates a second)
const FINISH_POINTS = [60, 40, 25, 15]; // bonus for finishing 1st, 2nd, 3rd, 4th; then 5

module.exports = {
  id: 'sled-race',
  name: 'Sled Race',
  description: 'Sled down the slope, dodge the rocks and catch the speed boosts. First to the bottom wins.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#2c8fbf',
  icon: '🛷',
  tickRate: 20,

  // Tuning values; read through ctx.settings so admins can change them later.
  defaults: {
    trackLength: 2400, // distance to the finish line
    roundMs: 75000, // time limit; anyone still sledding is ranked by distance
    baseSpeed: 80, // distance per second on clear snow
    steerRate: 1.1, // lane widths per second
    stunMs: 900, // slow-down after hitting a rock
    boostMs: 1400, // length of a speed boost
    boostSpeed: 45, // extra speed while boosted
  },

  // Points: 1 per 1% of the track covered, plus a finish bonus by place. Coins follow the score.
  rewards(result, { players }) {
    const winBonus = result.place === 1 && players > 1 ? 10 : 0;
    return { coins: result.score * 2 + winBonus, xp: Math.floor(result.score * 0.8) + winBonus };
  },

  create(ctx) {
    const s = ctx.settings;
    const sleds = new Map(); // id -> { x, y, dir, stunUntil, boostUntil, finishedAt, place, hits:Set }
    const obstacles = makeTrack(ctx, s.trackLength);
    let finishCount = 0;
    let ticks = 0;
    let done = false;
    let timeout = null;

    for (const p of ctx.players) {
      sleds.set(p.id, { x: 0, y: 0, dir: 0, stunUntil: 0, boostUntil: 0, finishedAt: null, place: null, hits: new Set() });
    }

    function alive(id) { return sleds.has(id) && ctx.isPlaying(id); }
    function unfinished() { return [...sleds.keys()].filter((id) => alive(id) && sleds.get(id).finishedAt === null); }

    function snapshot() {
      const players = {};
      for (const [id, sl] of sleds) {
        if (!ctx.isPlaying(id)) continue;
        players[id] = [round(sl.x, 3), round(sl.y, 1), sl.finishedAt !== null ? 1 : 0, ctx.now() < sl.stunUntil ? 1 : 0, ctx.now() < sl.boostUntil ? 1 : 0];
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
        const progress = Math.min(1, sl.y / s.trackLength);
        const bonus = sl.place ? (FINISH_POINTS[sl.place - 1] || 5) : 0;
        return { id: p.id, score: Math.round(progress * 100) + bonus, detail: { place: sl.place, hits: sl.hits.size } };
      }));
    }

    function checkEnd() {
      if (!done && unfinished().length === 0) finish();
    }

    function tick(dt) {
      if (done) return;
      ticks++;
      const now = ctx.now();
      for (const id of unfinished()) {
        const sl = sleds.get(id);
        const stunned = now < sl.stunUntil;
        const boosted = now < sl.boostUntil;
        const speed = s.baseSpeed * (stunned ? 0.35 : 1) + (boosted ? s.boostSpeed : 0);
        sl.x = clamp(sl.x + sl.dir * s.steerRate * dt, LANE_MIN, LANE_MAX);
        sl.y = Math.min(s.trackLength, sl.y + speed * dt);

        for (const ob of obstacles) {
          if (sl.hits.has(ob.n) || Math.abs(sl.y - ob.y) > HIT_Y || Math.abs(sl.x - ob.x) > HIT_X) continue;
          sl.hits.add(ob.n);
          if (ob.kind === 'rock') {
            sl.stunUntil = now + s.stunMs;
            ctx.broadcast({ type: 'hit', id, kind: 'rock' });
          } else {
            sl.boostUntil = now + s.boostMs;
            ctx.broadcast({ type: 'hit', id, kind: 'boost' });
          }
        }

        if (sl.y >= s.trackLength) {
          finishCount++;
          sl.finishedAt = now;
          sl.place = finishCount;
          ctx.broadcast({ type: 'finish', id, place: sl.place });
        }
      }
      if (ticks % STATE_EVERY === 0) ctx.broadcast({ type: 'state', t: now, players: snapshot() });
      checkEnd();
    }

    return {
      tick,
      start() {
        ctx.broadcast({ type: 'track', length: s.trackLength, roundMs: s.roundMs, obstacles: obstacles.map(({ x, y, kind, n }) => ({ x: round(x, 3), y: round(y, 1), kind, n })) });
        timeout = ctx.after(s.roundMs, finish);
      },
      input(id, msg) {
        if (done || !alive(id) || msg.type !== 'steer') return;
        const dir = Number(msg.dir);
        if (dir === -1 || dir === 0 || dir === 1) sleds.get(id).dir = dir;
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

// Lay out rocks and boost pads down the slope. The layout is random per round and is sent
// to every client when the round starts.
function makeTrack(ctx, length) {
  const lanes = [-0.75, -0.25, 0.25, 0.75];
  const out = [];
  let y = 260;
  let n = 0;
  while (y < length - 160) {
    const count = ctx.randomInt(3) === 0 ? 2 : 1;
    const start = ctx.randomInt(lanes.length);
    for (let i = 0; i < count; i++) {
      const lane = lanes[(start + i * 2) % lanes.length];
      const kind = ctx.randomInt(10) < 3 ? 'boost' : 'rock';
      out.push({ x: lane, y: y + i * 20, kind, n: n++ });
    }
    y += 120 + ctx.randomInt(110);
  }
  return out;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round(v, d) { const f = 10 ** d; return Math.round(v * f) / f; }
