// Football (server rules): field goals. Set the distance with up and down, press kick to start
// the aim meter, and press again to lock it. The meter sweeps across the uprights; the closer the
// lock to the centre, the better the kick. Longer kicks are harder to keep straight and worth more.
// Five attempts each, all at once. Score: points. Guide: docs/minigames/README.md
const ATTEMPTS = 5;
const MIN_YD = 20;
const MAX_YD = 60;
const STEP_YD = 5;
const SWEEP_YD = 12;       // the meter sweeps this far to either side of the centre
const PERIOD = 1.4;        // seconds for one sweep of the meter
const READY_MS = 1200;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Meter position 0..1 for a given time (triangle wave).
function meterAt(start, now) {
  const u = (((now - start) / 1000) / PERIOD) % 1;
  const t = u < 0 ? u + 1 : u;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

module.exports = {
  id: 'football',
  name: 'Football',
  description: 'Field goals. Pick your distance, time the aim meter, and split the uprights. Five kicks each.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#8b5a2b',
  icon: '🏈',
  tickRate: 0,

  defaults: { roundMs: 90000 },

  create(ctx) {
    const s = ctx.settings;
    const kickers = new Map();
    ctx.players.forEach((p) => kickers.set(p.id, { id: p.id, dist: 35, attempts: 0, points: 0, meter: null, readyAt: 0, active: true }));
    let ended = false;
    let timeTimer = null;

    const allDone = () => [...kickers.values()].every((k) => !k.active || k.attempts >= ATTEMPTS);

    function finish() {
      if (ended) return;
      ended = true;
      ctx.cancel(timeTimer);
      ctx.end(ctx.players.map((p) => ({ id: p.id, score: kickers.get(p.id).points })));
    }

    return {
      start() {
        ctx.broadcast({ type: 'begin', roundMs: s.roundMs, attempts: ATTEMPTS, period: PERIOD, sweep: SWEEP_YD });
        timeTimer = ctx.after(s.roundMs, finish);
      },

      input(id, msg) {
        const k = kickers.get(id);
        if (!k || !k.active || ended || k.attempts >= ATTEMPTS) return;
        const now = ctx.now();
        if (msg.type === 'dist' && !k.meter) {
          k.dist = clamp(k.dist + (Number(msg.step) > 0 ? STEP_YD : -STEP_YD), MIN_YD, MAX_YD);
          ctx.send(id, { type: 'dist', dist: k.dist });
        } else if (msg.type === 'kick' && !k.meter && now >= k.readyAt) {
          k.meter = { start: now };
          ctx.send(id, { type: 'meter', start: now, t: now, period: PERIOD });
        } else if (msg.type === 'lock' && k.meter) {
          const phase = meterAt(k.meter.start, now);
          const error = (phase - 0.5) * 2 * SWEEP_YD + (ctx.randomInt(21) - 10) / 10; // plus a little wobble
          // Narrower uprights window the further the kick.
          const half = Math.max(1.2, 4 - (k.dist - MIN_YD) * 0.05);
          const made = Math.abs(error) <= half;
          const points = made ? (k.dist >= 50 ? 5 : 3) : 0;
          k.attempts++;
          k.points += points;
          k.meter = null;
          k.readyAt = now + READY_MS;
          ctx.broadcast({ type: 'attempt', id, dist: k.dist, error: Math.round(error * 10) / 10, made, points, n: k.attempts, score: k.points });
          if (allDone()) finish();
        }
      },

      leave(id) {
        const k = kickers.get(id);
        if (!k) return;
        k.active = false;
        if (!ended && allDone()) finish();
      },

      dispose() {},
    };
  },
};
