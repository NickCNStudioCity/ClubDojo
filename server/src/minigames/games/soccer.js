// Soccer (server rules): 2v2 on a small pitch. Team A (blue) defends the left goal, team B (red)
// defends the right. Score by knocking the ball into the other team's goal. Each human controls
// one player with WASD or the arrow keys. Space shoots in the direction you are running, Shift
// dashes (a short burst that also shoves opponents off the ball). Power-ups appear in midfield:
// Speed Boots (run faster for a while) and Fire Shot (your next shot is a rocket).
// A draw at full time goes to Golden Goal: the next goal wins. Empty slots are filled with bots.
// Score per player: 3 per goal, 1 per assist, plus 3 for a win or 1 for a draw.
// Guide: docs/minigames/README.md
const FIELD = { w: 120, h: 70, goalHalf: 9 };
const PLAYER_R = 2.2;
const BALL_R = 1.3;
const POST_R = 0.8;
const MAX_SPEED = 22;        // units per second
const BOOT_SPEED = 1.35;     // speed multiplier while wearing Speed Boots
const DASH_SPEED = 2.1;      // speed multiplier during a dash
const DASH_MS = 220;
const DASH_COOLDOWN_MS = 2000;
const ACCEL = 9;             // how quickly a player reaches their target speed (per second)
const BALL_DRAG = 0.6;       // ball slows down this much per second
const MAX_BALL = 60;
const MAX_FIRE_BALL = 95;
const DRIBBLE = 10.4;        // push on a plain touch
const SHOT = 46;             // Space shot
const FIRE_SHOT = 78;        // Space shot with a Fire Shot ready
const KICK_REACH = 1.4;      // a shot connects this far beyond touching distance
const KICK_WINDOW_MS = 180;  // how long a Space press stays "armed"
const KICK_COOLDOWN_MS = 350;
const RESET_MS = 2200;       // pause after a goal before kickoff
const GOLDEN_MS = 45000;     // Golden Goal time limit before it is called a draw
const PICKUP_EVERY_MS = 11000;
const PICKUP_LIFE_MS = 12000;
const PICKUP_R = 2.4;
const BOOTS_MS = 6000;
const ASSIST_MS = 8000;      // a teammate's touch this recent before the goal counts as an assist
const STEP = 1 / 60;
const BROADCAST_EVERY = 2;   // state sent every 2nd physics step (30 per second)
const TEAM_SIZE = 2;
const PICKUP_KINDS = ['boots', 'fire'];
const BOT_NAMES = ['Bot Ryu', 'Bot Mei', 'Bot Kenji', 'Bot Hana'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const len = (x, y) => Math.hypot(x, y);
const round = (v) => Math.round(v * 10) / 10;

// Kickoff spots per slot. Slots 0 and 2 are team 0 (left), 1 and 3 are team 1 (right).
function homeFor(slot) {
  const side = slot.team === 0 ? 0.3 : 0.7;
  const top = slot.index < 2 ? 0.34 : 0.66;
  return { x: FIELD.w * side, y: FIELD.h * top };
}

const POSTS = [
  { x: 0, y: FIELD.h / 2 - FIELD.goalHalf }, { x: 0, y: FIELD.h / 2 + FIELD.goalHalf },
  { x: FIELD.w, y: FIELD.h / 2 - FIELD.goalHalf }, { x: FIELD.w, y: FIELD.h / 2 + FIELD.goalHalf },
];

module.exports = {
  id: 'soccer',
  name: 'Soccer',
  description: '2v2 football with dashes, power-ups and Golden Goal. Bots fill any empty spots.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#3fa34d',
  icon: '⚽',
  tickRate: 30,

  defaults: { roundMs: 120000 },

  // About 2 coins per point, like the other games.
  rewards(result) {
    return { coins: result.score * 2, xp: result.score };
  },

  create(ctx) {
    const s = ctx.settings;
    // Slot order: 0 = team 0 (left), 1 = team 1 (right), 2 = team 0, 3 = team 1.
    // Humans take slots in join order; the rest are bots.
    const slots = [];
    for (let i = 0; i < TEAM_SIZE * 2; i++) {
      slots.push({
        index: i, team: i % 2, id: null, name: BOT_NAMES[i], bot: true, human: false,
        x: 0, y: 0, vx: 0, vy: 0, fx: i % 2 === 0 ? 1 : -1, fy: 0, move: { x: 0, y: 0 },
        kickAt: -1e9, lastKick: -1e9, dashAt: -1e9, dashUntil: 0, dashReadyAt: 0, bootsUntil: 0, fire: false,
        jitter: 0, botDashAt: 0,
      });
    }
    ctx.players.slice(0, slots.length).forEach((p, i) => {
      Object.assign(slots[i], { id: p.id, name: p.name, bot: false, human: true });
    });
    slots.forEach((sl) => {
      sl.jitter = ctx.randomInt(9) - 4;
      const h = homeFor(sl);
      sl.x = h.x; sl.y = h.y;
    });
    const ball = { x: FIELD.w / 2, y: FIELD.h / 2, vx: 0, vy: 0, last: null, prev: null, fire: false };
    const sc = [0, 0];
    const stats = new Map(ctx.players.map((p) => [p.id, { goals: 0, assists: 0, shots: 0 }]));
    const pickups = [];
    let pickupSeq = 0;
    let nextPickupAt = 0;
    let phase = 'idle';
    let pausedUntil = 0;
    let golden = false;
    let ended = false;
    let timeTimer = null;
    let accum = 0;
    let stepCount = 0;

    const humansLeft = () => slots.some((sl) => sl.human);
    const statFor = (sl) => (sl && sl.human ? stats.get(sl.id) : null);

    function finish() {
      if (ended) return;
      ended = true;
      phase = 'over';
      ctx.cancel(timeTimer);
      const winner = sc[0] === sc[1] ? -1 : (sc[0] > sc[1] ? 0 : 1);
      const teamOf = new Map(slots.filter((sl) => sl.id != null).map((sl) => [sl.id, sl.team]));
      const results = ctx.players.map((p) => {
        const st = stats.get(p.id) || { goals: 0, assists: 0 };
        const team = teamOf.get(p.id);
        const bonus = team === undefined ? 0 : (winner === -1 ? 1 : (winner === team ? 3 : 0));
        return { id: p.id, score: st.goals * 3 + st.assists + bonus };
      });
      ctx.broadcast({
        type: 'fulltime',
        sc: [...sc],
        winner,
        stats: ctx.players.map((p) => ({ id: p.id, ...(stats.get(p.id) || {}) })),
      });
      ctx.end(results);
    }

    function resetPositions() {
      slots.forEach((sl) => {
        const h = homeFor(sl);
        sl.x = h.x; sl.y = h.y; sl.vx = 0; sl.vy = 0;
        sl.fx = sl.team === 0 ? 1 : -1; sl.fy = 0;
        sl.dashUntil = 0;
      });
      ball.x = FIELD.w / 2; ball.y = FIELD.h / 2; ball.vx = 0; ball.vy = 0;
      ball.last = null; ball.prev = null; ball.fire = false;
    }

    function flagsFor(sl, now) {
      return (now < sl.bootsUntil ? 1 : 0) | (now < sl.dashUntil ? 2 : 0) | (sl.fire ? 4 : 0);
    }

    function broadcastState() {
      const now = ctx.now();
      ctx.broadcast({
        type: 'state',
        b: [round(ball.x), round(ball.y), ball.fire ? 1 : 0],
        p: slots.map((sl) => [round(sl.x), round(sl.y), round(sl.fx), round(sl.fy), flagsFor(sl, now)]),
        pu: pickups.map((pk) => [pk.id, round(pk.x), round(pk.y), PICKUP_KINDS.indexOf(pk.kind)]),
        sc,
      });
    }

    function touch(sl, now) {
      if (!ball.last || ball.last.sl !== sl) ball.prev = ball.last;
      ball.last = { sl, at: now };
      // Anyone else touching the ball puts the fire out.
      if (ball.fire && ball.fireBy !== sl) ball.fire = false;
    }

    function scoreGoal(team) {
      const now = ctx.now();
      sc[team]++;
      const scorer = ball.last && ball.last.sl.team === team ? ball.last.sl : null;
      const assister = scorer && ball.prev && ball.prev.sl.team === team && ball.prev.sl !== scorer
        && now - ball.prev.at < ASSIST_MS ? ball.prev.sl : null;
      const own = ball.last && ball.last.sl.team !== team ? ball.last.sl : null;
      if (statFor(scorer)) statFor(scorer).goals++;
      if (statFor(assister)) statFor(assister).assists++;
      ctx.broadcast({
        type: 'goal',
        team,
        sc: [...sc],
        scorer: scorer ? scorer.name : null,
        scorerSlot: scorer ? scorer.index : -1,
        assist: assister ? assister.name : null,
        own: own ? own.name : null,
        speed: Math.round(len(ball.vx, ball.vy)),
        fire: ball.fire,
        golden,
      });
      resetPositions();
      pausedUntil = now + RESET_MS;
      if (golden) {
        // Golden Goal: a short celebration, then the match is over.
        ctx.cancel(timeTimer);
        timeTimer = ctx.after(1800, finish);
      }
    }

    function fullTime() {
      if (ended) return;
      if (sc[0] === sc[1] && !golden) {
        golden = true;
        ctx.broadcast({ type: 'golden', ms: GOLDEN_MS });
        resetPositions();
        pausedUntil = ctx.now() + RESET_MS;
        timeTimer = ctx.after(GOLDEN_MS + RESET_MS, finish);
        return;
      }
      finish();
    }

    function startDash(sl, now) {
      if (now < sl.dashReadyAt) return;
      sl.dashAt = now;
      sl.dashUntil = now + DASH_MS;
      sl.dashReadyAt = now + DASH_COOLDOWN_MS;
      const ml = len(sl.move.x, sl.move.y);
      const dx = ml > 0.1 ? sl.move.x / ml : sl.fx;
      const dy = ml > 0.1 ? sl.move.y / ml : sl.fy;
      sl.vx = dx * MAX_SPEED * DASH_SPEED;
      sl.vy = dy * MAX_SPEED * DASH_SPEED;
    }

    // Bots pick a target: the closest bot on a team chases the ball from behind, the other covers
    // (or grabs a nearby power-up).
    function botDesire(sl) {
      const attack = sl.team === 0 ? 1 : -1;
      const oppGoalX = sl.team === 0 ? FIELD.w : 0;
      const teammates = slots.filter((o) => o.team === sl.team && o.bot);
      const chaser = teammates.reduce((best, o) => (len(o.x - ball.x, o.y - ball.y) < len(best.x - ball.x, best.y - ball.y) ? o : best));
      if (chaser === sl) {
        const gx = oppGoalX - ball.x;
        const gy = FIELD.h / 2 - ball.y;
        const gl = len(gx, gy) || 1;
        const behindX = ball.x - (gx / gl) * (PLAYER_R + BALL_R + 2.5);
        const behindY = ball.y - (gy / gl) * (PLAYER_R + BALL_R + 2.5);
        const behindDist = len(behindX - sl.x, behindY - sl.y);
        const inFront = (sl.x - ball.x) * attack < 0 && Math.abs(sl.y - ball.y) < 6;
        if (behindDist > 4 && !(inFront && len(sl.x - ball.x, sl.y - ball.y) < 6)) return { tx: behindX, ty: behindY, aim: false };
        return { tx: ball.x, ty: ball.y, aim: true, gx: gx / gl, gy: gy / gl };
      }
      const near = pickups.find((pk) => len(pk.x - sl.x, pk.y - sl.y) < 14);
      if (near) return { tx: near.x, ty: near.y, aim: false };
      const base = sl.team === 0 ? FIELD.w * 0.22 : FIELD.w * 0.78;
      return {
        tx: base + (ball.x - base) * 0.35,
        ty: FIELD.h / 2 + (ball.y - FIELD.h / 2) * 0.6 + sl.jitter,
        aim: false,
      };
    }

    function shoot(sl, nx, ny, now) {
      // Shots go where you are facing, nudged by where the ball sits against your foot.
      // A shot never goes backwards into you.
      let dx = sl.fx * 0.75 + nx * 0.25;
      let dy = sl.fy * 0.75 + ny * 0.25;
      const dl = len(dx, dy);
      if (dl < 0.2 || dx * nx + dy * ny < 0) { dx = nx; dy = ny; } else { dx /= dl; dy /= dl; }
      const power = sl.fire ? FIRE_SHOT : SHOT;
      ball.vx = dx * power + sl.vx * 0.3;
      ball.vy = dy * power + sl.vy * 0.3;
      ball.fire = sl.fire;
      ball.fireBy = sl;
      sl.lastKick = now;
      sl.kickAt = -1e9;
      const st = statFor(sl);
      if (st) st.shots++;
      ctx.broadcast({ type: 'kick', s: sl.index, fire: sl.fire ? 1 : 0 });
      sl.fire = false;
      touch(sl, now);
      ball.fireBy = ball.fire ? sl : null;
    }

    function stepWorld(dt) {
      const now = ctx.now();
      if (now < pausedUntil) return;

      // Power-ups: one at a time, in midfield, and they fade if nobody takes them.
      for (let i = pickups.length - 1; i >= 0; i--) if (now > pickups[i].until) pickups.splice(i, 1);
      if (!nextPickupAt) nextPickupAt = now + PICKUP_EVERY_MS;
      if (now >= nextPickupAt) {
        nextPickupAt = now + PICKUP_EVERY_MS;
        if (pickups.length === 0) {
          pickups.push({
            id: ++pickupSeq,
            kind: PICKUP_KINDS[ctx.randomInt(PICKUP_KINDS.length)],
            x: FIELD.w * (0.3 + ctx.randomInt(41) / 100),
            y: FIELD.h * (0.18 + ctx.randomInt(65) / 100),
            until: now + PICKUP_LIFE_MS,
          });
        }
      }

      for (const sl of slots) {
        let dx = sl.move.x;
        let dy = sl.move.y;
        if (sl.bot) {
          const want = botDesire(sl);
          const ex = want.tx - sl.x;
          const ey = want.ty - sl.y;
          const d = len(ex, ey);
          const speedScale = d < 0.8 ? 0 : Math.min(1, d / 3);
          dx = d > 0 ? (ex / d) * speedScale : 0;
          dy = d > 0 ? (ey / d) * speedScale : 0;
          const ballDist = len(ball.x - sl.x, ball.y - sl.y);
          if (want.aim) { sl.fx = want.gx; sl.fy = want.gy; }
          // Bots tap Space when they reach the ball, and now and then dash onto a loose ball.
          if (want.aim && ballDist < PLAYER_R + BALL_R + KICK_REACH && now - sl.lastKick > KICK_COOLDOWN_MS) sl.kickAt = now;
          if (ballDist > 10 && ballDist < 18 && now > sl.botDashAt) {
            sl.botDashAt = now + 3000 + ctx.randomInt(4000);
            sl.move = { x: dx, y: dy };
            startDash(sl, now);
          }
        }
        const dashing = now < sl.dashUntil;
        if (!dashing) {
          const mag = len(dx, dy);
          const k = mag > 1 ? 1 / mag : 1;
          const top = MAX_SPEED * (now < sl.bootsUntil ? BOOT_SPEED : 1);
          const a = Math.min(1, ACCEL * dt);
          sl.vx += (dx * k * top - sl.vx) * a;
          sl.vy += (dy * k * top - sl.vy) * a;
          // Humans face the way they steer, so they can line up a shot before reaching the ball.
          if (sl.human && mag > 0.1) { sl.fx = dx / mag; sl.fy = dy / mag; }
          if (sl.bot && !len(sl.fx, sl.fy)) sl.fx = sl.team === 0 ? 1 : -1;
          if (sl.bot && mag > 0.1 && len(ball.x - sl.x, ball.y - sl.y) > 8) { sl.fx = dx / mag; sl.fy = dy / mag; }
        }
        sl.x = clamp(sl.x + sl.vx * dt, PLAYER_R, FIELD.w - PLAYER_R);
        sl.y = clamp(sl.y + sl.vy * dt, PLAYER_R, FIELD.h - PLAYER_R);

        for (let i = pickups.length - 1; i >= 0; i--) {
          const pk = pickups[i];
          if (len(pk.x - sl.x, pk.y - sl.y) > PLAYER_R + PICKUP_R) continue;
          pickups.splice(i, 1);
          if (pk.kind === 'boots') sl.bootsUntil = now + BOOTS_MS;
          else sl.fire = true;
          ctx.broadcast({ type: 'pickup', s: sl.index, kind: pk.kind });
        }
      }

      // Players push each other apart. A dash shoves whoever it hits.
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) {
          const a = slots[i];
          const b = slots[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = len(dx, dy);
          const min = PLAYER_R * 2;
          if (d > 0 && d < min) {
            const nx = dx / d;
            const ny = dy / d;
            const aDash = now < a.dashUntil;
            const bDash = now < b.dashUntil;
            const push = (min - d) / 2;
            a.x -= nx * push; a.y -= ny * push;
            b.x += nx * push; b.y += ny * push;
            if (aDash !== bDash && a.team !== b.team) {
              const [hit, by, sgn] = aDash ? [b, a, 1] : [a, b, -1];
              hit.vx += nx * sgn * 30; hit.vy += ny * sgn * 30;
              hit.dashUntil = 0;
              by.dashUntil = 0;
              ctx.broadcast({ type: 'shove', s: by.index, t: hit.index });
            }
          }
        }
      }

      // Ball movement and drag.
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      const drag = Math.exp(-BALL_DRAG * (ball.fire ? 0.4 : 1) * dt);
      ball.vx *= drag;
      ball.vy *= drag;
      const bs = len(ball.vx, ball.vy);
      const cap = ball.fire ? MAX_FIRE_BALL : MAX_BALL;
      if (bs > cap) { ball.vx *= cap / bs; ball.vy *= cap / bs; }
      if (ball.fire && bs < 28) ball.fire = false;

      // Shots first (an armed Space press near the ball), then plain touches.
      for (const sl of slots) {
        const dx = ball.x - sl.x;
        const dy = ball.y - sl.y;
        const d = len(dx, dy);
        const min = PLAYER_R + BALL_R;
        const nx = d > 0 ? dx / d : 1;
        const ny = d > 0 ? dy / d : 0;
        if (d < min + KICK_REACH && now - sl.kickAt < KICK_WINDOW_MS && now - sl.lastKick > KICK_COOLDOWN_MS) {
          if (d < min) { ball.x = sl.x + nx * min; ball.y = sl.y + ny * min; }
          shoot(sl, nx, ny, now);
          continue;
        }
        if (d >= min) continue;
        ball.x = sl.x + nx * min;
        ball.y = sl.y + ny * min;
        const rvn = (ball.vx - sl.vx) * nx + (ball.vy - sl.vy) * ny;
        if (rvn < 0) {
          // A fireball knocks players back instead of stopping dead.
          const keep = ball.fire && ball.fireBy !== sl ? 0.6 : 1.5;
          ball.vx -= nx * rvn * keep;
          ball.vy -= ny * rvn * keep;
          if (ball.fire && ball.fireBy !== sl) { sl.vx -= nx * 18; sl.vy -= ny * 18; }
        }
        ball.vx += nx * DRIBBLE;
        ball.vy += ny * DRIBBLE;
        touch(sl, now);
      }

      // Goal posts.
      for (const post of POSTS) {
        const dx = ball.x - post.x;
        const dy = ball.y - post.y;
        const d = len(dx, dy);
        const min = BALL_R + POST_R;
        if (d > 0 && d < min) {
          const nx = dx / d;
          const ny = dy / d;
          ball.x = post.x + nx * min;
          ball.y = post.y + ny * min;
          const vn = ball.vx * nx + ball.vy * ny;
          if (vn < 0) {
            ball.vx -= 1.75 * vn * nx;
            ball.vy -= 1.75 * vn * ny;
            if (-vn > 15) ctx.broadcast({ type: 'post', x: round(post.x), y: round(post.y) });
          }
        }
      }

      // Goals and walls. The goal mouth is open, everything else bounces.
      const inMouth = Math.abs(ball.y - FIELD.h / 2) < FIELD.goalHalf;
      if (ball.x < 0 && inMouth) { scoreGoal(1); return; }
      if (ball.x > FIELD.w && inMouth) { scoreGoal(0); return; }
      if (ball.y < BALL_R) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy) * 0.8; }
      if (ball.y > FIELD.h - BALL_R) { ball.y = FIELD.h - BALL_R; ball.vy = -Math.abs(ball.vy) * 0.8; }
      if (!inMouth && ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx) * 0.8; }
      if (!inMouth && ball.x > FIELD.w - BALL_R) { ball.x = FIELD.w - BALL_R; ball.vx = -Math.abs(ball.vx) * 0.8; }
    }

    return {
      start() {
        phase = 'play';
        resetPositions();
        pausedUntil = ctx.now() + 1200;
        ctx.broadcast({
          type: 'begin',
          roundMs: s.roundMs,
          field: FIELD,
          kickoffMs: 1200,
          roster: slots.map((sl) => ({ id: sl.id, name: sl.name, team: sl.team, bot: sl.bot })),
        });
        broadcastState();
        timeTimer = ctx.after(s.roundMs, fullTime);
      },

      input(id, msg) {
        if (phase !== 'play' || ended || !msg || typeof msg !== 'object') return;
        const sl = slots.find((o) => o.human && o.id === id);
        if (!sl) return;
        if (msg.type === 'move') {
          const x = Number(msg.x);
          const y = Number(msg.y);
          sl.move = {
            x: Number.isFinite(x) ? clamp(x, -1, 1) : 0,
            y: Number.isFinite(y) ? clamp(y, -1, 1) : 0,
          };
        } else if (msg.type === 'kick') {
          sl.kickAt = ctx.now();
        } else if (msg.type === 'dash') {
          if (ctx.now() >= pausedUntil) startDash(sl, ctx.now());
        }
      },

      tick(dt) {
        if (phase !== 'play' || ended) return;
        accum = Math.min(accum + dt, 0.25);
        while (accum >= STEP && !ended) {
          accum -= STEP;
          stepWorld(STEP);
          stepCount++;
          if (ended) break;
          if (stepCount % BROADCAST_EVERY === 0) broadcastState();
        }
      },

      leave(id) {
        const sl = slots.find((o) => o.id === id);
        if (!sl) return;
        // The seat becomes a bot so the team keeps its size.
        sl.human = false;
        sl.bot = true;
        sl.move = { x: 0, y: 0 };
        if (!ended && !humansLeft()) finish();
      },

      dispose() {},
    };
  },
};
