// ClubDojo World Server: the single source of truth for the village.
// Clients send intents over WebSocket; the server validates them and broadcasts results.
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dgram = require('dgram');
const bcrypt = require('bcryptjs');
const { WebSocketServer } = require('ws');
const P = require('../../shared/protocol');
const DB = require('./db');
const filter = require('./filter');
const minigameRegistry = require('./minigames/registry');
const { createEngine } = require('./minigames/engine');
const progress = require('./progress');
const mountain = require('./mountain');
const updater = require('../../shared/updater');

const JOIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const IDLE_KICK_MS = 30 * 60 * 1000;
const MOUNTAIN_ROOMS = new Set(['mountain-town', 'mountain-peak']);

function randomCode(len, alphabet) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

function broadcastAddress(address, netmask) {
  const a = address.split('.').map(Number);
  const m = netmask.split('.').map(Number);
  return a.map((v, i) => (v & m[i]) | (~m[i] & 255)).join('.');
}

// Running from source: server/data. Running as the packaged ClubDojo-Server.exe: a
// ClubDojo-Data folder next to the exe, so the database is easy to find and back up.
function defaultDataDir() {
  let packaged = false;
  try { packaged = require('node:sea').isSea(); } catch {}
  return packaged ? path.join(path.dirname(process.execPath), 'ClubDojo-Data') : path.join(__dirname, '..', 'data');
}

function start(options = {}) {
  const config = {
    port: Number(options.port || process.env.CLUBDOJO_PORT || P.DEFAULT_PORT),
    dataDir: options.dataDir || process.env.CLUBDOJO_DATA || defaultDataDir(),
    maxPlayers: Number(options.maxPlayers || process.env.CLUBDOJO_MAX_PLAYERS || 30),
    serverName: options.serverName || process.env.CLUBDOJO_NAME || `${os.hostname()} Dojo`,
    discovery: options.discovery ?? process.env.CLUBDOJO_DISCOVERY !== '0',
    quiet: !!options.quiet,
  };
  const log = (...a) => { if (!config.quiet) console.log(...a); };

  const db = DB.open(config.dataDir);
  const startedAt = Date.now();

  // Join code: stable across restarts, overridable by env.
  let joinCode = (options.joinCode || process.env.CLUBDOJO_JOIN_CODE || db.getSetting('join_code') || randomCode(6, JOIN_ALPHABET)).toUpperCase();
  db.setSetting('join_code', joinCode);

  // First run: make sure a Grandmaster exists.
  let firstAdmin = null;
  if (db.countRole('grandmaster') === 0) {
    let username = 'admin';
    for (let i = 2; db.findAccount(username); i++) username = `admin${i}`;
    const password = options.adminPassword || process.env.CLUBDOJO_ADMIN_PASSWORD || randomCode(10, 'abcdefghjkmnpqrstuvwxyz23456789');
    let name = 'Grandmaster';
    for (let i = 2; db.nameTaken(name); i++) name = `Grandmaster ${i}`;
    db.createAccount({ username, passwordHash: bcrypt.hashSync(password, 10), role: 'grandmaster', name, color: '#15191e' });
    firstAdmin = { username, password };
    fs.writeFileSync(path.join(config.dataDir, 'FIRST_RUN_ADMIN.txt'),
      `ClubDojo admin login (created ${new Date().toISOString()})\nusername: ${username}\npassword: ${password}\n\nChange it from the admin client (Players > Reset password) and delete this file.\n`);
  }

  const rooms = new Map(db.listRooms().map((r) => [r.id, r]));
  const sessions = new Set();
  const byAccount = new Map();
  const loginAttempts = new Map();

  // ---------- helpers ----------
  const send = (s, msg) => { if (s.ws.readyState === 1) s.ws.send(JSON.stringify(msg)); };
  const authed = () => [...sessions].filter((s) => s.account);
  const inRoom = (roomId) => authed().filter((s) => s.roomId === roomId);
  const toRoom = (roomId, msg, except) => { for (const s of inRoom(roomId)) if (s !== except) send(s, msg); };
  const toAll = (msg) => { for (const s of authed()) send(s, msg); };
  const admins = () => authed().filter((s) => s.client === 'admin' && s.account.role === 'grandmaster');

  // Minigames: one server-run lobby per spot on the map.
  const minigames = createEngine({
    db,
    registry: minigameRegistry,
    sendTo: (accountId, msg) => { const t = byAccount.get(accountId); if (t) send(t, msg); },
    toRoom: (roomId, msg) => toRoom(roomId, msg),
    onRewarded: (accountId, info) => {
      const s = onlineSession(accountId);
      if (s && info) trackEvent(s, { type: 'play', game: info.game, won: info.place === 1 && info.score > 0 }, { push: false });
      refreshOnline(accountId);
    },
    log,
  });

  function publicPlayer(s) {
    return {
      id: s.account.id, name: s.ninja.name, color: s.ninja.color, headband: s.ninja.headband,
      belt: s.ninja.belt, role: s.account.role, x: s.x, y: s.y,
      accessories: progressOf(s).mountain.scarf ? { body: 'summit-scarf' } : undefined,
    };
  }
  function privateNinja(s) {
    return {
      id: s.account.id, username: s.account.username, role: s.account.role, name: s.ninja.name,
      belt: s.ninja.belt, xp: s.ninja.xp, coins: s.ninja.coins, color: s.ninja.color, headband: s.ninja.headband,
      mutedUntil: s.account.muted_until,
      daily: progress.summary(progressOf(s), progress.dayKey(), challengeGames()),
      beltTest: progress.beltTest(s.ninja, beltRecord(s)),
      mountain: mountain.summary(progressOf(s), progress.dayKey(), rooms, currentBeacon()),
    };
  }

  // ---------- Mountain Town and Peak: finds, the Summit Bell, the beacon, warming up ----------
  let beacon = null;
  function currentBeacon() {
    const day = progress.dayKey();
    if (!beacon || beacon.day !== day) beacon = mountain.beaconFor(db.getJsonSetting('mountain_beacon'), day);
    return beacon;
  }
  function saveBeacon() { db.setJsonSetting('mountain_beacon', beacon); }
  function pushEveryone() { for (const t of authed()) pushYou(t); }
  // Warm places pay a little every tick to ninjas who stay put, more with company.
  function cozyTick() {
    const day = progress.dayKey();
    const lit = currentBeacon().lit;
    const warm = authed().filter((s) => MOUNTAIN_ROOMS.has(s.roomId) && mountain.warmAt(rooms.get(s.roomId), s.x, s.y) && !minigames.lobbyOf(s.account.id));
    for (const s of authed()) if (!warm.includes(s)) s.wasWarm = false;
    for (const s of warm) {
      // The first tick only notices you arrived, so walking through pays nothing.
      if (!s.wasWarm) { s.wasWarm = true; continue; }
      const state = progressOf(s);
      const company = warm.some((o) => o !== s && o.roomId === s.roomId);
      const coins = mountain.cozyTick(state, day, { company, beaconLit: lit });
      if (!coins) continue;
      saveProgress(s, state);
      db.addRewards(s.account.id, coins, 1);
      send(s, { t: 'mt:cozy', coins, company });
      refreshOnline(s.account.id);
    }
  }

  // ---------- progression: daily streak, daily challenges, belt tests ----------
  // Minigames that can be a "featured game" challenge: installed and placed on a map.
  function challengeGames() {
    const placed = new Set();
    for (const r of rooms.values()) for (const sp of r.minigames || []) placed.add(sp.game);
    return minigameRegistry.list().filter((g) => g.available && placed.has(g.id));
  }
  function progressOf(s) { return progress.parse(s.ninja.progress); }
  function saveProgress(s, state) {
    const json = JSON.stringify(state);
    s.ninja.progress = json;
    db.updateNinja(s.account.id, { progress: json });
  }
  function beltRecord(s) {
    const r = db.progressRecord(s.account.id);
    const st = progressOf(s);
    return { plays: r.plays, distinct: r.distinct_games, wins: r.wins, challenges: st.challengesDone, bestStreak: st.bestStreak };
  }
  // Count something the ninja did toward today's challenges and pay out any it completes.
  function trackEvent(s, ev, { push = true } = {}) {
    if (!s.account || !s.ninja) return;
    const state = progressOf(s);
    const before = JSON.stringify(state);
    const done = progress.track(state, progress.dayKey(), challengeGames(), ev);
    if (JSON.stringify(state) === before) return;
    saveProgress(s, state);
    for (const c of done) {
      db.addRewards(s.account.id, c.coins, c.xp);
      send(s, { t: 'progress', kind: 'challenge', text: c.text, coins: c.coins, xp: c.xp });
      log(`[daily] ${s.account.username} completed "${c.text}"`);
    }
    if (done.length) refreshOnline(s.account.id);
    else if (push) pushYou(s);
  }
  // First visit of the day: extend the login streak and pay the daily reward.
  function claimDaily(s) {
    if (!s.account || !s.ninja) return;
    const state = progressOf(s);
    const reward = progress.claimLogin(state, progress.dayKey());
    if (!reward) return;
    saveProgress(s, state);
    db.addRewards(s.account.id, reward.coins, reward.xp);
    s.ninja = db.getNinja(s.account.id);
    const target = s;
    setTimeout(() => { if (target.account) { send(target, { t: 'progress', kind: 'streak', ...reward }); pushYou(target); } }, 900);
  }
  function roomPayload(room) {
    const { id, name, width, height, tiles, portals, props, spawn, version, theme } = room;
    const info = new Map(minigameRegistry.list().map((g) => [g.id, g]));
    const spots = (room.minigames || []).map((sp) => {
      const g = info.get(sp.game) || {};
      return { ...sp, name: g.name || sp.game, color: g.color || '#7a3b2e', icon: g.icon || '🥋' };
    });
    const doors = (portals || []).map((p) => (rooms.has(p.to) ? { ...p, label: rooms.get(p.to).name } : p));
    return { id, name, width, height, tiles, portals: doors, props, spawn, version, theme, minigames: spots, spotStatus: minigames.spotStatus(id) };
  }
  function worldSnapshot() {
    return {
      online: authed().length,
      maxPlayers: config.maxPlayers,
      rooms: [...rooms.values()].map((r) => ({ id: r.id, name: r.name, players: inRoom(r.id).map(publicPlayer) })),
    };
  }

  let presenceTimer = null;
  function presenceChanged() {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      const online = authed().length;
      toAll({ t: 'presence', online });
      const snap = worldSnapshot();
      for (const a of admins()) send(a, { t: 'admin:world', ...snap });
    }, 150);
  }

  let closed = false;
  function savePosition(s) {
    if (!closed && s.account && s.roomId) db.saveNinjaPosition(s.account.id, s.roomId, s.x, s.y);
  }

  // A free walkable tile close to the room's spawn point, so arriving ninjas do not stack.
  function spawnNear(room) {
    const taken = new Set(inRoom(room.id).map((o) => `${o.x},${o.y}`));
    for (let tries = 0; tries < 30; tries++) {
      const r = tries < 10 ? 1 : 2;
      const x = room.spawn.x + Math.floor(Math.random() * (2 * r + 1)) - r;
      const y = room.spawn.y + Math.floor(Math.random() * (2 * r + 1)) - r;
      if (P.isWalkable(room, x, y) && !P.portalAt(room, x, y) && !taken.has(`${x},${y}`)) return { x, y };
    }
    return { ...room.spawn };
  }

  function enterRoom(s, roomId, x, y) {
    const room = rooms.get(roomId) || rooms.get('plaza') || rooms.values().next().value;
    if (s.roomId !== room.id) minigames.leave(s.account.id, null);
    if (s.roomId) toRoom(s.roomId, { t: 'player:leave', id: s.account.id }, s);
    let px = x, py = y;
    if (px == null || !P.isWalkable(room, px, py) || P.portalAt(room, px, py)) ({ x: px, y: py } = spawnNear(room));
    s.roomId = room.id; s.x = px; s.y = py;
    savePosition(s);
    send(s, { t: 'room:enter', room: roomPayload(room), you: s.account.id, players: inRoom(room.id).map(publicPlayer) });
    toRoom(room.id, { t: 'player:join', player: publicPlayer(s) }, s);
    presenceChanged();
    trackEvent(s, { type: 'visit', room: room.id });
    if (MOUNTAIN_ROOMS.has(room.id) && mountain.noteVisitor(currentBeacon(), s.account.id)) { saveBeacon(); pushEveryone(); }
  }

  function leaveWorld(s) {
    if (!s.account) return;
    minigames.leave(s.account.id, null);
    savePosition(s);
    if (s.roomId) toRoom(s.roomId, { t: 'player:leave', id: s.account.id }, s);
    if (byAccount.get(s.account.id) === s) byAccount.delete(s.account.id);
    presenceChanged();
  }

  function disconnect(s, code, reason) {
    send(s, { t: 'kicked', reason });
    setTimeout(() => s.ws.close(code || 4000, reason), 50);
  }

  function pushYou(s) {
    send(s, { t: 'you', ninja: privateNinja(s) });
  }

  function onlineSession(accountId) {
    return byAccount.get(Number(accountId)) || null;
  }

  // Reload a player's in-memory state after an admin changes them in the database.
  function refreshOnline(accountId, { lookChanged } = {}) {
    const s = onlineSession(accountId);
    if (!s) return;
    s.account = db.getAccount(s.account.id);
    s.ninja = db.getNinja(s.account.id);
    pushYou(s);
    if (lookChanged) toRoom(s.roomId, { t: 'player:look', player: publicPlayer(s) });
  }

  // Per-address limits over the last minute. Wrong passwords count toward 'login'; every
  // sign-up counts toward 'register'. Successful logins never count, so a host PC running
  // several clients (all from 127.0.0.1) is not locked out.
  const RATE_LIMITS = { login: 8, register: 12 };
  function recent(kind, ip) {
    const key = `${kind}:${ip}`;
    const list = (loginAttempts.get(key) || []).filter((t) => Date.now() - t < 60000);
    loginAttempts.set(key, list);
    return list;
  }
  function rateLimited(kind, ip) { return recent(kind, ip).length >= RATE_LIMITS[kind]; }
  function noteAttempt(kind, ip) { recent(kind, ip).push(Date.now()); }

  async function completeLogin(s, account) {
    const prev = onlineSession(account.id);
    if (prev && prev !== s) {
      leaveWorld(prev);
      prev.account = null;
      disconnect(prev, 4001, 'You logged in from another window.');
    }
    s.account = account;
    s.ninja = db.getNinja(account.id);
    byAccount.set(account.id, s);
    db.updateAccount(account.id, { last_login_at: Date.now() });
    db.logLogin(account.id, account.username, true, s.ip, s.client);
    log(`[login] ${account.username} (${account.role}) via ${s.client} from ${s.ip}`);
    claimDaily(s);
    enterRoom(s, s.ninja.room_id, s.ninja.x, s.ninja.y);
    return { ninja: privateNinja(s) };
  }

  const fail = (code, message) => { const e = new Error(message); e.code = code; throw e; };

  // ---------- message handlers ----------
  const handlers = {
    hello(s, m) {
      if (m.v !== P.PROTOCOL_VERSION) fail('version', `This client speaks protocol ${m.v}; the server needs ${P.PROTOCOL_VERSION}. Update ClubDojo.`);
      if (String(m.joinCode || '').trim().toUpperCase() !== joinCode) fail('join_code', 'That join code is not right. Check the code on the host screen.');
      if ([...sessions].filter((x) => x.hello).length >= config.maxPlayers) fail('full', 'The dojo is full. Try again soon.');
      s.hello = true;
      s.client = m.client === 'admin' ? 'admin' : 'player';
      return { serverName: config.serverName, online: authed().length, maxPlayers: config.maxPlayers, colors: P.NINJA_COLORS };
    },

    async register(s, m) {
      if (!s.hello) fail('hello', 'Say hello first.');
      if (s.account) fail('authed', 'Already logged in.');
      if (rateLimited('register', s.ip)) fail('rate', 'Too many new ninjas from this computer. Wait a minute.');
      noteAttempt('register', s.ip);
      const username = String(m.username || '').trim();
      const password = String(m.password || '');
      const name = String(m.name || '').trim().replace(/\s+/g, ' ');
      const color = P.NINJA_COLORS.includes(m.color) ? m.color : P.NINJA_COLORS[0];
      const L = P.LIMITS;
      if (!new RegExp(`^[A-Za-z0-9_]{${L.usernameMin},${L.usernameMax}}$`).test(username)) fail('username', `Username must be ${L.usernameMin}-${L.usernameMax} letters, numbers or _.`);
      if (password.length < L.passwordMin || password.length > L.passwordMax) fail('password', `Password must be ${L.passwordMin}-${L.passwordMax} characters.`);
      if (!new RegExp(`^[A-Za-z0-9 _-]{${L.nameMin},${L.nameMax}}$`).test(name)) fail('name', `Ninja name must be ${L.nameMin}-${L.nameMax} letters, numbers, spaces, - or _.`);
      if (!filter.isClean(name) || !filter.isClean(username)) fail('name', 'Pick a friendlier name.');
      if (db.findAccount(username)) fail('username', 'That username is taken.');
      if (db.nameTaken(name)) fail('name', 'That ninja name is taken.');
      const hash = await bcrypt.hash(password, 10);
      const id = db.createAccount({ username, passwordHash: hash, role: 'ninja', name, color });
      log(`[register] ${username} as "${name}"`);
      const account = db.getAccount(id);
      if (s.client === 'admin') fail('not_admin', 'Ninja created. The admin client needs a Grandmaster account; use the player client to play.');
      return completeLogin(s, account);
    },

    async login(s, m) {
      if (!s.hello) fail('hello', 'Say hello first.');
      if (s.account) fail('authed', 'Already logged in.');
      if (rateLimited('login', s.ip)) fail('rate', 'Too many wrong passwords. Wait a minute.');
      const username = String(m.username || '').trim();
      const account = db.findAccount(username);
      const ok = account && (await bcrypt.compare(String(m.password || ''), account.password_hash));
      if (!ok) {
        noteAttempt('login', s.ip);
        db.logLogin(account ? account.id : null, username, false, s.ip, s.client);
        fail('bad_login', 'Wrong username or password.');
      }
      if (account.banned) { db.logLogin(account.id, username, false, s.ip, s.client); fail('banned', 'This ninja has been banned.'); }
      if (s.client === 'admin' && account.role !== 'grandmaster') {
        db.logLogin(account.id, username, false, s.ip, s.client);
        fail('not_admin', 'The admin client needs a Grandmaster account.');
      }
      return completeLogin(s, account);
    },

    move(s, m) {
      const lobby = minigames.lobbyOf(s.account.id);
      if (lobby && lobby.phase !== 'lobby') fail('busy', 'Finish or leave the minigame first.');
      if (lobby) minigames.leave(s.account.id, null);
      const room = rooms.get(s.roomId);
      const x = Number(m.x), y = Number(m.y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) fail('bad', 'Bad target.');
      const path = P.findPath(room, { x: s.x, y: s.y }, { x, y });
      if (!path) fail('blocked', 'Cannot walk there.');
      const from = { x: s.x, y: s.y };
      s.x = x; s.y = y;
      toRoom(s.roomId, { t: 'player:move', id: s.account.id, from, x, y });
    },

    portal(s) {
      const room = rooms.get(s.roomId);
      const p = P.portalAt(room, s.x, s.y);
      if (!p || !rooms.has(p.to)) fail('no_portal', 'There is no door here.');
      enterRoom(s, p.to, p.tx, p.ty);
    },

    // The world map: every place, how the places link up, who is there and what can be played.
    // A full room is only sent for its preview picture when the client does not have that version.
    'map:get'(s, m) {
      const have = (m && m.have) || {};
      const counts = minigames.lobbyCounts();
      const info = new Map(minigameRegistry.list().map((g) => [g.id, g]));
      return {
        here: s.roomId,
        rooms: [...rooms.values()].map((r) => ({
          id: r.id,
          name: r.name,
          links: [...new Set((r.portals || []).map((p) => p.to))].filter((to) => rooms.has(to)),
          players: inRoom(r.id).map((o) => ({ name: o.ninja.name, color: o.ninja.color, you: o === s })),
          games: (r.minigames || []).map((sp) => {
            const g = info.get(sp.game) || {};
            const lobby = counts[P.spotKey(r.id, sp)];
            return { name: g.name || sp.game, icon: g.icon || '🥋', color: g.color || '#7a3b2e', count: lobby ? lobby.count : 0 };
          }),
          preview: r.version != null && have[r.id] === r.version ? undefined : roomPayload(r),
        })),
      };
    },

    // Fast travel from the world map. Any place, from anywhere, unless a minigame is under way.
    travel(s, m) {
      const id = String((m && m.roomId) || '');
      if (!rooms.has(id)) fail('bad', 'That place is not on the map.');
      if (id === s.roomId) fail('here', 'You are already here.');
      const lobby = minigames.lobbyOf(s.account.id);
      if (lobby && lobby.phase !== 'lobby') fail('busy', 'Finish or leave the minigame first.');
      const now = Date.now();
      if (now - (s.lastTravel || 0) < 400) fail('slow', 'Catch your breath first.');
      s.lastTravel = now;
      enterRoom(s, id);
    },

    chat(s, m) {
      const text = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, P.LIMITS.chatMax);
      if (!text) return;
      if (s.account.muted_until > Date.now()) fail('muted', `You are muted for ${Math.ceil((s.account.muted_until - Date.now()) / 60000)} more minute(s).`);
      const now = Date.now();
      if (now - (s.lastChat || 0) < 600) fail('slow', 'Slow down a little.');
      s.lastChat = now;
      const clean = filter.clean(text);
      db.logChat(s.roomId, s.account.id, s.ninja.name, text);
      toRoom(s.roomId, { t: 'chat', id: s.account.id, name: s.ninja.name, role: s.account.role, text: clean, at: now });
      trackEvent(s, { type: 'chat' });
    },

    emote(s, m) {
      if (!P.EMOTES[m.emote]) fail('bad', 'Unknown emote.');
      toRoom(s.roomId, { t: 'player:emote', id: s.account.id, emote: m.emote });
      // A bow only counts toward "bow to another ninja" when someone else is in the room.
      if (m.emote !== 'bow' || inRoom(s.roomId).length > 1) trackEvent(s, { type: 'emote', emote: m.emote });
      else trackEvent(s, { type: 'emote', emote: 'bow-alone' });
    },

    setLook(s, m) {
      const fields = {};
      if (m.color !== undefined) {
        if (!P.NINJA_COLORS.includes(m.color)) fail('bad', 'That gi color is not available.');
        fields.color = m.color;
      }
      if (m.headband !== undefined) {
        if (!/^#[0-9a-fA-F]{6}$/.test(m.headband)) fail('bad', 'Bad headband color.');
        fields.headband = m.headband;
      }
      db.updateNinja(s.account.id, fields);
      Object.assign(s.ninja, fields);
      pushYou(s);
      toRoom(s.roomId, { t: 'player:look', player: publicPlayer(s) });
    },

    ping() { return { at: Date.now() }; },

    // Belt test with Sensei Oru: stand next to him in the Main Dojo with the XP and the
    // test's requirements met. Promotes one belt and tells the whole village.
    'belt:test'(s) {
      const room = rooms.get(s.roomId);
      const sensei = (room.props || []).find((p) => p.type === 'npc' && !p.npc && Math.max(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) <= 2);
      if (!sensei) fail('far', 'Find Sensei Oru in the Main Dojo to take your belt test.');
      const test = progress.beltTest(s.ninja, beltRecord(s));
      if (!test) fail('max', 'You already wear the Black Belt.');
      if (!test.ready) fail('not_ready', `Not yet. ${test.reqs.filter((r) => r.have < r.need).map((r) => r.text).join(', ')}.`);
      db.updateNinja(s.account.id, { belt: test.belt });
      if (test.coins) db.addRewards(s.account.id, test.coins, 0);
      refreshOnline(s.account.id, { lookChanged: true });
      toAll({ t: 'celebrate', id: s.account.id, name: s.ninja.name, belt: test.belt, beltName: test.name, color: test.color });
      log(`[belt] ${s.account.username} passed the ${test.name} test`);
      return { belt: test.belt, name: test.name, coins: test.coins };
    },

    // ---------- Mountain Town and Peak ----------
    'mt:gather'(s, m) {
      const state = progressOf(s);
      const got = mountain.gather(state, progress.dayKey(), rooms, s.roomId, { x: s.x, y: s.y }, String(m.id || ''));
      if (!got) fail('gone', 'There is nothing to pick up here.');
      saveProgress(s, state);
      db.addRewards(s.account.id, got.coins, got.xp);
      trackEvent(s, { type: 'find' }, { push: false });
      refreshOnline(s.account.id, { lookChanged: got.journalComplete });
      if (got.journalComplete) toAll({ t: 'mt:journal', id: s.account.id, name: s.ninja.name });
      return got;
    },

    // The Summit Bell: once a day each. Every ring counts toward lighting the beacon.
    'mt:ring'(s) {
      const room = rooms.get(s.roomId);
      const bell = (room.props || []).find((p) => p.interact === 'bell');
      if (!bell || P.propDistance(bell, s.x, s.y) > 2) fail('far', 'Walk up to the Summit Bell to ring it.');
      const state = progressOf(s);
      const r = mountain.ring(state, progress.dayKey());
      if (!r) fail('done', 'You have already rung the bell today. Come back tomorrow.');
      saveProgress(s, state);
      const b = currentBeacon();
      const wasLit = b.lit;
      const litNow = mountain.addRing(b, s.account.id);
      saveBeacon();
      if (wasLit) r.coins += mountain.BEACON_BONUS; // the beacon was already burning: join in the reward
      db.addRewards(s.account.id, r.coins, r.xp);
      toRoom(s.roomId, { t: 'mt:ring', id: s.account.id, name: s.ninja.name });
      trackEvent(s, { type: 'bell' }, { push: false });
      refreshOnline(s.account.id);
      if (litNow) {
        for (const id of b.ringers) { db.addRewards(id, mountain.BEACON_BONUS, 5); refreshOnline(id); }
        toAll({ t: 'mt:beacon', name: s.ninja.name });
        log(`[mountain] ${s.account.username} lit the summit beacon`);
      }
      pushEveryone();
      return { ...r, lit: litNow };
    },

    'mt:cocoa'(s) {
      const room = rooms.get(s.roomId);
      const vendor = (room.props || []).find((p) => p.npc === 'cocoa');
      if (!vendor || P.propDistance(vendor, s.x, s.y) > 2) fail('far', 'Walk up to the cocoa cart.');
      if (s.ninja.coins < mountain.COCOA_PRICE) fail('coins', `Cocoa costs ${mountain.COCOA_PRICE} coins.`);
      const state = progressOf(s);
      if (!mountain.buyCocoa(state, progress.dayKey())) fail('done', 'You have already had your cocoa today.');
      saveProgress(s, state);
      db.addRewards(s.account.id, -mountain.COCOA_PRICE, 0);
      refreshOnline(s.account.id);
      return {};
    },

    // ---------- minigames ----------
    // Every installed and planned game, where its spots are, and how full each lobby is.
    'mg:list'(s) {
      const counts = minigames.lobbyCounts();
      const spots = [];
      for (const r of rooms.values()) for (const sp of r.minigames || []) {
        const key = P.spotKey(r.id, sp);
        spots.push({ key, spotId: sp.id, roomId: r.id, roomName: r.name, game: sp.game, x: sp.x, y: sp.y, lobby: counts[key] || null });
      }
      return {
        games: minigameRegistry.list().map((g) => ({ ...g, enabled: g.available ? minigames.settings(g.id).enabled : false })),
        spots,
        stats: db.minigameStats(s.account.id),
      };
    },
    'mg:join'(s, m) {
      const room = rooms.get(s.roomId);
      const spot = (room.minigames || []).find((sp) => sp.id === m.spotId);
      if (!spot) fail('bad', 'There is no minigame there.');
      const pad = P.spotPad(spot);
      if (Math.max(Math.abs(s.x - pad.x), Math.abs(s.y - pad.y)) > 1) fail('far', 'Walk up to the pavilion to join.');
      return { lobby: minigames.join(s, room.id, spot) };
    },
    'mg:leave'(s) { minigames.leave(s.account.id, null); },
    'mg:ready'(s, m) { return { lobby: minigames.setReady(s.account.id, m.ready) }; },
    'mg:start'(s) { return { lobby: minigames.start(s.account.id) }; },
    'mg:input'(s, m) { minigames.input(s.account.id, m.data); },
  };

  // Admin handlers: Grandmaster accounts on the admin client only. Every change is logged.
  const adminHandlers = {
    world() { return worldSnapshot(); },

    announce(s, m) {
      const text = String(m.text || '').trim().slice(0, P.LIMITS.announceMax);
      if (!text) fail('bad', 'Write an announcement first.');
      toAll({ t: 'announce', text, from: s.ninja.name, at: Date.now() });
      audit(s, 'announce', null, { text });
      return { message: 'Announcement sent.' };
    },

    kick(s, m) {
      const t = onlineSession(m.id);
      if (!t) fail('offline', 'That ninja is not online.');
      audit(s, 'kick', m.id, { reason: m.reason });
      leaveWorld(t); t.account = null;
      disconnect(t, 4002, m.reason ? `Kicked: ${m.reason}` : 'You were kicked by a Grandmaster.');
      return { message: 'Kicked.' };
    },

    mute(s, m) {
      const minutes = Math.max(0, Math.min(24 * 60, Number(m.minutes) || 0));
      const until = minutes ? Date.now() + minutes * 60000 : 0;
      requireAccount(m.id);
      db.updateAccount(Number(m.id), { muted_until: until });
      refreshOnline(m.id);
      audit(s, minutes ? 'mute' : 'unmute', m.id, { minutes });
      return { message: minutes ? `Muted for ${minutes} min.` : 'Unmuted.' };
    },

    teleport(s, m) {
      const t = onlineSession(m.id);
      if (!t) fail('offline', 'That ninja is not online.');
      if (!rooms.has(m.roomId)) fail('bad', 'No such room.');
      enterRoom(t, m.roomId);
      audit(s, 'teleport', m.id, { roomId: m.roomId });
      return { message: `Teleported to ${rooms.get(m.roomId).name}.` };
    },

    players(s, m) { return { players: db.searchPlayers(String(m.text || ''), 200).map((p) => ({ ...p, online: !!onlineSession(p.id) })) }; },

    player(s, m) {
      const a = requireAccount(m.id);
      const n = db.getNinja(a.id);
      const { password_hash, ...account } = a;
      return { account, ninja: n, online: !!onlineSession(a.id) };
    },

    give(s, m) {
      requireAccount(m.id);
      const n = db.getNinja(Number(m.id));
      const coins = Math.max(0, n.coins + (Number(m.coins) || 0));
      const xp = Math.max(0, n.xp + (Number(m.xp) || 0));
      db.updateNinja(n.account_id, { coins, xp });
      refreshOnline(m.id);
      audit(s, 'give', m.id, { coins: m.coins || 0, xp: m.xp || 0 });
      return { message: `Now ${coins} coins, ${xp} XP.` };
    },

    setBelt(s, m) {
      requireAccount(m.id);
      if (!P.BELTS.some((b) => b.id === m.belt)) fail('bad', 'No such belt.');
      db.updateNinja(Number(m.id), { belt: m.belt });
      refreshOnline(m.id, { lookChanged: true });
      audit(s, 'setBelt', m.id, { belt: m.belt });
      return { message: `Belt set to ${P.beltById(m.belt).name}.` };
    },

    setRole(s, m) {
      requireAccount(m.id);
      if (!P.ROLES.includes(m.role)) fail('bad', 'No such role.');
      if (Number(m.id) === s.account.id && m.role !== 'grandmaster') fail('bad', 'You cannot demote yourself.');
      db.updateAccount(Number(m.id), { role: m.role });
      refreshOnline(m.id, { lookChanged: true });
      audit(s, 'setRole', m.id, { role: m.role });
      return { message: `Role set to ${m.role}.` };
    },

    ban(s, m) {
      requireAccount(m.id);
      if (Number(m.id) === s.account.id) fail('bad', 'You cannot ban yourself.');
      db.updateAccount(Number(m.id), { banned: m.banned ? 1 : 0 });
      audit(s, m.banned ? 'ban' : 'unban', m.id);
      const t = onlineSession(m.id);
      if (t && m.banned) { leaveWorld(t); t.account = null; disconnect(t, 4003, 'You have been banned.'); }
      return { message: m.banned ? 'Banned.' : 'Unbanned.' };
    },

    async resetPassword(s, m) {
      requireAccount(m.id);
      const pw = String(m.password || '');
      if (pw.length < P.LIMITS.passwordMin) fail('bad', `Password must be at least ${P.LIMITS.passwordMin} characters.`);
      db.updateAccount(Number(m.id), { password_hash: await bcrypt.hash(pw, 10) });
      audit(s, 'resetPassword', m.id);
      return { message: 'Password reset.' };
    },

    rooms() {
      return { rooms: [...rooms.values()].map((r) => ({ ...roomPayload(r), draft: db.getDraft(r.id) })) };
    },

    saveDraft(s, m) {
      const data = validateRoomEdit(m);
      db.saveDraft(data.id, data);
      audit(s, 'saveDraft', data.id);
      return { message: 'Draft saved.' };
    },

    discardDraft(s, m) {
      if (!rooms.has(m.roomId)) fail('bad', 'No such room.');
      db.saveDraft(m.roomId, null);
      return { message: 'Draft discarded.' };
    },

    publishRoom(s, m) {
      const data = validateRoomEdit(m);
      const version = db.publishRoom(data.id, data, s.account.id);
      const room = { ...data, version };
      rooms.set(room.id, room);
      minigames.syncRoom(room);
      audit(s, 'publishRoom', room.id, { version });
      // Re-seat everyone inside so they get the new layout (anyone on a now-blocked tile goes to spawn).
      for (const t of inRoom(room.id)) {
        let x = t.x, y = t.y;
        if (!P.isWalkable(room, x, y) || P.portalAt(room, x, y)) { x = room.spawn.x; y = room.spawn.y; }
        t.x = x; t.y = y;
        send(t, { t: 'room:enter', room: roomPayload(room), you: t.account.id, players: inRoom(room.id).map(publicPlayer), updated: true });
      }
      return { message: `Published ${room.name} v${version}.`, version };
    },

    minigames() { return { games: minigames.adminList() }; },

    setMinigame(s, m) {
      if (!minigameRegistry.get(m.game)) fail('bad', 'That minigame is not installed.');
      const next = minigames.setSettings(m.game, { enabled: m.enabled, multiplier: m.multiplier });
      audit(s, 'setMinigame', m.game, { enabled: next.enabled, multiplier: next.multiplier });
      return { message: `${minigameRegistry.get(m.game).name}: ${next.enabled ? 'open' : 'closed'}, rewards x${next.multiplier}.`, settings: next };
    },

    logs(s, m) { return { kind: m.kind, rows: db.readLog(m.kind, 300) }; },

    server() {
      return {
        serverName: config.serverName, port: config.port, maxPlayers: config.maxPlayers, joinCode,
        connections: sessions.size, online: authed().length, addresses: lanAddresses().map((a) => a.address),
        uptimeMs: Date.now() - startedAt, dbFile: db.file,
      };
    },

    newJoinCode(s) {
      joinCode = randomCode(6, JOIN_ALPHABET);
      db.setSetting('join_code', joinCode);
      audit(s, 'newJoinCode');
      log(`[server] new join code: ${joinCode}`);
      return { joinCode, message: 'New join code set. Connected ninjas stay connected.' };
    },

    backup(s) {
      const dest = db.backup(path.join(config.dataDir, 'backups'));
      audit(s, 'backup', null, { file: dest });
      return { message: `Backup saved to ${dest}` };
    },
  };

  function requireAccount(id) {
    const a = db.getAccount(Number(id));
    if (!a) fail('bad', 'No such account.');
    return a;
  }

  function audit(s, action, target, details) {
    db.logAdmin(s.account.id, s.ninja.name, action, target, details);
  }

  function validateRoomEdit(m) {
    const base = rooms.get(m.roomId);
    if (!base) fail('bad', 'No such room.');
    const tiles = m.tiles;
    if (!Array.isArray(tiles) || tiles.length !== base.height || tiles.some((r) => typeof r !== 'string' || r.length !== base.width || [...r].some((c) => !P.TILES[c]))) {
      fail('bad', 'Tiles do not match the room size.');
    }
    const data = { ...base, tiles, name: String(m.name || base.name).slice(0, 32) };
    delete data.version; delete data.hasDraft; delete data.draft;
    if (m.spawn) data.spawn = { x: Number(m.spawn.x), y: Number(m.spawn.y) };
    if (m.minigames !== undefined) data.minigames = validateSpots(data, m.minigames);
    for (const sp of data.minigames || []) {
      const pad = P.spotPad(sp);
      if (P.portalAt(data, pad.x, pad.y) || !P.isWalkable(data, pad.x, pad.y)) fail('bad', `The tile in front of the ${gameName(sp.game)} pavilion must be walkable.`);
    }
    if (!P.isWalkable(data, data.spawn.x, data.spawn.y)) fail('bad', 'The spawn point must be on a walkable tile (not under a pavilion).');
    for (const p of data.portals) {
      const target = rooms.get(p.to);
      if (!target) continue;
      for (let j = p.y; j < p.y + (p.h || 1); j++) for (let i = p.x; i < p.x + (p.w || 1); i++) {
        if (!P.isWalkable(data, i, j)) fail('bad', `The door to ${target.name} must stay walkable.`);
      }
    }
    return data;
  }

  function gameName(id) { const g = minigameRegistry.list().find((x) => x.id === id); return g ? g.name : id; }

  function validateSpots(room, list) {
    if (!Array.isArray(list) || list.length > 12) fail('bad', 'A room can hold up to 12 minigame spots.');
    const { w, h } = P.MINIGAME_SPOT;
    const out = [];
    const taken = new Set(list.map((o) => o && o.id).filter((id) => /^mg\d+$/.test(id || '')));
    const used = new Set();
    for (const raw of list) {
      const x = Number(raw.x), y = Number(raw.y);
      if (!minigameRegistry.get(raw.game)) fail('bad', `"${raw.game}" is not an installed minigame.`);
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + w > room.width || y + h >= room.height) fail('bad', 'A minigame spot is off the map.');
      for (const o of out) if (x < o.x + w && o.x < x + w && y < o.y + h && o.y < y + h) fail('bad', 'Two minigame spots overlap.');
      for (const p of room.portals) if (x < p.x + (p.w || 1) && p.x < x + w && y < p.y + (p.h || 1) && p.y < y + h) fail('bad', 'A minigame spot covers a door.');
      let id = /^mg\d+$/.test(raw.id || '') && !used.has(raw.id) ? raw.id : null;
      for (let n = 1; !id; n++) if (!taken.has(`mg${n}`) && !used.has(`mg${n}`)) id = `mg${n}`;
      used.add(id);
      out.push({ id, game: raw.game, x, y });
    }
    return out;
  }

  async function handle(s, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    s.lastActive = Date.now();
    s.msgCount = (s.msgCount || 0) + 1;
    // Flood guard, reset each second. Leaving a minigame always goes through: a player mashing
    // keys in a game must never end up stuck in a lobby their client has already closed.
    if (s.msgCount > 40 && m.t !== 'mg:leave') return;

    const reply = (ok, data) => { if (m.rid != null) send(s, { t: 'reply', rid: m.rid, ok, ...data }); };
    try {
      let fn;
      if (m.t.startsWith('admin:')) {
        if (!s.account || s.client !== 'admin' || s.account.role !== 'grandmaster') fail('forbidden', 'Grandmaster only.');
        fn = adminHandlers[m.t.slice(6)];
      } else {
        fn = handlers[m.t];
        if (fn && !['hello', 'register', 'login', 'ping'].includes(m.t) && !s.account) fail('auth', 'Log in first.');
      }
      if (!fn) fail('unknown', `Unknown message ${m.t}.`);
      const data = await fn(s, m);
      reply(true, { data: data || {} });
    } catch (err) {
      if (!err.code) console.error('[error]', err);
      reply(false, { error: err.code ? err.message : 'Something went wrong on the server.', code: err.code || 'server' });
      if (err.code === 'join_code' || err.code === 'full' || err.code === 'version') setTimeout(() => s.ws.close(4004, err.code), 100);
    }
  }

  // ---------- WebSocket server ----------
  const wss = new WebSocketServer({ port: config.port, maxPayload: 64 * 1024 });
  wss.on('connection', (ws, req) => {
    const s = { ws, ip: req.socket.remoteAddress, client: 'player', account: null, ninja: null, roomId: null, x: 0, y: 0, lastActive: Date.now(), alive: true };
    sessions.add(s);
    ws.on('pong', () => { s.alive = true; });
    ws.on('message', (raw) => handle(s, raw.toString()));
    ws.on('close', () => {
      leaveWorld(s);
      sessions.delete(s);
      presenceChanged();
    });
    ws.on('error', () => {});
  });

  const ticker = setInterval(() => { for (const s of sessions) s.msgCount = 0; }, 1000);
  // Ninjas who stay online past midnight still get the next day's streak reward.
  const dailyTimer = setInterval(() => { for (const s of authed()) claimDaily(s); }, 60 * 1000);
  const cozyTimer = setInterval(cozyTick, mountain.COZY_TICK_MS);
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const s of sessions) {
      if (!s.alive) { s.ws.terminate(); continue; }
      s.alive = false;
      s.ws.ping();
      if (s.account && now - s.lastActive > IDLE_KICK_MS) {
        leaveWorld(s); s.account = null;
        disconnect(s, 4005, 'Disconnected for being idle.');
      }
      if (s.account) savePosition(s);
    }
  }, 15000);

  // ---------- LAN discovery (UDP broadcast) ----------
  let udp = null, discoveryTimer = null;
  if (config.discovery) {
    udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udp.on('error', (e) => log(`[discovery] off: ${e.message}`));
    udp.bind(() => {
      try { udp.setBroadcast(true); } catch {}
      const beacon = () => {
        const msg = Buffer.from(JSON.stringify({ app: 'clubdojo', v: P.PROTOCOL_VERSION, name: config.serverName, port: config.port, online: authed().length, max: config.maxPlayers }));
        const targets = new Set(['255.255.255.255', ...lanAddresses().map((a) => broadcastAddress(a.address, a.netmask))]);
        for (const t of targets) udp.send(msg, P.DISCOVERY_PORT, t, () => {});
      };
      beacon();
      discoveryTimer = setInterval(beacon, 2000);
    });
  }

  wss.on('listening', () => {
    log('');
    log('  ClubDojo World Server is running');
    log('  ---------------------------------');
    log(`  Name:       ${config.serverName}`);
    const addrs = lanAddresses();
    if (addrs.length === 0) log(`  Address:    localhost:${config.port} (no LAN network found)`);
    for (const a of addrs) log(`  Address:    ${a.address}:${config.port}   (${a.name})`);
    log(`  Join code:  ${joinCode}`);
    log(`  Max ninjas: ${config.maxPlayers}`);
    log(`  Database:   ${db.file}`);
    if (db.seedChanges.length) log(`  Starter rooms: ${db.seedChanges.join(', ')} (old layouts kept in history)`);
    if (firstAdmin) {
      log('');
      log('  First run: created a Grandmaster account for the admin client');
      log(`    username: ${firstAdmin.username}`);
      log(`    password: ${firstAdmin.password}`);
      log(`  (also saved to ${path.join(config.dataDir, 'FIRST_RUN_ADMIN.txt')})`);
    }
    log('');
    log(`  Firewall: allow inbound TCP ${config.port} (and UDP ${P.DISCOVERY_PORT} on the laptops for auto-discovery).`);
    log('');
  });

  return {
    config,
    get joinCode() { return joinCode; },
    get online() { return authed().length; },
    ready: new Promise((resolve, reject) => { wss.once('listening', resolve); wss.once('error', reject); }),
    close() {
      clearInterval(ticker); clearInterval(dailyTimer); clearInterval(cozyTimer); clearInterval(heartbeat); clearInterval(discoveryTimer); clearTimeout(presenceTimer);
      minigames.shutdown();
      for (const s of sessions) { savePosition(s); s.account = null; s.ws.terminate(); }
      closed = true;
      if (udp) try { udp.close(); } catch {}
      return new Promise((r) => wss.close(() => { db.close(); r(); }));
    },
  };
}

// Command-line entry: start, print the banner, save and close cleanly on Ctrl+C.
// Packaged ClubDojo-Server.exe only: it checks GitHub for a newer build at startup and hourly.
// A downloaded build is installed at startup, or once nobody is online.
//   --reinstall   download the latest release again even if it matches this file
//   --no-update   never check (also CLUBDOJO_NO_UPDATE=1)
function runCli() {
  const argv = process.argv.slice(2);
  let packaged = false;
  try { packaged = require('node:sea').isSea(); } catch {}
  const autoUpdate = packaged && !argv.includes('--no-update') && process.env.CLUBDOJO_NO_UPDATE !== '1';
  const reinstall = packaged && argv.includes('--reinstall');
  const relaunchArgs = argv.filter((a) => a !== '--reinstall');
  const updateOpts = {
    kind: 'Server', target: process.execPath,
    stateFile: path.join(process.env.CLUBDOJO_DATA || defaultDataDir(), 'update-state.json'),
    log: (m) => console.log(`  ${m}`),
  };

  let server = null;
  let pending = null; // a downloaded build waiting for an empty server
  let checking = false;
  const checkForUpdate = async (force) => {
    if (checking || pending) return;
    checking = true;
    try {
      const r = await updater.checkForUpdate({ ...updateOpts, force });
      if (r.status === 'staged') { pending = r; console.log(`  Update ${r.asset.name} downloaded. It installs once nobody is online.`); }
    } catch (e) {
      console.log(`  Update check failed: ${e.message}`);
    } finally { checking = false; }
  };
  const installWhenIdle = async () => {
    if (!pending || !server || server.online > 0) return;
    console.log(`  Installing ${pending.asset.name}. The server restarts in a moment.`);
    updater.applyUpdate(pending, { args: relaunchArgs });
    await server.close();
    process.exit(0);
  };

  const shutdown = () => { console.log('\nSaving and shutting down...'); server.close().then(() => process.exit(0)); };
  const startServer = () => {
    server = start();
    server.ready.catch((e) => {
      console.error(e.code === 'EADDRINUSE' ? `Port ${server.config.port} is already in use. Is another ClubDojo server running?` : e);
      // Keep a double-clicked console window open long enough to read the error.
      setTimeout(() => process.exit(1), 15000);
    });
    server.ready.then(() => console.log('  Press Ctrl+C to save and stop the server.\n'));
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    if (autoUpdate) setInterval(() => checkForUpdate(false), 60 * 60 * 1000);
    // Also runs with --no-update, so a build staged by the "reinstall" command still gets installed.
    if (packaged) setInterval(installWhenIdle, 60 * 1000);
  };

  // Typed commands in the console window. "reinstall" fetches the latest release now and
  // installs it right away when nobody is online, otherwise as soon as the last player leaves.
  const runCommand = async (line) => {
    const cmd = line.trim().toLowerCase();
    if (!cmd) return;
    if (cmd === 'reinstall') {
      if (!packaged) { console.log('  reinstall only works in the packaged ClubDojo-Server.exe build.'); return; }
      if (checking) { console.log('  An update check is already running. Try again in a moment.'); return; }
      if (!pending) {
        console.log('  Checking GitHub for the latest release...');
        await checkForUpdate(true);
      }
      if (!pending) { console.log('  No download was staged. See the messages above.'); return; }
      console.log(`  ${pending.asset.name} is ready.`);
      await installWhenIdle();
      if (pending) console.log(`  Waiting for everyone to leave before installing ${pending.asset.name}.`);
    } else if (cmd === 'help') {
      console.log('  Commands: reinstall (fetch and install the latest release), help');
    } else {
      console.log(`  Unknown command "${cmd}". Type help for the list.`);
    }
  };
  require('node:readline').createInterface({ input: process.stdin, terminal: false })
    .on('line', (line) => runCommand(line).catch((e) => console.log(`  Command failed: ${e.message}`)));

  (async () => {
    if (autoUpdate || reinstall) {
      await checkForUpdate(reinstall);
      if (pending) {
        console.log(`  Installing ${pending.asset.name}. The server restarts in a moment.`);
        updater.applyUpdate(pending, { args: relaunchArgs });
        process.exit(0);
      }
    }
    startServer();
  })();
}

module.exports = { start, runCli };

if (require.main === module) runCli();
