// Mountain Town and Mountain Peak: the daily reasons to come back and to linger.
// Pure rules over a ninja's progress state (state.mountain) and the live rooms, so they can be
// tested without a server. index.js calls these, pays the rewards and tells the clients.
const P = require('../../shared/protocol');
const { prevDay } = require('./progress');

// One forecast a day from a repeating week, so the Guide can truthfully tell you tomorrow's.
const WEATHER = {
  bluebird: { id: 'bluebird', name: 'Bluebird Day', icon: '☀️', perk: 'Clear skies: one extra find is out on the trails.', extraFinds: 1 },
  snowfall: { id: 'snowfall', name: 'Fresh Snowfall', icon: '🌨️', perk: 'Bitter cold: you can earn more warming up today.', cozyCap: 100 },
  clouds: { id: 'clouds', name: 'Sea of Clouds', icon: '☁️', perk: 'The Summit Bell carries far: it pays double today.', bellMult: 2 },
  aurora: { id: 'aurora', name: 'Aurora Watch', icon: '🌌', perk: 'A rare Starstone has fallen near the summit.', starstone: true },
};
const FORECAST = ['snowfall', 'bluebird', 'clouds', 'snowfall', 'aurora', 'bluebird', 'clouds'];

// The Mountain Journal. Each room hides different things, so both are worth walking.
const KINDS = [
  { id: 'edelweiss', name: 'Edelweiss', where: 'Mountain Town', room: 'mountain-town' },
  { id: 'pinecone', name: 'Larch Cone', where: 'Mountain Town', room: 'mountain-town' },
  { id: 'feather', name: 'Eagle Feather', where: 'Mountain Town', room: 'mountain-town' },
  { id: 'oldcoin', name: 'Old Trail Coin', where: 'Mountain Town', room: 'mountain-town' },
  { id: 'frost', name: 'Frost Crystal', where: 'Mountain Peak', room: 'mountain-peak' },
  { id: 'amethyst', name: 'Amethyst', where: 'Mountain Peak', room: 'mountain-peak' },
  { id: 'lotus', name: 'Snow Lotus', where: 'Mountain Peak', room: 'mountain-peak' },
  { id: 'starstone', name: 'Starstone', where: 'Peak, on Aurora Watch days', rare: true },
];
const FIND_COUNT = { 'mountain-town': 3, 'mountain-peak': 2 };
const FIND_REWARD = { coins: 8, xp: 3 };
const RARE_REWARD = { coins: 40, xp: 15 };
const JOURNAL_REWARD = { coins: 300, xp: 100 };

const BELL_COINS = [20, 25, 30, 35, 40, 50, 100]; // day 1..7 of a Summit Bell streak
const BELL_XP = 10;
const BEACON_GOAL = 3; // rings to light the beacon, or fewer if fewer ninjas came up today
const BEACON_BONUS = 25;

const COZY_TICK_MS = 10000;
const COZY_CAP = 60;
const COCOA_PRICE = 15;

function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function dayNumber(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function weatherFor(day) { return WEATHER[FORECAST[dayNumber(day) % FORECAST.length]]; }
function nextDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`;
}

// The ninja's mountain record, with today's counters reset if the day has changed.
function stateOf(progress, day) {
  const m = progress.mountain || (progress.mountain = {});
  m.journal = m.journal || {};
  m.bellStreak = m.bellStreak || 0;
  m.bestBell = m.bestBell || 0;
  m.rings = m.rings || 0;
  m.lastBell = m.lastBell || null;
  m.scarf = !!m.scarf;
  if (m.day !== day) { m.day = day; m.found = []; m.cozy = 0; m.cocoa = false; }
  return m;
}

// Tiles a find can sit on: open, reachable, and not tucked behind something tall.
function openTiles(room) {
  const out = [];
  const blocked = (x, y) => y < room.height && !P.isWalkable(room, x, y);
  for (let y = 4; y < room.height - 1; y++) {
    for (let x = 1; x < room.width - 1; x++) {
      if (!P.isWalkable(room, x, y) || P.portalAt(room, x, y) || blocked(x, y + 1) || blocked(x, y + 2)) continue;
      if (warmAt(room, x, y) || (room.minigames || []).some((sp) => { const pad = P.spotPad(sp); return pad.x === x && pad.y === y; })) continue;
      out.push({ x, y });
    }
  }
  return out;
}

const findCache = new Map();
// Today's finds in one room. The same places for every ninja, different every day.
function findsIn(room, day) {
  const key = `${room.id}:${room.version || 0}:${day}`;
  if (findCache.has(key)) return findCache.get(key);
  const weather = weatherFor(day);
  const r = rng(seedOf(`${day}:${room.id}`));
  const kinds = KINDS.filter((k) => k.room === room.id);
  const count = (FIND_COUNT[room.id] || 0) + (room.id === 'mountain-town' ? weather.extraFinds || 0 : 0);
  const open = openTiles(room).filter((t) => P.findPath(room, room.spawn, t));
  const picked = [];
  for (let tries = 0; tries < 400 && picked.length < count && open.length; tries++) {
    const t = open[Math.floor(r() * open.length)];
    if (picked.some((o) => Math.abs(o.x - t.x) + Math.abs(o.y - t.y) < 7)) continue;
    picked.push(t);
  }
  const list = picked.map((t, i) => ({
    id: `${room.id}:${i}`, room: room.id, x: t.x, y: t.y,
    kind: weather.starstone && room.id === 'mountain-peak' && i === 0 ? 'starstone' : kinds[Math.floor(r() * kinds.length)].id,
  }));
  if (findCache.size > 16) findCache.clear();
  findCache.set(key, list);
  return list;
}
function allFinds(rooms, day) {
  const out = [];
  for (const id of Object.keys(FIND_COUNT)) if (rooms.has(id)) out.push(...findsIn(rooms.get(id), day));
  return out;
}

// Pick up a find next to the ninja. Returns what they got, or null if it cannot be collected.
function gather(progress, day, rooms, roomId, at, id) {
  const m = stateOf(progress, day);
  const find = allFinds(rooms, day).find((f) => f.id === id);
  if (!find || find.room !== roomId || m.found.includes(id)) return null;
  if (Math.max(Math.abs(find.x - at.x), Math.abs(find.y - at.y)) > 1) return null;
  m.found.push(id);
  const firstOfKind = !m.journal[find.kind];
  m.journal[find.kind] = (m.journal[find.kind] || 0) + 1;
  const kind = KINDS.find((k) => k.id === find.kind);
  const base = kind.rare ? RARE_REWARD : FIND_REWARD;
  let { coins, xp } = base;
  const completed = !m.scarf && KINDS.every((k) => m.journal[k.id]);
  if (completed) { m.scarf = true; coins += JOURNAL_REWARD.coins; xp += JOURNAL_REWARD.xp; }
  return { kind: kind.id, name: kind.name, rare: !!kind.rare, firstOfKind, coins, xp, journalComplete: completed };
}

// The once-a-day Summit Bell, with its own streak.
function ring(progress, day) {
  const m = stateOf(progress, day);
  if (m.lastBell === day) return null;
  m.bellStreak = m.lastBell === prevDay(day) ? m.bellStreak + 1 : 1;
  m.bestBell = Math.max(m.bestBell, m.bellStreak);
  m.lastBell = day;
  m.rings += 1;
  const slot = (m.bellStreak - 1) % BELL_COINS.length;
  return { streak: m.bellStreak, slot: slot + 1, coins: BELL_COINS[slot] * (weatherFor(day).bellMult || 1), xp: BELL_XP };
}

// The village-wide beacon. `beacon` is { day, rings, visitors, ringers, lit } kept in settings.
function beaconFor(saved, day) {
  return saved && saved.day === day ? saved : { day, rings: 0, visitors: [], ringers: [], lit: false };
}
function beaconGoal(b) { return Math.max(1, Math.min(BEACON_GOAL, b.visitors.length)); }
function noteVisitor(b, accountId) {
  if (b.visitors.includes(accountId)) return false;
  b.visitors.push(accountId);
  return true;
}
// Count a ring. Returns true the moment this ring lights the beacon.
function addRing(b, accountId) {
  b.rings += 1;
  if (!b.ringers.includes(accountId)) b.ringers.push(accountId);
  if (b.lit || b.rings < beaconGoal(b)) return false;
  b.lit = true;
  return true;
}

// Warm places are marked on room props: a hot spring's area, or `warm: radius` around a fire.
function warmAt(room, x, y) {
  return (room.props || []).some((p) => {
    if (!p.warm) return false;
    if (p.type === 'hotspring') return x >= p.x && x < p.x + (p.w || 1) && y >= p.y && y < p.y + (p.h || 1);
    return Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) <= p.warm;
  });
}
function cozyCap(day) { return weatherFor(day).cozyCap || COZY_CAP; }
// One tick of sitting somewhere warm: returns the coins earned (0 when at today's limit).
function cozyTick(progress, day, { company, beaconLit }) {
  const m = stateOf(progress, day);
  const room = cozyCap(day) - m.cozy;
  if (room <= 0) return 0;
  const coins = Math.min(room, 1 + (m.cocoa ? 1 : 0) + (company ? 1 : 0) + (beaconLit ? 1 : 0));
  m.cozy += coins;
  return coins;
}
function buyCocoa(progress, day) {
  const m = stateOf(progress, day);
  if (m.cocoa) return false;
  m.cocoa = true;
  return true;
}

// Everything the client shows about the mountains for this ninja, today.
function summary(progress, day, rooms, beacon) {
  const m = stateOf(progress, day);
  const weather = weatherFor(day);
  const finds = allFinds(rooms, day);
  const slot = (m.lastBell === prevDay(day) ? m.bellStreak : 0) % BELL_COINS.length;
  return {
    day,
    weather: { id: weather.id, name: weather.name, icon: weather.icon, perk: weather.perk },
    tomorrow: (() => { const w = weatherFor(nextDay(day)); return { id: w.id, name: w.name, icon: w.icon, perk: w.perk }; })(),
    finds: finds.filter((f) => !m.found.includes(f.id)),
    foundCount: m.found.length,
    findTotal: finds.length,
    bell: {
      rung: m.lastBell === day,
      streak: m.lastBell === day || m.lastBell === prevDay(day) ? m.bellStreak : 0,
      best: m.bestBell, total: m.rings,
      next: BELL_COINS[slot] * (weather.bellMult || 1),
      week: BELL_COINS,
    },
    cozy: { earned: m.cozy, cap: cozyCap(day) },
    cocoa: m.cocoa,
    cocoaPrice: COCOA_PRICE,
    beacon: { lit: beacon.lit, rings: beacon.rings, goal: beaconGoal(beacon) },
    journal: KINDS.map((k) => ({ id: k.id, name: k.name, where: k.where, rare: !!k.rare, count: m.journal[k.id] || 0 })),
    scarf: m.scarf,
  };
}

module.exports = {
  KINDS, WEATHER, COZY_TICK_MS, COCOA_PRICE, BEACON_BONUS, BELL_COINS,
  stateOf, weatherFor, findsIn, allFinds, gather, ring, beaconFor, beaconGoal, noteVisitor, addRing, warmAt, cozyCap, cozyTick, buyCocoa, summary,
};
