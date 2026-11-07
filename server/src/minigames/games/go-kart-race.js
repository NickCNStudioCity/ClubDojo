// Go-Kart Race (server rules). Up to 4 ninjas race karts around a looping track.
// The server simulates every kart; clients only send steering and pedal states.
// Score: 10 points for each racer you beat, +5 for crossing the finish line.
// Guide: docs/minigames/README.md
const TRACK_SAMPLES = 36;
const TRACK_HALF_WIDTH = 52; // road half-width in world pixels
const WALL_MARGIN = 30;      // how far past the road edge a kart can drift before it is pushed back
const KART_RADIUS = 12;
const GRID_GAP = 34;         // spacing of the starting grid
const WORLD_W = 1000;
const WORLD_H = 640;

// Closed loop built from a radius function. Points are generated once, in order.
function buildTrack() {
  const pts = [];
  for (let k = 0; k < TRACK_SAMPLES; k++) {
    const a = (Math.PI * 2 * k) / TRACK_SAMPLES;
    const r = 200 + 55 * Math.sin(2 * a) + 25 * Math.cos(3 * a);
    pts.push({ x: Math.round(500 + 1.35 * r * Math.cos(a)), y: Math.round(320 + r * Math.sin(a)) });
  }
  const seg = [];
  const cum = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    seg.push({ dx, dy, len, len2: len * len });
    cum.push(cum[i] + len);
  }
  return { pts, seg, length: cum[pts.length], cum };
}

const TRACK = buildTrack();

// Nearest point on the centerline: distance, track position s (0..length), and the outward normal.
function nearest(x, y) {
  let best = null;
  for (let i = 0; i < TRACK.pts.length; i++) {
    const a = TRACK.pts[i];
    const sg = TRACK.seg[i];
    const t = Math.max(0, Math.min(1, ((x - a.x) * sg.dx + (y - a.y) * sg.dy) / sg.len2));
    const px = a.x + sg.dx * t;
    const py = a.y + sg.dy * t;
    const d2 = (x - px) ** 2 + (y - py) ** 2;
    if (!best || d2 < best.d2) best = { d2, i, t, px, py };
  }
  const d = Math.sqrt(best.d2);
  const nx = d > 1e-6 ? (x - best.px) / d : 0;
  const ny = d > 1e-6 ? (y - best.py) / d : -1;
  return { d, s: TRACK.cum[best.i] + best.t * TRACK.seg[best.i].len, px: best.px, py: best.py, nx, ny };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

module.exports = {
  id: 'go-kart-race',
  name: 'Go-Kart Race',
  description: 'Race karts around the track, three laps. Stay on the road and cross the line first.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#d35400',
  icon: '🏎️',
  tickRate: 20,

  defaults: { laps: 3, timeLimitMs: 120000, maxSpeed: 330, offroadSpeed: 150, accel: 300, brake: 380, turnRate: 2.4 },

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

    ctx.players.forEach((p, i) => {
      // Grid: every racer starts just behind the start line, staggered.
      const back = i * GRID_GAP + 12;
      const dir = TRACK.seg[0];
      const len = Math.hypot(dir.dx, dir.dy);
      const x = TRACK.pts[0].x - (dir.dx / len) * back;
      const y = TRACK.pts[0].y - (dir.dy / len) * back;
      const info = nearest(x, y);
      karts.set(p.id, {
        id: p.id, color: colors[i], x, y, h: Math.atan2(dir.dy, dir.dx), v: 0,
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
        const grip = clamp(Math.abs(k.v) / 200, 0, 1);
        k.h += c.steer * s.turnRate * grip * Math.sign(k.v) * dt;
      }
      k.x += Math.cos(k.h) * k.v * dt;
      k.y += Math.sin(k.h) * k.v * dt;

      const after = nearest(k.x, k.y);
      k.off = after.d > TRACK_HALF_WIDTH;
      if (after.d > TRACK_HALF_WIDTH + WALL_MARGIN) {
        // Hit the outer wall: snap back to the edge and lose speed.
        const edge = TRACK_HALF_WIDTH + WALL_MARGIN;
        k.x = after.px + after.nx * edge;
        k.y = after.py + after.ny * edge;
        k.v *= 0.5;
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

    return {
      start() {
        phase = 'race';
        ctx.broadcast({
          type: 'go', laps: s.laps, timeMs: s.timeLimitMs, length: TRACK.length,
          track: TRACK.pts, halfWidth: TRACK_HALF_WIDTH, world: { w: WORLD_W, h: WORLD_H },
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
        for (const k of activeRacers()) if (!k.finished) stepKart(k, dt);
        separate();
        maybeEnd();
        // Snapshots at tick rate are small (4 karts), so send them each tick.
        ctx.broadcast({ type: 'state', t: ctx.now(), karts: snapshot() });
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
