// SQLite storage (Node's built-in node:sqlite). One file on the host: copy it to back up.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const seedRooms = require('./rooms-seed');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'ninja',
  banned INTEGER NOT NULL DEFAULT 0,
  muted_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS ninjas (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  belt TEXT NOT NULL DEFAULT 'white',
  xp INTEGER NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 100,
  color TEXT NOT NULL DEFAULT '#20262e',
  headband TEXT NOT NULL DEFAULT '#e8453c',
  room_id TEXT NOT NULL DEFAULT 'plaza',
  x INTEGER, y INTEGER
);
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  published_version INTEGER NOT NULL DEFAULT 1,
  draft TEXT
);
CREATE TABLE IF NOT EXISTS room_versions (
  room_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL,
  created_by INTEGER, created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, version)
);
CREATE TABLE IF NOT EXISTS chat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT, account_id INTEGER, name TEXT,
  message TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, admin_name TEXT, action TEXT NOT NULL,
  target TEXT, details TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, username TEXT, ok INTEGER NOT NULL,
  ip TEXT, client TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS minigame_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, game_id TEXT NOT NULL,
  score INTEGER NOT NULL, place INTEGER, players INTEGER, played_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS minigame_scores_game ON minigame_scores (game_id, score DESC);
`;

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'clubdojo.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  const now = () => Date.now();
  const q = (sql) => db.prepare(sql);

  // Columns added after v1.0.0.
  const ninjaCols = q('PRAGMA table_info(ninjas)').all().map((c) => c.name);
  if (!ninjaCols.includes('accessories')) db.exec("ALTER TABLE ninjas ADD COLUMN accessories TEXT NOT NULL DEFAULT '{}'");
  // Daily streak, daily challenges and lifetime challenge count (server/src/progress.js).
  if (!ninjaCols.includes('progress')) db.exec("ALTER TABLE ninjas ADD COLUMN progress TEXT NOT NULL DEFAULT '{}'");

  // Seed rooms on first run, and upgrade starter rooms when the seed changes
  // (for example the v1.1 forest hub). The old layout stays in room_versions.
  const roomCount = q('SELECT COUNT(*) AS n FROM rooms').get().n;
  const settingRow = q("SELECT value FROM settings WHERE key = 'seed_version'").get();
  const storedSeed = settingRow ? Number(settingRow.value) : roomCount === 0 ? 0 : 1;
  const seedChanges = [];
  if (storedSeed < seedRooms.SEED_VERSION) {
    const ins = q('INSERT INTO rooms (id, name, data) VALUES (?, ?, ?)');
    const ver = q('INSERT INTO room_versions (room_id, version, data, created_at) VALUES (?, ?, ?, ?)');
    const cur = q('SELECT published_version FROM rooms WHERE id = ?');
    const upd = q('UPDATE rooms SET data = ?, name = ?, published_version = ?, draft = NULL WHERE id = ?');
    for (const r of seedRooms()) {
      const json = JSON.stringify(r);
      const existing = cur.get(r.id);
      if (!existing) { ins.run(r.id, r.name, json); ver.run(r.id, 1, json, now()); if (roomCount) seedChanges.push(`added ${r.name}`); }
      else if ((r.seedVersion || 1) > storedSeed) {
        const v = existing.published_version + 1;
        upd.run(json, r.name, v, r.id);
        ver.run(r.id, v, json, now());
        seedChanges.push(`updated ${r.name} to v${v}`);
      }
    }
    q("INSERT INTO settings (key, value) VALUES ('seed_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(seedRooms.SEED_VERSION));
  }

  const api = {
    file,
    seedChanges,
    getJsonSetting(key) {
      const v = api.getSetting(key);
      try { return v ? JSON.parse(v) : null; } catch { return null; }
    },
    setJsonSetting(key, value) { api.setSetting(key, JSON.stringify(value)); },

    // Minigames
    recordMinigameScore(accountId, gameId, score, place, players) {
      q('INSERT INTO minigame_scores (account_id, game_id, score, place, players, played_at) VALUES (?, ?, ?, ?, ?, ?)').run(accountId, gameId, score, place, players, now());
    },
    addRewards(accountId, coins, xp) {
      q('UPDATE ninjas SET coins = coins + ?, xp = xp + ? WHERE account_id = ?').run(coins, xp, accountId);
    },
    topMinigameScores(gameId, limit) {
      return q(`SELECT n.name, MAX(s.score) AS score, COUNT(*) AS plays FROM minigame_scores s JOIN ninjas n ON n.account_id = s.account_id
                WHERE s.game_id = ? GROUP BY s.account_id ORDER BY score DESC LIMIT ?`).all(gameId, limit || 10);
    },
    // The Cafe's Hall of Fame: most wins across the card games.
    topCardPlayers(games, limit) {
      const marks = games.map(() => '?').join(',');
      return q(`SELECT n.name, SUM(s.place = 1 AND s.score > 0) AS wins, COUNT(*) AS plays FROM minigame_scores s JOIN ninjas n ON n.account_id = s.account_id
                WHERE s.game_id IN (${marks}) GROUP BY s.account_id ORDER BY wins DESC, plays ASC LIMIT ?`).all(...games, limit || 8);
    },
    // Totals the belt tests read: rounds played, different games played, and first places
    // with a score above zero.
    progressRecord(accountId) {
      return q(`SELECT COUNT(*) AS plays, COUNT(DISTINCT game_id) AS distinct_games, COALESCE(SUM(place = 1 AND score > 0), 0) AS wins
                FROM minigame_scores WHERE account_id = ?`).get(accountId);
    },
    minigameStats(accountId) {
      return q('SELECT game_id, COUNT(*) AS plays, MAX(score) AS best, SUM(place = 1) AS wins FROM minigame_scores WHERE account_id = ? GROUP BY game_id').all(accountId);
    },
    getSetting(key) {
      const row = q('SELECT value FROM settings WHERE key = ?').get(key);
      return row ? row.value : null;
    },
    setSetting(key, value) {
      q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
    },

    // Accounts and ninjas
    findAccount(username) {
      return q('SELECT * FROM accounts WHERE username = ?').get(username);
    },
    getAccount(id) {
      return q('SELECT * FROM accounts WHERE id = ?').get(id);
    },
    nameTaken(name) {
      return !!q('SELECT 1 FROM ninjas WHERE name = ?').get(name);
    },
    createAccount({ username, passwordHash, role, name, color }) {
      const res = q('INSERT INTO accounts (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)').run(username, passwordHash, role || 'ninja', now());
      const id = Number(res.lastInsertRowid);
      q('INSERT INTO ninjas (account_id, name, color) VALUES (?, ?, ?)').run(id, name, color);
      return id;
    },
    countRole(role) {
      return q('SELECT COUNT(*) AS n FROM accounts WHERE role = ?').get(role).n;
    },
    getNinja(accountId) {
      return q('SELECT * FROM ninjas WHERE account_id = ?').get(accountId);
    },
    saveNinjaPosition(accountId, roomId, x, y) {
      q('UPDATE ninjas SET room_id = ?, x = ?, y = ? WHERE account_id = ?').run(roomId, x, y, accountId);
    },
    updateNinja(accountId, fields) {
      const allowed = ['belt', 'xp', 'coins', 'color', 'headband', 'progress'];
      for (const k of Object.keys(fields)) {
        if (!allowed.includes(k)) continue;
        q(`UPDATE ninjas SET ${k} = ? WHERE account_id = ?`).run(fields[k], accountId);
      }
    },
    updateAccount(accountId, fields) {
      const allowed = ['role', 'banned', 'muted_until', 'password_hash', 'last_login_at'];
      for (const k of Object.keys(fields)) {
        if (!allowed.includes(k)) continue;
        q(`UPDATE accounts SET ${k} = ? WHERE id = ?`).run(fields[k], accountId);
      }
    },
    searchPlayers(text, limit) {
      const like = `%${text || ''}%`;
      return q(`SELECT a.id, a.username, a.role, a.banned, a.muted_until, a.created_at, a.last_login_at,
                       n.name, n.belt, n.xp, n.coins, n.color, n.room_id
                FROM accounts a JOIN ninjas n ON n.account_id = a.id
                WHERE a.username LIKE ? OR n.name LIKE ?
                ORDER BY a.last_login_at DESC NULLS LAST, a.id LIMIT ?`).all(like, like, limit || 100);
    },

    // Rooms
    listRooms() {
      return q('SELECT id, name, data, published_version, draft FROM rooms ORDER BY rowid').all().map((r) => ({
        ...JSON.parse(r.data), version: r.published_version, hasDraft: !!r.draft,
      }));
    },
    getDraft(roomId) {
      const row = q('SELECT draft FROM rooms WHERE id = ?').get(roomId);
      return row && row.draft ? JSON.parse(row.draft) : null;
    },
    saveDraft(roomId, data) {
      q('UPDATE rooms SET draft = ? WHERE id = ?').run(data ? JSON.stringify(data) : null, roomId);
    },
    publishRoom(roomId, data, adminId) {
      const cur = q('SELECT published_version FROM rooms WHERE id = ?').get(roomId);
      const version = cur.published_version + 1;
      const json = JSON.stringify(data);
      q('UPDATE rooms SET data = ?, name = ?, published_version = ?, draft = NULL WHERE id = ?').run(json, data.name, version, roomId);
      q('INSERT INTO room_versions (room_id, version, data, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(roomId, version, json, adminId, now());
      return version;
    },

    // Logs
    logChat(roomId, accountId, name, message) {
      q('INSERT INTO chat_log (room_id, account_id, name, message, created_at) VALUES (?, ?, ?, ?, ?)').run(roomId, accountId, name, message, now());
    },
    logAdmin(adminId, adminName, action, target, details) {
      q('INSERT INTO admin_log (admin_id, admin_name, action, target, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(adminId, adminName, action, target == null ? null : String(target), details ? JSON.stringify(details) : null, now());
    },
    logLogin(accountId, username, ok, ip, client) {
      q('INSERT INTO login_log (account_id, username, ok, ip, client, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(accountId, username, ok ? 1 : 0, ip, client, now());
    },
    readLog(kind, limit) {
      const table = { chat: 'chat_log', admin: 'admin_log', login: 'login_log' }[kind];
      if (!table) return [];
      return q(`SELECT * FROM ${table} ORDER BY id DESC LIMIT ?`).all(limit || 200);
    },

    backup(destDir) {
      fs.mkdirSync(destDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dest = path.join(destDir, `clubdojo-${stamp}.sqlite`);
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
      return dest;
    },
    close() {
      db.close();
    },
  };
  return api;
}

module.exports = { open };
