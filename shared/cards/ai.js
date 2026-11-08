// The House regulars. They only look at what a player could see: the board and their own hand.
// level 0: takes the best-looking move, with plenty of mistakes.
// level 1: also weighs exposed sides and saves Ki Burst for a big moment.
// level 2: as level 1, then checks the worst reply an average card could make.
(function (root) {
  const node = typeof module !== 'undefined' && module.exports;
  const R = node ? require('./rules') : root.ClubDojoCardRules;
  const Data = node ? require('./data') : root.ClubDojoCardData;
  const { getCard, PHANTOM } = Data;

  function evaluate(s, me, level) {
    const opp = R.other(me);
    const r = R.score(s);
    let v = (r[me] - r[opp]) * 10;
    if (s.mode === 'turncoat') v += (s.p[me].flips - s.p[opp].flips) * 0.5;
    if (level === 0) return v;
    s.cells.forEach((c, i) => {
      if (!c.card) return;
      const mine = c.card.owner === me;
      let risk = 0;
      for (let d = 0; d < 4; d++) {
        const n = R.neighbour(s, i, d);
        const outside = n < 0 || s.cells[n].t === 'pit';
        const def = R.defendValue(s, i, c.card, d);
        if (s.mode === 'turncoat') {
          if (n >= 0 && R.openCell(s.cells[n])) risk += Math.max(0, 5 - def) * 0.45; // open square: it can be attacked from here
        } else {
          const back = R.neighbour(s, i, (d + 2) % 4);
          const opposite = back < 0 || s.cells[back].t === 'pit';
          if (outside && !opposite && back >= 0 && R.openCell(s.cells[back])) risk += Math.max(0, 6 - R.defendValue(s, i, c.card, (d + 2) % 4)) * 0.8; // a shove from behind drops it off
        }
      }
      if (c.card.ward) risk *= 0.5;
      v += mine ? -risk : risk;
      if (s.mode === 'ring-out' && c.t === 'shrine') v += mine ? 2 : -2;
    });
    return v;
  }

  // Replies with an average card on every empty square, and returns the position that hurts most.
  function worstReply(s, me) {
    const opp = R.other(me);
    const open = [];
    s.cells.forEach((c, i) => { if (R.openCell(c)) open.push(i); });
    if (!open.length) return evaluate(s, me, 2);
    let worst = Infinity;
    for (const cell of open) {
      const t = JSON.parse(JSON.stringify(s));
      t.turn = opp;
      t.p[opp].hand = [{ uid: -1, id: PHANTOM.id }];
      worst = Math.min(worst, evaluate(R.applyMove(t, { uid: -1, cell }, { preview: true }).state, me, 2));
    }
    return worst;
  }

  function choose(state, { level = 1, rng = Math.random } = {}) {
    const me = state.turn;
    const moves = R.legalMoves(state);
    if (!moves.length) return null;
    const noise = [5, 0.6, 0.1][level];
    const remaining = state.p[me].hand.length + (state.p[me].deck ? state.p[me].deck.length : state.p[me].deckCount || 0);
    const ranked = [];
    for (const m of moves) {
      for (const burst of state.p[me].burst && level > 0 ? [false, true] : [false]) {
        const after = R.applyMove(state, { ...m, burst }, { preview: true }).state;
        let v = evaluate(after, me, level) + rng() * noise;
        // Holding Ki Burst has value until the last few cards.
        if (burst) v -= remaining > 3 ? 12 : 1;
        ranked.push({ m: { ...m, burst }, v, after });
      }
    }
    ranked.sort((a, b) => b.v - a.v);
    if (level < 2) return ranked[0].m;
    let best = ranked[0], bestV = -Infinity;
    for (const r of ranked.slice(0, 10)) {
      const reply = worstReply(r.after, me) + rng() * noise + (r.m.burst && remaining > 3 ? -12 : 0);
      if (reply > bestV) { bestV = reply; best = r; }
    }
    return best.m;
  }

  const api = { choose, evaluate };
  if (node) module.exports = api;
  else root.ClubDojoCardAI = api;
})(typeof window !== 'undefined' ? window : globalThis);
