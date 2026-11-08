// Go-Kart Race (server rules). Up to 4 ninjas race karts around a looping track.
// The server simulates every kart; clients only send steering and pedal states.
// Score: 10 points for each racer you beat, +5 for crossing the finish line.
// Guide: docs/minigames/README.md
// Track geometry lives in a shared module so the client's Mode 7 renderer uses the same numbers.
const {
  TRACK, HALF_WIDTH: TRACK_HALF_WIDTH, WALL_MARGIN, KART_RADIUS, WORLD, nearest, gridSlot,
} = require('../../../../shared/client/minigames/games/go-kart-mode7/track');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Physics always advances in fixed steps, so the simulation does not depend on timer jitter.
const STEP = 1 / 60;
// Snapshots go to clients every 3rd physics step (20 Hz). Positions are all clients need.
const SNAPSHOT_EVERY = 3;
// Cap on catch-up work after a stall, so one slow tick cannot trigger a long burst of steps.
const MAX_ACCUM = 0.25;
// Steering grip at low speed (fraction of full grip), so a slow kart can still turn.
const MIN_GRIP = 0.35;
// Wall contact: share of speed lost on a square hit (less for glancing ones), and how close to
// square (sine of the angle off square, about 3°) counts as square, where the slide direction
// comes from the steering instead of the approach angle.
const WALL_SCRUB = 0.6;
const WALL_SQUARE = 0.05;

// Index of the track segment that contains distance s along the centreline.
function nearestSeg(s) {
  let i = 0;
  while (i < TRACK.seg.length - 1 && TRACK.cum[i + 1] <= s) i++;
  return i;
}

module.exports = {
  id: 'go-kart-race',
  name: 'Go-Kart Race',
  description: 'Race karts around the track, three laps. Stay on the road and cross the line first.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#d35400',
  icon: '🏎️',
  // The engine calls tick() at this rate; tick() then runs fixed physics steps (see STEP below).
  tickRate: 60,

  defaults: { laps: 3, timeLimitMs: 120000, maxSpeed: 201, // 201 units/s is 45 mph (see MPH_PER_UNIT on the client)
offroadSpeed: 150, accel: 300, brake: 380, turnRate: 2.4 },

  // Base rewards per racer; the engine applies the admin multiplier and the per-match cap.
  rewards(result, { players }) {
    const winBonus = result.place === 1 && players > 1 ? 10 : 0;
    return { coins: result.score + winBonus, xp: Math.floor(result.score / 2) + winBonus };
  },

  create(ctx) {
    const s = ctx.settings;
    const karts = new Map(); // id -> kart state
    const ctrl = new Map();  // id -> { steer, gas, brake }
    const finishOrder = [];
    const colors = ['#e8453c', '#2f6fd1', '#3fbf7f', '#f5b82e'];
    let phase = 'idle';
    let ended = false;
    let timeTimer = null;
    let accum = 0;      // unsimulated time, in seconds
    let stepCount = 0;  // physics steps run so far

    ctx.players.forEach((p, i) => {
      // Grid: every racer starts just behind the start line, staggered.
      const { x, y, h, back } = gridSlot(i);
      const info = nearest(x, y);
      karts.set(p.id, {
        id: p.id, color: colors[i], x, y, h, v: 0,
        lastS: info.s, p: -back, finished: false, off: false, active: true,
      });
      ctrl.set(p.id, { steer: 0, gas: false, brake: false });
    });

    function activeRacers() { return [...karts.values()].filter((k) => k.active); }

    function snapshot() {
      return [...karts.values()].map((k) => ({
        id: k.id,
        x: Math.round(k.x * 10) / 10,
        y: Math.round(k.y * 10) / 10,
        h: Math.round(k.h * 1000) / 1000,
        v: Math.round(k.v),
        lap: clamp(Math.floor(k.p / TRACK.length), 0, s.laps),
        p: Math.round(k.p),
        f: k.finished ? 1 : 0,
        o: k.off ? 1 : 0,
        active: k.active ? 1 : 0,
      }));
    }

    function finishRace() {
      if (ended) return;
      ended = true;
      phase = 'done';
      ctx.cancel(timeTimer);
      const rest = [...karts.values()].filter((k) => !k.finished).sort((a, b) => b.p - a.p);
      const order = [...finishOrder.map((id) => karts.get(id)), ...rest];
      const n = ctx.players.length;
      const results = order.map((k, i) => {
        const place = i + 1;
        const score = Math.max(0, (n - place)) * 10 + (k.finished ? 5 : 0);
        return { id: k.id, score, detail: { place, laps: clamp(Math.floor(k.p / TRACK.length), 0, s.laps), finished: k.finished } };
      });
      ctx.end(results);
    }

    function maybeEnd() {
      if (phase !== 'race') return;
      const live = activeRacers();
      const unfinished = live.filter((k) => !k.finished);
      // Everyone done, or a multiplayer race down to one racer.
      if (unfinished.length === 0 || (ctx.players.length > 1 && live.length <= 1)) finishRace();
    }

    // Keep karts from overlapping each other.
    function separate() {
      const list = activeRacers();
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.hypot(dx, dy);
          const min = KART_RADIUS * 2;
          if (d > 0 && d < min) {
            const push = (min - d) / 2;
            a.x -= (dx / d) * push; a.y -= (dy / d) * push;
            b.x += (dx / d) * push; b.y += (dy / d) * push;
          }
        }
      }
    }

    function stepKart(k, dt) {
      const c = ctrl.get(k.id) || { steer: 0, gas: false, brake: false };
      const before = nearest(k.x, k.y);
      const maxV = before.d > TRACK_HALF_WIDTH ? s.offroadSpeed : s.maxSpeed;

      if (c.gas) k.v += s.accel * dt;
      else if (c.brake) k.v -= s.brake * dt;
      else k.v -= Math.sign(k.v) * Math.min(Math.abs(k.v), 120 * dt);
      k.v = clamp(k.v, -90, maxV);
      if (before.d > TRACK_HALF_WIDTH) k.v = Math.min(k.v, s.offroadSpeed);

      if (Math.abs(k.v) > 5) {
        // Grip grows with speed, with a floor so a slow kart (say, just off a wall) can still turn.
        const grip = clamp(Math.abs(k.v) / 200, MIN_GRIP, 1);
        k.h += c.steer * s.turnRate * grip * Math.sign(k.v) * dt;
      }
      k.x += Math.cos(k.h) * k.v * dt;
      k.y += Math.sin(k.h) * k.v * dt;

      const after = nearest(k.x, k.y);
      k.off = after.d > TRACK_HALF_WIDTH;
      if (after.d > TRACK_HALF_WIDTH + WALL_MARGIN) {
        // Hit the wall: snap back to the edge. Speed and heading change once, by the impact angle,
        // so a kart slides along the wall instead of losing half its speed on every step.
        const edge = TRACK_HALF_WIDTH + WALL_MARGIN;
        k.x = after.px + after.nx * edge;
        k.y = after.py + after.ny * edge;
        const dir = Math.sign(k.v);
        const mx = Math.cos(k.h) * dir, my = Math.sin(k.h) * dir; // direction of travel
        const into = mx * after.nx + my * after.ny;              // 1 = head-on, 0 = alongside
        if (into > 0) {
          // Turn to run along the wall, losing speed by how square the hit was. A near-square hit
          // goes the way the driver is steering, or on along the track if they are not.
          let tx = mx - into * after.nx, ty = my - into * after.ny;
          if (Math.hypot(tx, ty) < WALL_SQUARE) {
            const sideX = -after.ny, sideY = after.nx; // one way along the wall
            const seg = TRACK.seg[nearestSeg(after.s)];
            let way = c.steer ? Math.sign(c.steer) * Math.sign(mx * sideY - my * sideX)
              : Math.sign(sideX * seg.dx + sideY * seg.dy) * dir;
            if (!way) way = 1;
            tx = sideX * way; ty = sideY * way;
          }
          const along = Math.atan2(ty, tx);
          k.h = dir > 0 ? along : along + Math.PI;
          k.v *= 1 - WALL_SCRUB * into;
        }
      }

      // Progress is measured along the centerline, so cutting across the infield gains nothing.
      const info = nearest(k.x, k.y);
      let delta = info.s - k.lastS;
      if (delta > TRACK.length / 2) delta -= TRACK.length;
      if (delta < -TRACK.length / 2) delta += TRACK.length;
      k.p += delta;
      k.lastS = info.s;

      if (!k.finished && k.p >= s.laps * TRACK.length) {
        k.finished = true;
        finishOrder.push(k.id);
        ctx.broadcast({ type: 'finish', id: k.id, place: finishOrder.length });
      }
    }

    // One fixed physics step for every racer.
    function stepWorld(dt) {
      for (const k of activeRacers()) if (!k.finished) stepKart(k, dt);
      separate();
      maybeEnd();
    }

    return {
      start() {
        phase = 'race';
        ctx.broadcast({
          type: 'go', laps: s.laps, timeMs: s.timeLimitMs, length: TRACK.length,
          track: TRACK.pts, halfWidth: TRACK_HALF_WIDTH, world: { w: WORLD.w, h: WORLD.h },
          karts: ctx.players.map((p) => ({ id: p.id, color: karts.get(p.id).color })),
        });
        ctx.broadcast({ type: 'state', t: ctx.now(), karts: snapshot() });
        timeTimer = ctx.after(s.timeLimitMs, finishRace);
      },

      input(id, msg) {
        if (phase !== 'race' || ended || msg.type !== 'ctl') return;
        const k = karts.get(id);
        if (!k || !k.active || k.finished) return;
        const c = ctrl.get(id);
        const steer = Number(msg.steer);
        c.steer = Number.isFinite(steer) ? clamp(steer, -1, 1) : 0;
        c.gas = !!msg.gas;
        c.brake = !!msg.brake;
      },

      tick(dt) {
        if (phase !== 'race' || ended) return;
        accum = Math.min(accum + dt, MAX_ACCUM);
        while (accum >= STEP && !ended) {
          accum -= STEP;
          stepWorld(STEP);
          stepCount++;
          if (stepCount % SNAPSHOT_EVERY === 0 && !ended) {
            ctx.broadcast({ type: 'state', t: ctx.now(), karts: snapshot() });
          }
        }
      },

      leave(id) {
        const k = karts.get(id);
        if (k) { k.active = false; ctrl.delete(id); }
        if (phase === 'race') maybeEnd();
      },

      dispose() {
        ctx.cancel(timeTimer);
      },
    };
  },
};
