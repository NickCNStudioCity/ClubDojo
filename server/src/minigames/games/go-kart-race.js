// Go-Kart Race (server rules). Up to 4 ninjas race karts around a looping track.
// The server simulates every kart; clients only send steering, pedal and drift states.
// CPU racers fill empty grid slots, so a solo race is still a race.
// Score: 10 points for each ninja you beat, 5 for each CPU racer, +5 for crossing the finish line,
// +3 for setting the fastest lap of the race.
// Boost pads and a drift mini-turbo (hold drift while steering, let go for a burst) reward good lines.
// Guide: docs/minigames/README.md
// Track geometry lives in a shared module so the client's Mode 7 renderer uses the same numbers.
const {
  TRACK, HALF_WIDTH: TRACK_HALF_WIDTH, WALL_MARGIN, KART_RADIUS, WORLD, BOOST_PADS, BOOST_PAD_RADIUS,
  nearest, gridSlot, pointAt,
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
// Above the current speed cap (after a boost ends, or on running onto the grass) a kart sheds speed
// at these rates instead of being clamped, so a boost fades out smoothly.
const OVERSPEED_DECAY = 260;
const GRASS_DECAY = 520;
// Drift: needs this speed to start, and charges a mini-turbo while held. Charge level 1 (blue
// sparks) after DRIFT_LV1 s, level 2 (orange) after DRIFT_LV2 s. Letting go gives a boost of
// DRIFT_BOOST[level] seconds. Running onto the grass, slowing right down or a hard wall hit
// loses the charge.
const DRIFT_MIN_SPEED = 110;
const DRIFT_LV1 = 0.7;
const DRIFT_LV2 = 1.6;
const DRIFT_BOOST = [0, 0.55, 1.1];
const PAD_BOOST = 1.2;      // seconds of boost from a pad
const PAD_COOLDOWN = 0.6;   // the same kart cannot retrigger a pad straight away

// CPU racers: names, headband colours and pace (share of the speed cap). The rubber band (see
// rubberBand) eases a CPU off when it is far ahead of the leading ninja and pushes it when far behind.
const CPU_NAMES = ['Kenji', 'Mika', 'Hiro', 'Sora', 'Yuki', 'Ren', 'Aiko', 'Taro'];
const CPU_BANDS = ['#9b59b6', '#1abc9c', '#e67e22', '#ecf0f1'];
const CPU_PACE = [0.92, 0.95, 0.98];

module.exports = {
  id: 'go-kart-race',
  name: 'Go-Kart Race',
  description: 'Race karts around the track, three laps. Hit the boost pads, drift for a mini-turbo and cross the line first.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#d35400',
  icon: '🏎️',
  // The engine calls tick() at this rate; tick() then runs fixed physics steps (see STEP below).
  tickRate: 60,

  defaults: {
    laps: 3, timeLimitMs: 120000,
    maxSpeed: 201, // 201 units/s is 45 mph (see MPH_PER_UNIT on the client)
    offroadSpeed: 150, accel: 300, brake: 380, turnRate: 2.4,
    boostSpeed: 290, // top speed while boosting, about 65 mph
    cpuRacers: 3,    // CPU karts that fill empty grid slots (0 turns them off)
  },

  // Base rewards per racer; the engine applies the admin multiplier and the per-match cap.
  // A win against other ninjas earns the full bonus; a win against CPU racers only, half of it.
  rewards(result, { players }) {
    const d = result.detail || {};
    const winBonus = result.place === 1 && players > 1 ? 10 : (d.place === 1 && d.racers > 1 ? 5 : 0);
    return { coins: result.score + winBonus, xp: Math.floor(result.score / 2) + winBonus };
  },

  create(ctx) {
    const s = ctx.settings;
    const karts = new Map(); // id -> kart state
    const ctrl = new Map();  // id -> { steer, gas, brake, drift }
    const finishOrder = [];
    const colors = ['#e8453c', '#2f6fd1', '#3fbf7f', '#f5b82e'];
    let phase = 'idle';
    let ended = false;
    let timeTimer = null;
    let accum = 0;      // unsimulated time, in seconds
    let stepCount = 0;  // physics steps run so far

    // Grid: every racer starts just behind the start line, staggered. Ninjas first, then CPUs.
    const cpuCount = clamp(Math.floor(Number(s.cpuRacers) || 0), 0, 4 - ctx.players.length);
    const entrants = ctx.players.map((p) => ({ id: p.id, name: p.name, cpu: false }));
    const names = [...CPU_NAMES];
    for (let i = 0; i < cpuCount; i++) {
      const name = names.splice(ctx.randomInt(names.length), 1)[0];
      entrants.push({ id: `cpu-${i + 1}`, name: `CPU ${name}`, cpu: true, band: CPU_BANDS[i] });
    }
    const paces = [...CPU_PACE];
    entrants.forEach((e, i) => {
      const { x, y, h, back } = gridSlot(i);
      const info = nearest(x, y);
      const k = {
        id: e.id, name: e.name, cpu: e.cpu, color: colors[i], x, y, h, v: 0,
        lastS: info.s, p: -back, finished: false, off: false, active: true,
        boost: 0, padCool: 0, drift: 0, driftT: 0, driftHeld: false,
        lapsDone: 0, lapStart: 0, bestLap: 0, timeMs: 0,
      };
      if (e.cpu) {
        // Personality: pace (shuffled, so the quickest is not always at the back of the grid),
        // a preferred line across the road and how far ahead it looks.
        k.band = e.band;
        k.pace = paces.splice(ctx.randomInt(paces.length), 1)[0] || 0.92;
        k.lane = ctx.randomInt(41) - 20;
        k.look = 80 + ctx.randomInt(30);
      }
      karts.set(e.id, k);
      ctrl.set(e.id, { steer: 0, gas: false, brake: false, drift: false });
    });

    function activeRacers() { return [...karts.values()].filter((k) => k.active); }
    function ninjas() { return [...karts.values()].filter((k) => !k.cpu); }
    const lapOf = (k) => clamp(Math.floor(k.p / TRACK.length), 0, s.laps);
    const driftLevel = (k) => (k.driftT >= DRIFT_LV2 ? 2 : k.driftT >= DRIFT_LV1 ? 1 : 0);

    function snapshot() {
      return [...karts.values()].map((k) => ({
        id: k.id,
        x: Math.round(k.x * 10) / 10,
        y: Math.round(k.y * 10) / 10,
        h: Math.round(k.h * 1000) / 1000,
        v: Math.round(k.v),
        lap: lapOf(k),
        p: Math.round(k.p),
        f: k.finished ? 1 : 0,
        o: k.off ? 1 : 0,
        active: k.active ? 1 : 0,
        // Drift: 0 when not drifting, else its direction (-1 left, 1 right) times (charge level + 1).
        dr: k.drift ? k.drift * (driftLevel(k) + 1) : 0,
        b: k.boost > 0 ? 1 : 0,
      }));
    }

    function finishRace() {
      if (ended) return;
      ended = true;
      phase = 'done';
      ctx.cancel(timeTimer);
      const rest = [...karts.values()].filter((k) => !k.finished).sort((a, b) => b.p - a.p);
      const order = [...finishOrder.map((id) => karts.get(id)), ...rest];
      // Fastest lap of the race, CPU laps included; only a ninja can earn the bonus for it.
      let fastest = null;
      for (const k of karts.values()) if (k.bestLap && (!fastest || k.bestLap < fastest.bestLap)) fastest = k;
      // Places count every racer, but only ninjas get results.
      const results = [];
      order.forEach((k, i) => {
        if (k.cpu) return;
        const beaten = order.slice(i + 1).reduce((a, o) => a + (o.cpu ? 5 : 10), 0);
        const score = beaten + (k.finished ? 5 : 0) + (fastest === k ? 3 : 0);
        results.push({
          id: k.id, score,
          detail: {
            place: i + 1, racers: order.length, laps: lapOf(k), finished: k.finished,
            bestLapMs: k.bestLap || null, timeMs: k.finished ? k.timeMs : null, fastestLap: fastest === k,
          },
        });
      });
      ctx.end(results);
    }

    function maybeEnd() {
      if (phase !== 'race') return;
      // CPU racers never hold a race open: it ends once every ninja still here has finished, or
      // when a multiplayer race is down to one ninja.
      const live = ninjas().filter((k) => k.active);
      const unfinished = live.filter((k) => !k.finished);
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

    // Ends a drift. A clean release pays out the mini-turbo for the charge level reached.
    function endDrift(k, payout) {
      if (!k.drift) return;
      const lv = driftLevel(k);
      if (payout && lv) {
        k.boost = Math.max(k.boost, DRIFT_BOOST[lv]);
        if (!k.cpu) ctx.send(k.id, { type: 'boost', from: 'drift', level: lv });
      }
      k.drift = 0;
      k.driftT = 0;
    }

    // Rubber band for CPU racers, relative to the furthest-along ninja still racing.
    function rubberBand(k) {
      let lead = null;
      for (const o of karts.values()) if (!o.cpu && o.active && (!lead || o.p > lead.p)) lead = o;
      if (!lead) return 1;
      const gap = k.p - lead.p;
      if (gap > 250) return 0.9;
      if (gap > 120) return 0.95;
      if (gap < -350) return 1.07;
      if (gap < -150) return 1.03;
      return 1;
    }

    // CPU driving: aim at a point on its line a little further along the track, ease off the gas
    // when the turn needed is sharp, and move over for a boost pad coming up.
    function cpuControls(k) {
      const n = nearest(k.x, k.y);
      let lane = k.lane; // offset to the driver's right of the centreline
      for (const pad of BOOST_PADS) {
        let ahead = pad.s - n.s;
        if (ahead < 0) ahead += TRACK.length;
        if (ahead < 170) {
          const c = pointAt(pad.s);
          lane = (pad.x - c.x) * -c.dy + (pad.y - c.y) * c.dx;
          break;
        }
      }
      const p = pointAt(n.s + k.look);
      const tx = p.x - p.dy * lane, ty = p.y + p.dx * lane;
      const want = Math.atan2(ty - k.y, tx - k.x);
      const turn = Math.atan2(Math.sin(want - k.h), Math.cos(want - k.h));
      const c = ctrl.get(k.id);
      c.steer = clamp(turn * 3, -1, 1);
      c.gas = !(Math.abs(turn) > 0.6 && k.v > 140);
      c.brake = Math.abs(turn) > 1.1 && k.v > 100;
      c.drift = false;
    }

    function stepKart(k, dt) {
      const c = ctrl.get(k.id) || { steer: 0, gas: false, brake: false, drift: false };
      const before = nearest(k.x, k.y);
      const onGrass = before.d > TRACK_HALF_WIDTH;
      k.boost = Math.max(0, k.boost - dt);
      k.padCool = Math.max(0, k.padCool - dt);

      // Drift starts on pressing drift while steering at speed on the road, and keeps its direction.
      if (c.drift && !k.driftHeld && !k.drift && c.steer && k.v > DRIFT_MIN_SPEED && !onGrass) {
        k.drift = Math.sign(c.steer);
        k.driftT = 0;
      }
      k.driftHeld = c.drift;
      if (k.drift) {
        if (!c.drift) endDrift(k, true);
        else if (onGrass || k.v < DRIFT_MIN_SPEED * 0.7) endDrift(k, false);
        else k.driftT += dt;
      }

      // Speed cap: a boost lifts it (on the grass too, a little less), the grass lowers it, and a
      // drift costs a little (the mini-turbo pays it back).
      const boosting = k.boost > 0;
      let maxV = onGrass ? s.offroadSpeed : s.maxSpeed;
      if (boosting) maxV = onGrass ? s.boostSpeed * 0.8 : s.boostSpeed;
      if (k.drift) maxV *= 0.96;
      if (k.cpu) maxV *= k.pace * rubberBand(k);

      if (k.v > maxV) {
        // Over the cap (a boost ran out, or onto the grass): shed speed, faster with the brake on.
        k.v -= ((onGrass ? GRASS_DECAY : OVERSPEED_DECAY) + (c.brake ? s.brake : 0)) * dt;
        k.v = Math.max(k.v, maxV);
      } else if (boosting) k.v = Math.min(maxV, k.v + s.accel * 2.2 * dt);
      else if (c.gas) k.v = Math.min(maxV, k.v + s.accel * dt);
      else if (c.brake) k.v -= s.brake * dt;
      else k.v -= Math.sign(k.v) * Math.min(Math.abs(k.v), 120 * dt);
      k.v = Math.max(k.v, -90);

      if (Math.abs(k.v) > 5) {
        // Grip grows with speed, with a floor so a slow kart (say, just off a wall) can still turn.
        const grip = clamp(Math.abs(k.v) / 200, MIN_GRIP, 1);
        // In a drift the kart keeps turning its way: steering into it tightens the line, steering
        // against it widens it, but it does not straighten out until you let go.
        const steer = k.drift ? k.drift * (0.8 + 0.45 * c.steer * k.drift) * 1.1 : c.steer;
        k.h += steer * s.turnRate * grip * Math.sign(k.v) * dt;
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
            const seg = pointAt(after.s);
            let way = c.steer ? Math.sign(c.steer) * Math.sign(mx * sideY - my * sideX)
              : Math.sign(sideX * seg.dx + sideY * seg.dy) * dir;
            if (!way) way = 1;
            tx = sideX * way; ty = sideY * way;
          }
          const along = Math.atan2(ty, tx);
          k.h = dir > 0 ? along : along + Math.PI;
          k.v *= 1 - WALL_SCRUB * into;
          if (into > 0.3) endDrift(k, false); // a real knock loses the drift charge
        }
      }

      // Boost pads.
      if (!k.padCool) {
        for (const pad of BOOST_PADS) {
          if (Math.hypot(k.x - pad.x, k.y - pad.y) < BOOST_PAD_RADIUS + KART_RADIUS * 0.5) {
            k.boost = Math.max(k.boost, PAD_BOOST);
            k.padCool = PAD_COOLDOWN;
            if (!k.cpu) ctx.send(k.id, { type: 'boost', from: 'pad' });
            break;
          }
        }
      }

      // Progress is measured along the centerline, so cutting across the infield gains nothing.
      const info = nearest(k.x, k.y);
      let delta = info.s - k.lastS;
      if (delta > TRACK.length / 2) delta -= TRACK.length;
      if (delta < -TRACK.length / 2) delta += TRACK.length;
      k.p += delta;
      k.lastS = info.s;

      // Lap times, counted from GO for the first lap. A lap only counts the first time it is done,
      // so reversing back over the line and crossing again does not set a time.
      const done = lapOf(k);
      if (done > k.lapsDone) {
        const nowMs = Math.round((stepCount + 1) * STEP * 1000);
        const ms = nowMs - k.lapStart;
        k.lapsDone = done;
        k.lapStart = nowMs;
        if (!k.bestLap || ms < k.bestLap) k.bestLap = ms;
        if (done >= s.laps) k.timeMs = nowMs;
        if (!k.cpu) ctx.send(k.id, { type: 'lap', lap: done, ms, best: k.bestLap });
      }

      if (!k.finished && k.p >= s.laps * TRACK.length) {
        k.finished = true;
        endDrift(k, false);
        finishOrder.push(k.id);
        ctx.broadcast({ type: 'finish', id: k.id, place: finishOrder.length, timeMs: k.timeMs, bestLapMs: k.bestLap });
      }
    }

    // One fixed physics step for every racer.
    function stepWorld(dt) {
      for (const k of activeRacers()) if (k.cpu && !k.finished) cpuControls(k);
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
          karts: [...karts.values()].map((k) => (k.cpu
            ? { id: k.id, color: k.color, name: k.name, cpu: 1, band: k.band }
            : { id: k.id, color: k.color })),
        });
        ctx.broadcast({ type: 'state', t: ctx.now(), karts: snapshot() });
        timeTimer = ctx.after(s.timeLimitMs, finishRace);
      },

      input(id, msg) {
        if (phase !== 'race' || ended || msg.type !== 'ctl') return;
        const k = karts.get(id);
        if (!k || k.cpu || !k.active || k.finished) return;
        const c = ctrl.get(id);
        const steer = Number(msg.steer);
        c.steer = Number.isFinite(steer) ? clamp(steer, -1, 1) : 0;
        c.gas = !!msg.gas;
        c.brake = !!msg.brake;
        c.drift = !!msg.drift;
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
