// Cart Surfer (server rules). A ninja rides a mine cart down a tunnel track. Switch rails left or
// right to scoop up coins and dodge the rockfalls, jump over boulders and duck under low beams.
// You have three carts (lives): every crash costs one and stuns you briefly. Coins collected in a
// row build a streak multiplier; pickups (magnet, lantern shield, gem) spice up the run.
// Everything is simulated here; clients only send inputs and draw the state the server broadcasts.
// Guide: docs/minigames/README.md
//
// Rails: lane -1 (left), 0 (middle), 1 (right). Distance y runs from 0 to trackLength.
// Inputs: { type: 'move', dir: -1 | 1 }, { type: 'jump' }, { type: 'duck' }.
// Item kinds: coin, rock (one rail; switch or jump), beam (all rails; duck), magnet, shield, gem.
const HIT_Y = 24; // how close along the track counts as touching an item (wide enough that a fast cart can't skip past one between ticks)
const STATE_EVERY = 1; // tickRate 20 -> broadcast 20 times a second
const DISTANCE_PER_POINT = 100; // 1 point per 100 units of track covered
const STREAK_STEP = 8; // coins in a row for each +1 on the multiplier
const POSE_RIDE = 0, POSE_AIR = 1, POSE_DUCK = 2;

module.exports = {
  id: 'cart-surfer',
  name: 'Cart Surfer',
  description: 'Ride the mine cart down the tunnel. Switch rails, jump boulders and duck under beams. Chain coins for a multiplier. You have three carts.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#7d5a3c',
  icon: '🛒',
  tickRate: 20,

  // Tuning values; read through ctx.settings so admins can change them later.
  defaults: {
    trackLength: 7000, // distance to the finish line
    roundMs: 60000, // time limit; anyone still riding is ranked by distance
    startSpeed: 230, // distance per second at the start
    accel: 8, // extra speed gained per second
    maxSpeed: 420, // speed cap
    stunMs: 900, // time a crashed cart spends at a crawl
    crashCoins: 2, // coins knocked off the cart on a crash
    lives: 3, // carts you start with; each crash costs one
    jumpMs: 620, // time in the air after a jump
    duckMs: 720, // time spent ducked after a duck
    magnetMs: 6000, // how long a magnet pulls in coins from the other rails
    maxMultiplier: 3, // streak multiplier cap
    gemCoins: 5, // coins a gem is worth (before the multiplier)
  },

  // Points: 1 per coin, plus 1 per 100 units of distance. Coins follow the score.
  rewards(result) {
    return { coins: result.score * 2, xp: Math.floor(result.score / 2) };
  },

  create(ctx) {
    const s = ctx.settings;
    const carts = new Map();
    const items = makeTrack(ctx, s.trackLength);
    let elapsed = 0;
    let speedNow = s.startSpeed;
    let ticks = 0;
    let finishCount = 0;
    let done = false;
    let timeout = null;

    for (const p of ctx.players) {
      carts.set(p.id, {
        lane: 0, y: 0, stunUntil: 0, coins: 0, lives: s.lives, got: new Set(), hit: new Set(),
        place: null, out: false, crashes: 0, airUntil: 0, duckUntil: 0, streak: 0, best: 0,
        shield: false, magnetUntil: 0, hops: 0, gems: 0,
      });
    }

    function alive(id) { return carts.has(id) && ctx.isPlaying(id); }
    // Still riding: not finished, not out of carts.
    function running() { return [...carts.keys()].filter((id) => alive(id) && carts.get(id).place === null && !carts.get(id).out); }
    function pose(c, now) { return now < c.airUntil ? POSE_AIR : now < c.duckUntil ? POSE_DUCK : POSE_RIDE; }
    function mult(c) { return Math.min(s.maxMultiplier, 1 + Math.floor(c.streak / STREAK_STEP)); }

    // id -> [lane, y, finished, stunned, coins, lives, pose, multiplier, shield, magnet tenths left, speed]
    function snapshot() {
      const now = ctx.now();
      const players = {};
      for (const [id, c] of carts) {
        if (!ctx.isPlaying(id)) continue;
        players[id] = [
          c.lane, round(c.y, 1), c.place !== null ? 1 : 0, now < c.stunUntil ? 1 : 0, c.coins, c.lives,
          pose(c, now), mult(c), c.shield ? 1 : 0, Math.max(0, Math.ceil((c.magnetUntil - now) / 100)),
          c.place !== null || c.out ? 0 : Math.round(now < c.stunUntil ? speedNow * 0.25 : speedNow),
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
        const c = carts.get(p.id);
        if (!c) return { id: p.id, score: 0 };
        const dist = Math.min(c.y, s.trackLength);
        return {
          id: p.id,
          score: c.coins + Math.floor(dist / DISTANCE_PER_POINT),
          detail: { place: c.place, coins: c.coins, distance: Math.round(dist), crashes: c.crashes, streak: c.best, hops: c.hops, gems: c.gems },
        };
      }));
    }

    function crash(id, c, item, now) {
      if (c.shield) { // the lantern takes the hit instead
        c.shield = false;
        ctx.send(id, { type: 'shield', n: item.n, used: true });
        return;
      }
      c.crashes++;
      c.lives--;
      c.streak = 0;
      c.coins = Math.max(0, c.coins - s.crashCoins);
      c.stunUntil = now + s.stunMs;
      c.airUntil = 0;
      c.duckUntil = 0;
      ctx.send(id, { type: 'crash', n: item.n, kind: item.kind, coins: c.coins, lives: c.lives });
      if (c.lives <= 0) {
        c.out = true;
        ctx.send(id, { type: 'out' });
      }
    }

    function collect(id, c, item, now) {
      c.got.add(item.n);
      if (item.kind === 'coin' || item.kind === 'gem') {
        c.streak++;
        c.best = Math.max(c.best, c.streak);
        const m = mult(c);
        const worth = (item.kind === 'gem' ? s.gemCoins : 1) * m;
        if (item.kind === 'gem') c.gems++;
        c.coins += worth;
        ctx.send(id, { type: 'got', n: item.n, kind: item.kind, worth, coins: c.coins, streak: c.streak, mult: m });
      } else if (item.kind === 'magnet') {
        c.magnetUntil = now + s.magnetMs;
        ctx.send(id, { type: 'got', n: item.n, kind: 'magnet', ms: s.magnetMs, coins: c.coins, streak: c.streak, mult: mult(c) });
      } else if (item.kind === 'shield') {
        c.shield = true;
        ctx.send(id, { type: 'got', n: item.n, kind: 'shield', coins: c.coins, streak: c.streak, mult: mult(c) });
      }
    }

    function tick(dt) {
      if (done) return;
      ticks++;
      elapsed += dt;
      const now = ctx.now();
      const speed = Math.min(s.maxSpeed, s.startSpeed + s.accel * elapsed);
      speedNow = speed;

      for (const id of running()) {
        const c = carts.get(id);
        const stunned = now < c.stunUntil;
        c.y = Math.min(s.trackLength, c.y + (stunned ? speed * 0.25 : speed) * dt);
        const p = pose(c, now);
        const magnet = now < c.magnetUntil;

        for (const item of items) {
          if (Math.abs(c.y - item.y) > HIT_Y) continue;
          if (item.kind === 'rock') {
            if (item.lane !== c.lane || c.hit.has(item.n)) continue;
            c.hit.add(item.n);
            if (p === POSE_AIR) { // cleared it with a jump
              c.hops++;
              c.coins++;
              ctx.send(id, { type: 'hop', n: item.n, coins: c.coins });
            } else crash(id, c, item, now);
          } else if (item.kind === 'beam') {
            if (c.hit.has(item.n)) continue;
            c.hit.add(item.n);
            if (p === POSE_DUCK) {
              c.hops++;
              c.coins++;
              ctx.send(id, { type: 'hop', n: item.n, coins: c.coins, duck: true });
            } else crash(id, c, item, now);
          } else {
            if (c.got.has(item.n)) continue;
            const reach = magnet && item.kind === 'coin' ? 2 : 0;
            if (Math.abs(item.lane - c.lane) > reach) continue;
            collect(id, c, item, now);
          }
          if (c.out) break;
        }

        if (!c.out && c.y >= s.trackLength) {
          finishCount++;
          c.place = finishCount;
          ctx.broadcast({ type: 'finish', id, place: c.place });
        }
      }

      if (ticks % STATE_EVERY === 0) ctx.broadcast({ type: 'state', t: now, players: snapshot() });
      if (!done && running().length === 0) finish();
    }

    return {
      start() {
        ctx.broadcast({
          type: 'track',
          length: s.trackLength,
          roundMs: s.roundMs,
          lives: s.lives,
          jumpMs: s.jumpMs,
          duckMs: s.duckMs,
          items: items.map(({ lane, y, kind, n }) => ({ lane, y: round(y, 1), kind, n })),
        });
        timeout = ctx.after(s.roundMs, finish);
      },
      input(id, msg) {
        if (done || !alive(id) || !msg) return;
        const c = carts.get(id);
        if (c.place !== null || c.out) return;
        const now = ctx.now();
        if (msg.type === 'move') {
          const dir = Number(msg.dir);
          if (dir !== -1 && dir !== 1) return;
          c.lane = clamp(c.lane + dir, -1, 1);
        } else if (msg.type === 'jump') {
          if (now < c.stunUntil || now < c.airUntil) return;
          c.duckUntil = 0;
          c.airUntil = now + s.jumpMs;
        } else if (msg.type === 'duck') {
          if (now < c.stunUntil) return;
          c.airUntil = 0; // a duck in the air slams you back onto the rails
          c.duckUntil = now + s.duckMs;
        }
      },
      tick,
      leave(id) {
        carts.delete(id);
        if (!done && running().length === 0) finish();
      },
      dispose() {
        done = true;
      },
    };
  },
};

// Lay out the track. Rows are well spread out, 190-320 units apart, to suit the speed. Most rows are
// one rockfall (now and then two) leaving a clear rail, and every rock can be jumped, with coins on
// the clear rails. Low beams across all three rails are rare. Coin trails fill the wider gaps, and
// a pickup (magnet, shield or gem) turns up every 800-1200 units.
// The layout is random per round and sent to clients at the start.
function makeTrack(ctx, length) {
  const lanes = [-1, 0, 1];
  const out = [];
  let y = 420;
  let n = 0;
  let nextPickup = 1100;
  let lastBeam = 0;
  while (y < length - 120) {
    const beam = y > 1400 && y - lastBeam > 1100 && ctx.randomInt(6) === 0;
    let rockLanes = [];
    if (beam) {
      out.push({ lane: 0, y, kind: 'beam', n: n++ });
      lastBeam = y;
    } else {
      const start = ctx.randomInt(3);
      rockLanes = ctx.randomInt(5) === 0 ? [lanes[start], lanes[(start + 1) % 3]] : [lanes[start]];
      for (const lane of rockLanes) out.push({ lane, y, kind: 'rock', n: n++ });
    }
    const free = lanes.filter((l) => !rockLanes.includes(l));
    const gap = 190 + ctx.randomInt(130);
    if (y >= nextPickup) {
      const kinds = ['magnet', 'shield', 'gem', 'gem'];
      out.push({ lane: free[ctx.randomInt(free.length)], y: y + Math.min(34, gap / 2), kind: kinds[ctx.randomInt(kinds.length)], n: n++ });
      nextPickup = y + 800 + ctx.randomInt(400);
    } else if (!beam) {
      for (const lane of free) if (ctx.randomInt(2) === 0) out.push({ lane, y, kind: 'coin', n: n++ });
    }
    // a short coin trail in a wide gap leads the eye toward a safe rail
    if (gap >= 240 && !beam) {
      const lane = free[ctx.randomInt(free.length)];
      for (let k = 1; k <= 3; k++) out.push({ lane, y: y + (gap * k) / 4, kind: 'coin', n: n++ });
    }
    y += gap;
  }
  return out;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round(v, d) { const f = 10 ** d; return Math.round(v * f) / f; }
