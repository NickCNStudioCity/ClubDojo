// Football (server rules): field goals, taken in turns. On your turn, set the distance with up and
// down, press kick to start the aim meter, and press again to lock it. Aim into the wind: the wind
// pushes the ball sideways, and the green zone on the meter shows where to lock it. Longer kicks
// are worth more; a made kick straight after another made kick adds a streak bonus. Solo plays
// against a bot. Guide: docs/minigames/README.md
const BOT_ID = '__bot';
const ATTEMPTS = 5;
const MIN_YD = 20;
const MAX_YD = 60;
const STEP_YD = 5;
const SWEEP_YD = 12;       // the meter sweeps this far to either side of the centre
const PERIOD = 1.4;        // seconds for one sweep of the meter
const WIND_YD = 1.2;       // yards the ball drifts per unit of wind (wind is -3..3)

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

// Meter position 0..1 for a given time (triangle wave).
function meterAt(start, now) {
  const u = (((now - start) / 1000) / PERIOD) % 1;
  const t = u < 0 ? u + 1 : u;
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

// Half the width of the uprights, in yards of error. Longer kicks have a narrower window.
function halfWidth(dist) {
  return Math.max(1.2, 4 - (dist - MIN_YD) * 0.05);
}

module.exports = {
  id: 'football',
  name: 'Football',
  description: 'Field goals in turns. Set the distance, aim into the wind, and split the uprights. Solo vs a bot, or up to four players taking turns.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#8b5a2b',
  icon: '🏈',
  tickRate: 0,

  defaults: { roundMs: 180000, turnMs: 15000, botDelayMs: 1500 },

  create(ctx) {
    const s = ctx.settings;
    const solo = ctx.players.length === 1;
    const order = ctx.players.map((p) => p.id);
    if (solo) order.push(BOT_ID);
    const names = new Map(ctx.players.map((p) => [p.id, p.name]));
    names.set(BOT_ID, 'Bot');
    const kickers = new Map(order.map((id) => [id, { id, dist: 35, attempts: 0, points: 0, streak: 0, active: true }]));

    let ended = false;
    let timeTimer = null;
    let turnTimer = null;
    let botTimer = null;
    let turnIdx = -1;
    let cur = null;      // id of the kicker whose turn it is
    let wind = 0;        // -3..3, positive pushes the ball right
    let meter = null;    // { start } while the current kicker's aim meter runs

    function finish() {
      if (ended) return;
      ended = true;
      ctx.cancel(timeTimer);
      ctx.cancel(turnTimer);
      ctx.cancel(botTimer);
      ctx.end(ctx.players.map((p) => ({ id: p.id, score: kickers.get(p.id).points })));
    }

    // Humans who are still in the round and have kicks left.
    const liveHumans = () => order.filter((id) => id !== BOT_ID && ctx.isPlaying(id) && kickers.get(id).active && kickers.get(id).attempts < ATTEMPTS);

    function nextTurn() {
      if (ended) return;
      if (!liveHumans().length) return finish();
      // Move to the next kicker (in seat order) who still has kicks left.
      for (let n = 0; n < order.length; n++) {
        turnIdx = (turnIdx + 1) % order.length;
        const k = kickers.get(order[turnIdx]);
        if (k.active && k.attempts < ATTEMPTS && (order[turnIdx] === BOT_ID || ctx.isPlaying(order[turnIdx]))) {
          cur = order[turnIdx];
          break;
        }
      }
      const k = kickers.get(cur);
      meter = null;
      wind = ctx.randomInt(7) - 3;
      ctx.cancel(turnTimer);
      ctx.cancel(botTimer);
      ctx.broadcast({ type: 'turn', id: cur, name: names.get(cur), wind, n: k.attempts + 1, of: ATTEMPTS, dist: k.dist, ms: s.turnMs });
      turnTimer = ctx.after(s.turnMs, () => resolve(null));   // out of time: a miss
      if (cur === BOT_ID) botTimer = ctx.after(s.botDelayMs, botKick);
    }

    // aim: meter position in yards from the centre, or null for a timed-out kick.
    function resolve(aim) {
      if (ended || cur === null) return;
      const k = kickers.get(cur);
      ctx.cancel(turnTimer);
      ctx.cancel(botTimer);
      meter = null;
      let landing = null;
      let made = false;
      let points = 0;
      if (aim !== null) {
        landing = aim + wind * WIND_YD + (ctx.randomInt(11) - 5) / 10;   // a little wobble
        made = Math.abs(landing) <= halfWidth(k.dist);
        if (made) {
          points = k.dist >= 50 ? 5 : 3;
          if (k.streak > 0) points += 1;   // streak bonus
          k.streak++;
        } else {
          k.streak = 0;
        }
        k.points += points;
      } else {
        k.streak = 0;
      }
      k.attempts++;
      ctx.broadcast({
        type: 'attempt', id: cur, dist: k.dist, wind,
        error: landing === null ? null : round1(landing), made, points, n: k.attempts, score: k.points, timedOut: aim === null,
      });
      nextTurn();
    }

    function botKick() {
      if (ended || cur !== BOT_ID) return;
      const k = kickers.get(BOT_ID);
      // The bot picks a distance it can usually make, then aims into the wind with some spread.
      k.dist = MIN_YD + ctx.randomInt(5) * STEP_YD + (ctx.randomInt(2) ? 5 : 0);
      k.dist = clamp(k.dist, MIN_YD, MAX_YD);
      ctx.broadcast({ type: 'dist', id: BOT_ID, dist: k.dist });
      const aim = -wind * WIND_YD + (ctx.randomInt(9) - 4) * 1.1;
      resolve(clamp(aim, -SWEEP_YD, SWEEP_YD));
    }

    return {
      start() {
        ctx.broadcast({
          type: 'begin', roundMs: s.roundMs, attempts: ATTEMPTS, period: PERIOD, sweep: SWEEP_YD,
          roster: order.map((id) => ({ id, name: names.get(id), bot: id === BOT_ID })),
        });
        timeTimer = ctx.after(s.roundMs, finish);
        nextTurn();
      },

      input(id, msg) {
        if (ended || id !== cur || id === BOT_ID) return;
        const k = kickers.get(id);
        if (!k || !k.active || k.attempts >= ATTEMPTS) return;
        const now = ctx.now();
        if (msg.type === 'dist' && !meter) {
          k.dist = clamp(k.dist + (Number(msg.step) > 0 ? STEP_YD : -STEP_YD), MIN_YD, MAX_YD);
          ctx.broadcast({ type: 'dist', id, dist: k.dist });
        } else if (msg.type === 'kick' && !meter) {
          meter = { start: now };
          ctx.broadcast({ type: 'meter', id, start: now, t: now, period: PERIOD });
        } else if (msg.type === 'lock' && meter) {
          const phase = meterAt(meter.start, now);
          resolve((phase - 0.5) * 2 * SWEEP_YD);
        }
      },

      leave(id) {
        const k = kickers.get(id);
        if (!k || id === BOT_ID) return;
        k.active = false;
        if (ended) return;
        if (id === cur) nextTurn();
        else if (!liveHumans().length) finish();
      },

      dispose() {},
    };
  },
};
