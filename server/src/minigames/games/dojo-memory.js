// Dojo Memory (server rules). Reference implementation of a minigame module.
// Everyone watches the same sequence of glowing scrolls, then repeats it.
// A wrong scroll or running out of time knocks you out. Each correct scroll is 1 point.
module.exports = {
  id: 'dojo-memory',
  name: 'Dojo Memory',
  description: 'Watch the scrolls glow, then repeat the sequence. One mistake and you are out.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#8e44ad',
  icon: '📜',
  tickRate: 0, // timer-driven, no per-frame tick needed

  // Tuning an admin can override later; read through ctx.settings.
  defaults: { scrolls: 6, startLength: 3, maxRounds: 12, showMs: 600, gapMs: 220, inputMsPerStep: 1100, inputGraceMs: 1500 },

  // Base rewards per player; the engine applies the admin multiplier and the per-match cap.
  rewards(result, { players }) {
    const winBonus = result.place === 1 && players > 1 ? 10 : 0;
    return { coins: result.score * 2 + winBonus, xp: result.score + winBonus };
  },

  create(ctx) {
    const s = ctx.settings;
    const sequence = [];
    const scores = new Map(ctx.players.map((p) => [p.id, 0]));
    const alive = new Set(ctx.players.map((p) => p.id));
    let progress = new Map();
    let round = 0;
    let phase = 'watch';
    let inputTimer = null;

    function nextRound() {
      if (alive.size === 0 || round >= s.maxRounds) return finish();
      round++;
      const add = round === 1 ? s.startLength : 1;
      for (let i = 0; i < add; i++) sequence.push(ctx.randomInt(s.scrolls));
      phase = 'watch';
      progress = new Map([...alive].map((id) => [id, 0]));
      ctx.broadcast({ type: 'show', round, sequence, showMs: s.showMs, gapMs: s.gapMs, alive: [...alive], scores: Object.fromEntries(scores) });
      const watchMs = sequence.length * (s.showMs + s.gapMs) + 500;
      ctx.after(watchMs, () => {
        phase = 'input';
        const ms = sequence.length * s.inputMsPerStep + s.inputGraceMs;
        ctx.broadcast({ type: 'input', round, ms });
        inputTimer = ctx.after(ms, timeUp);
      });
    }

    function doneCount() { return [...alive].filter((id) => progress.get(id) >= sequence.length).length; }

    function maybeEndRound() {
      if (phase !== 'input') return;
      if (alive.size === 0 || doneCount() === alive.size) {
        phase = 'between';
        ctx.cancel(inputTimer);
        ctx.after(900, nextRound);
      }
    }

    function knockOut(id, reason) {
      alive.delete(id);
      ctx.broadcast({ type: 'out', id, reason, scores: Object.fromEntries(scores) });
    }

    function timeUp() {
      for (const id of [...alive]) if (progress.get(id) < sequence.length) knockOut(id, 'time');
      maybeEndRound();
    }

    function finish() {
      ctx.end(ctx.players.map((p) => ({ id: p.id, score: scores.get(p.id), detail: { rounds: round } })));
    }

    return {
      start() {
        ctx.broadcast({ type: 'setup', scrolls: s.scrolls });
        ctx.after(600, nextRound);
      },
      input(id, msg) {
        if (phase !== 'input' || !alive.has(id) || msg.type !== 'tap') return;
        const at = progress.get(id);
        if (at >= sequence.length) return;
        if (Number(msg.scroll) === sequence[at]) {
          progress.set(id, at + 1);
          scores.set(id, scores.get(id) + 1);
          ctx.send(id, { type: 'ok', step: at + 1, of: sequence.length });
          if (at + 1 === sequence.length) ctx.broadcast({ type: 'cleared', id, scores: Object.fromEntries(scores) });
        } else {
          ctx.send(id, { type: 'wrong', expected: sequence[at] });
          knockOut(id, 'wrong');
        }
        maybeEndRound();
      },
      leave(id) {
        alive.delete(id);
        maybeEndRound();
      },
    };
  },
};
