// Player progression: daily login streaks, daily challenges and belt tests.
// Pure functions over a small per-ninja state object (stored as JSON in ninjas.progress), so the
// rules can be tested without a server. index.js calls these and pays out the rewards.
const P = require('../../shared/protocol');

// Coins for day 1..7 of a login streak. Day 7 is the big one, then the week starts again.
const STREAK_COINS = [20, 30, 40, 50, 60, 80, 150];
const STREAK_XP = 10;

// Daily challenges. Three a day, the same for every ninja on the server, picked from these
// groups by the date: one "play" challenge, one featured game, and one around the village.
// `event` names what counts; `game` limits it to one minigame; `distinct` counts different things.
const PLAY_POOL = [
  { id: 'play2', text: 'Play 2 minigames', event: 'play', goal: 2, coins: 40, xp: 20 },
  { id: 'play4', text: 'Play 4 minigames', event: 'play', goal: 4, coins: 70, xp: 35 },
  { id: 'win1', text: 'Finish first in a minigame', event: 'win', goal: 1, coins: 60, xp: 30 },
  { id: 'win2', text: 'Finish first in 2 minigames', event: 'win', goal: 2, coins: 90, xp: 45 },
  { id: 'variety3', text: 'Play 3 different minigames', event: 'play', distinct: true, goal: 3, coins: 80, xp: 40 },
];
const VILLAGE_POOL = [
  { id: 'explore', text: 'Visit the Sports Park and the Grotto', event: 'visit', rooms: ['sports-park', 'grotto'], goal: 2, coins: 35, xp: 15 },
  { id: 'dojo', text: 'Pay your respects in the Main Dojo', event: 'visit', rooms: ['dojo'], goal: 1, coins: 25, xp: 10 },
  { id: 'ramen', text: 'Stop by the Ramen House', event: 'visit', rooms: ['ramen'], goal: 1, coins: 25, xp: 10 },
  { id: 'emote5', text: 'Use 5 emotes', event: 'emote', goal: 5, coins: 25, xp: 10 },
  { id: 'chat3', text: 'Say something in chat 3 times', event: 'chat', goal: 3, coins: 25, xp: 10 },
  { id: 'bow', text: 'Bow to another ninja (emote 1)', event: 'emote', emote: 'bow', goal: 1, coins: 20, xp: 10 },
  { id: 'climb', text: 'Climb from Mountain Town to the Peak', event: 'visit', rooms: ['mountain-town', 'mountain-peak'], goal: 2, coins: 35, xp: 15 },
  { id: 'bell', text: 'Ring the Summit Bell', event: 'bell', goal: 1, coins: 30, xp: 15 },
  { id: 'forage', text: 'Collect 3 mountain finds', event: 'find', goal: 3, coins: 40, xp: 20 },
];
const FEATURED_REWARD = { coins: 50, xp: 25 };

// What each belt test asks for, on top of the XP in BELTS. Checked by Sensei Oru.
// `have` reads the ninja's record: { plays, distinct, wins, challenges, bestStreak }.
const BELT_TESTS = {
  yellow: [{ text: 'Play a minigame', key: 'plays', need: 1 }],
  orange: [{ text: 'Play 3 different minigames', key: 'distinct', need: 3 }],
  green: [{ text: 'Finish first in 5 minigames', key: 'wins', need: 5 }],
  blue: [{ text: 'Complete 5 daily challenges', key: 'challenges', need: 5 }, { text: 'Play 5 different minigames', key: 'distinct', need: 5 }],
  brown: [{ text: 'Finish first in 15 minigames', key: 'wins', need: 15 }, { text: 'Reach a 3-day login streak', key: 'bestStreak', need: 3 }],
  black: [{ text: 'Complete 20 daily challenges', key: 'challenges', need: 20 }, { text: 'Play 7 different minigames', key: 'distinct', need: 7 }],
};
const BELT_REWARD_COINS = { yellow: 50, orange: 100, green: 150, blue: 200, brown: 300, black: 500 };

function dayKey(date = new Date()) {
  const y = date.getFullYear(), m = String(date.getMonth() + 1).padStart(2, '0'), d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function prevDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}
function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function parse(json) {
  let s = {};
  try { s = typeof json === 'string' ? JSON.parse(json || '{}') : (json || {}); } catch {}
  return {
    streak: s.streak || 0, bestStreak: s.bestStreak || 0, lastLogin: s.lastLogin || null,
    challengesDone: s.challengesDone || 0,
    daily: s.daily && typeof s.daily === 'object' ? s.daily : null,
    mountain: s.mountain && typeof s.mountain === 'object' ? s.mountain : {}, // server/src/mountain.js
  };
}

// Today's three challenges. `games` is the list of installed minigames placed on the map.
function challengesFor(day, games) {
  const seed = seedOf(day);
  const list = [PLAY_POOL[seed % PLAY_POOL.length]];
  if (games.length) {
    const g = games[(seed >>> 8) % games.length];
    list.push({ id: `feat-${g.id}`, text: `Featured game: play ${g.name}`, event: 'play', game: g.id, goal: 1, ...FEATURED_REWARD, icon: g.icon });
  }
  list.push(VILLAGE_POOL[(seed >>> 16) % VILLAGE_POOL.length]);
  return list;
}

function freshDaily(state, day) {
  if (!state.daily || state.daily.day !== day) state.daily = { day, counts: {}, seen: {}, done: [] };
  return state.daily;
}

// First login of the day: extend or restart the streak and return the reward, or null if
// the ninja already claimed today.
function claimLogin(state, day) {
  if (state.lastLogin === day) return null;
  state.streak = state.lastLogin === prevDay(day) ? state.streak + 1 : 1;
  state.bestStreak = Math.max(state.bestStreak, state.streak);
  state.lastLogin = day;
  const slot = (state.streak - 1) % STREAK_COINS.length;
  return { streak: state.streak, day: slot + 1, coins: STREAK_COINS[slot], xp: STREAK_XP, week: STREAK_COINS };
}

function matches(c, ev) {
  if (c.event === 'win') return ev.type === 'play' && ev.won && (!c.game || c.game === ev.game);
  if (c.event !== ev.type) return false;
  if (c.game && c.game !== ev.game) return false;
  if (c.emote && c.emote !== ev.emote) return false;
  if (c.rooms && !c.rooms.includes(ev.room)) return false;
  return true;
}

// Count an event toward today's challenges. Returns the challenges it just completed.
function track(state, day, games, ev) {
  const daily = freshDaily(state, day);
  const completed = [];
  for (const c of challengesFor(day, games)) {
    if (daily.done.includes(c.id) || !matches(c, ev)) continue;
    if (c.distinct || c.rooms) {
      const key = c.rooms ? ev.room : ev.game;
      const seen = daily.seen[c.id] || (daily.seen[c.id] = []);
      if (!seen.includes(key)) seen.push(key);
      daily.counts[c.id] = seen.length;
    } else {
      daily.counts[c.id] = (daily.counts[c.id] || 0) + 1;
    }
    if (daily.counts[c.id] >= c.goal) {
      daily.done.push(c.id);
      state.challengesDone += 1;
      completed.push(c);
    }
  }
  return completed;
}

// What the client shows: today's challenges with progress, and the streak.
function summary(state, day, games) {
  const daily = state.daily && state.daily.day === day ? state.daily : { counts: {}, done: [] };
  return {
    day,
    streak: state.lastLogin === day || state.lastLogin === prevDay(day) ? state.streak : 0,
    bestStreak: state.bestStreak,
    challengesDone: state.challengesDone,
    challenges: challengesFor(day, games).map((c) => ({
      id: c.id, text: c.text, goal: c.goal, coins: c.coins, xp: c.xp, icon: c.icon || null,
      progress: Math.min(c.goal, daily.counts[c.id] || 0), done: daily.done.includes(c.id),
    })),
    week: STREAK_COINS,
  };
}

// The next belt's test: XP plus its requirements, with what the ninja has so far.
function beltTest(ninja, record) {
  const next = P.nextBelt(ninja.belt);
  if (!next) return null;
  const reqs = [{ text: `Earn ${next.xp.toLocaleString()} XP`, have: ninja.xp, need: next.xp }]
    .concat((BELT_TESTS[next.id] || []).map((r) => ({ text: r.text, have: record[r.key] || 0, need: r.need })));
  return { belt: next.id, name: next.name, color: next.color, reqs, ready: reqs.every((r) => r.have >= r.need), coins: BELT_REWARD_COINS[next.id] || 0 };
}

module.exports = { dayKey, prevDay, parse, challengesFor, claimLogin, track, summary, beltTest, STREAK_COINS, BELT_TESTS };
