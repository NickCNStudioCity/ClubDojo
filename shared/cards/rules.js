// Rules for both card games. Pure functions and no DOM, so the server, the client's move preview,
// the AI and the balance checks all run the same code.
//
// A move places one card from your hand on an empty square; the card then attacks all four
// neighbours. The two games differ only in what winning an attack does:
//   Turncoat: the enemy card changes sides. Most cards owned at the end wins.
//   Ring Out: the enemy card is shoved a square, taking the line behind it along. Cards pushed off
//             the mat or into a pit are knocked out. Shrines held plus knockouts wins.
(function (root) {
  const Data = typeof module !== 'undefined' && module.exports ? require('./data') : root.ClubDojoCardData;
  const { ELEMENTS, ELEMENT_LETTER, DECK, getCard, boardById } = Data;

  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // n e s w, the same order as card.sides
  const DIR_NAMES = ['n', 'e', 's', 'w'];
  const SHRINE_POINTS = { turncoat: 1, 'ring-out': 2 };
  const other = (p) => (p === 1 ? 2 : 1);
  const clone = (s) => JSON.parse(JSON.stringify(s));

  function shuffle(list, rng) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function createMatch({ mode, boardId, decks, first = 1, rng = Math.random }) {
    const board = boardById(boardId);
    if (!board || board.mode !== mode) throw new Error(`Board ${boardId} is not a ${mode} board.`);
    const h = board.rows.length, w = board.rows[0].length;
    const cells = [];
    for (const row of board.rows) for (const ch of row) {
      if (ch === '#') cells.push({ t: 'rock' });
      else if (ch === 'v') cells.push({ t: 'pit' });
      else if (ch === '*') cells.push({ t: 'shrine', card: null });
      else if (ELEMENT_LETTER[ch]) cells.push({ t: 'element', el: ELEMENT_LETTER[ch], card: null });
      else cells.push({ t: 'open', card: null });
    }
    const s = { mode, boardId, w, h, cells, komi: board.komi || 0, first, turn: first, over: false, moves: 0, nextUid: 1, p: {} };
    for (const n of [1, 2]) {
      s.p[n] = { deck: shuffle(decks[n], rng), hand: [], burst: true, flips: 0, ko: 0 };
      draw(s, n);
    }
    return s;
  }

  function draw(s, n) {
    const p = s.p[n];
    while (p.hand.length < DECK.handSize && p.deck.length) p.hand.push({ uid: s.nextUid++, id: p.deck.pop() });
  }

  const neighbour = (s, i, d) => {
    const x = i % s.w, y = Math.floor(i / s.w), nx = x + DIRS[d][0], ny = y + DIRS[d][1];
    return nx < 0 || ny < 0 || nx >= s.w || ny >= s.h ? -1 : ny * s.w + nx;
  };
  const openCell = (c) => c.t !== 'rock' && c.t !== 'pit' && !c.card;

  function hasAlly(s, i, card, sameElement) {
    for (let d = 0; d < 4; d++) {
      const n = neighbour(s, i, d);
      const o = n >= 0 ? s.cells[n].card : null;
      if (o && o.owner === card.owner && (!sameElement || getCard(o.id).element === getCard(card.id).element)) return true;
    }
    return false;
  }

  // A card's side after rotation, tile and permanent bonuses. Attack and defence add their own on top.
  function sideValue(s, i, card, d) {
    const def = getCard(card.id);
    const cell = s.cells[i];
    let v = def.sides[(d - (card.rot || 0) + 8) % 4] + (card.boost || 0);
    if (cell.t === 'element' && cell.el === def.element) v += 1;
    if (def.tech === 'bond' && hasAlly(s, i, card, true)) v += 1;
    return v;
  }
  function attackValue(s, i, card, d, target) {
    const def = getCard(card.id);
    let v = sideValue(s, i, card, d);
    if (def.tech === 'strike') v += 1;
    if (def.tech === 'lone' && !hasAlly(s, i, card, false)) v += 2;
    const beats = def.element && ELEMENTS[def.element].beats;
    if (beats && getCard(target.id).element === beats) v += 1;
    return v;
  }
  function defendValue(s, i, card, d) {
    return sideValue(s, i, card, d) + (getCard(card.id).tech === 'guard' ? 1 : 0);
  }

  function legalMoves(s, player = s.turn) {
    if (s.over || !s.p[player].hand) return [];
    const out = [];
    s.cells.forEach((c, i) => { if (openCell(c)) for (const h of s.p[player].hand) out.push({ uid: h.uid, cell: i }); });
    return out;
  }

  // Plays a move and returns { state, events }; the input state is left alone. events is the script
  // the client animates. With { preview: true } nothing is drawn and the turn is not passed, so it
  // also works on a player's view, where the opponent's hand and both decks are hidden.
  function applyMove(state, move, { preview = false } = {}) {
    const s = clone(state);
    const me = s.turn;
    const hand = s.p[me].hand;
    const at = hand.findIndex((h) => h.uid === move.uid);
    if (at < 0) throw new Error('That card is not in your hand.');
    const cell = s.cells[move.cell];
    if (!cell || !openCell(cell)) throw new Error('You cannot play there.');
    const burst = !!move.burst;
    if (burst && !s.p[me].burst) throw new Error('Ki Burst is already spent.');

    const [picked] = hand.splice(at, 1);
    const card = { uid: picked.uid, id: picked.id, owner: me, rot: 0, boost: burst ? 1 : 0 };
    if (burst) { s.p[me].burst = false; card.burst = true; }
    if (getCard(card.id).tech === 'smoke') card.ward = true;
    cell.card = card;
    const events = [{ type: 'place', cell: move.cell, card: { ...card }, player: me, burst }];

    onPlace(s, move.cell, card, events);
    if (s.mode === 'turncoat') resolveFlips(s, move.cell, events);
    else resolveShoves(s, move.cell, events);

    s.moves += 1;
    if (!preview) {
      draw(s, me);
      pass(s, events);
    }
    return { state: s, events };
  }

  function onPlace(s, at, card, events) {
    const tech = getCard(card.id).tech;
    if (tech !== 'whirl' && tech !== 'rally') return;
    for (let d = 0; d < 4; d++) {
      const n = neighbour(s, at, d);
      const o = n >= 0 ? s.cells[n].card : null;
      if (!o) continue;
      if (tech === 'whirl' && o.owner !== card.owner) { o.rot = ((o.rot || 0) + 1) % 4; events.push({ type: 'whirl', cell: n, rot: o.rot }); }
      if (tech === 'rally' && o.owner === card.owner) { o.boost = (o.boost || 0) + 1; events.push({ type: 'rally', cell: n, boost: o.boost }); }
    }
  }

  function resolveFlips(s, from, events) {
    const chain = getCard(s.cells[from].card.id).tech === 'chain';
    const queue = [{ at: from, depth: 0 }];
    while (queue.length) {
      const { at, depth } = queue.shift();
      const src = s.cells[at].card;
      for (let d = 0; d < 4; d++) {
        const n = neighbour(s, at, d);
        const t = n >= 0 ? s.cells[n].card : null;
        if (!t || t.owner === src.owner) continue;
        const opp = (d + 2) % 4;
        const atk = attackValue(s, at, src, d, t), def = defendValue(s, n, t, opp);
        if (atk <= def) { if (depth === 0) events.push({ type: 'hold', from: at, cell: n, atk, def, dir: DIR_NAMES[d] }); continue; }
        if (t.ward) { t.ward = false; events.push({ type: 'ward', from: at, cell: n, atk, def, dir: DIR_NAMES[d] }); continue; }
        t.owner = src.owner;
        s.p[src.owner].flips += 1;
        events.push({ type: 'flip', from: at, cell: n, owner: src.owner, atk, def, depth, dir: DIR_NAMES[d] });
        if (chain) queue.push({ at: n, depth: depth + 1 });
      }
    }
  }

  // The cards in a straight line starting at head, and what lies beyond the last of them.
  function lineFrom(s, head, d) {
    const line = [];
    let i = head;
    while (i >= 0 && s.cells[i].card) { line.push(i); i = neighbour(s, i, d); }
    if (i < 0) return { line, end: 'edge', past: -1 };
    if (s.cells[i].t === 'pit') return { line, end: 'pit', past: i };
    if (s.cells[i].t === 'rock') return { line, end: 'rock', past: i };
    return { line, end: 'open', past: i };
  }

  function resolveShoves(s, from, events) {
    const src = s.cells[from].card;
    const steps = getCard(src.id).tech === 'chain' ? 2 : 1;
    for (let d = 0; d < 4; d++) {
      const n = neighbour(s, from, d);
      const t = n >= 0 ? s.cells[n].card : null;
      if (!t || t.owner === src.owner) continue;
      const first = lineFrom(s, n, d);
      const opp = (d + 2) % 4;
      const atk = attackValue(s, from, src, d, t);
      // Every card behind the first makes the line one heavier.
      const def = defendValue(s, n, t, opp) + (first.line.length - 1);
      if (first.end === 'rock') { events.push({ type: 'blocked', from, cell: n, atk, def, dir: DIR_NAMES[d] }); continue; }
      if (atk <= def) { events.push({ type: 'hold', from, cell: n, atk, def, dir: DIR_NAMES[d] }); continue; }
      if (t.ward) { t.ward = false; events.push({ type: 'ward', from, cell: n, atk, def, dir: DIR_NAMES[d] }); continue; }
      let head = n;
      for (let step = 0; step < steps; step++) {
        const moved = moveLine(s, head, d, src.owner, events, atk, def);
        if (moved < 0) break;
        head = moved;
      }
    }
  }

  // Moves the line starting at head one square. Returns where the head ended up, or -1 if it stopped.
  function moveLine(s, head, d, by, events, atk, def) {
    const { line, end, past } = lineFrom(s, head, d);
    if (end === 'rock' || !line.length) return -1;
    const moves = [];
    let kept = line;
    if (end === 'edge' || end === 'pit') {
      const lastAt = line[line.length - 1];
      const last = s.cells[lastAt].card;
      if (last.ward) { last.ward = false; events.push({ type: 'ward', from: head, cell: lastAt, atk, def, dir: DIR_NAMES[d] }); return -1; }
      s.cells[lastAt].card = null;
      s.p[other(last.owner)].ko += 1;
      events.push({ type: 'ko', cell: lastAt, card: last, into: end, by, dir: DIR_NAMES[d], scorer: other(last.owner) });
      kept = line.slice(0, -1);
    }
    for (let i = kept.length - 1; i >= 0; i--) {
      const fromCell = kept[i], to = neighbour(s, fromCell, d);
      s.cells[to].card = s.cells[fromCell].card;
      s.cells[fromCell].card = null;
      moves.push({ from: fromCell, to });
    }
    if (moves.length) events.push({ type: 'shove', moves, dir: DIR_NAMES[d], atk, def, by });
    return kept.length ? neighbour(s, head, d) : -1;
  }

  function pass(s, events) {
    const full = !s.cells.some(openCell);
    const empty = (n) => !s.p[n].hand.length;
    if (full || (empty(1) && empty(2))) { s.over = true; events.push({ type: 'over' }); return; }
    const next = other(s.turn);
    if (!empty(next)) s.turn = next;
    // Otherwise the next player is out of cards and the current player goes again.
  }

  function score(s) {
    const out = { 1: 0, 2: 0, cards: { 1: 0, 2: 0 }, shrines: { 1: 0, 2: 0 }, ko: { 1: s.p[1].ko, 2: s.p[2].ko } };
    for (const c of s.cells) {
      if (!c.card) continue;
      out.cards[c.card.owner] += 1;
      if (c.t === 'shrine') out.shrines[c.card.owner] += 1;
    }
    const shrine = SHRINE_POINTS[s.mode];
    for (const n of [1, 2]) {
      out[n] = s.mode === 'turncoat' ? out.cards[n] + out.shrines[n] * shrine : out.shrines[n] * shrine + out.ko[n];
    }
    if (s.komi) out[s.komi > 0 ? other(s.first) : s.first] += Math.abs(s.komi);
    return out;
  }

  // 1 or 2, or 0 for a true draw. Ties go to whoever did more: flips in Turncoat, cards left on the mat in Ring Out.
  function winner(s) {
    const r = score(s);
    if (r[1] !== r[2]) return r[1] > r[2] ? 1 : 2;
    const a = s.mode === 'turncoat' ? s.p[1].flips : r.cards[1];
    const b = s.mode === 'turncoat' ? s.p[2].flips : r.cards[2];
    return a === b ? 0 : a > b ? 1 : 2;
  }

  // What one player may see: their own hand, and only counts for everything hidden.
  function viewFor(s, me) {
    const v = clone(s);
    for (const n of [1, 2]) {
      const p = v.p[n];
      p.deckCount = p.deck.length;
      delete p.deck;
      p.handCount = p.hand.length;
      if (n !== me) delete p.hand;
    }
    delete v.nextUid;
    return v;
  }

  const api = { createMatch, legalMoves, applyMove, score, winner, viewFor, attackValue, defendValue, sideValue, neighbour, openCell, other, shuffle, DIR_NAMES, SHRINE_POINTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ClubDojoCardRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
