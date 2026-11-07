// End-to-end check: starts a throwaway server, connects two player clients and one admin
// client over real WebSockets, and verifies they see and affect each other.
// Run: npm run smoke
process.removeAllListeners('warning');
const os = require('os');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const P = require('../shared/protocol');
const { start } = require('../server/src/index');

const PORT = 7790 + Math.floor(Math.random() * 100);
const JOIN = 'TEST42';
const ADMIN_PW = 'admin-test-pw';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clubdojo-smoke-'));

class Client {
  constructor(label, client) {
    this.label = label; this.client = client; this.rid = 0; this.pending = new Map(); this.events = []; this.waiters = [];
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('close', (code) => { this.closedWith = code; });
      this.ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.t === 'reply') {
          const p = this.pending.get(m.rid); this.pending.delete(m.rid);
          return m.ok ? p.resolve(m.data) : p.reject(Object.assign(new Error(m.error), { code: m.code }));
        }
        this.events.push(m);
        this.waiters = this.waiters.filter((w) => (w.test(m) ? (w.resolve(m), false) : true));
      });
    });
  }
  req(t, body = {}) {
    const rid = ++this.rid;
    return new Promise((resolve, reject) => {
      this.pending.set(rid, { resolve, reject });
      this.ws.send(JSON.stringify({ t, rid, ...body }));
    });
  }
  waitFor(test, ms = 2000, what = 'event') {
    const hit = this.events.find(test);
    if (hit) { this.events.splice(this.events.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const w = { test, resolve: (m) => { clearTimeout(timer); this.events.splice(this.events.indexOf(m), 1); resolve(m); } };
      const timer = setTimeout(() => reject(new Error(`${this.label} timed out waiting for ${what}`)), ms);
      this.waiters.push(w);
    });
  }
  async hello(code = JOIN) { return this.req('hello', { v: P.PROTOCOL_VERSION, joinCode: code, client: this.client }); }
  close() { this.ws.close(); }
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };
const expectError = async (p, code) => {
  try { await p; } catch (e) { assert(e.code === code, `expected ${code}, got ${e.code}: ${e.message}`); return; }
  throw new Error(`expected error ${code}`);
};

(async () => {
  const server = start({ port: PORT, dataDir, joinCode: JOIN, adminPassword: ADMIN_PW, discovery: false, quiet: true });
  await server.ready;
  console.log(`ClubDojo smoke test on port ${PORT}`);

  const kai = new Client('kai', 'player');
  const mika = new Client('mika', 'player');
  const admin = new Client('admin', 'admin');
  await Promise.all([kai.open(), mika.open(), admin.open()]);

  await check('wrong join code is rejected', async () => {
    const bad = new Client('bad', 'player'); await bad.open();
    await expectError(bad.hello('WRONG1'), 'join_code');
  });

  await check('players say hello and register ninjas', async () => {
    const h = await kai.hello();
    assert(h.serverName && h.maxPlayers === 30, 'welcome missing fields');
    await mika.hello();
    const a = await kai.req('register', { username: 'kai', password: 'secret1', name: 'Kai', color: P.NINJA_COLORS[1] });
    assert(a.ninja.name === 'Kai' && a.ninja.belt === 'white', 'bad ninja');
    await kai.waitFor((m) => m.t === 'room:enter' && m.room.id === 'plaza', 2000, 'room:enter');
    await mika.req('register', { username: 'mika', password: 'secret2', name: 'Mika', color: P.NINJA_COLORS[2] });
    const enter = await mika.waitFor((m) => m.t === 'room:enter', 2000, 'room:enter');
    assert(enter.players.some((p) => p.name === 'Kai'), 'Mika should see Kai already in the plaza');
    await kai.waitFor((m) => m.t === 'player:join' && m.player.name === 'Mika', 2000, 'Mika join');
  });

  await check('duplicate username and bad words are refused', async () => {
    const dup = new Client('dup', 'player'); await dup.open(); await dup.hello();
    await expectError(dup.req('register', { username: 'KAI', password: 'secret1', name: 'Other', color: P.NINJA_COLORS[0] }), 'username');
    await expectError(dup.req('register', { username: 'nice1', password: 'secret1', name: 'stupid ninja', color: P.NINJA_COLORS[0] }), 'name');
    dup.close();
  });

  await check('player client cannot use admin tools', async () => {
    await expectError(kai.req('admin:world'), 'forbidden');
  });

  await check('ninja account cannot log in to the admin client', async () => {
    const sneaky = new Client('sneaky', 'admin'); await sneaky.open(); await sneaky.hello();
    await expectError(sneaky.req('login', { username: 'kai', password: 'secret1' }), 'not_admin');
    sneaky.close();
  });

  await check('admin logs in and sees both players in the live world', async () => {
    await admin.hello();
    await expectError(admin.req('login', { username: 'admin', password: 'nope' }), 'bad_login');
    const r = await admin.req('login', { username: 'admin', password: ADMIN_PW });
    assert(r.ninja.role === 'grandmaster', 'admin role');
    await kai.waitFor((m) => m.t === 'player:join' && m.player.name === 'Grandmaster', 2000, 'admin join');
    const w = await admin.req('admin:world');
    const plaza = w.rooms.find((x) => x.id === 'plaza');
    const names = plaza.players.map((p) => p.name).sort();
    assert(JSON.stringify(names) === JSON.stringify(['Grandmaster', 'Kai', 'Mika']), `plaza has ${names}`);
    assert(w.online === 3, `online ${w.online}`);
  });

  await check('movement is validated and broadcast', async () => {
    await kai.req('move', { x: 22, y: 15 });
    const mv = await mika.waitFor((m) => m.t === 'player:move' && m.x === 22, 2000, 'move');
    assert(P.findPath(server_room('plaza'), mv.from, { x: 22, y: 15 }), 'clients can rebuild the path');
    await expectError(kai.req('move', { x: 30, y: 17 }), 'blocked'); // pond
  });

  await check('room chat reaches the room, filtered', async () => {
    await mika.req('chat', { text: 'hi kai, you are stupid fast' });
    const c = await kai.waitFor((m) => m.t === 'chat', 2000, 'chat');
    assert(c.name === 'Mika' && c.text === 'hi kai, you are ****** fast', `got "${c.text}"`);
    await admin.waitFor((m) => m.t === 'chat', 2000, 'admin sees chat');
  });

  await check('walking through a door changes rooms', async () => {
    await kai.req('move', { x: 19, y: 9 });
    await kai.req('portal');
    const e = await kai.waitFor((m) => m.t === 'room:enter' && m.room.id === 'dojo', 2000, 'dojo enter');
    assert(e.room.name === 'Main Dojo', 'dojo name');
    await mika.waitFor((m) => m.t === 'player:leave' && m.id === e.you, 2000, 'Kai leaves plaza');
    const w = await admin.waitFor((m) => m.t === 'admin:world' && m.rooms.find((r) => r.id === 'dojo').players.length === 1, 2000, 'admin world push');
    assert(w.rooms.find((r) => r.id === 'dojo').players[0].name === 'Kai', 'admin sees Kai in dojo');
  });

  await check('admin announcement reaches every room', async () => {
    await admin.req('admin:announce', { text: 'Shuriken Arena opens soon!' });
    const a1 = await kai.waitFor((m) => m.t === 'announce', 2000, 'announce kai');
    const a2 = await mika.waitFor((m) => m.t === 'announce', 2000, 'announce mika');
    assert(a1.text === a2.text && a1.from === 'Grandmaster', 'announce body');
  });

  await check('admin teleports a ninja', async () => {
    const list = await admin.req('admin:players', { text: 'mika' });
    const id = list.players[0].id;
    await admin.req('admin:teleport', { id, roomId: 'ramen' });
    await mika.waitFor((m) => m.t === 'room:enter' && m.room.id === 'ramen', 2000, 'mika to ramen');
  });

  await check('admin gives coins and sets a belt; the player sees it', async () => {
    const { players } = await admin.req('admin:players', { text: 'kai' });
    const id = players[0].id;
    await admin.req('admin:give', { id, coins: 50, xp: 120 });
    const you = await kai.waitFor((m) => m.t === 'you' && m.ninja.coins === 150, 2000, 'coins update');
    assert(you.ninja.xp === 120, 'xp');
    await admin.req('admin:setBelt', { id, belt: 'yellow' });
    await kai.waitFor((m) => m.t === 'you' && m.ninja.belt === 'yellow', 2000, 'belt update');
  });

  await check('admin mutes a ninja', async () => {
    const id = (await admin.req('admin:players', { text: 'mika' })).players[0].id;
    await admin.req('admin:mute', { id, minutes: 5 });
    await new Promise((r) => setTimeout(r, 700));
    await expectError(mika.req('chat', { text: 'hello?' }), 'muted');
    await admin.req('admin:mute', { id, minutes: 0 });
  });

  await check('admin publishes a map edit; players inside get the new layout', async () => {
    const { rooms } = await admin.req('admin:rooms');
    const ramen = rooms.find((r) => r.id === 'ramen');
    const tiles = ramen.tiles.slice();
    tiles[15] = tiles[15].slice(0, 2) + '~~~' + tiles[15].slice(5);
    await admin.req('admin:saveDraft', { roomId: 'ramen', tiles });
    assert((await admin.req('admin:rooms')).rooms.find((r) => r.id === 'ramen').draft, 'draft stored');
    const r = await admin.req('admin:publishRoom', { roomId: 'ramen', tiles });
    assert(r.version === 2, 'version bump');
    const e = await mika.waitFor((m) => m.t === 'room:enter' && m.updated, 2000, 'room update');
    assert(e.room.tiles[15].slice(2, 5) === '~~~', 'new tiles');
  });

  await check('logs record chat, logins, and admin actions', async () => {
    const chat = await admin.req('admin:logs', { kind: 'chat' });
    assert(chat.rows.some((r) => r.message.includes('stupid fast')), 'chat log keeps original for moderation');
    const adm = await admin.req('admin:logs', { kind: 'admin' });
    assert(['announce', 'teleport', 'give', 'setBelt', 'publishRoom'].every((a) => adm.rows.some((r) => r.action === a)), 'admin actions logged');
    const lg = await admin.req('admin:logs', { kind: 'login' });
    assert(lg.rows.some((r) => !r.ok && r.username === 'admin'), 'failed login logged');
  });

  await check('server info and backup', async () => {
    const info = await admin.req('admin:server');
    assert(info.joinCode === JOIN && info.port === PORT, 'server info');
    const b = await admin.req('admin:backup');
    assert(/Backup saved/.test(b.message), 'backup');
  });

  await check('admin kicks a ninja; others see them leave', async () => {
    const id = (await admin.req('admin:players', { text: 'kai' })).players[0].id;
    await admin.req('admin:kick', { id, reason: 'test' });
    const k = await kai.waitFor((m) => m.t === 'kicked', 2000, 'kicked');
    assert(/test/.test(k.reason), 'kick reason');
    const w = await admin.waitFor((m) => m.t === 'admin:world' && m.online === 2, 2000, 'online drops to 2');
    assert(!w.rooms.some((r) => r.players.some((p) => p.name === 'Kai')), 'Kai gone');
  });

  await check('position persists across logins', async () => {
    const again = new Client('kai2', 'player'); await again.open(); await again.hello();
    await again.req('login', { username: 'kai', password: 'secret1' });
    const e = await again.waitFor((m) => m.t === 'room:enter', 2000, 'room:enter');
    assert(e.room.id === 'dojo', `back in ${e.room.id}`);
    again.close();
  });

  function server_room(id) { return require('../server/src/rooms-seed')().find((r) => r.id === id); }

  for (const c of [kai, mika, admin]) c.close();
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log(`\n${passed} checks passed${process.exitCode ? ', some FAILED' : ''}.`);
})().catch((e) => { console.error(e); process.exit(1); });
