// Basketball (server rules). Four courts, one per ninja. Players take the courts first; bots fill
// the rest, and a bot takes over a court when its player leaves.
//
// A shot is a jump: "charge" when the ninja leaves the floor, "release" when the ball goes. The
// server times the gap between the two, so network delay cancels out and what you see on the gauge
// is what gets judged. Timing decides the shot, with no dice except on a near miss:
//   perfect: always in (a dunk if you are in the paint), good: always in,
//   close: rattles in half the time, off: airball when early, brick when late.
// Longer shots hold longer and have tighter windows.
//
// Points: 2 inside the arc, 3 outside it, 4 from deep. Bonuses: perfect +1, dunk +2, standing on the
// hot spot +2, a streak of 3 makes +1 (6 makes +2), and a make in the last 1.5 seconds +5.
// Multipliers: Shadow Clones x2 and the last 10 seconds x2, and they stack.
// Chi: fills from clean makes. Spend a full bar on Shadow Clones for wider windows and double points.
// Smoke: every 4th make in a row throws a smoke bomb at the top rival, tightening their windows.
// The server owns the clock, the bots and every make or miss. Score: points.
// Guide: docs/minigames/README.md
const HOOP_X = 0.9;        // hoop position across the court (0..1)
const MIN_X = 0.08;        // furthest the shooter can get from the hoop
const MAX_X = 0.85;        // closest the shooter can get to the hoop
const MOVE = 0.46;         // court widths per second
const COURTS = 4;
const MAX_D = HOOP_X - MIN_X;

const PAINT_D = 0.2;       // this close or nearer: a perfect shot is a dunk
const THREE_D = 0.5;       // past this: 3 points
const DEEP_D = 0.72;       // past this: 4 points

// How long to hold (ms) for a perfect release: longer from further out.
const HOLD_BASE = 520;
const HOLD_PER_D = 260;
const HOLD_LATE = 380;     // held this long past the sweet spot, the shot goes by itself

// Timing windows, half-widths in ms: [right next to the hoop, from the deepest spot].
const WINDOW = { perfect: [32, 20], good: [95, 58], close: [170, 118] };
const FOCUS_MUL = 1.5;     // Shadow Clones widen the windows
const SMOKE_MUL = 0.7;     // smoke tightens them

const READY_MS = 480;      // ball comes back after a make
const MISS_READY_MS = 640; // and takes a little longer after a miss

const HOT_R = 0.075;       // half-width of the hot spot
const HOT_MS = 7000;       // it moves on after this long, or as soon as you score from it
const CHI_FULL = 100;
const CHI_GAIN = { perfect: 34, good: 20, close: 12, hot: 14 };
const FOCUS_MS = 7000;
const SMOKE_MS = 3500;
const SMOKE_EVERY = 4;     // every 4th make in a row throws a smoke bomb

const FINAL_MS = 10000;    // the last this-many ms count double
const BUZZER_MS = 1500;    // a make released this close to the end is a buzzer beater
const BUZZER_HOLD_MS = 2800; // the court stays up this long after the horn, for the last ball and the standings

const BOT_NAMES = ['Ace', 'Blaze', 'Dunk', 'Swish'];
const BOT_SKILLS = [0.42, 0.55, 0.68, 0.5];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const r3 = (v) => Math.round(v * 1000) / 1000;

// Hold time and windows for a shot from distance d. The client works these out too, from the numbers in begin{}.
function shotWindows(d, focus, smoked) {
  const t = clamp(d / MAX_D, 0, 1);
  const mul = (focus ? FOCUS_MUL : 1) * (smoked ? SMOKE_MUL : 1);
  return {
    sweet: HOLD_BASE + d * HOLD_PER_D,
    perfect: lerp(WINDOW.perfect[0], WINDOW.perfect[1], t) * mul,
    good: lerp(WINDOW.good[0], WINDOW.good[1], t) * mul,
    close: lerp(WINDOW.close[0], WINDOW.close[1], t) * mul,
  };
}

function gradeOf(err, win) {
  const a = Math.abs(err);
  if (a <= win.perfect) return 'perfect';
  if (a <= win.good) return 'good';
  if (a <= win.close) return 'close';
  return 'off';
}

module.exports = {
  id: 'basketball',
  name: 'Basketball',
  description: 'Hold to jump, let go at the top. Hit the hot spots, dunk from the paint, throw smoke at the leader and call up Shadow Clones of your ninja.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#d7733a',
  icon: '🏀',
  tickRate: 15,

  defaults: { roundMs: 60000 },

  // Scores run higher than a plain make-or-miss game, so coins are about half a point each.
  rewards(result, { players }) {
    const winBonus = players > 1 && result.place === 1 ? 15 : 0;
    return { coins: Math.round(result.score * 0.5) + winBonus, xp: Math.round(result.score * 0.25) };
  },

  create(ctx) {
    const s = ctx.settings;
    let over = false;           // the horn has gone: no more input
    let ended = false;          // ctx.end has been called
    let finalOn = false;
    let endAt = 0;
    let timeTimer = null, finalTimer = null, endTimer = null;
    const humans = new Set(ctx.players.map((p) => p.id));

    const newLane = (id, name, bot, skill) => ({
      id, name, bot, skill,
      x: 0.5, dir: 0,
      chargeAt: null, sweet: 0,   // when the ninja jumped, and the hold that would be perfect
      readyAt: 0,
      points: 0, shots: 0, made: 0, streak: 0, bestStreak: 0, perfects: 0,
      chi: 0, focusUntil: 0, smokedUntil: 0,
      hot: 0.5, hotUntil: 0,
      active: true,
      target: 0.3 + ctx.randomInt(45) / 100,   // bots: the spot they are heading for
      waitUntil: null,                         // bots: when to jump once in position
      botRelease: 0,                           // bots: when to let go
    });

    const lanes = ctx.players.slice(0, COURTS).map((p) => newLane(p.id, p.name, false, 0));
    let botNo = 0;
    while (lanes.length < COURTS) {
      lanes.push(newLane(`__bot${botNo}`, `Bot ${BOT_NAMES[botNo % BOT_NAMES.length]}`, true, BOT_SKILLS[botNo % BOT_SKILLS.length]));
      botNo++;
    }
    const byId = new Map(lanes.map((l) => [l.id, l]));

    function moveHot(l, now) {
      // Pick a spot well away from where the ninja stands, so taking it means moving.
      let x = 0.5;
      for (let i = 0; i < 8; i++) {
        x = 0.12 + ctx.randomInt(71) / 100;
        if (Math.abs(x - l.x) >= 0.18) break;
      }
      l.hot = x;
      l.hotUntil = now + HOT_MS;
    }

    function finish() {
      if (ended) return;
      ended = true;
      over = true;
      ctx.cancel(timeTimer);
      ctx.cancel(finalTimer);
      ctx.cancel(endTimer);
      ctx.end(ctx.players.map((p) => ({ id: p.id, score: byId.get(p.id) ? byId.get(p.id).points : 0 })), { endingMs: 0 }); // the standings already held on screen
    }

    // The horn: shots still in the air count, then the standings hold on screen before the results.
    function buzzer() {
      if (over) return;
      const now = ctx.now();
      for (const l of lanes) if (l.chargeAt !== null) release(l, now);
      over = true;
      ctx.broadcast({
        type: 'buzzer',
        standings: lanes.map((l) => ({ id: l.id, score: l.points, shots: l.shots, made: l.made, perfects: l.perfects, best: l.bestStreak })),
      });
      endTimer = ctx.after(BUZZER_HOLD_MS, finish);
    }

    function charge(l, now) {
      if (over || l.chargeAt !== null || now < l.readyAt) return false;
      l.chargeAt = now;
      l.sweet = shotWindows(HOOP_X - l.x, false, false).sweet;
      ctx.broadcast({ type: 'charge', id: l.id });
      return true;
    }

    function topRival(l) {
      let best = null;
      for (const o of lanes) if (o !== l && (!best || o.points > best.points)) best = o;
      return best;
    }

    // The ball goes. at: the time of release, which a bot sets exactly; players use the arrival time.
    function release(l, at) {
      if (over || l.chargeAt === null) return;
      const now = ctx.now();
      const d = HOOP_X - l.x;
      const focus = now < l.focusUntil;
      const win = shotWindows(d, focus, now < l.smokedUntil);
      const err = (at - l.chargeAt) - l.sweet;
      const grade = gradeOf(err, win);
      const perfect = grade === 'perfect';
      const made = perfect || grade === 'good' || (grade === 'close' && ctx.randomInt(2) === 0);
      const dunk = perfect && d <= PAINT_D;
      const hot = Math.abs(l.x - l.hot) <= HOT_R;
      const zone = d > DEEP_D ? 4 : d > THREE_D ? 3 : 2;
      const buzzerBeater = made && endAt - now <= BUZZER_MS;
      l.chargeAt = null;
      l.shots++;
      if (perfect) l.perfects++;

      let kind;
      if (dunk) kind = 'dunk';
      else if (perfect) kind = 'swish';
      else if (made) kind = ctx.randomInt(3) === 0 ? 'swish' : 'in';
      else if (grade === 'close') kind = 'rattle';
      else kind = err < 0 ? 'air' : 'brick';

      let points = 0;
      if (made) {
        l.made++;
        l.streak++;
        l.bestStreak = Math.max(l.bestStreak, l.streak);
        points = zone + (perfect ? 1 : 0) + (dunk ? 2 : 0) + (hot ? 2 : 0)
          + (l.streak >= 6 ? 2 : l.streak >= 3 ? 1 : 0) + (buzzerBeater ? 5 : 0);
        points *= (focus ? 2 : 1) * (finalOn ? 2 : 1);
        l.points += points;
        if (!focus) l.chi = Math.min(CHI_FULL, l.chi + CHI_GAIN[grade] + (hot ? CHI_GAIN.hot : 0));
        if (hot) moveHot(l, now);
      } else {
        l.streak = 0;
      }

      l.readyAt = now + (made ? READY_MS : MISS_READY_MS);
      ctx.broadcast({
        type: 'shot', id: l.id, x: r3(l.x), made, kind, grade, points, zone, hot, dunk, focus,
        buzzer: buzzerBeater, final: finalOn, streak: l.streak, chi: Math.round(l.chi), score: l.points,
        t: now, ready: l.readyAt,
      });

      if (made && l.streak % SMOKE_EVERY === 0) {
        const target = topRival(l);
        if (target) {
          target.smokedUntil = now + SMOKE_MS;
          ctx.broadcast({ type: 'smoke', from: l.id, to: target.id, ms: SMOKE_MS });
        }
      }

      if (l.bot) {
        l.waitUntil = null;
        // Better bots chase the hot spot; the rest wander.
        l.target = ctx.randomInt(100) < l.skill * 100 ? l.hot : 0.25 + ctx.randomInt(55) / 100;
      }
    }

    function focusUp(l, now) {
      if (over || l.chi < CHI_FULL || now < l.focusUntil) return;
      l.chi = 0;
      l.focusUntil = now + FOCUS_MS;
      ctx.broadcast({ type: 'focus', id: l.id, ms: FOCUS_MS });
    }

    function botThink(l, now) {
      if (l.chargeAt !== null) {
        if (now >= l.botRelease) release(l, l.botRelease);
        return;
      }
      if (l.chi >= CHI_FULL) focusUp(l, now);
      const dx = l.target - l.x;
      l.dir = Math.abs(dx) < MOVE / module.exports.tickRate ? 0 : Math.sign(dx); // within one step: stop, or it jitters past the spot
      if (l.dir !== 0 || now < l.readyAt) return;
      if (l.waitUntil === null) l.waitUntil = now + 250 + ctx.randomInt(750);
      if (now < l.waitUntil || !charge(l, now)) return;
      // A triangular spread around the sweet spot; better bots stay closer to it.
      const spread = Math.round(90 + (1 - l.skill) * 430);
      const noise = (ctx.randomInt(spread * 2 + 1) - spread + ctx.randomInt(spread * 2 + 1) - spread) / 2;
      l.botRelease = now + l.sweet + noise;
    }

    return {
      start() {
        const now = ctx.now();
        endAt = now + s.roundMs;
        for (const l of lanes) moveHot(l, now);
        ctx.broadcast({
          type: 'begin', roundMs: s.roundMs, t: now,
          cfg: {
            hoopX: HOOP_X, minX: MIN_X, maxX: MAX_X, maxD: MAX_D, move: MOVE,
            paintD: PAINT_D, threeD: THREE_D, deepD: DEEP_D, hotR: HOT_R, chiFull: CHI_FULL,
            holdBase: HOLD_BASE, holdPerD: HOLD_PER_D, holdLate: HOLD_LATE,
            window: WINDOW, focusMul: FOCUS_MUL, smokeMul: SMOKE_MUL,
          },
          lanes: lanes.map((l) => ({ id: l.id, name: l.name, bot: l.bot })),
        });
        timeTimer = ctx.after(s.roundMs, buzzer);
        finalTimer = ctx.after(Math.max(0, s.roundMs - FINAL_MS), () => {
          if (over) return;
          finalOn = true;
          ctx.broadcast({ type: 'final' });
        });
      },

      input(id, msg) {
        const l = byId.get(id);
        if (!l || l.bot || !l.active || over || !msg) return;
        const now = ctx.now();
        if (msg.type === 'move') l.dir = clamp(Number(msg.dir) || 0, -1, 1);
        else if (msg.type === 'charge') charge(l, now);
        else if (msg.type === 'release') release(l, now);
        else if (msg.type === 'focus') focusUp(l, now);
      },

      tick(dt) {
        if (over) return;
        const now = ctx.now();
        for (const l of lanes) {
          if (l.bot) botThink(l, now);
          // A shot held too long goes by itself, late.
          if (l.chargeAt !== null && now - l.chargeAt >= l.sweet + HOLD_LATE) release(l, now);
          if (l.chargeAt === null) l.x = clamp(l.x + l.dir * MOVE * dt, MIN_X, MAX_X);
          if (now >= l.hotUntil) moveHot(l, now);
        }
        ctx.broadcast({
          type: 'state', left: Math.max(0, endAt - now),
          lanes: lanes.map((l) => ({
            id: l.id, x: r3(l.x), s: l.points, st: l.streak, b: l.bot ? 1 : 0,
            m: l.chargeAt === null && l.dir !== 0 ? 1 : 0,
            c: Math.round(l.chi), h: r3(l.hot),
            fo: now < l.focusUntil ? 1 : 0, sm: now < l.smokedUntil ? 1 : 0,
          })),
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
        l.chargeAt = null;
        l.target = l.x;
        l.skill = 0.5;
        l.waitUntil = null;
        ctx.broadcast({ type: 'takeover', id, name: l.name });
        // Everyone has left: end the match now.
        if (humans.size === 0) finish();
      },

      dispose() {},
    };
  },
};
