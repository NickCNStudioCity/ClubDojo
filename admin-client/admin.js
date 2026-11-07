// Admin client: every player feature (the shared game) plus Grandmaster tools in a side dock.
// The server checks the Grandmaster role on every admin:* request and logs each change.
(function () {
  const game = ClubDojoGame.boot({ root: document.getElementById('app'), client: 'admin' });
  window.clubdojo = game;
  const { h, conn, P, toast } = game;
  const World = window.ClubDojoWorld;
  const dock = document.getElementById('dock');

  const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString() : '—');
  const fmtDur = (ms) => { const m = Math.floor(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  const req = (t, body) => conn.request(t, body).then((d) => { if (d.message) toast(d.message); return d; }).catch((e) => { toast(e.message, true); throw e; });

  let roomsCache = [];
  let worldSnap = null;
  let tab = 'world';

  const tabs = [['world', 'Live World'], ['players', 'Players'], ['map', 'Map Editor'], ['logs', 'Logs'], ['server', 'Server']];
  const tabBar = h('div', { class: 'dock-tabs', role: 'tablist' });
  const body = h('div', { class: 'dock-body' });
  dock.append(h('div', { class: 'dock-head' }, h('h1', {}, 'GRANDMASTER ', h('span', {}, 'TOOLS')), tabBar), body);

  function renderTabs() {
    tabBar.replaceChildren(...tabs.map(([id, label]) => h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => show(id) }, label)));
  }
  function show(id) {
    if (tab === 'map' && id !== 'map') editor.leave();
    tab = id;
    renderTabs();
    ({ world: renderWorld, players: renderPlayers, map: renderMap, logs: renderLogs, server: renderServer })[id]();
  }

  game.on('authed', async () => {
    dock.hidden = false;
    try { roomsCache = (await conn.request('admin:rooms')).rooms; } catch {}
    try { worldSnap = await conn.request('admin:world'); } catch {}
    show(tab);
  });
  game.on('disconnected', () => { dock.hidden = true; worldSnap = null; });
  conn.on('admin:world', (m) => { worldSnap = m; if (tab === 'world') renderWorld(); });

  const roomSelect = (value, attrs = {}) => h('select', attrs, roomsCache.map((r) => h('option', { value: r.id, selected: r.id === value }, r.name)));

  // ---------- Live World ----------
  function renderWorld() {
    const text = h('textarea', { maxlength: P.LIMITS.announceMax, placeholder: 'Announcement to every ninja online' });
    const blocks = (worldSnap?.rooms || []).map((r) => h('div', { class: 'box room-block' },
      h('header', {}, h('b', {}, r.name), h('div', { class: 'row' },
        h('span', { class: 'tag' }, `${r.players.length} ninja${r.players.length === 1 ? '' : 's'}`),
        r.players.some((p) => p.id === game.state.me?.id) ? null
          : h('button', { class: 'btn small alt', onclick: () => req('admin:teleport', { id: game.state.me.id, roomId: r.id }) }, 'Go here'))),
      r.players.length ? r.players.map((p) => {
        const sel = roomSelect(r.id);
        return h('div', { class: 'who' },
          h('span', { class: 'belt-chip', style: { background: P.beltById(p.belt).color } }),
          h('span', { class: 'name' }, p.name, ' ', p.role !== 'ninja' ? h('span', { class: `pill${p.role === 'grandmaster' ? ' gm' : ''}` }, p.role) : null),
          sel,
          h('button', { class: 'btn small alt', title: 'Teleport to the selected room', onclick: () => req('admin:teleport', { id: p.id, roomId: sel.value }) }, 'Move'),
          h('button', { class: 'btn small alt', onclick: () => { show('players'); openPlayer(p.id); } }, 'Open'),
          p.id === game.state.me?.id ? null : h('button', { class: 'btn small warn', onclick: () => { if (confirm(`Kick ${p.name}?`)) req('admin:kick', { id: p.id }); } }, 'Kick'));
      }) : h('div', { class: 'empty' }, 'Empty')));
    body.replaceChildren(
      h('h3', {}, 'Broadcast'),
      h('div', { class: 'box' }, text, h('div', { class: 'row', style: { marginTop: '8px' } }, h('span', { class: 'grow tag' }, 'Shows as a banner in every room.'),
        h('button', { class: 'btn small gold', onclick: () => req('admin:announce', { text: text.value }).then(() => { text.value = ''; }).catch(() => {}) }, 'Send announcement'))),
      h('h3', {}, `Rooms · ${worldSnap ? `${worldSnap.online}/${worldSnap.maxPlayers} online` : 'loading'}`),
      ...blocks);
  }

  // ---------- Players ----------
  let selectedPlayer = null;
  let searchText = '';
  let listEl, detailEl;
  function renderPlayers() {
    const search = h('input', { class: 'grow', placeholder: 'Search by username or ninja name', value: searchText,
      oninput: () => { searchText = search.value; clearTimeout(renderPlayers.t); renderPlayers.t = setTimeout(loadList, 200); } });
    listEl = h('div', { class: 'box', style: { maxHeight: '260px', overflowY: 'auto', padding: '4px' } }, h('div', { class: 'empty' }, 'Loading...'));
    detailEl = h('div');
    body.replaceChildren(h('h3', {}, 'Find a ninja'), h('div', { class: 'row', style: { marginBottom: '8px' } }, search), listEl, detailEl);
    loadList();
    if (selectedPlayer) openPlayer(selectedPlayer);
    search.focus();
  }
  async function loadList() {
    let players;
    try { players = (await conn.request('admin:players', { text: searchText })).players; } catch (e) { toast(e.message, true); return; }
    listEl.replaceChildren(...(players.length ? players.map((p) => h('button', { class: 'player-row', 'aria-current': String(p.id === selectedPlayer), onclick: () => openPlayer(p.id) },
      h('span', { class: `online-dot${p.online ? ' on' : ''}`, title: p.online ? 'Online' : 'Offline' }),
      h('span', {}, h('b', {}, p.name), ' ', h('small', {}, `@${p.username}`), ' ',
        p.role !== 'ninja' ? h('span', { class: `pill${p.role === 'grandmaster' ? ' gm' : ''}` }, p.role) : null,
        p.banned ? h('span', { class: 'pill bad' }, 'banned') : null),
      h('small', {}, P.beltById(p.belt).name))) : [h('div', { class: 'empty' }, 'No ninjas match.')]));
  }
  async function openPlayer(id) {
    selectedPlayer = id;
    if (!detailEl) return;
    let d;
    try { d = await conn.request('admin:player', { id }); } catch (e) { toast(e.message, true); return; }
    const { account: a, ninja: n, online } = d;
    const self = a.id === game.state.me?.id;
    const after = () => { openPlayer(id); loadList(); };
    const coins = h('input', { type: 'number', value: 0, style: { width: '90px' }, 'aria-label': 'Coins to add' });
    const xp = h('input', { type: 'number', value: 0, style: { width: '90px' }, 'aria-label': 'XP to add' });
    const belt = h('select', { 'aria-label': 'Belt' }, P.BELTS.map((b) => h('option', { value: b.id, selected: b.id === n.belt }, b.name)));
    const role = h('select', { 'aria-label': 'Role', disabled: self }, P.ROLES.map((r) => h('option', { value: r, selected: r === a.role }, r)));
    const mute = h('select', { 'aria-label': 'Mute length' }, [[5, '5 min'], [15, '15 min'], [60, '1 hour'], [1440, '1 day'], [0, 'Unmute']].map(([v, l]) => h('option', { value: v }, l)));
    const tpRoom = roomSelect(n.room_id);
    const pw = h('input', { type: 'text', class: 'grow', placeholder: `New password (${P.LIMITS.passwordMin}+ characters)`, autocomplete: 'off' });
    const muted = a.muted_until > Date.now();
    detailEl.replaceChildren(
      h('h3', {}, 'Ninja'),
      h('div', { class: 'box' },
        h('div', { class: 'row' }, h('span', { class: 'belt-chip', style: { background: P.beltById(n.belt).color } }),
          h('b', { class: 'grow', style: { fontSize: '16px' } }, n.name), h('span', { class: `online-dot${online ? ' on' : ''}` }), h('small', {}, online ? 'Online' : 'Offline')),
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('small', {}, 'Belt'), h('b', {}, P.beltById(n.belt).name)),
          h('div', { class: 'stat' }, h('small', {}, 'XP'), h('b', {}, n.xp)),
          h('div', { class: 'stat' }, h('small', {}, 'Coins'), h('b', {}, n.coins))),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Username'), h('dd', {}, `@${a.username}`),
          h('dt', {}, 'Role'), h('dd', {}, a.role),
          h('dt', {}, 'Room'), h('dd', {}, roomsCache.find((r) => r.id === n.room_id)?.name || n.room_id),
          h('dt', {}, 'Joined'), h('dd', {}, fmtTime(a.created_at)),
          h('dt', {}, 'Last login'), h('dd', {}, fmtTime(a.last_login_at)),
          h('dt', {}, 'Status'), h('dd', {}, a.banned ? 'Banned' : muted ? `Muted until ${fmtTime(a.muted_until)}` : 'Good standing'))),
      h('h3', {}, 'Rewards and rank'),
      h('div', { class: 'box' },
        h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Add coins / XP (negative removes)'), coins, xp,
          h('button', { class: 'btn small', onclick: () => req('admin:give', { id, coins: Number(coins.value), xp: Number(xp.value) }).then(after, () => {}) }, 'Apply')),
        h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Belt'), belt, h('button', { class: 'btn small', onclick: () => req('admin:setBelt', { id, belt: belt.value }).then(after, () => {}) }, 'Set')),
        h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Role'), role, h('button', { class: 'btn small', disabled: self, onclick: () => req('admin:setRole', { id, role: role.value }).then(after, () => {}) }, 'Set'))),
      h('h3', {}, 'Moderation'),
      h('div', { class: 'box' },
        h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Mute chat'), mute, h('button', { class: 'btn small alt', onclick: () => req('admin:mute', { id, minutes: Number(mute.value) }).then(after, () => {}) }, 'Apply')),
        online ? h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Teleport'), tpRoom, h('button', { class: 'btn small alt', onclick: () => req('admin:teleport', { id, roomId: tpRoom.value }).then(after, () => {}) }, 'Move')) : null,
        h('div', { class: 'row' }, h('input', { type: 'hidden' }), pw, h('button', { class: 'btn small alt', onclick: () => req('admin:resetPassword', { id, password: pw.value }).then(() => { pw.value = ''; }, () => {}) }, 'Reset password')),
        self ? null : h('div', { class: 'row', style: { marginTop: '12px' } },
          online ? h('button', { class: 'btn small warn', onclick: () => { if (confirm(`Kick ${n.name}?`)) req('admin:kick', { id }).then(after, () => {}); } }, 'Kick') : null,
          h('button', { class: 'btn small warn', onclick: () => { if (confirm(`${a.banned ? 'Unban' : 'Ban'} ${n.name}?`)) req('admin:ban', { id, banned: !a.banned }).then(after, () => {}); } }, a.banned ? 'Unban' : 'Ban'))));
  }

  // ---------- Map Editor ----------
  const BRUSH_COLORS = { '.': '#f4fafd', '#': '#9fb6c3', '~': '#6fb7dc', '=': '#d9c08a', '*': '#cdeaf7', ',': '#c99a6b' };
  const editor = {
    roomId: null, tiles: null, spawn: null, brush: '#', undo: [], redo: [], dirty: false, canvas: null, status: null, painting: false, stroke: null,
    room() { return roomsCache.find((r) => r.id === this.roomId); },
    load(room, fromDraft) {
      const src = fromDraft && room.draft ? room.draft : room;
      this.roomId = room.id;
      this.tiles = src.tiles.map((r) => r.split(''));
      this.spawn = { ...src.spawn };
      this.undo = []; this.redo = []; this.dirty = false;
    },
    data() { return { roomId: this.roomId, tiles: this.tiles.map((r) => r.join('')), spawn: this.spawn }; },
    snapshot() { return { tiles: this.tiles.map((r) => r.slice()), spawn: { ...this.spawn } }; },
    restore(s) { this.tiles = s.tiles.map((r) => r.slice()); this.spawn = { ...s.spawn }; },
    leave() { this.painting = false; },
  };

  function renderMap() {
    if (!roomsCache.length) { body.replaceChildren(h('div', { class: 'empty' }, 'Loading rooms...')); return; }
    if (!editor.roomId || !editor.room()) editor.load(roomsCache[0], false);
    const room = editor.room();
    const sel = roomSelect(editor.roomId, {
      class: 'grow',
      onchange: () => {
        if (editor.dirty && !confirm('Discard unsaved changes to this room?')) { sel.value = editor.roomId; return; }
        const r = roomsCache.find((x) => x.id === sel.value);
        editor.load(r, r.draft && confirm(`${r.name} has a saved draft. Load the draft?`));
        renderMap();
      },
    });
    const brushes = h('div', { class: 'brushes', role: 'toolbar', 'aria-label': 'Brushes' },
      ...Object.entries(P.TILES).map(([ch, t]) => h('button', { 'aria-pressed': String(editor.brush === ch), onclick: () => { editor.brush = ch; renderMap(); } },
        h('i', { style: { background: BRUSH_COLORS[ch] } }), t.name)),
      h('button', { 'aria-pressed': String(editor.brush === 'spawn'), onclick: () => { editor.brush = 'spawn'; renderMap(); } }, h('i', { style: { background: '#2f6fd1', borderRadius: '50%' } }), 'Spawn point'));
    const canvas = h('canvas', { class: 'editor-canvas', 'aria-label': `Map of ${room.name}. Drag to paint.` });
    editor.canvas = canvas;
    editor.status = h('div', { class: 'status-line' });
    const undoBtn = h('button', { class: 'btn small alt', onclick: () => step(editor.undo, editor.redo) }, 'Undo');
    const redoBtn = h('button', { class: 'btn small alt', onclick: () => step(editor.redo, editor.undo) }, 'Redo');
    function step(from, to) {
      if (!from.length) return;
      to.push(editor.snapshot());
      editor.restore(from.pop());
      editor.dirty = true;
      drawEditor();
    }
    body.replaceChildren(
      h('h3', {}, 'Room'),
      h('div', { class: 'row', style: { marginBottom: '10px' } }, sel, h('span', { class: 'tag' }, `v${room.version} published${room.draft ? ' · draft saved' : ''}`)),
      h('h3', {}, 'Brush'), brushes,
      h('div', { style: { marginTop: '10px' } }, canvas), editor.status,
      h('div', { class: 'row', style: { marginTop: '10px' } }, undoBtn, redoBtn,
        h('button', { class: 'btn small alt', onclick: () => { if (confirm('Throw away edits and reload the published room?')) { editor.load(room, false); renderMap(); } } }, 'Revert'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn small alt', onclick: () => req('admin:saveDraft', editor.data()).then(refreshRooms, () => {}) }, 'Save draft'),
        h('button', { class: 'btn small gold', onclick: () => { if (confirm(`Publish ${room.name} to every ninja now?`)) req('admin:publishRoom', editor.data()).then(() => { editor.dirty = false; refreshRooms(); }, () => {}); } }, 'Publish')),
      h('p', { class: 'tag', style: { marginTop: '12px', lineHeight: '1.5' } },
        'Paint walkable and blocked tiles. Doors (gold) and the spawn point (blue) must stay walkable. Buildings and other props are drawn on top of blocked tiles; placing props, NPCs and portals arrives in the next editor update.'));

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const T = r.width / room.width;
      return { x: Math.floor((e.clientX - r.left) / T), y: Math.floor((e.clientY - r.top) / T) };
    };
    const paint = (t) => {
      if (t.x < 0 || t.y < 0 || t.x >= room.width || t.y >= room.height) return;
      if (editor.brush === 'spawn') { editor.spawn = t; }
      else if (editor.tiles[t.y][t.x] !== editor.brush) editor.tiles[t.y][t.x] = editor.brush;
      else return;
      editor.dirty = true;
      drawEditor();
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      editor.undo.push(editor.snapshot()); editor.redo = [];
      if (editor.undo.length > 100) editor.undo.shift();
      editor.painting = true; paint(pos(e));
    });
    canvas.addEventListener('pointermove', (e) => {
      const t = pos(e);
      editor.status.textContent = t.x >= 0 && t.x < room.width && t.y >= 0 && t.y < room.height
        ? `Tile ${t.x}, ${t.y} · ${P.TILES[editor.tiles[t.y][t.x]].name}${P.portalAt(room, t.x, t.y) ? ` · door to ${P.portalAt(room, t.x, t.y).label}` : ''}` : '';
      if (editor.painting) paint(t);
    });
    canvas.addEventListener('pointerup', () => { editor.painting = false; });
    requestAnimationFrame(drawEditor);
  }

  function drawEditor() {
    const canvas = editor.canvas;
    if (!canvas || !canvas.isConnected) return;
    const room = editor.room();
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const T = w / room.width;
    canvas.style.height = `${T * room.height}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(T * room.height * dpr);
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const draft = { ...room, tiles: editor.tiles.map((r) => r.join('')) };
    World.drawStatic(c, draft, T);
    // Show the raw tile type over props so blocked areas under buildings are visible.
    c.globalAlpha = 0.28;
    for (let y = 0; y < room.height; y++) for (let x = 0; x < room.width; x++) {
      const ch = editor.tiles[y][x];
      if (ch === '#') { c.fillStyle = '#e8453c'; c.fillRect(x * T, y * T, T, T); }
    }
    c.globalAlpha = 1;
    c.strokeStyle = 'rgba(0,0,0,.08)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= room.width; x++) { c.moveTo(x * T + 0.5, 0); c.lineTo(x * T + 0.5, room.height * T); }
    for (let y = 0; y <= room.height; y++) { c.moveTo(0, y * T + 0.5); c.lineTo(room.width * T, y * T + 0.5); }
    c.stroke();
    c.fillStyle = '#2f6fd1';
    c.beginPath(); c.arc((editor.spawn.x + 0.5) * T, (editor.spawn.y + 0.5) * T, T * 0.45, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
  }
  new ResizeObserver(() => { if (tab === 'map') drawEditor(); }).observe(dock);

  async function refreshRooms() {
    try { roomsCache = (await conn.request('admin:rooms')).rooms; } catch {}
    if (tab === 'map') {
      // Keep the current edit buffer; just refresh version/draft labels.
      const snap = editor.snapshot(), dirty = editor.dirty, undo = editor.undo, redo = editor.redo;
      renderMap();
      editor.restore(snap); editor.dirty = dirty; editor.undo = undo; editor.redo = redo;
      drawEditor();
    }
  }

  // ---------- Logs ----------
  let logKind = 'chat';
  async function renderLogs() {
    const kind = h('select', { onchange: () => { logKind = kind.value; renderLogs(); } },
      [['chat', 'Chat log'], ['login', 'Login history'], ['admin', 'Admin actions']].map(([v, l]) => h('option', { value: v, selected: v === logKind }, l)));
    const table = h('table', { class: 'log' });
    body.replaceChildren(h('div', { class: 'row', style: { marginBottom: '10px' } }, kind, h('span', { class: 'grow' }), h('button', { class: 'btn small alt', onclick: renderLogs }, 'Refresh')), table);
    let rows;
    try { rows = (await conn.request('admin:logs', { kind: logKind })).rows; } catch (e) { toast(e.message, true); return; }
    const roomName = (id) => roomsCache.find((r) => r.id === id)?.name || id;
    const cols = {
      chat: [['Time', (r) => fmtTime(r.created_at), 'time'], ['Room', (r) => roomName(r.room_id)], ['Ninja', (r) => r.name], ['Message', (r) => r.message]],
      login: [['Time', (r) => fmtTime(r.created_at), 'time'], ['User', (r) => r.username], ['Result', (r) => (r.ok ? 'OK' : 'Failed')], ['From', (r) => `${r.ip || ''} · ${r.client || ''}`]],
      admin: [['Time', (r) => fmtTime(r.created_at), 'time'], ['Admin', (r) => r.admin_name], ['Action', (r) => r.action], ['Details', (r) => [r.target ? `#${r.target}` : '', r.details || ''].filter(Boolean).join(' ')]],
    }[logKind];
    table.replaceChildren(h('thead', {}, h('tr', {}, cols.map(([c]) => h('th', {}, c)))),
      h('tbody', {}, rows.length ? rows.map((r) => h('tr', { class: logKind === 'login' && !r.ok ? 'fail' : null }, cols.map(([, f, cls]) => h('td', { class: cls || null }, f(r)))))
        : h('tr', {}, h('td', { colspan: cols.length, class: 'empty' }, 'Nothing logged yet.'))));
  }

  // ---------- Server ----------
  async function renderServer() {
    let s;
    try { s = await conn.request('admin:server'); } catch (e) { toast(e.message, true); return; }
    body.replaceChildren(
      h('h3', {}, 'Join details for laptops'),
      h('div', { class: 'box' },
        h('dl', { class: 'kv' },
          h('dt', {}, 'Address'), h('dd', {}, s.addresses.length ? s.addresses.map((a) => `${a}:${s.port}`).join(', ') : `localhost:${s.port}`),
          h('dt', {}, 'Join code'), h('dd', {}, h('span', { class: 'code' }, s.joinCode))),
        h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'grow tag' }, 'A new code stops new joins with the old one.'),
          h('button', { class: 'btn small alt', onclick: () => { if (confirm('Make a new join code?')) req('admin:newJoinCode').then(renderServer, () => {}); } }, 'New code'))),
      h('h3', {}, 'Status'),
      h('div', { class: 'box' },
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('small', {}, 'Ninjas online'), h('b', {}, `${s.online} / ${s.maxPlayers}`)),
          h('div', { class: 'stat' }, h('small', {}, 'Connections'), h('b', {}, s.connections)),
          h('div', { class: 'stat' }, h('small', {}, 'Uptime'), h('b', {}, fmtDur(s.uptimeMs)))),
        h('dl', { class: 'kv' },
          h('dt', {}, 'Server name'), h('dd', {}, s.serverName),
          h('dt', {}, 'Port'), h('dd', {}, `${s.port} (TCP)`),
          h('dt', {}, 'Database'), h('dd', {}, s.dbFile))),
      h('h3', {}, 'Data'),
      h('div', { class: 'box' }, h('div', { class: 'row' }, h('span', { class: 'grow tag' }, 'Saves a copy of the database next to it in a backups folder on the host.'),
        h('button', { class: 'btn small gold', onclick: () => req('admin:backup').catch(() => {}) }, 'Back up now'))),
      h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn small alt', onclick: renderServer }, 'Refresh')));
  }

  renderTabs();
})();
