// Soccer (server rules): penalty shootout. Each player takes five penalties against their own
// keeper. Pick a side (left, centre or right) and kick. The keeper dives at random, so guessing
// the wrong side is far more likely to score. Everyone shoots at the same time.
// Score: goals. Guide: docs/minigames/README.md
const KICKS = 5;
const ZONES = 3;           // 0 = left, 1 = centre, 2 = right

module.exports = {
  id: 'soccer',
  name: 'Soccer',
  description: 'Penalty shootout. Pick a side, kick, and beat the keeper. Five kicks each.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#3fa34d',
  icon: '⚽',
  tickRate: 0,

  defaults: { kicks: KICKS, roundMs: 90000, cooldownMs: 1200, goalIfWrongDive: 85, goalIfRightDive: 20 },

  create(ctx) {
    const s = ctx.settings;
    const shooters = new Map();
    ctx.players.forEach((p) => shooters.set(p.id, { id: p.id, aim: 1, kicks: 0, goals: 0, readyAt: 0, active: true }));
    let ended = false;
    let timeTimer = null;

    const allDone = () => [...shooters.values()].every((k) => !k.active || k.kicks >= s.kicks);

    function finish() {
      if (ended) return;
      ended = true;
      ctx.cancel(timeTimer);
      ctx.end(ctx.players.map((p) => ({ id: p.id, score: shooters.get(p.id).goals })));
    }

    return {
      start() {
        ctx.broadcast({ type: 'begin', roundMs: s.roundMs, kicks: s.kicks, zones: ZONES });
        timeTimer = ctx.after(s.roundMs, finish);
      },

      input(id, msg) {
        const k = shooters.get(id);
        if (!k || !k.active || ended) return;
        if (msg.type === 'aim') {
          const zone = Number(msg.zone);
          if (Number.isInteger(zone) && zone >= 0 && zone < ZONES) k.aim = zone;
        } else if (msg.type === 'kick') {
          const now = ctx.now();
          if (k.kicks >= s.kicks || now < k.readyAt) return;
          k.kicks++;
          k.readyAt = now + s.cooldownMs;
          const dive = ctx.randomInt(ZONES);
          // A keeper who guesses the side saves most shots; a wrong guess still lets some in.
          const odds = k.aim === dive ? s.goalIfRightDive : s.goalIfWrongDive;
          const goal = ctx.randomInt(100) < odds;
          if (goal) k.goals++;
          ctx.broadcast({ type: 'kick', id, aim: k.aim, dive, goal, n: k.kicks, score: k.goals });
          if (allDone()) finish();
        }
      },

      leave(id) {
        const k = shooters.get(id);
        if (!k) return;
        k.active = false;
        if (!ended && allDone()) finish();
      },

      dispose() {},
    };
  },
};
