// Basketball (server rules). Each player has a lane with a hoop on the right. Move along the
// lane to pick a distance, then shoot when the meter is in the green zone for the best odds.
// Far shots past the arc are worth 3. The server owns the meter clock and every make or miss.
// Score: points. Guide: docs/minigames/README.md
const HOOP_X = 0.9;        // hoop position across the lane (0..1)
const MIN_X = 0.08;        // closest the shooter can stand to the baseline
const MAX_X = 0.85;        // furthest from the hoop still on the lane
const MOVE = 0.4;          // lane widths per second
const PERIOD = 1.1;        // seconds for the meter to sweep once
const GREEN = 0.1;         // half-width of the green zone around the middle of the meter
const READY_MS = 800;      // pause after each shot before the meter restarts

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Meter position 0..1 for a given time (triangle wave, 0 -> 1 -> 0).
function meterAt(start, now) {
  const u = (((now - start) / 1000) / PERIOD) % 1;
  const t = u < 0 ? u + 1 : u;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

module.exports = {
  id: 'basketball',
  name: 'Basketball',
  description: 'Shoot from your own lane. Move to find a spot, then time the meter. Far shots past the arc are worth three.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#d7733a',
  icon: '🏀',
  tickRate: 10,

  defaults: { roundMs: 40000 },

  create(ctx) {
    const s = ctx.settings;
    let ended = false;
    let timeTimer = null;
    const lanes = new Map();
    ctx.players.forEach((p) => {
      lanes.set(p.id, { id: p.id, x: 0.5, dir: 0, meterStart: 0, readyAt: 0, points: 0, shots: 0, made: 0, active: true });
    });

    function finish() {
      if (ended) return;
      ended = true;
      ctx.cancel(timeTimer);
      ctx.end(ctx.players.map((p) => ({ id: p.id, score: lanes.get(p.id).points })));
    }

    return {
      start() {
        const now = ctx.now();
        for (const l of lanes.values()) { l.meterStart = now; }
        ctx.broadcast({ type: 'begin', roundMs: s.roundMs, t: now, lanes: [...lanes.values()].map((l) => ({ id: l.id, start: l.meterStart })) });
        timeTimer = ctx.after(s.roundMs, finish);
      },

      input(id, msg) {
        const l = lanes.get(id);
        if (!l || !l.active || ended) return;
        if (msg.type === 'move') {
          l.dir = clamp(Number(msg.dir) || 0, -1, 1);
        } else if (msg.type === 'shoot') {
          const now = ctx.now();
          if (now < l.readyAt) return;
          const phase = meterAt(l.meterStart, now);
          const inZone = Math.abs(phase - 0.5) <= GREEN;
          const d = HOOP_X - l.x;
          const three = d > 0.5;
          // Odds drop with distance; the green zone gives the full odds, anything else a fraction.
          let chance = clamp(0.9 - d * 0.7, 0.2, 0.9);
          if (!inZone) chance *= 0.3;
          const made = ctx.randomInt(1000) < Math.round(chance * 1000);
          const points = made ? (three ? 3 : 2) : 0;
          l.shots++;
          if (made) { l.made++; l.points += points; }
          l.readyAt = now + READY_MS;
          l.meterStart = now + READY_MS;
          ctx.broadcast({ type: 'shot', id: l.id, x: l.x, made, points, green: inZone, three, t: now, start: l.meterStart, score: l.points });
        }
      },

      tick(dt) {
        if (ended) return;
        for (const l of lanes.values()) {
          if (!l.active) continue;
          l.x = clamp(l.x + l.dir * MOVE * dt, MIN_X, MAX_X);
        }
        ctx.broadcast({ type: 'state', t: ctx.now(), lanes: [...lanes.values()].map((l) => ({ id: l.id, x: Math.round(l.x * 1000) / 1000, s: l.points, a: l.active ? 1 : 0 })) });
      },

      leave(id) {
        const l = lanes.get(id);
        if (!l) return;
        l.active = false;
        // Everyone has left: end the match now.
        if (!ended && [...lanes.values()].every((x) => !x.active)) finish();
      },

      dispose() {},
    };
  },
};
