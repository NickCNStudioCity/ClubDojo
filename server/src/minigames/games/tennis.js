// Tennis (server rules). Top-down court, net across the middle.
// Solo: a rally against a bot that levels up each time you beat it. Duel: two players, bottom vs top.
// Keyboard only: move with arrows or WASD. Space (or Enter) is the swing.
//   Tap = volley: a short shot that drops near the net.
//   Hold, then release = power shot: the longer the hold, the deeper it lands (a full hold reaches the back line).
//   Timing: release as the ball lands in front of you. Early sends it left, late sends it right.
//   A release right on the bounce is a Perfect: a faster shot that fills more Focus.
//   A swing only counts from inside your reach radius, which the client shows while the ball is coming to you.
//   Serve: hold left or right as you release to angle it.
// Focus fills with every return. Full Focus + a power shot = Shadow Strike: a very fast shot that
// shrinks the receiver's reach for that ball.
// Points are worth more in long rallies (+1 every 5 returns), and double in the final seconds.
// A glowing lantern target sometimes appears on a half; land a shot on it for a bonus point.
// The server moves the ball and the players. Clients send move, press and release.
// Score: points won (with bonuses). Guide: docs/minigames/README.md
const W = 20;               // court width, in units
const H = 30;               // court length; the net is at H / 2
const NET = H / 2;
const BASE = 1.5;           // distance from each end to the baseline
const LINE_L = 2.5, LINE_R = W - 2.5; // singles sidelines
const SPEED = 11;           // player speed, units per second
const BALL = 14;            // base ball speed, units per second (power shots fly faster)
const REACH = 2.6;          // how close the ball's landing spot must be to a player to return it
const EARLY_MS = 350;       // a swing up to this long before the ball lands still counts, and sends it left
const LATE_MS = 250;        // a swing up to this long after it lands still counts, and sends it right
const PERFECT_MS = 70;      // a swing this close to the bounce is a Perfect
const SPREAD = 4.5;         // how far the swing timing shifts the shot, in units
const SERVE_ANGLE = 3.5;    // how far holding left/right angles a serve
const TAP_MS = 200;         // a press shorter than this is a volley
const CHARGE_MS = 1000;     // how long past a tap a hold takes to reach the back of the court
const SERVE_WAIT_MS = 4000; // a human server serves on their own after this long
const FOCUS_HIT = 0.2;      // Focus gained per return
const FOCUS_PERFECT = 0.35; // Focus gained per Perfect return
const SUPER_MIN_C = 0.6;    // a Shadow Strike needs at least this much charge
const SUPER_SPEED = 1.55;   // Shadow Strike speed multiplier
const SUPER_REACH = 0.6;    // receiver reach multiplier against a Shadow Strike
const RALLY_STEP = 5;       // +1 point value every this many returns
const FINAL_MS = 10000;     // the last this-many ms: points are worth double
const TARGET_EVERY_MS = 7000; // a new lantern target appears this long after the last one went
const TARGET_LIFE_MS = 9000;
const TARGET_R = 1.8;       // landing within this of a target's centre hits it
const BOT_ID = '__bot';
const TUNE = { reach: REACH, early: EARLY_MS, late: LATE_MS, perfect: PERFECT_MS, spread: SPREAD, tapMs: TAP_MS, chargeMs: CHARGE_MS, superMinC: SUPER_MIN_C, finalMs: FINAL_MS, targetR: TARGET_R };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = (v) => Math.round(v * 100) / 100;

// A spot is in when it is inside the singles lines and on the half the ball lands on.
function inCourt(x, y, topHalf) {
  if (x < LINE_L || x > LINE_R) return false;
  return topHalf ? y >= BASE && y < NET : y > NET && y <= H - BASE;
}
// Where a shot lands for charge c (0 = volley, 1 = full power). A volley drops short by the net;
// a full power shot goes to the back line. fromBottom: the hitter is on the bottom half.
function depthFor(c, fromBottom) {
  if (fromBottom) return (NET - 4) - c * ((NET - 4) - (BASE + 1.5));
  return (NET + 4) + c * ((H - BASE - 1.5) - (NET + 4));
}
// Hold length to shot charge. A tap is a volley; a longer hold is a stronger shot.
function chargeFor(holdMs) {
  if (holdMs < TAP_MS) return 0;
  return 0.15 + 0.85 * Math.min(1, (holdMs - TAP_MS) / CHARGE_MS);
}
// Swing time relative to the landing, in ms (negative = early). Early sends the shot left, late right.
function shiftFor(deltaMs) {
  if (deltaMs < 0) return -SPREAD * Math.min(1, -deltaMs / EARLY_MS);
  return SPREAD * Math.min(1, deltaMs / LATE_MS);
}
// Bot strength by level: reaction delay (ms), speed (units/s), chance of an error, chance of a drop shot.
function botSkill(lv) {
  return {
    react: Math.max(140, 470 - lv * 55),
    speed: Math.min(11, 6.8 + lv * 0.6),
    error: Math.max(0.03, 0.13 - lv * 0.015),
    drop: Math.min(0.3, 0.06 + lv * 0.04),
  };
}

module.exports = {
  id: 'tennis',
  name: 'Tennis',
  description: 'Rally on a top-down court as your own ninja. Tap Space to volley, hold for power, and time the release to aim. Fill Focus for a Shadow Strike. Solo vs a levelling bot, or two players.',
  minPlayers: 1,
  maxPlayers: 2,
  color: '#3b7fc4',
  icon: '🎾',
  tickRate: 20,

  defaults: { roundMs: 60000, serveDelayMs: 1200 },

  create(ctx) {
    return createMatch(ctx);
  },
};

function newSide(id, bottom, bot) {
  return {
    id, bottom, bot, x: W / 2, y: bottom ? H - 2 : 2, dx: 0, dy: 0, score: 0,
    pressAt: null, swing: null, focus: 0, moving: false,
    stats: { bestRally: 0, perfects: 0, strikes: 0, aces: 0, targets: 0 },
  };
}

function createMatch(ctx) {
  const s = ctx.settings;
  const solo = ctx.players.length === 1;
  const sides = solo
    ? [newSide(ctx.players[0].id, true, false), newSide(BOT_ID, false, true)]
    : [newSide(ctx.players[0].id, true, false), newSide(ctx.players[1].id, false, false)];

  let flight = null;          // { from, ox, oy, tx, ty, c, kind, out, reach, serve, startMs, durMs }: the ball in the air
  let server = solo ? sides[1] : sides[0];  // whoever serves next; solo starts with the bot
  let waiting = false;        // a human server is due to serve
  let serveTimer = null;
  let timeTimer = null;
  let finalTimer = null;
  let targetTimer = null;
  let ended = false;
  let final = false;          // the last seconds: points are worth double
  let rally = 0;              // returns in the current point
  let lv = 1;                 // solo bot level
  let target = null;          // { x, y, top, until }
  let roundStart = 0;
  const ball = { x: server.x, y: server.y };

  const other = (p) => (p === sides[0] ? sides[1] : sides[0]);

  function finish() {
    if (ended) return;
    ended = true;
    ctx.cancel(serveTimer); ctx.cancel(timeTimer); ctx.cancel(finalTimer); ctx.cancel(targetTimer);
    ctx.broadcast({ type: 'stats', players: sides.map((p) => ({ id: p.id, s: p.score, ...p.stats })), lv: solo ? lv : 0 });
    ctx.end(sides.filter((p) => !p.bot).map((p) => ({ id: p.id, score: p.score })));
  }

  function clampSide(p) {
    p.x = clamp(p.x, 1, W - 1);
    p.y = p.bottom ? clamp(p.y, NET + 1, H - 1) : clamp(p.y, 1, NET - 1);
  }

  // ---------- lantern targets ----------
  function spawnTarget() {
    if (ended) return;
    // Solo: always on the bot's half. Duel: either half.
    const top = solo ? true : ctx.randomInt(2) === 0;
    const x = LINE_L + 1.5 + ctx.randomInt(Math.round((LINE_R - LINE_L - 3) * 10)) / 10;
    const y = top ? BASE + 1.5 + ctx.randomInt(90) / 10 : NET + 1.5 + ctx.randomInt(90) / 10;
    target = { x, y, top, until: ctx.now() + TARGET_LIFE_MS };
    targetTimer = ctx.after(TARGET_LIFE_MS, () => { target = null; targetTimer = ctx.after(TARGET_EVERY_MS, spawnTarget); });
  }
  // A shot that lands in on the target's half and within its radius scores a bonus for the hitter.
  function checkTarget(f) {
    if (!target || f.out) return;
    if (target.top !== f.from.bottom) return;
    if (Math.hypot(f.tx - target.x, f.ty - target.y) > TARGET_R) return;
    const value = final ? 2 : 1;
    f.from.score += value;
    f.from.stats.targets++;
    ctx.broadcast({ type: 'bonus', id: f.from.id, x: r2(target.x), y: r2(target.y), value });
    target = null;
    ctx.cancel(targetTimer);
    targetTimer = ctx.after(TARGET_EVERY_MS, spawnTarget);
  }

  // Send a shot from `from` (the ball starts at ox, oy) to tx, ty. It lands when it arrives.
  // opts: { shift, perfect, strike, serve }
  function launch(from, ox, oy, tx, ty, c, opts) {
    for (const p of sides) p.swing = null;
    const o = opts || {};
    const d = Math.hypot(tx - ox, ty - oy);
    const speed = BALL * (0.85 + 0.45 * c) * (o.perfect ? 1.15 : 1) * (o.strike ? SUPER_SPEED : 1);
    const kind = o.strike ? 'strike' : o.serve ? 'serve' : c === 0 ? 'volley' : c > 0.6 ? 'power' : 'drive';
    flight = {
      from, ox, oy, tx, ty, c, kind,
      out: !inCourt(tx, ty, from.bottom),   // the ball lands on the other half
      reach: REACH * (o.strike ? SUPER_REACH : 1),
      serve: !!o.serve,
      startMs: ctx.now(),
      durMs: Math.max(400, (d / speed) * 1000),
    };
    ball.x = ox; ball.y = oy;
    if (!o.serve) rally++;
    if (rally > from.stats.bestRally) from.stats.bestRally = rally;
    ctx.broadcast({ type: 'hit', id: from.id, c: r2(c), shift: r2(o.shift || 0), kind, perfect: o.perfect ? 1 : 0, rally });
  }

  // Focus after a return. Returns true when this shot uses a full Focus bar as a Shadow Strike.
  function useFocus(p, c, perfect) {
    if (p.focus >= 1 && c >= SUPER_MIN_C) { p.focus = 0; p.stats.strikes++; return true; }
    p.focus = Math.min(1, p.focus + (perfect ? FOCUS_PERFECT : FOCUS_HIT));
    return false;
  }

  // The bot aims away from its opponent, sometimes drops it short, and sometimes sends it out.
  // stretched: it barely reached the ball, so the return is weaker and riskier.
  function botShot(p, ox, oy, stretched, serve) {
    const sk = botSkill(lv);
    const foe = other(p);
    const deep = foe.y > H - 6;
    let c = 0.25 + ctx.randomInt(76) / 100;
    if (!serve && deep && ctx.randomInt(100) < sk.drop * 100) c = 0;
    if (stretched) c = Math.min(c, 0.15 + ctx.randomInt(30) / 100);
    // Aim at the side of the court the opponent is not on, with some scatter.
    const away = foe.x < W / 2 ? 1 : -1;
    let tx = W / 2 + away * (2 + ctx.randomInt(50) / 10) + (ctx.randomInt(30) - 15) / 10;
    if (stretched || serve) tx = W / 2 + (ctx.randomInt(90) - 45) / 10;
    let ty = depthFor(c, p.bottom);
    const err = sk.error * (stretched ? 3 : 1);
    if (ctx.randomInt(1000) < err * 1000) {
      if (ctx.randomInt(2)) ty = p.bottom ? BASE - 0.8 : H - BASE + 0.8;   // long
      else tx = ctx.randomInt(2) ? LINE_L - 0.8 : LINE_R + 0.8;             // wide
    }
    const strike = !serve && lv >= 3 && c >= SUPER_MIN_C && p.focus >= 1 && ctx.randomInt(2) === 0;
    if (strike) { p.focus = 0; c = 1; ty = depthFor(1, p.bottom); }
    else if (!serve) p.focus = Math.min(1, p.focus + FOCUS_HIT);
    launch(p, ox, oy, clamp(tx, 0.5, W - 0.5), ty, c, { strike, serve });
  }

  function serveNow(p, holdMs) {
    if (!waiting || p !== server || ended) return;
    waiting = false;
    ctx.cancel(serveTimer);
    const c = chargeFor(holdMs);
    launch(p, p.x, p.y, p.x + p.dx * SERVE_ANGLE, depthFor(c, p.bottom), c, { serve: true, shift: p.dx * SERVE_ANGLE });
  }

  function botServe() {
    if (ended) return;
    botShot(server, server.x, server.y, false, true);
  }

  function prepServe() {
    ctx.cancel(serveTimer);
    flight = null;
    rally = 0;
    server.x = W / 2 + (server.bottom ? 2 : -2);
    server.y = server.bottom ? H - 2 : 2;
    ball.x = server.x; ball.y = server.y;
    if (server.bot) {
      waiting = false;
      serveTimer = ctx.after(s.serveDelayMs, botServe);
    } else {
      waiting = true;
      serveTimer = ctx.after(SERVE_WAIT_MS, () => serveNow(server, TAP_MS + CHARGE_MS / 2));
    }
  }

  function point(winner, loser, why, f) {
    if (ended) return;
    const value = (1 + Math.floor(Math.max(0, rally - 1) / RALLY_STEP)) * (final ? 2 : 1);
    winner.score += value;
    if (why === 'ace') winner.stats.aces++;
    // Solo: the bot levels up when you beat it, and eases off a level when it wins a point while ahead.
    if (solo) {
      if (!winner.bot) lv = Math.min(8, lv + 1);
      else if (lv > 1 && winner.score > loser.score) lv--;
    }
    ctx.broadcast({ type: 'point', winner: winner.id, why, value, rally, lv: solo ? lv : 0, x: f ? r2(f.tx) : null, y: f ? r2(f.ty) : null });
    server = loser;
    prepServe();
  }

  // A swing is stored on release. It counts when the release falls inside the window around the
  // landing and the player is within reach of the landing spot. Misses are reported to the swinger.
  function swing(p, holdMs) {
    if (waiting && p === server) return serveNow(p, holdMs);
    const f = flight;
    if (!f || f.from === p || p.swing) return;
    const delta = ctx.now() - (f.startMs + f.durMs);
    if (delta < -EARLY_MS) return ctx.send(p.id, { type: 'whiff', why: 'early' });
    if (delta > LATE_MS) return ctx.send(p.id, { type: 'whiff', why: 'late' });
    if (Math.hypot(p.x - f.tx, p.y - f.ty) > f.reach) return ctx.send(p.id, { type: 'whiff', why: 'far' });
    p.swing = { x: p.x, c: chargeFor(holdMs), shift: shiftFor(delta), perfect: Math.abs(delta) <= PERFECT_MS };
  }

  // The window after the landing has closed: decide the rally.
  function resolve() {
    const f = flight;
    flight = null;
    const hitter = f.from;
    const receiver = other(hitter);
    if (f.out) return point(receiver, hitter, 'out', f);
    checkTarget(f);
    const missWhy = f.serve ? 'ace' : f.kind === 'strike' ? 'strike' : 'reach';
    if (receiver.bot) {
      const d = Math.hypot(receiver.x - f.tx, receiver.y - f.ty);
      if (d > f.reach) return point(hitter, receiver, missWhy, f);
      return botShot(receiver, f.tx, f.ty, d > f.reach * 0.7, false);
    }
    if (!receiver.swing) return point(hitter, receiver, missWhy, f);
    const sw = receiver.swing;
    receiver.swing = null;
    if (sw.perfect) receiver.stats.perfects++;
    const strike = useFocus(receiver, sw.c, sw.perfect);
    const c = strike ? Math.max(sw.c, 0.85) : sw.c;
    launch(receiver, f.tx, f.ty, sw.x + sw.shift, depthFor(c, receiver.bottom), c, { shift: sw.shift, perfect: sw.perfect, strike });
  }

  function botMove(p, dt) {
    const sk = botSkill(lv);
    let goal = { x: W / 2, y: 3.5 };   // recover to the middle of the baseline
    if (flight && flight.from !== p) {
      if (ctx.now() - flight.startMs < sk.react) { p.moving = false; return; }   // still reading the shot
      goal = { x: flight.tx, y: flight.ty };
    } else if (waiting || (server === p && !flight)) {
      goal = { x: p.x, y: p.y };
    }
    const dx = goal.x - p.x, dy = goal.y - p.y, d = Math.hypot(dx, dy), amt = sk.speed * dt;
    if (d <= amt) { p.x = goal.x; p.y = goal.y; } else { p.x += (dx / d) * amt; p.y += (dy / d) * amt; }
    p.moving = d > 0.05;
    p.dx = Math.abs(dx) > 0.3 ? Math.sign(dx) : 0;
  }

  function snapshot() {
    const f = flight;
    const now = ctx.now();
    return {
      type: 'state',
      ball: { x: r2(ball.x), y: r2(ball.y), live: f ? 1 : 0 },
      // eta: ms until the ball lands (negative once it has landed and is in the swing window).
      flight: f ? {
        from: f.from.id, ox: r2(f.ox), oy: r2(f.oy), tx: r2(f.tx), ty: r2(f.ty), out: f.out ? 1 : 0,
        eta: Math.round(f.startMs + f.durMs - now), dur: Math.round(f.durMs), kind: f.kind, c: r2(f.c), reach: r2(f.reach),
      } : null,
      players: sides.map((p) => ({
        id: p.id, x: r2(p.x), y: r2(p.y), s: p.score, f: Math.round(p.focus * 100),
        m: (p.bot ? p.moving : (p.dx || p.dy)) ? 1 : 0, dx: p.dx, ch: p.pressAt !== null ? 1 : 0,
      })),
      serve: waiting ? server.id : null,
      rally,
      lv: solo ? lv : 0,
      final: final ? 1 : 0,
      left: Math.max(0, Math.round(s.roundMs - (now - roundStart))),
      tgt: target ? { x: r2(target.x), y: r2(target.y), t: Math.max(0, Math.round(target.until - now)) } : null,
    };
  }

  return {
    start() {
      roundStart = ctx.now();
      ctx.broadcast({ type: 'begin', roundMs: s.roundMs, solo, tune: TUNE });
      timeTimer = ctx.after(s.roundMs, finish);
      if (s.roundMs > FINAL_MS * 2) {
        finalTimer = ctx.after(s.roundMs - FINAL_MS, () => { final = true; ctx.broadcast({ type: 'final' }); });
      }
      targetTimer = ctx.after(TARGET_EVERY_MS, spawnTarget);
      prepServe();
    },

    input(id, msg) {
      const p = sides.find((q) => q.id === id);
      if (!p || p.bot || ended || !msg) return;
      if (msg.type === 'move') {
        p.dx = clamp(Number(msg.dx) || 0, -1, 1);
        p.dy = clamp(Number(msg.dy) || 0, -1, 1);
      } else if (msg.type === 'press') {
        if (p.pressAt === null) p.pressAt = ctx.now();
      } else if (msg.type === 'release') {
        const hold = p.pressAt === null ? 0 : ctx.now() - p.pressAt;
        p.pressAt = null;
        swing(p, hold);
      }
    },

    tick(dt) {
      if (ended) return;
      for (const p of sides) {
        if (p.bot) botMove(p, dt);
        else if (waiting && p === server) {
          p.x += p.dx * SPEED * 0.4 * dt;   // the server can only shuffle along the baseline
        } else {
          p.x += p.dx * SPEED * dt;
          p.y += p.dy * SPEED * dt;
        }
        clampSide(p);
      }
      if (waiting) { ball.x = server.x; ball.y = server.y; }
      if (flight) {
        const elapsed = ctx.now() - flight.startMs;
        const k = Math.min(1, elapsed / flight.durMs);
        ball.x = flight.ox + (flight.tx - flight.ox) * k;
        ball.y = flight.oy + (flight.ty - flight.oy) * k;
        if (elapsed >= flight.durMs + LATE_MS) resolve();
      }
      ctx.broadcast(snapshot());
    },

    leave(id) {
      if (sides.some((p) => p.id === id)) finish();
    },

    dispose() {},
  };
}
