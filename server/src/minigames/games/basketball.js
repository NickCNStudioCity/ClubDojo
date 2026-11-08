// Basketball (server rules). Four courts, one per ninja. Players take the courts first; bots fill
// the rest, and a bot takes over a court when its player leaves. Move along your court to pick a
// spot, then shoot with the meter in the green zone for the best odds.
// Scoring: a make is 2 points, or 3 from past the arc. Perfect timing (the gold centre of the
// meter) adds 1. A streak of 3 or more makes adds 1 more per make. The last 10 seconds count double.
// The server owns the meter clock, the bots and every make or miss. Score: points.
// Guide: docs/minigames/README.md
const HOOP_X = 0.9;        // hoop position across the court (0..1)
const MIN_X = 0.08;        // closest the shooter can stand to the baseline
const MAX_X = 0.85;        // furthest from the hoop still on the court
const MOVE = 0.42;         // court widths per second
const PERIOD = 1.1;        // seconds for the meter to sweep once
const GREEN = 0.12;        // half-width of the green zone around the middle of the meter
const PERFECT = 0.04;      // half-width of the perfect zone (the gold centre)
const READY_MS = 700;      // pause after each shot before the meter restarts
const FINAL_MS = 10000;    // the last this-many ms count double
const COURTS = 4;
const STREAK_MIN = 3;      // makes in a row before the streak bonus starts
const BOT_NAMES = ['Ace', 'Blaze', 'Dunk', 'Swish'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r3 = (v) => Math.round(v * 1000) / 1000;

// Meter position 0..1 for a given time (triangle wave, 0 -> 1 -> 0).
function meterAt(start, now) {
  const u = (((now - start) / 1000) / PERIOD) % 1;
  const t = u < 0 ? u + 1 : u;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

module.exports = {
  id: 'basketball',
  name: 'Basketball',
  description: 'Four courts, one for each ninja. Bots fill the empty courts. Move to find a spot, then time the meter: perfect shots, streaks and a double-points finish.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#d7733a',
  icon: '🏀',
  tickRate: 10,

  defaults: { roundMs: 60000 },

  create(ctx) {
    const s = ctx.settings;
    let ended = false;
    let finalOn = false;
    let timeTimer = null;
    let finalTimer = null;
    const humans = new Set(ctx.players.map((p) => p.id));

    const newLane = (id, name, bot, skill) => ({
      id, name, bot,
      x: 0.5, dir: 0,
      meterStart: 0, readyAt: 0,
      points: 0, shots: 0, made: 0, streak: 0, bestStreak: 0, perfects: 0,
      active: true,
      skill,                                   // bots: chance to wait for the green zone
      target: 0.3 + ctx.randomInt(45) / 100,   // bots: the spot they are heading for
      waitSince: null,                         // bots: when they got into position
    });

    const lanes = ctx.players.slice(0, COURTS).map((p) => newLane(p.id, p.name, false, 0));
    let botNo = 0;
    while (lanes.length < COURTS) {
      lanes.push(newLane(`__bot${botNo}`, `Bot ${BOT_NAMES[botNo % BOT_NAMES.length]}`, true, 0.45 + ctx.randomInt(45) / 100));
      botNo++;
    }
    const byId = new Map(lanes.map((l) => [l.id, l]));

    function finish() {
      if (ended) return;
      ended = true;
      ctx.cancel(timeTimer);
      ctx.cancel(finalTimer);
      ctx.end(ctx.players.map((p) => ({ id: p.id, score: byId.get(p.id) ? byId.get(p.id).points : 0 })));
    }

    // One shot from a court. Returns false if the shot was too early.
    function shoot(l, now) {
      if (now < l.readyAt) return false;
      const dist = Math.abs(meterAt(l.meterStart, now) - 0.5);
      const inZone = dist <= GREEN;
      const perfect = dist <= PERFECT;
      const d = HOOP_X - l.x;
      const three = d > 0.5;
      // Odds drop with distance; a perfect shot gets a boost, and anything off the green zone a penalty.
      let chance = clamp(0.9 - d * 0.7, 0.2, 0.9);
      if (perfect) chance = Math.min(0.95, chance + 0.08);
      else if (!inZone) chance *= 0.3;
      const made = ctx.randomInt(1000) < Math.round(chance * 1000);
      l.shots++;
      let points = 0;
      if (made) {
        l.made++;
        l.streak++;
        l.bestStreak = Math.max(l.bestStreak, l.streak);
        points = (three ? 3 : 2) + (perfect ? 1 : 0) + (l.streak >= STREAK_MIN ? 1 : 0);
        if (finalOn) points *= 2;
        l.points += points;
      } else {
        l.streak = 0;
      }
      if (perfect) l.perfects++;
      l.readyAt = now + READY_MS;
      l.meterStart = now + READY_MS;
      l.waitSince = null;
      if (l.bot) l.target = 0.3 + ctx.randomInt(45) / 100;
      ctx.broadcast({
        type: 'shot', id: l.id, x: r3(l.x), made, points, green: inZone, perfect, three,
        streak: l.streak, t: now, start: l.meterStart, score: l.points,
      });
      return true;
    }

    // Bots walk to their spot, wait for the green zone (more often when skilled), and shoot.
    // If they wait too long they shoot anyway, which usually misses.
    function botThink(l, now) {
      const dx = l.target - l.x;
      l.dir = Math.abs(dx) < 0.015 ? 0 : Math.sign(dx);
      if (l.dir !== 0 || now < l.readyAt) { l.waitSince = null; return; }
      if (l.waitSince === null) l.waitSince = now;
      const inZone = Math.abs(meterAt(l.meterStart, now) - 0.5) <= GREEN;
      if ((inZone && ctx.randomInt(100) < l.skill * 100) || now - l.waitSince > 2600) shoot(l, now);
    }

    return {
      start() {
        const now = ctx.now();
        for (const l of lanes) l.meterStart = now;
        ctx.broadcast({
          type: 'begin', roundMs: s.roundMs, t: now,
          lanes: lanes.map((l) => ({ id: l.id, name: l.name, bot: l.bot, start: l.meterStart })),
        });
        timeTimer = ctx.after(s.roundMs, finish);
        finalTimer = ctx.after(Math.max(0, s.roundMs - FINAL_MS), () => {
          if (ended) return;
          finalOn = true;
          ctx.broadcast({ type: 'final' });
        });
      },

      input(id, msg) {
        const l = byId.get(id);
        if (!l || l.bot || !l.active || ended || !msg) return;
        if (msg.type === 'move') {
          l.dir = clamp(Number(msg.dir) || 0, -1, 1);
        } else if (msg.type === 'shoot') {
          shoot(l, ctx.now());
        }
      },

      tick(dt) {
        if (ended) return;
        const now = ctx.now();
        for (const l of lanes) {
          if (l.bot) botThink(l, now);
          l.x = clamp(l.x + l.dir * MOVE * dt, MIN_X, MAX_X);
        }
        ctx.broadcast({
          type: 'state', t: now,
          lanes: lanes.map((l) => ({ id: l.id, x: r3(l.x), s: l.points, st: l.streak, b: l.bot ? 1 : 0 })),
        });
      },

      leave(id) {
        const l = byId.get(id);
        if (!l || !l.active) return;
        l.active = false;
        humans.delete(id);
        // A bot takes over the court so the others keep a full match.
        l.bot = true;
        l.dir = 0;
        l.target = l.x;
        l.skill = 0.5;
        l.waitSince = null;
        ctx.broadcast({ type: 'takeover', id, name: l.name });
        // Everyone has left: end the match now.
        if (humans.size === 0) finish();
      },

      dispose() {},
    };
  },
};
