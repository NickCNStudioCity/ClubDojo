// Tennis (server rules). Top-down court, net across the middle.
// Solo (one player): a rally against a bot on the far side. Before a shot you call it left, centre
// or right, then click the bot's half where the ball should land. The ball flies there, and the
// bot (or you, when it comes to you) has to reach the spot. Landing out, or nobody reaching it,
// gives the point to the other side.
// Duel (two players): the bottom player and the top player play points; a ball that gets past a
// baseline gives the point to the other player.
// The server moves the ball and players. Clients only send move, aim, call and swing/serve inputs.
// Score: points won. Guide: docs/minigames/README.md
const W = 20;              // court width, in units
const H = 30;              // court length; the net is at H / 2
const NET = H / 2;
const SPEED = 11;          // player speed, units per second
const BOT_SPEED = 9;       // bot speed, units per second
const BALL = 14;           // ball speed in flight, units per second
const REACH = 2.6;         // how close the ball's landing spot must be to a player to return it
const SWING_MS = 220;      // duel: a swing counts if pressed this recently before the ball gets there
const SERVE_WAIT_MS = 4000; // solo: the player serves on their own after this long
const BOT_ERROR = 0.08;    // chance the bot sends a shot out
const LINE_L = 2.5, LINE_R = W - 2.5; // singles sidelines
const BASE = 1.5;          // distance from each end to the baseline
const ZONES = { L: [2.5, 7.5], C: [7.5, 12.5], R: [12.5, 17.5] };
const BOT_ID = '__bot';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = (v) => Math.round(v * 100) / 100;
const zoneOf = (x) => (x < ZONES.L[1] ? 'L' : x < ZONES.C[1] ? 'C' : 'R');
// A landing spot is in when it is inside the singles lines and on the right half, behind the baseline.
const inside = (x, y, toBot) => x >= LINE_L && x <= LINE_R && (toBot ? y >= BASE && y < NET : y > NET && y <= H - BASE);

module.exports = {
  id: 'tennis',
  name: 'Tennis',
  description: 'Rally on a top-down court. Solo: call your shot and click where it lands against a bot. Two players: win points off each other.',
  minPlayers: 1,
  maxPlayers: 2,
  color: '#3b7fc4',
  icon: '🎾',
  tickRate: 20,

  defaults: { roundMs: 60000, serveDelayMs: 1200 },

  create(ctx) {
    return ctx.players.length === 1 ? createBot(ctx) : createDuel(ctx);
  },
};

// ---------- Solo: rally against a bot ----------
function createBot(ctx) {
  const s = ctx.settings;
  const pid = ctx.players[0].id;
  const me = { x: W / 2, y: H - 2, dx: 0, dy: 0, score: 0 };
  const bot = { x: W / 2, y: 2, score: 0 };
  const aim = { x: null, y: null, call: null };  // the player's next shot
  const ball = { x: W / 2, y: 2 };
  let flight = null;       // { from: 'me' | 'bot', ox, oy, tx, ty, t, dur, out }
  let serveTo = 'bot';     // whoever lost the last point serves next
  let waiting = false;     // the player is due to serve
  let serveTimer = null;
  let timeTimer = null;
  let ended = false;

  const who = (k) => (k === 'me' ? me : bot);
  const idOf = (k) => (k === 'me' ? pid : BOT_ID);

  // Where the player's next shot would land, and whether it is out. An unset call follows the aim.
  function playerTarget() {
    const call = aim.call || (aim.x !== null ? zoneOf(aim.x) : 'C');
    const [lo, hi] = ZONES[call];
    const x = aim.x !== null ? aim.x : (lo + hi) / 2;
    const y = aim.y !== null ? aim.y : 8;
    const wide = aim.x !== null && (x < lo || x > hi);   // landed outside the called third
    return { x, y, call, out: wide || !inside(x, y, true) };
  }
  function takeShot() {
    const t = playerTarget();
    aim.x = null; aim.y = null; aim.call = null;
    return t;
  }

  // The bot aims at the player's half, and sometimes sends the ball out.
  function botTarget() {
    const x = 3 + ctx.randomInt(14);
    const y = ctx.randomInt(1000) < BOT_ERROR * 1000 ? H - BASE + 1 : 17 + ctx.randomInt(10);
    return { x, y, out: !inside(x, y, false) };
  }

  function launch(from, tx, ty, out) {
    const h = who(from);
    const d = Math.hypot(tx - h.x, ty - h.y);
    flight = { from, ox: h.x, oy: h.y, tx, ty, t: 0, dur: Math.max(0.5, d / BALL), out };
    ball.x = h.x; ball.y = h.y;
    ctx.broadcast({ type: 'hit', id: idOf(from) });
  }

  function point(winner, loser, why) {
    if (ended) return;
    who(winner).score++;
    ctx.broadcast({ type: 'point', winner: idOf(winner), why });
    serveTo = loser;
    flight = null;
    if (serveTo === 'me') {
      waiting = true;
      serveTimer = ctx.after(SERVE_WAIT_MS, serveNow);
    } else {
      serveTimer = ctx.after(s.serveDelayMs, botServe);
    }
  }

  function botServe() {
    if (ended) return;
    bot.x = W / 2; bot.y = 2;
    const t = botTarget();
    launch('bot', t.x, t.y, t.out);
  }

  function serveNow() {
    if (!waiting || ended) return;
    waiting = false;
    ctx.cancel(serveTimer);
    const t = takeShot();
    launch('me', t.x, t.y, t.out);
  }

  // The ball has reached its landing spot. The other side must be in reach to return it.
  function arrive() {
    const f = flight;
    flight = null;
    const receiver = f.from === 'me' ? 'bot' : 'me';
    if (f.out) return point(receiver, f.from, 'out');
    const r = who(receiver);
    if (Math.hypot(r.x - f.tx, r.y - f.ty) > REACH) return point(f.from, receiver, 'reach');
    if (receiver === 'me') {
      const t = takeShot();
      return launch('me', t.x, t.y, t.out);
    }
    const t = botTarget();
    return launch('bot', t.x, t.y, t.out);
  }

  function stepTo(p, tx, ty, amt) {
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    if (d <= amt) { p.x = tx; p.y = ty; } else { p.x += (dx / d) * amt; p.y += (dy / d) * amt; }
    p.x = clamp(p.x, 1, W - 1);
    p.y = clamp(p.y, 1, NET - 1);
  }

  function snapshot() {
    const t = playerTarget();
    return {
      type: 'state',
      ball: { x: r2(ball.x), y: r2(ball.y), live: flight ? 1 : 0 },
      players: [
        { id: pid, x: r2(me.x), y: r2(me.y), s: me.score, a: 1 },
        { id: BOT_ID, x: r2(bot.x), y: r2(bot.y), s: bot.score, a: 1 },
      ],
      tgt: { x: r2(t.x), y: r2(t.y), call: t.call, out: t.out ? 1 : 0 },
      serve: waiting ? 1 : 0,
    };
  }

  function finish() {
    if (ended) return;
    ended = true;
    ctx.cancel(serveTimer);
    ctx.cancel(timeTimer);
    ctx.end([{ id: pid, score: me.score }]);
  }

  return {
    start() {
      ctx.broadcast({ type: 'begin', roundMs: s.roundMs, solo: true });
      timeTimer = ctx.after(s.roundMs, finish);
      prepFirst();
    },

    input(id, msg) {
      if (id !== pid || ended) return;
      if (msg.type === 'move') {
        me.dx = clamp(Number(msg.dx) || 0, -1, 1);
        me.dy = clamp(Number(msg.dy) || 0, -1, 1);
      } else if (msg.type === 'aim') {
        const x = Number(msg.x), y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        aim.x = clamp(x, 0, W);
        aim.y = clamp(y, 0, NET);
      } else if (msg.type === 'call') {
        if (['L', 'C', 'R'].includes(msg.zone)) aim.call = msg.zone;
      } else if (msg.type === 'serve' || msg.type === 'swing') {
        serveNow();
      }
    },

    tick(dt) {
      if (ended) return;
      me.x = clamp(me.x + me.dx * SPEED * dt, 1, W - 1);
      me.y = clamp(me.y + me.dy * SPEED * dt, NET + 1, H - 1);
      // The bot goes to the spot the player is aiming at, otherwise waits near its baseline.
      const goal = flight && flight.from === 'me' ? flight : { tx: W / 2, ty: 3 };
      stepTo(bot, goal.tx, goal.ty, BOT_SPEED * dt);
      if (flight) {
        flight.t += dt;
        const p = Math.min(1, flight.t / flight.dur);
        ball.x = flight.ox + (flight.tx - flight.ox) * p;
        ball.y = flight.oy + (flight.ty - flight.oy) * p;
        if (p >= 1) arrive();
      }
      ctx.broadcast(snapshot());
    },

    leave(id) {
      if (id === pid) finish();
    },

    dispose() {},
  };

  // The first point starts with a bot serve.
  function prepFirst() {
    serveTimer = ctx.after(s.serveDelayMs, botServe);
  }
}

// ---------- Duel: two players ----------
function createDuel(ctx) {
  const s = ctx.settings;
  const bottomId = ctx.players[0].id;
  const topId = ctx.players[1].id;
  const side = new Map();
  ctx.players.forEach((p, i) => {
    const bottom = i === 0;
    side.set(p.id, { id: p.id, bottom, x: W / 2, y: bottom ? H - 2 : 2, dx: 0, dy: 0, swingAt: -1e9, score: 0, active: true });
  });

  const ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, live: false, last: null };
  let serveTo = bottomId;
  let ended = false;
  let serveTimer = null;
  let timeTimer = null;

  const active = () => [...side.values()].filter((p) => p.active);

  // Serve toward the receiver.
  function serve() {
    if (ended) return;
    const down = side.get(serveTo).bottom;
    const vx = ctx.randomInt(7) - 3;
    ball.x = W / 2 + ctx.randomInt(5) - 2;
    ball.y = H / 2;
    ball.vx = vx;
    ball.vy = (down ? 1 : -1) * Math.sqrt(BALL * BALL - vx * vx);
    ball.last = null;
    ball.live = true;
  }

  function prepServe() {
    ball.live = false;
    ball.vx = 0; ball.vy = 0;
    ball.x = W / 2; ball.y = H / 2;
    serveTimer = ctx.after(s.serveDelayMs, serve);
  }

  // A point ends the rally. The loser serves next.
  function point(winnerId, loserId, why) {
    if (ended) return;
    side.get(winnerId).score++;
    ctx.broadcast({ type: 'point', winner: winnerId, why });
    serveTo = loserId || bottomId;
    prepServe();
  }

  function hitBy(p, now) {
    if (!ball.live || ball.last === p.id) return;
    if (now - p.swingAt > SWING_MS) return;
    const dx = ball.x - p.x;
    const dy = ball.y - p.y;
    if (dx * dx + dy * dy > REACH * REACH) return;
    p.swingAt = -1e9;
    // Angle the shot by where on the racket it lands and which way the player is moving.
    const vx = clamp(dx * 1.6 + p.dx * 3, -9, 9);
    ball.vx = vx;
    ball.vy = (p.bottom ? -1 : 1) * Math.sqrt(Math.max(16, BALL * BALL - vx * vx));
    ball.last = p.id;
    ctx.broadcast({ type: 'hit', id: p.id });
  }

  function finish() {
    if (ended) return;
    ended = true;
    ctx.cancel(serveTimer);
    ctx.cancel(timeTimer);
    ctx.end(ctx.players.map((p) => ({ id: p.id, score: side.get(p.id).score })));
  }

  function snapshot() {
    return {
      type: 'state',
      ball: { x: r2(ball.x), y: r2(ball.y), live: ball.live ? 1 : 0 },
      players: [...side.values()].map((p) => ({ id: p.id, x: r2(p.x), y: r2(p.y), s: p.score, a: p.active ? 1 : 0 })),
    };
  }

  return {
    start() {
      ctx.broadcast({ type: 'begin', roundMs: s.roundMs, solo: false });
      timeTimer = ctx.after(s.roundMs, finish);
      prepServe();
    },

    input(id, msg) {
      const p = side.get(id);
      if (!p || !p.active || ended) return;
      if (msg.type === 'move') {
        p.dx = clamp(Number(msg.dx) || 0, -1, 1);
        p.dy = clamp(Number(msg.dy) || 0, -1, 1);
      } else if (msg.type === 'swing') {
        p.swingAt = ctx.now();
      }
    },

    tick(dt) {
      if (ended) return;
      for (const p of active()) {
        p.x = clamp(p.x + p.dx * SPEED * dt, 1, W - 1);
        const lo = p.bottom ? H / 2 + 1 : 1;
        const hi = p.bottom ? H - 1 : H / 2 - 1;
        p.y = clamp(p.y + p.dy * SPEED * dt, lo, hi);
      }

      if (ball.live) {
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
        // Side walls always bounce.
        if (ball.x < 0.5) { ball.x = 0.5; ball.vx = Math.abs(ball.vx); }
        if (ball.x > W - 0.5) { ball.x = W - 0.5; ball.vx = -Math.abs(ball.vx); }

        const now = ctx.now();
        for (const p of active()) hitBy(p, now);

        if (ball.live && ball.y < 0) point(bottomId, topId, 'out');
        else if (ball.live && ball.y > H) point(topId, bottomId, 'out');
      }

      ctx.broadcast(snapshot());
    },

    leave(id) {
      const p = side.get(id);
      if (!p) return;
      p.active = false;
      // A duel ends when one player is left.
      if (!ended && active().length < 2) finish();
    },

    dispose() {},
  };
}
