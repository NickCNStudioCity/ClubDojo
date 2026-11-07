// Tennis (server rules). Top-down court, net across the middle.
// Solo: rally against the back wall, one point per return. Duel: the bottom player and the top
// player play points; a ball that gets past a baseline gives the point to the other player.
// The server moves the ball and players. Clients only send move and swing inputs.
// Score: returns (solo) or points won (duel). Guide: docs/minigames/README.md
const W = 20;              // court width, in units
const H = 30;              // court length; the net is at H / 2
const SPEED = 11;          // player speed, units per second
const BALL = 17;           // ball speed after a hit
const REACH = 2.6;         // how close the ball must be to a player to hit it
const SWING_MS = 220;      // a swing counts if pressed this recently before the ball gets there

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

module.exports = {
  id: 'tennis',
  name: 'Tennis',
  description: 'Rally on a top-down court. Solo: return as many shots as you can. Two players: win points off each other.',
  minPlayers: 1,
  maxPlayers: 2,
  color: '#3b7fc4',
  icon: '🎾',
  tickRate: 20,

  defaults: { roundMs: 60000, serveDelayMs: 1200 },

  create(ctx) {
    const s = ctx.settings;
    const solo = ctx.players.length === 1;
    const bottomId = ctx.players[0].id;
    const topId = solo ? null : ctx.players[1].id;
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

    // Serve toward the receiver. Solo serves come from the top wall.
    function serve() {
      if (ended) return;
      const down = side.get(serveTo).bottom;
      const vx = ctx.randomInt(7) - 3;
      ball.x = W / 2 + ctx.randomInt(5) - 2;
      ball.y = solo ? 2 : H / 2;
      ball.vx = vx;
      ball.vy = (down ? 1 : -1) * Math.sqrt(BALL * BALL - vx * vx);
      ball.last = null;
      ball.live = true;
    }

    function prepServe() {
      ball.live = false;
      ball.vx = 0; ball.vy = 0;
      ball.x = W / 2; ball.y = solo ? 2 : H / 2;
      serveTimer = ctx.after(s.serveDelayMs, serve);
    }

    // A point ends the rally. The loser serves next.
    function point(winnerId, loserId, why) {
      if (ended) return;
      if (winnerId) side.get(winnerId).score++;
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
      if (solo) p.score++;
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
        ball: { x: Math.round(ball.x * 100) / 100, y: Math.round(ball.y * 100) / 100, live: ball.live ? 1 : 0 },
        players: [...side.values()].map((p) => ({ id: p.id, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, s: p.score, a: p.active ? 1 : 0 })),
      };
    }

    return {
      start() {
        ctx.broadcast({ type: 'begin', roundMs: s.roundMs, solo });
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

          if (ball.live && ball.y < 0) {
            if (solo) { // back wall: bounce and keep the rally going
              ball.y = 0; ball.vy = Math.abs(ball.vy); ball.last = null;
            } else {
              point(bottomId, topId, 'out');
            }
          } else if (ball.live && ball.y > H) {
            if (solo) point(null, bottomId, 'miss');
            else point(topId, bottomId, 'out');
          }
        }

        ctx.broadcast(snapshot());
      },

      leave(id) {
        const p = side.get(id);
        if (!p) return;
        p.active = false;
        // Solo ends with the player. A duel ends when one player is left.
        if (!ended && (solo || active().length < 2)) finish();
      },

      dispose() {},
    };
  },
};
