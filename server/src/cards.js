// A ninja's card collection: copies, foils, Ink, unopened packs, decks, the House Ladder and rewards.
// Pure functions over the `cards` object inside the ninja's progress JSON, so the rules can be
// tested without a server. index.js calls these and pays out coins and XP.
const Data = require('../../shared/cards/data');

const { CARDS, DECK, PACKS, RARITIES, LADDER, MODES, ELEMENTS, STARTER_COLLECTION, STARTER_DECK, FOIL_CHANCE, SET_REWARD, COMPLETE_REWARD, FIRST_WIN_PACK, getCard, rankFor } = Data;
const GAMES = Object.keys(MODES);
const MAX_COPIES = 3; // copies you can hold; extras become Ink automatically
const isDuel = (game) => GAMES.includes(game);

function fresh() {
  const owned = {};
  for (const id of STARTER_COLLECTION) owned[id] = 1;
  return {
    owned, foils: [], ink: 0, packs: { street: 1, temple: 0 }, unseen: [],
    decks: [{ name: 'Starter Deck', cards: [...STARTER_DECK] }, { name: 'Deck 2', cards: [] }, { name: 'Deck 3', cards: [] }],
    active: Object.fromEntries(GAMES.map((g) => [g, 0])),
    ladder: Object.fromEntries(GAMES.map((g) => [g, 0])),
    stats: Object.fromEntries(GAMES.map((g) => [g, { w: 0, l: 0, d: 0 }])),
    firstWinDay: null, sets: [], complete: false, packsOpened: 0,
  };
}

// Reads the collection from a progress object, creating the starter set the first time.
function stateOf(progress) {
  if (!progress.cards || typeof progress.cards !== 'object') progress.cards = fresh();
  return progress.cards;
}

const fail = (code, message) => { const e = new Error(message); e.code = code; throw e; };
const wins = (st) => GAMES.reduce((n, g) => n + st.stats[g].w, 0);

function deckProblem(cards, owned) {
  if (!Array.isArray(cards)) return 'That deck is not valid.';
  if (cards.length !== DECK.size) return `A deck needs exactly ${DECK.size} cards.`;
  const count = {};
  let legends = 0;
  for (const id of cards) {
    const def = typeof id === 'string' ? getCard(id) : null;
    if (!def || id === Data.PHANTOM.id) return 'That deck has a card that does not exist.';
    count[id] = (count[id] || 0) + 1;
    if (count[id] > DECK.maxCopies) return `A deck can hold at most ${DECK.maxCopies} of the same card.`;
    if (count[id] > (owned[id] || 0)) return `You only own ${owned[id] || 0} of ${def.name}.`;
    if (def.rarity === 'legendary') legends++;
  }
  if (legends > DECK.maxLegendary) return `A deck can hold ${DECK.maxLegendary} Legendary card.`;
  return null;
}

// The deck a ninja sits down with. Falls back to the Starter Deck if the chosen one is unfinished.
function deckFor(st, game) {
  const d = st.decks[st.active[game]];
  return d && !deckProblem(d.cards, st.owned) ? [...d.cards] : [...STARTER_DECK];
}

function saveDeck(st, slot, name, cards) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= DECK.slots) fail('bad', 'That deck slot does not exist.');
  const list = Array.isArray(cards) ? cards.slice(0, DECK.size + 1).map(String) : [];
  // An unfinished deck can be saved as a draft, but every card in it must be yours.
  if (list.length === DECK.size) { const p = deckProblem(list, st.owned); if (p) fail('bad', p); }
  else if (list.length > DECK.size || list.some((id) => !st.owned[id])) fail('bad', 'That deck has a card you do not own.');
  const clean = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  st.decks[slot] = { name: clean || `Deck ${slot + 1}`, cards: list };
}

function setActive(st, game, slot) {
  if (!isDuel(game)) fail('bad', 'That is not a card game.');
  const d = st.decks[slot];
  if (!d) fail('bad', 'That deck slot does not exist.');
  const p = deckProblem(d.cards, st.owned);
  if (p) fail('bad', `Finish that deck first. ${p}`);
  st.active[game] = slot;
}

// ---------- gaining cards ----------
function rollRarity(table, rng) {
  let r = rng() * Object.values(table).reduce((a, b) => a + b, 0);
  for (const [rarity, weight] of Object.entries(table)) { r -= weight; if (r <= 0) return rarity; }
  return Object.keys(table)[0];
}

// Adds one card and returns what happened to it. Copies past the cap turn into Ink.
function grant(st, id, foil) {
  const isNew = !st.owned[id];
  const out = { id, foil: false, isNew, ink: 0 };
  if ((st.owned[id] || 0) >= MAX_COPIES) {
    out.ink = RARITIES[getCard(id).rarity].dissolve;
    st.ink += out.ink;
  } else {
    st.owned[id] = (st.owned[id] || 0) + 1;
  }
  if (foil && !st.foils.includes(id)) { st.foils.push(id); out.foil = true; }
  if (isNew && !st.unseen.includes(id)) st.unseen.push(id);
  return out;
}

function addPack(st, type, n = 1) { st.packs[type] = (st.packs[type] || 0) + n; }

function openPack(st, type, rng = Math.random) {
  const pack = PACKS[type];
  if (!pack) fail('bad', 'That pack does not exist.');
  if (!st.packs[type]) fail('none', `You have no ${pack.name} to open.`);
  st.packs[type] -= 1;
  st.packsOpened += 1;
  const picked = new Set();
  const drawn = pack.slots.map((table) => {
    const rarity = rollRarity(table, rng);
    let pool = CARDS.filter((c) => c.rarity === rarity && !picked.has(c.id));
    // Cards you do not own yet are three times as likely, so packs keep feeling useful.
    const weighted = pool.flatMap((c) => (st.owned[c.id] ? [c] : [c, c, c]));
    const card = weighted[Math.floor(rng() * weighted.length)];
    picked.add(card.id);
    return grant(st, card.id, rng() < FOIL_CHANCE);
  });
  return { drawn, sets: checkSets(st) };
}

// Pays once for each finished element, and once for the whole set.
function checkSets(st) {
  const out = { coins: 0, ink: 0, names: [] };
  for (const el of Object.keys(ELEMENTS)) {
    if (st.sets.includes(el) || !CARDS.filter((c) => c.element === el).every((c) => st.owned[c.id])) continue;
    st.sets.push(el);
    out.coins += SET_REWARD.coins; out.ink += SET_REWARD.ink; out.names.push(`${ELEMENTS[el].name} set`);
  }
  if (!st.complete && CARDS.every((c) => st.owned[c.id])) {
    st.complete = true;
    out.coins += COMPLETE_REWARD.coins; out.ink += COMPLETE_REWARD.ink; out.names.push('the complete collection');
  }
  st.ink += out.ink;
  return out;
}

function craft(st, id) {
  const def = getCard(id);
  if (!def || id === Data.PHANTOM.id) fail('bad', 'That card does not exist.');
  if ((st.owned[id] || 0) >= MAX_COPIES) fail('bad', `You already hold ${MAX_COPIES} of ${def.name}.`);
  const cost = RARITIES[def.rarity].ink;
  if (st.ink < cost) fail('ink', `${def.name} costs ${cost} Ink. You have ${st.ink}.`);
  st.ink -= cost;
  grant(st, id, false);
  return { card: id, cost, sets: checkSets(st) };
}

// Turns one spare copy into Ink. Never removes a card a finished deck is using, or your last copy.
function dissolve(st, id) {
  const def = getCard(id);
  if (!def || !st.owned[id]) fail('bad', 'You do not own that card.');
  const inDecks = Math.max(0, ...st.decks.map((d) => d.cards.filter((x) => x === id).length));
  if (st.owned[id] <= Math.max(1, inDecks)) fail('bad', `Keep this copy of ${def.name}. You need it.`);
  st.owned[id] -= 1;
  const ink = RARITIES[def.rarity].dissolve;
  st.ink += ink;
  return { ink };
}

function markSeen(st) { st.unseen = []; }

// ---------- matches ----------
// outcome is 'win', 'loss' or 'draw'. Returns the extras earned beyond the normal minigame reward.
function recordMatch(st, day, { game, outcome, vsHouse, step }) {
  const stat = st.stats[game];
  stat[outcome === 'win' ? 'w' : outcome === 'loss' ? 'l' : 'd'] += 1;
  const out = { coins: 0, xp: 0, packs: [], cards: [], firstWin: false, ladder: null, sets: { coins: 0, ink: 0, names: [] } };
  if (outcome !== 'win') return out;
  if (st.firstWinDay !== day) {
    st.firstWinDay = day;
    out.firstWin = true;
    addPack(st, FIRST_WIN_PACK);
    out.packs.push(FIRST_WIN_PACK);
  }
  if (vsHouse && step === st.ladder[game] && step < LADDER.length) {
    const rung = LADDER[step];
    st.ladder[game] += 1;
    out.ladder = rung.name;
    out.coins += rung.reward.coins;
    out.xp += rung.reward.xp;
    if (rung.reward.pack) { addPack(st, rung.reward.pack); out.packs.push(rung.reward.pack); }
    if (rung.reward.card) { const g = grant(st, rung.reward.card, true); out.cards.push(g); out.sets = checkSets(st); }
  }
  return out;
}

// Which House regular a ninja faces next in this game.
function ladderStep(st, game) { return Math.min(st.ladder[game], LADDER.length - 1); }

// Everything the Cards screen needs.
function summary(st, day) {
  const w = wins(st);
  return {
    owned: st.owned, foils: st.foils, ink: st.ink, packs: st.packs, unseen: st.unseen,
    decks: st.decks, active: st.active, ladder: st.ladder, stats: st.stats,
    firstWinReady: st.firstWinDay !== day, packsOpened: st.packsOpened, sets: st.sets,
    wins: w, rank: rankFor(w).name,
  };
}

module.exports = { GAMES, MAX_COPIES, isDuel, fresh, stateOf, deckProblem, deckFor, saveDeck, setActive, addPack, openPack, craft, dissolve, markSeen, recordMatch, ladderStep, summary, checkSets };
