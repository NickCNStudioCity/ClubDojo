// Cart Surfer (server rules). Ninjas ride mine carts down a rail track. Switch rails left or right
// to scoop up coins and dodge the rockfalls. Everything is simulated here; clients only send
// "move" inputs and draw the state the server broadcasts. Guide: docs/minigames/README.md
//
// Rails: lane -1 (left), 0 (middle), 1 (right). Distance y runs from 0 to trackLength.
const HIT_Y = 16; // how close along the track counts as touching an item
const STATE_EVERY = 2; // tickRate 20 -> broadcast 10 times a second
const DISTANCE_PER_POINT = 50; // 1 point per 50 units of track covered

module.exports = {
  id: 'cart-surfer',
  name: 'Cart Surfer',
  description: 'Ride the mine cart down the rails. Grab coins, dodge the rockfalls and go the distance.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#7d5a3c',
  icon: '🛒',
  tickRate: 20,

  // Tuning values; read through ctx.settings so admins can change them later.
  defaults: {
    trackLength: 3200, // distance to the finish line
    roundMs: 60000, // time limit; anyone still riding is ranked by distance
    startSpeed: 140, // distance per second at the start
    accel: 6, // extra speed gained per second
    maxSpeed: 260, // speed cap
    stunMs: 900, // time a crashed cart spends at a crawl
    crashCoins: 2, // coins knocked off the cart on a crash
  },

  // Points: 1 per coin, plus 1 per 50 units of distance. Coins follow the score.
  rewards(result) {
    return { coins: result.score * 2, xp: Math.floor(result.score / 2) };
  },

  create(ctx) {
    const s = ctx.settings;
    const carts = new Map(); // id -> { lane, y, stunUntil, coins, got:Set, hit:Set, place, crashes }
    const items = makeTrack(ctx, s.trackLength);
    let elapsed = 0;
    let ticks = 0;
    let finishCount = 0;
    let done = false;
    let timeout = null;

    for (const p of ctx.players) {
      carts.set(p.id, { lane: 0, y: 0, stunUntil: 0, coins: 0, got: new Set(), hit: new Set(), place: null, crashes: 0 });
    }

    function alive(id) { return carts.has(id) && ctx.isPlaying(id); }
    function running() { return [...carts.keys()].filter((id) => alive(id) && carts.get(id).place === null); }

    function snapshot() {
      const players = {};
      for (const [id, c] of carts) {
        if (!ctx.isPlaying(id)) continue;
        players[id] = [c.lane, round(c.y, 1), c.place !== null ? 1 : 0, ctx.now() < c.stunUntil ? 1 : 0, c.coins];
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
          detail: { place: c.place, coins: c.coins, distance: Math.round(dist), crashes: c.crashes },
        };
      }));
    }

    function tick(dt) {
      if (done) return;
      ticks++;
      elapsed += dt;
      const now = ctx.now();
      const speed = Math.min(s.maxSpeed, s.startSpeed + s.accel * elapsed);

      for (const id of running()) {
        const c = carts.get(id);
        const stunned = now < c.stunUntil;
        c.y = Math.min(s.trackLength, c.y + (stunned ? speed * 0.25 : speed) * dt);

        for (const item of items) {
          if (item.lane !== c.lane || Math.abs(c.y - item.y) > HIT_Y) continue;
          if (item.kind === 'coin') {
            if (c.got.has(item.n)) continue;
            c.got.add(item.n);
            c.coins++;
            ctx.send(id, { type: 'got', n: item.n, coins: c.coins });
          } else {
            if (c.hit.has(item.n)) continue;
            c.hit.add(item.n);
            c.crashes++;
            c.coins = Math.max(0, c.coins - s.crashCoins);
            c.stunUntil = now + s.stunMs;
            ctx.send(id, { type: 'crash', n: item.n, coins: c.coins });
          }
        }

        if (c.y >= s.trackLength) {
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
          items: items.map(({ lane, y, kind, n }) => ({ lane, y: round(y, 1), kind, n })),
        });
        timeout = ctx.after(s.roundMs, finish);
      },
      input(id, msg) {
        if (done || !alive(id) || msg.type !== 'move') return;
        const dir = Number(msg.dir);
        const c = carts.get(id);
        if ((dir !== -1 && dir !== 1) || c.place !== null) return;
        c.lane = clamp(c.lane + dir, -1, 1);
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

// Lay out rocks and coins down the track. Every row leaves at least one rail clear of rocks,
// so a round is always possible. The layout is random per round and sent to clients at the start.
function makeTrack(ctx, length) {
  const lanes = [-1, 0, 1];
  const out = [];
  let y = 260;
  let n = 0;
  while (y < length - 120) {
    const start = ctx.randomInt(3);
    const rockLanes = ctx.randomInt(3) === 0 ? [lanes[start], lanes[(start + 1) % 3]] : [lanes[start]];
    for (const lane of rockLanes) out.push({ lane, y, kind: 'rock', n: n++ });
    for (const lane of lanes) {
      if (rockLanes.includes(lane)) continue;
      if (ctx.randomInt(2) === 0) out.push({ lane, y, kind: 'coin', n: n++ });
    }
    y += 60 + ctx.randomInt(60);
  }
  return out;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round(v, d) { const f = 10 ** d; return Math.round(v * f) / f; }
