// Football (server rules): Lantern Kicks, field goals taken in turns.
// On your turn pick a distance, then swing in two presses: the first locks your aim, the second your
// power. Each distance needs a different power: too little drops short, too much hooks off line.
// Longer kicks and made-kick streaks score more. A lantern hangs between the posts for a bonus, a kick
// that clips an upright can bounce either way, and the fifth kick (the Golden Kick) counts double.
// Everyone waiting has one Gust Scroll to whip up the wind against the kicker. Solo plays a bot.
// Guide: docs/minigames/README.md
const BOT_ID = '__bot';
const ATTEMPTS = 5;
const MIN_YD = 20;
const MAX_YD = 60;
const STEP_YD = 5;
const SWEEP_YD = 12;        // the aim marker sweeps this far to either side of centre
const AIM_PERIOD = 1.8;     // seconds for one full sweep of the aim marker
const POWER_PERIOD = 2;     // seconds for the power needle to rise and fall
const WIND_YD = 1.2;        // yards of drift per unit of wind
const GUST = 2;             // units of wind a Gust Scroll adds
const POWER_GRACE = 0.02;   // how far under the needed power still carries
const HOOK_YD = 9;          // yards of hook per unit of power over the sweet spot
const POST_YD = 0.35;       // this close to an upright, the ball hits it
const PERFECT_YD = 0.8;     // this close to dead centre is a Perfect
const LANTERN_YD = 0.9;     // this close to the lantern lights it
const PERFECT_BONUS = 2;
const LANTERN_BONUS = 3;
const STREAK_CAP = 3;       // most bonus points a streak can add
const BEAT_BOT_BONUS = 5;
const MAX_LAG_MS = 200;     // a client's reported press time may be this much older than the server's
const IDLE_TURN_MS = 6000;  // the turn limit for someone who just let a turn run out

const POINTS = { 20: 2, 25: 2, 30: 3, 35: 3, 40: 4, 45: 5, 50: 6, 55: 7, 60: 9 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round2 = (v) => Math.round(v * 100) / 100;

// Everything that depends on the distance. Long kicks have a narrower goal, need more power and
// have a tighter sweet spot; on short kicks the danger is hitting them too hard.
function spot(d) {
  const f = (d - MIN_YD) / (MAX_YD - MIN_YD);
  return { d, pts: POINTS[d], half: round2(4 - f * 2), need: round2(0.3 + f * 0.52), band: round2(0.18 - f * 0.08) };
}
const SPOTS = [];
for (let d = MIN_YD; d <= MAX_YD; d += STEP_YD) SPOTS.push(spot(d));

// Triangle wave 0..1 after `elapsed` milliseconds.
function meterAt(elapsed, period) {
  const t = ((elapsed / 1000) / period) % 1;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

module.exports = {
  id: 'football',
  name: 'Football',
  description: 'Lantern Kicks: field goals in turns. Lock your aim and power, light the lantern, and curse your rivals with a gust. Solo vs a bot, or up to four players.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#8b5a2b',
  icon: '🏈',
  tickRate: 0,

  defaults: { turnMs: 15000, botDelayMs: 900, pauseMs: 3400, finalMs: 3800 },

  rewards(result) {
    return { coins: result.score * 2, xp: result.score };
  },

  create(ctx) {
    const s = ctx.settings;
    const solo = ctx.players.length === 1;
    const order = ctx.players.map((p) => p.id);
    if (solo) order.push(BOT_ID);
    const names = new Map(ctx.players.map((p) => [p.id, p.name]));
    names.set(BOT_ID, 'Sensei Bot');
    const kickers = new Map(order.map((id) => [id, { id, dist: 35, attempts: 0, points: 0, streak: 0, gusts: 1, idle: false, active: true }]));

    let ended = false;
    let turnTimer = null;
    let botTimer = null;
    let gustTimer = null;
    let pauseTimer = null;
    let turnIdx = -1;
    let cur = null;           // id of the kicker whose turn it is
    let wind = 0;             // -3..3, or up to 5 after a gust; positive pushes the ball right
    let lantern = 0;          // the lantern's place between the posts, -1..1 of the goal's half width
    let phase = null;         // 'set', 'aim' or 'power' during a turn
    let phaseStart = 0;
    let lockedAim = 0;
    let gustUsed = false;     // one gust per turn
    let botRead = 0;          // the wind as the bot saw it when its turn began

    function clearTurnTimers() {
      ctx.cancel(turnTimer);
      ctx.cancel(botTimer);
      ctx.cancel(gustTimer);
    }

    function finish() {
      if (ended) return;
      ended = true;
      clearTurnTimers();
      ctx.cancel(pauseTimer);
      // The game shows its own final standings, so the results screen can follow straight on.
      ctx.end(ctx.players.map((p) => ({ id: p.id, score: kickers.get(p.id).points })), { endingMs: 0 });
    }

    const humansLeft = () => order.some((id) => id !== BOT_ID && ctx.isPlaying(id) && kickers.get(id).active);
    const canKick = (id) => {
      const k = kickers.get(id);
      return k.active && k.attempts < ATTEMPTS && (id === BOT_ID || ctx.isPlaying(id));
    };

    // Everyone has kicked: show the final standings, then end the match.
    function wrapUp() {
      let bonus = 0;
      if (solo) {
        const you = kickers.get(ctx.players[0].id);
        if (you.points > kickers.get(BOT_ID).points) { bonus = BEAT_BOT_BONUS; you.points += bonus; }
      }
      const standings = order
        .filter((id) => id === BOT_ID || ctx.isPlaying(id))
        .map((id) => ({ id, name: names.get(id), score: kickers.get(id).points }))
        .sort((a, b) => b.score - a.score);
      ctx.broadcast({ type: 'final', standings, bonus });
      pauseTimer = ctx.after(s.finalMs, finish);
    }

    function nextTurn() {
      if (ended) return;
      if (!humansLeft()) return finish();
      if (!order.some(canKick)) return wrapUp();
      for (let n = 0; n < order.length; n++) {
        turnIdx = (turnIdx + 1) % order.length;
        if (canKick(order[turnIdx])) { cur = order[turnIdx]; break; }
      }
      const k = kickers.get(cur);
      phase = 'set';
      phaseStart = ctx.now();
      gustUsed = false;
      wind = ctx.randomInt(7) - 3;
      botRead = wind;
      lantern = (ctx.randomInt(2) ? 1 : -1) * (0.45 + ctx.randomInt(8) * 0.05);
      clearTurnTimers();
      const ms = k.idle ? Math.min(s.turnMs, IDLE_TURN_MS) : s.turnMs;
      ctx.broadcast({
        type: 'turn', id: cur, name: names.get(cur), wind, lantern: round2(lantern), n: k.attempts + 1, of: ATTEMPTS,
        dist: k.dist, ms, golden: k.attempts === ATTEMPTS - 1, streak: k.streak,
      });
      turnTimer = ctx.after(ms, () => resolve(null, 0));   // out of time: a miss
      if (cur === BOT_ID) botTimer = ctx.after(s.botDelayMs, botSetup);
      else if (solo) maybeBotGust(k);
    }

    function gustNow(from) {
      const fk = kickers.get(from);
      fk.gusts--;
      gustUsed = true;
      wind += (wind ? Math.sign(wind) : (ctx.randomInt(2) ? 1 : -1)) * GUST;
      ctx.broadcast({ type: 'gust', from, name: names.get(from), wind, gusts: fk.gusts });
    }

    // The bot saves its one scroll for your later kicks, and always spends it on the Golden Kick.
    function maybeBotGust(k) {
      const bot = kickers.get(BOT_ID);
      if (!bot.gusts || k.attempts < 2) return;
      if (k.attempts !== ATTEMPTS - 1 && ctx.randomInt(2)) return;
      gustTimer = ctx.after(1000 + ctx.randomInt(1500), () => {
        if (!ended && !gustUsed && (phase === 'set' || phase === 'aim')) gustNow(BOT_ID);
      });
    }

    function startPhase(next) {
      phase = next;
      phaseStart = ctx.now();
      ctx.broadcast({
        type: 'phase', id: cur, phase: next, period: next === 'aim' ? AIM_PERIOD : POWER_PERIOD,
        aim: next === 'power' ? round2(lockedAim) : undefined,
      });
    }

    // aim: yards from centre, power: 0..1. aim null means the turn timed out.
    function resolve(aim, power) {
      if (ended || cur === null) return;
      const id = cur;
      const k = kickers.get(id);
      const sp = spot(k.dist);
      const golden = k.attempts === ATTEMPTS - 1;
      clearTurnTimers();
      phase = null;
      cur = null;

      let outcome = 'timeout';
      let landing = null;
      let hook = 0;
      if (aim !== null) {
        k.idle = false;
        const base = aim + wind * WIND_YD + (ctx.randomInt(7) - 3) / 10;   // a little wobble
        if (power < sp.need - POWER_GRACE) {
          outcome = 'short';
          landing = base;
        } else {
          hook = Math.max(0, power - sp.need - sp.band) * HOOK_YD * (ctx.randomInt(2) ? 1 : -1);
          landing = base + hook;
          const off = Math.abs(landing) - sp.half;
          if (Math.abs(off) <= POST_YD) outcome = ctx.randomInt(2) ? 'post-in' : 'post-out';
          else outcome = off < 0 ? 'good' : 'wide';
        }
      } else {
        k.idle = true;
      }

      const made = outcome === 'good' || outcome === 'post-in';
      const parts = { base: 0, streak: 0, perfect: 0, lantern: 0, golden };
      if (made) {
        parts.base = sp.pts;
        parts.streak = Math.min(STREAK_CAP, k.streak);
        if (outcome === 'good') {
          if (Math.abs(landing - lantern * sp.half) <= LANTERN_YD) parts.lantern = LANTERN_BONUS;
          else if (Math.abs(landing) <= PERFECT_YD) parts.perfect = PERFECT_BONUS;
        }
        k.streak++;
      } else {
        k.streak = 0;
      }
      const points = made ? (parts.base + parts.streak + parts.perfect + parts.lantern) * (golden ? 2 : 1) : 0;
      k.points += points;
      k.attempts++;
      ctx.broadcast({
        type: 'attempt', id, dist: k.dist, wind, aim: aim === null ? null : round2(aim), power: round2(power),
        landing: landing === null ? null : round2(landing), half: sp.half, outcome, made, points, parts,
        n: k.attempts, score: k.points, streak: k.streak,
      });
      // Hold here so everyone sees the ball fly before the next ninja steps up.
      pauseTimer = ctx.after(s.pauseMs, nextTurn);
    }

    function botSetup() {
      if (ended || cur !== BOT_ID) return;
      const k = kickers.get(BOT_ID);
      const you = kickers.get(ctx.players[0].id);
      // Goes long when it's behind.
      k.dist = clamp(25 + ctx.randomInt(5) * STEP_YD + (k.points < you.points ? 10 : 0), MIN_YD, MAX_YD);
      ctx.broadcast({ type: 'dist', id: BOT_ID, dist: k.dist });
      botTimer = ctx.after(s.botDelayMs, botAim);
    }

    // The bot reads the wind once, as its turn begins, and plays the real meters, so a gust throws it off.
    function botAim() {
      if (ended || cur !== BOT_ID) return;
      startPhase('aim');
      const target = clamp(-botRead * WIND_YD + (ctx.randomInt(9) - 4) * 0.45, -SWEEP_YD, SWEEP_YD);
      const u = (target / SWEEP_YD + 1) / 2;
      botTimer = ctx.after((1 - u / 2) * AIM_PERIOD * 1000, () => {
        if (ended || cur !== BOT_ID) return;
        lockedAim = target;
        startPhase('power');
        const sp = spot(kickers.get(BOT_ID).dist);
        const power = clamp(sp.need + sp.band / 2 + (ctx.randomInt(5) - 2) * 0.04, 0, 1);
        botTimer = ctx.after(power * (POWER_PERIOD / 2) * 1000, () => resolve(target, power));
      });
    }

    return {
      start() {
        ctx.broadcast({
          type: 'begin', attempts: ATTEMPTS, sweep: SWEEP_YD, windYd: WIND_YD, spots: SPOTS, grace: POWER_GRACE,
          roster: order.map((id) => ({ id, name: names.get(id), bot: id === BOT_ID })),
        });
        nextTurn();
      },

      input(id, msg) {
        if (ended || !msg) return;
        const k = kickers.get(id);
        if (!k || id === BOT_ID) return;

        if (msg.type === 'gust') {
          if (cur === null || id === cur || gustUsed || !k.gusts || !k.active) return;
          if (phase === 'set' || phase === 'aim') gustNow(id);
          return;
        }

        if (id !== cur) return;
        if (msg.type === 'dist' && phase === 'set') {
          k.dist = clamp(k.dist + (Number(msg.step) > 0 ? STEP_YD : -STEP_YD), MIN_YD, MAX_YD);
          ctx.broadcast({ type: 'dist', id, dist: k.dist });
        } else if (msg.type === 'press') {
          if (phase === 'set') return startPhase('aim');
          // Judge the press at the moment the player saw it, within reason, so lag doesn't move the marker.
          const real = ctx.now() - phaseStart;
          const reported = Number(msg.at);
          const elapsed = Number.isFinite(reported) ? clamp(reported, Math.max(0, real - MAX_LAG_MS), real) : real;
          if (phase === 'aim') {
            lockedAim = (meterAt(elapsed, AIM_PERIOD) - 0.5) * 2 * SWEEP_YD;
            startPhase('power');
          } else if (phase === 'power') {
            resolve(lockedAim, meterAt(elapsed, POWER_PERIOD));
          }
        }
      },

      leave(id) {
        const k = kickers.get(id);
        if (!k || id === BOT_ID) return;
        k.active = false;
        if (ended) return;
        if (id === cur) { clearTurnTimers(); phase = null; cur = null; nextTurn(); }
        else if (!humansLeft()) finish();
      },

      dispose() {},
    };
  },
};
