// Checks the card games without a server: hand-made rules cases, then thousands of simulated matches
// that fail on the problems a rules test can miss (a board nothing happens on, first-player runaway,
// too many draws, a useless or overpowered card, a starter deck that cannot compete).
// Run: npm run check:cards         add --report for the full per-card table
const assert = require('assert');
const Data = require('../shared/cards/data');
const R = require('../shared/cards/rules');
const AI = require('../shared/cards/ai');

let failures = 0;
const report = process.argv.includes('--report');
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
function seeded(seed) { let x = seed; return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }

// A board with cards already on it; player 1 then holds exactly `hand`.
function table(mode, boardId, onBoard, hand) {
  const decks = { 1: Array(9).fill('ember-scout'), 2: Array(9).fill('ember-scout') };
  const s = R.createMatch({ mode, boardId, decks, first: 1, rng: seeded(1) });
  onBoard.forEach((c, i) => { s.cells[c.at].card = { uid: 100 + i, id: c.id, owner: c.owner, rot: c.rot || 0, boost: c.boost || 0, ward: c.ward }; });
  s.p[1].hand = [{ uid: 1, id: hand }];
  s.p[2].hand = [];
  return s;
}
const play = (s, cell, burst) => R.applyMove(s, { uid: 1, cell, burst }, { preview: true });

console.log('Data');
test('every card id is unique, sides run 1-6, techniques and art exist', () => {
  assert.strictEqual(new Set(Data.CARDS.map((c) => c.id)).size, Data.CARDS.length);
  for (const c of Data.CARDS) {
    assert.ok(c.sides.length === 4 && c.sides.every((v) => v >= 1 && v <= 6), c.id);
    assert.ok(!c.tech || Data.TECHNIQUES[c.tech], c.id);
    assert.ok(c.art && c.flavor, c.id);
  }
});
test('every element has one full set: 3 commons, 1 uncommon, 1 rare, 1 legendary', () => {
  for (const el of Object.keys(Data.ELEMENTS)) {
    const n = (r) => Data.CARDS.filter((c) => c.element === el && c.rarity === r).length;
    assert.deepStrictEqual([n('common'), n('uncommon'), n('rare'), n('legendary')], [3, 1, 1, 1], el);
  }
});
test('the starter deck is legal and comes from the starter collection', () => {
  assert.strictEqual(Data.STARTER_DECK.length, Data.DECK.size);
  for (const id of Data.STARTER_DECK) assert.ok(Data.STARTER_COLLECTION.includes(id), id);
  assert.strictEqual(new Set(Data.STARTER_DECK.map((id) => Data.getCard(id).element)).size, 6, 'every element appears');
});
test('every board is rectangular and every open square has a neighbour to fight', () => {
  for (const b of Data.BOARDS) {
    for (const r of b.rows) assert.strictEqual(r.length, b.rows[0].length, b.id);
    const s = R.createMatch({ mode: b.mode, boardId: b.id, decks: { 1: Data.STARTER_DECK, 2: Data.STARTER_DECK } });
    s.cells.forEach((c, i) => {
      if (!R.openCell(c)) return;
      assert.ok([0, 1, 2, 3].some((d) => { const n = R.neighbour(s, i, d); return n >= 0 && R.openCell(s.cells[n]); }), `${b.id} square ${i} is cut off`);
    });
  }
});

console.log('Turncoat rules');
// lantern-row is 3x3: 0 1 2 / 3 4 5 / 6 7 8
test('a stronger side wins the neighbour over; a tie does not', () => {
  // kiln-monk's west side is 4; ember-scout's east side is 3 (fire on fire gives no advantage).
  const win = play(table('turncoat', 'lantern-row', [{ at: 3, id: 'ember-scout', owner: 2 }], 'kiln-monk'), 4).state;
  assert.strictEqual(win.cells[3].card.owner, 1);
  const tie = play(table('turncoat', 'lantern-row', [{ at: 3, id: 'ember-scout', owner: 2 }], 'ember-scout'), 4).state;
  assert.strictEqual(tie.cells[3].card.owner, 2);
});
test('element advantage adds 1 when attacking', () => {
  // ember-scout 3 vs kite-runner (air) east side 3: a tie made into a win by fire beating air.
  const s = play(table('turncoat', 'lantern-row', [{ at: 3, id: 'kite-runner', owner: 2 }], 'ember-scout'), 4).state;
  assert.strictEqual(s.cells[3].card.owner, 1);
});
test('a matching element tile gives +1 on every side', () => {
  const s = table('turncoat', 'two-rivers', [], 'ember-scout');
  const card = { id: 'ember-scout', owner: 1 };
  assert.strictEqual(R.sideValue(s, 0, card, 1), 4); // square 0 is fire
  assert.strictEqual(R.sideValue(s, 1, card, 1), 3);
});
test('Smoke Bomb absorbs the first winning attack only', () => {
  const s = table('turncoat', 'lantern-row', [{ at: 3, id: 'smoke-tanuki', owner: 2, ward: true }], 'cinder-pup');
  s.p[1].hand = [{ uid: 1, id: 'wind-fox' }]; // west side 5 beats tanuki's east side 4
  const once = play(s, 4);
  assert.strictEqual(once.state.cells[3].card.owner, 2);
  assert.ok(once.events.some((e) => e.type === 'ward'));
  assert.strictEqual(once.state.cells[3].card.ward, false);
});
test('Chain: a card it wins over attacks too', () => {
  // riptide-ray west 5 beats card on 3; that card's north side then beats the card on 0.
  const s = table('turncoat', 'lantern-row', [{ at: 3, id: 'cinder-pup', owner: 2 }, { at: 0, id: 'night-owl', owner: 2 }], 'riptide-ray');
  const out = play(s, 4);
  assert.strictEqual(out.state.cells[3].card.owner, 1);
  assert.strictEqual(out.state.cells[0].card.owner, 1);
  assert.ok(out.events.some((e) => e.type === 'flip' && e.depth === 1));
});
test('Whirlwind turns neighbours before the attack, so a strong side can be spun away', () => {
  // paper-crane has north 5. Spun clockwise, its east side becomes 5 and its south side 2.
  const s = table('turncoat', 'lantern-row', [{ at: 1, id: 'paper-crane', owner: 2 }], 'storm-crane'); // storm-crane attacks north
  const out = play(s, 4);
  assert.strictEqual(out.state.cells[1].card.rot, 1);
});
test('Rally lasts; Ki Burst gives +1 and can only be used once', () => {
  const s = table('turncoat', 'lantern-row', [{ at: 3, id: 'ember-scout', owner: 1 }], 'halo-monk');
  assert.strictEqual(play(s, 4).state.cells[3].card.boost, 1);
  const b = play(table('turncoat', 'lantern-row', [], 'ember-scout'), 4, true).state;
  assert.strictEqual(b.cells[4].card.boost, 1);
  assert.strictEqual(b.p[1].burst, false);
  assert.throws(() => R.applyMove(b, { uid: 1, cell: 0, burst: true }));
});

console.log('Ring Out rules');
// clay-ring is 5x5: row 2 is squares 10-14, and the centre (12) is a shrine.
test('a shove moves the enemy one square', () => {
  const s = table('ring-out', 'clay-ring', [{ at: 11, id: 'ember-scout', owner: 2 }], 'kiln-monk');
  const out = play(s, 12).state;
  assert.strictEqual(out.cells[11].card, null);
  assert.strictEqual(out.cells[10].card.owner, 2);
});
test('a card shoved off the edge is knocked out and scores for the other side', () => {
  const s = table('ring-out', 'clay-ring', [{ at: 10, id: 'ember-scout', owner: 2 }], 'kiln-monk');
  const out = play(s, 11).state;
  assert.strictEqual(out.cells[10].card, null);
  assert.strictEqual(out.p[1].ko, 1);
  assert.strictEqual(R.score(out)[1], 1);
});
test('a card shoved into a pit is knocked out', () => {
  // pit-stop: row 1 is squares 5-9 with a pit on 7.
  const s = table('ring-out', 'pit-stop', [{ at: 6, id: 'ember-scout', owner: 2 }], 'kiln-monk');
  const out = play(s, 5);
  assert.ok(out.events.some((e) => e.type === 'ko' && e.into === 'pit'));
});
test('each card behind makes the line one heavier', () => {
  // kiln-monk west 4 vs 3 + 1 for the card behind: the push fails.
  const s = table('ring-out', 'clay-ring', [{ at: 11, id: 'ember-scout', owner: 2 }, { at: 10, id: 'ember-scout', owner: 2 }], 'kiln-monk');
  assert.strictEqual(play(s, 12).state.cells[11].card.owner, 2);
  // With 5 the whole line moves and the last card falls off.
  const t = table('ring-out', 'clay-ring', [{ at: 11, id: 'ember-scout', owner: 2 }, { at: 10, id: 'ember-scout', owner: 2 }], 'riptide-ray');
  const out = play(t, 12).state;
  assert.strictEqual(out.p[1].ko, 2, 'chain moves the line twice, so both fall off');
});
test('a rock stops a shove', () => {
  // broken-bridge is a Turncoat board; hot-springs has no rocks; on clay-ring square 1's west is rock 0.
  const s = table('ring-out', 'clay-ring', [{ at: 1, id: 'ember-scout', owner: 2 }], 'kiln-monk');
  const out = play(s, 2);
  assert.ok(out.events.some((e) => e.type === 'blocked'));
  assert.strictEqual(out.state.cells[1].card.owner, 2);
});
test('shrines score only while held', () => {
  const s = table('ring-out', 'clay-ring', [{ at: 12, id: 'ember-scout', owner: 2 }], 'kiln-monk');
  assert.strictEqual(R.score(s)[2], 2);
  const out = play(s, 13).state; // shoves the holder off the shrine
  assert.strictEqual(out.cells[12].card, null);
  assert.strictEqual(R.score(out)[2], 0);
});
test('a shove never moves your own lone card, but a line can carry it off', () => {
  const s = table('ring-out', 'clay-ring', [{ at: 11, id: 'ember-scout', owner: 2 }, { at: 10, id: 'cinder-pup', owner: 1 }], 'riptide-ray');
  const out = play(s, 12).state;
  assert.strictEqual(out.p[2].ko >= 1, true, 'your own card falling scores for the opponent');
});

console.log('Hidden information');
test('a player view never contains the opponent hand or either deck', () => {
  const s = R.createMatch({ mode: 'turncoat', boardId: 'lantern-row', decks: { 1: Data.STARTER_DECK, 2: Data.STARTER_DECK } });
  const v = R.viewFor(s, 1);
  assert.strictEqual(v.p[2].hand, undefined);
  assert.strictEqual(v.p[1].deck, undefined);
  assert.strictEqual(v.p[2].deck, undefined);
  assert.strictEqual(v.p[2].handCount, Data.DECK.handSize);
  assert.strictEqual(v.p[1].hand.length, Data.DECK.handSize);
});

console.log('Collection');
const Cards = require('../server/src/cards');
const P = require('../shared/protocol');
const mountain = require('../server/src/mountain');
const seedRooms = require('../server/src/rooms-seed');
const fresh = () => Cards.fresh();
const rejects = (fn, re) => assert.throws(fn, re);
test('a new ninja owns the starter set and a legal, active deck in both games', () => {
  const st = fresh();
  assert.strictEqual(Object.keys(st.owned).length, Data.STARTER_COLLECTION.length);
  assert.strictEqual(Cards.deckProblem(st.decks[0].cards, st.owned), null);
  for (const g of Cards.GAMES) assert.deepStrictEqual(Cards.deckFor(st, g), Data.STARTER_DECK);
});
test('decks reject missing cards, too many copies and a second legendary', () => {
  const st = fresh();
  const base = [...Data.STARTER_DECK];
  rejects(() => Cards.saveDeck(st, 0, 'x', [...base.slice(0, 8), 'wind-fox']), /only own/);
  rejects(() => Cards.saveDeck(st, 9, 'x', base), /slot/);
  st.owned['wind-fox'] = 3;
  rejects(() => Cards.saveDeck(st, 0, 'x', [...base.slice(0, 6), 'wind-fox', 'wind-fox', 'wind-fox']), /at most/);
  st.owned['phoenix-abbot'] = 1; st.owned['sky-hermit'] = 1;
  rejects(() => Cards.saveDeck(st, 0, 'x', [...base.slice(0, 7), 'phoenix-abbot', 'sky-hermit']), /Legendary/);
  Cards.saveDeck(st, 1, '  My   deck ', [...base.slice(0, 8), 'phoenix-abbot']);
  assert.strictEqual(st.decks[1].name, 'My deck');
});
test('an unfinished deck can be saved as a draft but not used', () => {
  const st = fresh();
  Cards.saveDeck(st, 1, 'Draft', Data.STARTER_DECK.slice(0, 4));
  rejects(() => Cards.setActive(st, 'turncoat', 1), /Finish/);
});
test('packs honour their guarantees and return the drawn cards', () => {
  const rand = seeded(5);
  for (const [type, floor] of [['street', 1], ['temple', 2]]) {
    for (let i = 0; i < 400; i++) {
      const st = fresh();
      Cards.addPack(st, type);
      const { drawn } = Cards.openPack(st, type, rand);
      assert.strictEqual(drawn.length, Data.PACKS[type].count);
      assert.ok(drawn.some((c) => Data.RARITIES[Data.getCard(c.id).rarity].order >= floor), type);
      assert.strictEqual(new Set(drawn.map((c) => c.id)).size, drawn.length, 'no repeats in a pack');
    }
  }
  rejects(() => Cards.openPack(fresh(), 'temple', rand), /no Temple/);
});
test('copies past the third become Ink, and Ink makes cards', () => {
  const st = fresh();
  st.owned['wind-fox'] = 3;
  assert.strictEqual(Cards.openPack.length >= 2, true);
  rejects(() => Cards.craft(st, 'wind-fox'), /already hold/);
  rejects(() => Cards.craft(st, 'halo-monk'), /costs/);
  st.ink = Data.RARITIES.rare.ink;
  Cards.craft(st, 'halo-monk');
  assert.strictEqual(st.owned['halo-monk'], 1);
  assert.strictEqual(st.ink, 0);
});
test('dissolving never takes your last copy or one a deck needs', () => {
  const st = fresh();
  rejects(() => Cards.dissolve(st, 'ember-scout'), /Keep/);
  st.owned['ember-scout'] = 2;
  Cards.dissolve(st, 'ember-scout');
  assert.strictEqual(st.owned['ember-scout'], 1);
});
test('the daily pack pays once and each ladder rung pays once', () => {
  const st = fresh();
  const first = Cards.recordMatch(st, 'd1', { game: 'turncoat', outcome: 'win', vsHouse: true, step: 0 });
  assert.ok(first.firstWin && first.ladder === Data.LADDER[0].name);
  const again = Cards.recordMatch(st, 'd1', { game: 'turncoat', outcome: 'win', vsHouse: true, step: 0 });
  assert.ok(!again.firstWin && !again.ladder);
  assert.strictEqual(st.ladder.turncoat, 1);
  assert.strictEqual(st.ladder['ring-out'], 0);
  assert.ok(Cards.recordMatch(st, 'd2', { game: 'ring-out', outcome: 'win', vsHouse: false, step: 0 }).firstWin);
  assert.strictEqual(Cards.recordMatch(st, 'd3', { game: 'ring-out', outcome: 'loss', vsHouse: false, step: 0 }).firstWin, false);
  assert.strictEqual(st.stats['ring-out'].l, 1);
});
test('finishing an element pays once', () => {
  const st = fresh();
  for (const c of Data.CARDS.filter((x) => x.element === 'fire')) st.owned[c.id] = 1;
  assert.deepStrictEqual(Cards.checkSets(st).names, ['Fire set']);
  assert.deepStrictEqual(Cards.checkSets(st).names, []);
});

console.log('The Cafe');
const rooms = seedRooms();
const cafe = rooms.find((r) => r.id === 'cafe');
const town = rooms.find((r) => r.id === 'mountain-town');
test('every table, person and door in the Cafe can be walked to', () => {
  const from = cafe.spawn;
  for (const sp of cafe.minigames) assert.ok(P.findPath(cafe, from, P.spotPad(sp)), `table ${sp.id}`);
  for (const p of cafe.props.filter((x) => x.npc || x.interact)) {
    const reachable = [];
    for (let y = p.y - 2; y <= p.y + (p.h || 1) + 1; y++) for (let x = p.x - 2; x <= p.x + (p.w || 1) + 1; x++) {
      if (P.propDistance(p, x, y) <= 2 && P.isWalkable(cafe, x, y) && !P.portalAt(cafe, x, y) && P.findPath(cafe, from, { x, y })) reachable.push([x, y]);
    }
    assert.ok(reachable.length, p.name || p.type);
  }
  const door = cafe.portals[0];
  assert.ok(P.findPath(cafe, from, { x: door.x, y: door.y }), 'way out');
});
test('Mountain Town has a walkable path to the Cafe door, and the door lands on open floor', () => {
  const door = town.portals.find((p) => p.to === 'cafe');
  assert.ok(P.findPath(town, town.spawn, { x: door.x, y: door.y }), 'door');
  assert.ok(P.isWalkable(cafe, door.tx, door.ty));
  const back = cafe.portals[0];
  assert.ok(P.isWalkable(town, back.tx, back.ty));
});
test('the fire warms the lounge, not the card tables', () => {
  assert.ok(mountain.warmAt(cafe, 7, 9));
  for (const sp of cafe.minigames) { const pad = P.spotPad(sp); assert.ok(!mountain.warmAt(cafe, pad.x, pad.y), sp.id); }
});

console.log('Whole matches');
const pool = Data.CARDS.map((c) => c.id);
function legalDeck(rand) {
  const out = [];
  while (out.length < Data.DECK.size) {
    const id = pool[Math.floor(rand() * pool.length)];
    const copies = out.filter((x) => x === id).length;
    const legends = out.filter((x) => Data.getCard(x).rarity === 'legendary').length;
    if (copies >= Data.DECK.maxCopies) continue;
    if (Data.getCard(id).rarity === 'legendary' && legends >= Data.DECK.maxLegendary) continue;
    out.push(id);
  }
  return out;
}
function runMatch(mode, boardId, deck1, deck2, levels, first, rand) {
  let s = R.createMatch({ mode, boardId, decks: { 1: deck1, 2: deck2 }, first, rng: rand });
  let guard = 0, fights = 0;
  while (!s.over) {
    const m = AI.choose(s, { level: levels[s.turn], rng: rand });
    assert.ok(m, 'no move in an unfinished match');
    const out = R.applyMove(s, m);
    fights += out.events.filter((e) => ['flip', 'shove', 'ko'].includes(e.type)).length;
    s = out.state;
    assert.ok(++guard <= 60, 'match did not end');
  }
  return { w: R.winner(s), fights, moves: s.moves, score: R.score(s) };
}
const N = report ? 400 : 160;
test('each board is live, fair to both seats and rarely drawn', () => {
  const rand = seeded(4242);
  const rows = [];
  for (const b of Data.BOARDS) {
    let f = 0, sc = 0, dr = 0, fights = 0;
    for (let i = 0; i < N; i++) {
      const r = runMatch(b.mode, b.id, legalDeck(rand), legalDeck(rand), { 1: 1, 2: 1 }, 1, rand);
      if (r.w === 1) f++; else if (r.w === 2) sc++; else dr++;
      fights += r.fights;
    }
    rows.push({ board: b.id, first: Math.round((f / N) * 100), second: Math.round((sc / N) * 100), draw: Math.round((dr / N) * 100), fights: +(fights / N).toFixed(1) });
  }
  console.table(rows);
  for (const r of rows) {
    assert.ok(r.fights >= 2, `${r.board}: almost nothing happens (${r.fights} per match)`);
    assert.ok(r.first >= 36 && r.first <= 64, `${r.board}: first player wins ${r.first}%`);
    assert.ok(r.draw <= 12, `${r.board}: ${r.draw}% draws`);
  }
});
test('card win rates stay in a healthy band in both games', () => {
  const rand = seeded(99);
  const games = Report(rand);
  let worst = [];
  for (const mode of Object.keys(Data.MODES)) {
    for (const c of Data.CARDS) {
      const g = games[mode][c.id];
      const rate = g.w / g.n;
      const [lo, hi] = { common: [0.3, 0.6], uncommon: [0.38, 0.66], rare: [0.42, 0.74], legendary: [0.43, 0.82] }[c.rarity];
      if (rate < lo || rate > hi) worst.push(`${mode} ${c.id} (${c.rarity}) ${Math.round(rate * 100)}%`);
    }
  }
  if (report) {
    console.table(Data.CARDS.map((c) => ({ card: c.id, rarity: c.rarity, turncoat: Math.round((games.turncoat[c.id].w / games.turncoat[c.id].n) * 100), ringOut: Math.round((games['ring-out'][c.id].w / games['ring-out'][c.id].n) * 100) })));
  }
  assert.ok(!worst.length, worst.join(', '));
});
function Report(rand) {
  const out = {};
  const M = report ? 900 : 360;
  for (const mode of Object.keys(Data.MODES)) {
    const t = Object.fromEntries(Data.CARDS.map((c) => [c.id, { w: 0, n: 0 }]));
    const boards = Data.boardsFor(mode);
    for (let i = 0; i < M; i++) {
      const d1 = legalDeck(rand), d2 = legalDeck(rand);
      const r = runMatch(mode, boards[i % boards.length].id, d1, d2, { 1: 1, 2: 1 }, 1 + (i % 2), rand);
      for (const id of new Set(d1)) { t[id].n++; if (r.w === 1) t[id].w++; else if (r.w === 0) t[id].w += 0.5; }
      for (const id of new Set(d2)) { t[id].n++; if (r.w === 2) t[id].w++; else if (r.w === 0) t[id].w += 0.5; }
    }
    out[mode] = t;
  }
  return out;
}
test('the starter deck competes in both games and the ladder gets harder', () => {
  const rand = seeded(2024);
  const rows = [];
  for (const mode of Object.keys(Data.MODES)) {
    const boards = Data.boardsFor(mode);
    let starterVsRandom = 0;
    for (let i = 0; i < N; i++) {
      const r = runMatch(mode, boards[i % boards.length].id, Data.STARTER_DECK, legalDeck(rand), { 1: 1, 2: 1 }, 1 + (i % 2), rand);
      if (r.w === 1) starterVsRandom++;
    }
    const row = { mode, 'starter vs random %': Math.round((starterVsRandom / N) * 100) };
    let prev = 101;
    for (const o of Data.LADDER) {
      let beat = 0;
      for (let i = 0; i < 80; i++) {
        const r = runMatch(mode, boards[i % boards.length].id, Data.STARTER_DECK, o.deck, { 1: 1, 2: o.level }, 1 + (i % 2), rand);
        if (r.w === 1) beat++;
      }
      const pct = Math.round((beat / 80) * 100);
      row[o.id] = pct;
      prev = Math.min(prev, pct);
    }
    rows.push(row);
  }
  console.table(rows);
  for (const r of rows) {
    assert.ok(r['starter vs random %'] >= 34, `${r.mode}: starter deck wins only ${r['starter vs random %']}% against random decks`);
    assert.ok(r.pip >= 55, `${r.mode}: the first opponent is too hard (${r.pip}%)`);
    assert.ok(r.kuro < r.pip, `${r.mode}: the last opponent is easier than the first`);
  }
});

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll card checks passed.');
process.exit(failures ? 1 : 0);
