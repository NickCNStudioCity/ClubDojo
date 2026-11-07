// ClubDojo game app: connect screen, login/create ninja, and the in-world HUD and panels.
// Shared by the player client and the admin client (which adds its tools via the returned API).
(function () {
  const P = window.ClubDojoProtocol;
  const Connection = window.ClubDojoConnection;
  const World = window.ClubDojoWorld;
  const EMOTE_KEYS = Object.keys(P.EMOTES);

  // Tiny DOM helper. Strings become text nodes, so user content is never parsed as HTML.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }

  let prefsKey = 'clubdojo:prefs:player';
  function loadPrefs() { try { return JSON.parse(localStorage.getItem(prefsKey)) || {}; } catch { return {}; } }
  function savePrefs(p) { try { localStorage.setItem(prefsKey, JSON.stringify({ ...loadPrefs(), ...p })); } catch {} }

  function boot({ root, client = 'player', host = window.clubdojoHost || {} }) {
    const isAdmin = client === 'admin';
    prefsKey = `clubdojo:prefs:${client}`;
    const conn = new Connection();
    const bus = new EventTarget();
    const state = { me: null, room: null, online: 0, serverName: '', address: '', phase: 'connect', kickReason: null };
    const emit = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

    // ---------- skeleton ----------
    const canvas = h('canvas', { class: 'world', 'aria-label': 'Game world. Click to walk.' });
    const toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    const banner = h('div', { class: 'announce-banner', role: 'status', hidden: true });
    const modalWrap = h('div', { class: 'modal-wrap', hidden: true, onclick: (e) => { if (e.target === modalWrap) closeModal(); } });
    const hud = h('div', { class: 'hud', hidden: true });
    const screens = h('div');
    const win = h('main', { class: 'window', 'aria-label': 'ClubDojo game window' }, canvas, hud, banner, modalWrap, screens, toasts);
    root.append(win);

    const world = new World(canvas, {
      onTileClick: (t) => walkTo(t),
      onArrive: (t) => {
        if (state.pendingPortal && P.portalAt(state.room, t.x, t.y)) {
          state.pendingPortal = false;
          conn.request('portal').catch((e) => toast(e.message, true));
        }
      },
    });
    world.start();

    function toast(msg, bad) {
      const t = h('div', { class: `toast${bad ? ' bad' : ''}` }, msg);
      toasts.append(t);
      setTimeout(() => t.remove(), 3200);
    }

    // ---------- HUD ----------
    const ui = {};
    ui.sash = h('div', { class: 'sash-icon', 'aria-hidden': 'true' });
    ui.beltName = h('div', { class: 'belt-name' });
    ui.ninjaName = h('div', { class: 'ninja-name' });
    ui.xpFill = h('i');
    ui.xpText = h('div', { class: 'xp-text' });
    ui.roomName = h('b');
    ui.online = h('small');
    ui.coins = h('b');
    ui.chatLog = h('div', { class: 'chat-log', role: 'log', 'aria-label': 'Room chat messages' });
    ui.chatInput = h('input', { type: 'text', placeholder: 'Say something... (Enter)', 'aria-label': 'Chat message', maxlength: P.LIMITS.chatMax });
    ui.minimap = h('canvas', { width: 400, height: 240 });
    ui.minimapPanel = h('div', { class: 'panel minimap', hidden: true }, ui.minimap);
    ui.emotePop = h('div', { class: 'panel emote-pop', hidden: true, role: 'toolbar', 'aria-label': 'Emotes' },
      EMOTE_KEYS.map((k, i) => h('button', { title: k, onclick: () => { doEmote(k); ui.emotePop.hidden = true; } }, P.EMOTES[k], h('kbd', {}, String(i + 1)))));
    ui.chat = h('section', { class: 'panel chat', 'aria-label': 'Room chat' },
      h('div', { class: 'chat-head' }, h('span', { class: 'label' }, 'Room chat'),
        h('button', { class: 'chat-toggle', onclick: () => { ui.chat.classList.toggle('collapsed'); } }, 'hide / show')),
      ui.chatLog,
      h('form', { class: 'chat-input', onsubmit: (e) => { e.preventDefault(); sendChat(); } }, ui.chatInput));

    const menuItems = [
      ['Quests', openQuests, true], ['Ninja', openNinja], ['Inventory', openInventory], ['Shop', openShop],
      ['Friends', openFriends], ['Minigames', openMinigames, true], ['Emotes', () => { ui.emotePop.hidden = !ui.emotePop.hidden; }],
    ];

    hud.append(
      h('section', { class: 'panel belt-card', 'aria-label': 'Belt progress' },
        h('div', { class: 'belt-row' }, ui.sash, h('div', {}, ui.beltName, ui.ninjaName)),
        h('div', { class: 'xp', 'aria-hidden': 'true' }, ui.xpFill), ui.xpText),
      h('div', { class: 'panel room-tag', 'aria-label': 'Current room' }, ui.roomName, ui.online),
      h('button', { class: 'panel minimap-btn', 'aria-label': 'Toggle mini map', onclick: () => { ui.minimapPanel.hidden = !ui.minimapPanel.hidden; drawMinimap(); } }, 'Map'),
      ui.minimapPanel,
      h('div', { class: 'panel coins', 'aria-label': 'Coins' }, h('span', { class: 'coin', 'aria-hidden': 'true' }), ui.coins),
      h('button', { class: 'panel quest', 'aria-label': 'Active quest. Open quest log.', onclick: openQuests },
        h('div', { class: 'label' }, 'Active quest'), h('b', {}, 'Earn your next belt'),
        ui.questStep = h('div', { class: 'step' }, 'Quests arrive in a coming update')),
      ui.chat,
      ui.emotePop,
      h('nav', { class: 'panel menu', 'aria-label': 'Game menu' },
        menuItems.map(([label, fn, primary]) => h('button', { class: `btn${primary ? '' : ' alt'}`, onclick: fn }, label))),
    );

    function renderHud() {
      const me = state.me;
      if (!me) return;
      const belt = P.beltById(me.belt);
      const next = P.nextBelt(me.belt);
      ui.sash.style.background = belt.color;
      ui.beltName.textContent = belt.name;
      ui.ninjaName.textContent = `${me.role === 'grandmaster' ? '★ ' : me.role === 'sensei' ? '☆ ' : ''}${me.name} · ${me.xp.toLocaleString()} XP`;
      if (next) {
        const pct = Math.max(0, Math.min(100, ((me.xp - belt.xp) / (next.xp - belt.xp)) * 100));
        ui.xpFill.style.width = `${pct}%`;
        ui.xpText.textContent = me.xp >= next.xp ? `Ready for the ${next.name} test` : `Next: ${next.name}, ${(next.xp - me.xp).toLocaleString()} XP to go`;
      } else {
        ui.xpFill.style.width = '100%';
        ui.xpText.textContent = 'Highest belt. Dan levels coming soon.';
      }
      ui.coins.textContent = me.coins.toLocaleString();
      ui.questStep.textContent = next ? `Reach ${next.xp} XP for the ${next.name}` : 'You have mastered the belts';
    }
    function renderRoomTag() {
      ui.roomName.textContent = state.room ? state.room.name : '';
      ui.online.textContent = `${state.online} online`;
    }

    function drawMinimap() {
      if (ui.minimapPanel.hidden || !state.room) return;
      const c = ui.minimap.getContext('2d');
      const r = state.room;
      const T = Math.min(ui.minimap.width / r.width, ui.minimap.height / r.height);
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, ui.minimap.width, ui.minimap.height);
      World.drawStatic(c, r, T);
      for (const n of world.players.values()) {
        c.fillStyle = n.id === state.me?.id ? '#e8453c' : '#2f6fd1';
        c.beginPath(); c.arc(n.px * T, n.py * T, T * 0.7, 0, Math.PI * 2); c.fill();
      }
    }
    setInterval(drawMinimap, 500);

    function chatLine(parts, cls) {
      const p = h('p', { class: cls || null }, parts);
      const atBottom = ui.chatLog.scrollTop + ui.chatLog.clientHeight >= ui.chatLog.scrollHeight - 8;
      ui.chatLog.append(p);
      while (ui.chatLog.children.length > 80) ui.chatLog.firstChild.remove();
      if (atBottom) ui.chatLog.scrollTop = ui.chatLog.scrollHeight;
    }

    function showBanner(text, from) {
      banner.replaceChildren(h('small', {}, `Announcement from ${from}`), text);
      banner.hidden = false;
      clearTimeout(showBanner.t);
      showBanner.t = setTimeout(() => { banner.hidden = true; }, 8000);
    }

    // ---------- actions ----------
    function walkTo(t) {
      if (!state.room || !state.me) return;
      closeEmotes();
      let target = t;
      const portal = P.portalAt(state.room, t.x, t.y);
      if (!portal && !P.isWalkable(state.room, t.x, t.y)) {
        // Clicking a building walks to its door; otherwise go to the nearest open tile.
        target = nearestDoor(t) || nearestWalkable(t);
        if (!target) { world.showMarker(t, false); return; }
      }
      state.pendingPortal = !!P.portalAt(state.room, target.x, target.y);
      world.showMarker(target, true);
      const me = world.players.get(state.me.id);
      if (me && me.x === target.x && me.y === target.y && !me.path.length) {
        if (state.pendingPortal) { state.pendingPortal = false; conn.request('portal').catch((e) => toast(e.message, true)); }
        return;
      }
      conn.request('move', target).catch(() => { state.pendingPortal = false; world.showMarker(target, false); });
    }
    function nearestDoor(t) {
      const building = (state.room.props || []).find((p) => (p.type === 'building') && t.x >= p.x && t.x < p.x + p.w && t.y >= p.y && t.y < p.y + p.h);
      if (!building) return null;
      const door = (state.room.portals || []).find((p) => p.x >= building.x - 1 && p.x < building.x + building.w + 1 && p.y >= building.y + building.h - 1 && p.y <= building.y + building.h + 1);
      return door ? { x: door.x, y: door.y } : null;
    }
    function nearestWalkable(t) {
      for (let r = 1; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (P.isWalkable(state.room, t.x + dx, t.y + dy) && !P.portalAt(state.room, t.x + dx, t.y + dy)) return { x: t.x + dx, y: t.y + dy };
      }
      return null;
    }
    function sendChat() {
      const text = ui.chatInput.value.trim();
      if (!text) { ui.chatInput.blur(); return; }
      ui.chatInput.value = '';
      conn.request('chat', { text }).catch((e) => chatLine(e.message, 'sys'));
    }
    function doEmote(k) { conn.request('emote', { emote: k }).catch(() => {}); }
    function closeEmotes() { ui.emotePop.hidden = true; }

    // ---------- modals ----------
    let modalOpen = false;
    function openModal(kicker, title, ...body) {
      const closeBtn = h('button', { class: 'close', 'aria-label': 'Close', onclick: closeModal }, '×');
      const modal = h('section', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        closeBtn, h('div', { class: 'label' }, kicker), h('h2', {}, title), ...body);
      modalWrap.replaceChildren(modal);
      modalWrap.hidden = false;
      modalOpen = true;
      closeBtn.focus();
      return modal;
    }
    function closeModal() { modalWrap.hidden = true; modalWrap.replaceChildren(); modalOpen = false; }

    function openQuests() {
      const me = state.me;
      const rows = P.BELTS.map((b) => {
        const done = me.xp >= b.xp && P.BELTS.findIndex((x) => x.id === b.id) <= P.BELTS.findIndex((x) => x.id === me.belt);
        return h('div', { class: 'objective' },
          h('span', { class: `check${done ? ' done' : ''}`, 'aria-hidden': 'true' }),
          h('span', { class: 'belt-chip', style: { background: b.color } }),
          h('div', { class: 'grow' }, b.name, h('small', { class: 'muted', style: { display: 'block' } }, b.xp ? `${b.xp} XP plus a belt test` : 'Account creation')),
          b.id === me.belt ? h('b', {}, 'Current') : null);
      });
      openModal('Quest log', 'Belt path',
        h('p', { class: 'muted' }, 'Quest lines and belt tests come in a later update. For now, this is the path from White to Black Belt.'),
        ...rows,
        h('div', { class: 'foot' }, h('span', { class: 'muted' }, `You have ${me.xp} XP`), h('button', { class: 'btn ghost', onclick: closeModal }, 'Close')));
    }

    function openNinja() {
      const me = state.me;
      let color = me.color, headband = me.headband;
      const preview = h('canvas', { width: 120, height: 140 });
      const draw = () => {
        const c = preview.getContext('2d');
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, 120, 140);
        World.drawNinja(c, { x: 1.5, y: 2.6, color, headband, belt: me.belt }, 40, performance.now());
      };
      const sw = (list, get, set) => h('div', { class: 'swatches' }, list.map((c) => {
        const b = h('button', { class: 'swatch', style: { background: c }, 'aria-label': c, 'aria-pressed': String(get() === c),
          onclick: () => { set(c); b.parentElement.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); } });
        return b;
      }));
      const headbands = ['#e8453c', '#f5b82e', '#3fbf7f', '#2f6fd1', '#8e44ad', '#ffffff', '#15191e', '#ff7eb6'];
      openModal('Ninja', me.name,
        h('div', { class: 'preview-row' }, preview,
          h('div', {}, h('div', {}, P.beltById(me.belt).name), h('div', { class: 'muted' }, `@${me.username} · ${me.role}`),
            h('div', { class: 'muted' }, 'Outfits, masks and weapons come with the shop.'))),
        h('div', { class: 'label', style: { marginTop: '12px' } }, 'Gi color'), sw(P.NINJA_COLORS, () => color, (c) => { color = c; }),
        h('div', { class: 'label' }, 'Headband'), sw(headbands, () => headband, (c) => { headband = c; }),
        h('div', { class: 'foot' },
          h('button', { class: 'btn ghost', onclick: logout }, 'Log out'),
          h('button', { class: 'btn', onclick: () => conn.request('setLook', { color, headband }).then(() => { toast('Looking sharp!'); closeModal(); }).catch((e) => toast(e.message, true)) }, 'Save look')));
      draw();
    }

    function comingSoon(kicker, title, text, extra) {
      openModal(kicker, title, h('p', { class: 'muted' }, text), extra || null,
        h('div', { class: 'foot' }, h('span'), h('button', { class: 'btn ghost', onclick: closeModal }, 'Close')));
    }
    function openInventory() { comingSoon('Inventory', 'Your scroll bag', 'Items you earn from quests, minigames and the shop will appear here. Your bag is empty for now.'); }
    function openShop() { comingSoon('Ramen House and Market', 'Shop', `You have ${state.me.coins} coins. The shop opens in a coming update with outfits, dojo decorations and limited-time items.`); }
    function openFriends() {
      const list = h('ul', { class: 'list' }, [...world.players.values()].filter((n) => n.id !== state.me.id).map((n) =>
        h('li', {}, h('span', { class: 'dot', style: { background: n.color } }), h('span', { class: 'grow', style: { flex: 1 } }, n.name), h('span', { class: 'muted' }, P.beltById(n.belt).name))));
      if (!list.children.length) list.append(h('li', { class: 'muted' }, 'Nobody else is in this room yet.'));
      comingSoon('Friends', 'Ninjas nearby', 'Friend requests come in a later update. These ninjas are in the room with you:', list);
    }
    function openMinigames() {
      const games = [['Shuriken Arena', '2 to 8'], ['Snowfall Dodge', '1 to 8'], ['Rooftop Race', '1 to 6'], ['Dojo Memory', '1 to 4'], ['Ice Fishing', '1']];
      comingSoon('Minigames', 'Lobby', 'Minigames open in a coming update. Here is what is being built:',
        h('ul', { class: 'list' }, games.map(([g, n]) => h('li', {}, h('span', { style: { flex: 1 } }, g), h('span', { class: 'muted' }, `${n} ninjas`)))));
    }

    // ---------- keyboard ----------
    document.addEventListener('keydown', (e) => {
      if (state.phase !== 'game') return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (e.key === 'Escape') {
        if (modalOpen) { closeModal(); e.preventDefault(); return; }
        if (!ui.emotePop.hidden) { closeEmotes(); return; }
        if (e.target === ui.chatInput) ui.chatInput.blur();
        return;
      }
      if (typing || modalOpen) return;
      if (!root.contains(e.target) && e.target !== document.body) return;
      if (e.key === 'Enter') { ui.chatInput.focus(); e.preventDefault(); }
      const n = Number(e.key);
      if (n >= 1 && n <= EMOTE_KEYS.length) doEmote(EMOTE_KEYS[n - 1]);
    });

    // ---------- server events ----------
    conn.on('room:enter', (m) => {
      state.room = m.room;
      world.setRoom(m.room, m.players, m.you);
      state.pendingPortal = false;
      renderRoomTag();
      drawMinimap();
      if (m.updated) toast(`${m.room.name} was just updated by a Grandmaster`);
      else chatLine(`You entered ${m.room.name}.`, 'sys');
      showGame();
      emit('room', m.room);
    });
    conn.on('player:join', (m) => { world.addPlayer(m.player); });
    conn.on('player:leave', (m) => { world.removePlayer(m.id); });
    conn.on('player:move', (m) => { world.movePlayer(m.id, m.from, { x: m.x, y: m.y }); });
    conn.on('player:look', (m) => { world.updateLook(m.player); });
    conn.on('player:emote', (m) => { world.emote(m.id, m.emote); });
    conn.on('chat', (m) => {
      world.say(m.id, m.text);
      chatLine([h('b', { class: m.role === 'grandmaster' ? 'gm' : null }, `${m.name}: `), m.text]);
    });
    conn.on('announce', (m) => {
      showBanner(m.text, m.from);
      chatLine(`📣 ${m.from}: ${m.text}`, 'ann');
    });
    conn.on('presence', (m) => { state.online = m.online; renderRoomTag(); });
    conn.on('you', (m) => {
      const before = state.me;
      state.me = m.ninja;
      renderHud();
      if (before && before.belt !== m.ninja.belt) toast(`You earned the ${P.beltById(m.ninja.belt).name}!`);
      else if (before && m.ninja.coins > before.coins) toast(`+${m.ninja.coins - before.coins} coins`);
      emit('me', state.me);
    });
    conn.on('kicked', (m) => { state.kickReason = m.reason; });
    conn.on('_close', () => {
      const wasIn = state.phase === 'game';
      const reason = state.kickReason || (wasIn ? 'Lost connection to the server.' : null);
      state.kickReason = null;
      resetToConnect(reason);
      emit('disconnected', { reason });
    });

    // ---------- screens ----------
    function backdrop() { return [h('div', { class: 'hill far' }), h('div', { class: 'hill' })]; }

    function showGame() {
      if (state.phase === 'game') return;
      state.phase = 'game';
      screens.replaceChildren();
      hud.hidden = false;
      renderHud();
      renderRoomTag();
      emit('game', state);
    }

    function resetToConnect(message) {
      state.phase = 'connect';
      state.me = null; state.room = null;
      hud.hidden = true;
      banner.hidden = true;
      closeModal();
      world.setRoom(null, [], null);
      ui.chatLog.replaceChildren();
      renderConnect(message);
    }

    function logout() {
      closeModal();
      conn.close();
      resetToConnect(null);
      emit('disconnected', { reason: null });
    }

    const discovered = new Map();
    let foundList = null;
    function renderFound() {
      if (!foundList) return;
      const now = Date.now();
      for (const [k, v] of discovered) if (now - v.seen > 8000) discovered.delete(k);
      foundList.replaceChildren(...[...discovered.values()].map((s) =>
        h('button', { type: 'button', onclick: () => { addrInput.value = `${s.address}:${s.port}`; codeInput.focus(); } },
          h('span', {}, h('b', {}, s.name), h('br'), h('small', { class: 'muted' }, `${s.address}:${s.port}`)),
          h('small', {}, `${s.online}/${s.max} ninjas`))));
      foundLabel.hidden = discovered.size === 0;
    }
    if (host.onDiscover) {
      host.onDiscover((s) => { discovered.set(`${s.address}:${s.port}`, { ...s, seen: Date.now() }); renderFound(); });
      setInterval(renderFound, 3000);
    }

    let addrInput, codeInput, foundLabel;
    function renderConnect(message) {
      const prefs = loadPrefs();
      const err = h('div', { class: 'error', role: 'alert', hidden: !message }, message || '');
      addrInput = h('input', { name: 'address', placeholder: '192.168.1.20:7777', value: prefs.address || 'localhost:7777', autocomplete: 'off', spellcheck: 'false' });
      codeInput = h('input', { name: 'joinCode', class: 'code-input', placeholder: 'ABC123', maxlength: 6, value: prefs.joinCode || '', autocomplete: 'off', spellcheck: 'false' });
      foundList = h('div', { class: 'found' });
      foundLabel = h('div', { class: 'label', hidden: true, style: { marginBottom: '8px' } }, 'Found on your network');
      const go = h('button', { class: 'btn', type: 'submit' }, isAdmin ? 'Connect as admin' : 'Connect');
      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          go.disabled = true; go.textContent = 'Connecting...'; err.hidden = true;
          try {
            await conn.connect(addrInput.value);
            const welcome = await conn.request('hello', { v: P.PROTOCOL_VERSION, joinCode: codeInput.value, client });
            state.serverName = welcome.serverName;
            state.online = welcome.online;
            state.address = addrInput.value.trim();
            state.colors = welcome.colors;
            savePrefs({ address: state.address, joinCode: codeInput.value.trim().toUpperCase() });
            renderAuth();
          } catch (ex) {
            conn.close();
            err.textContent = ex.message; err.hidden = false;
            go.disabled = false; go.textContent = isAdmin ? 'Connect as admin' : 'Connect';
          }
        },
      },
      err,
      foundLabel, foundList,
      h('label', { class: 'field' }, h('span', {}, 'Host address'), addrInput),
      h('label', { class: 'field' }, h('span', {}, 'Join code (shown on the host screen)'), codeInput),
      go);
      screens.replaceChildren(h('div', { class: 'screen' }, ...backdrop(),
        h('div', { class: 'card' },
          h('h1', { class: 'logo' }, 'CLUB', h('span', {}, 'DOJO')),
          h('p', { class: 'tagline' }, isAdmin ? 'Admin client · Grandmaster tools' : 'Train, earn your belt, play with your ninja friends.'),
          form,
          h('details', { class: 'note' }, h('summary', {}, 'Cannot connect?'),
            h('p', {}, 'Make sure the ClubDojo server is running on the host and you are on the same Wi-Fi. The host must allow inbound TCP on the port (default 7777) through its firewall. The address and join code are printed in the server window.')))));
      renderFound();
      (prefs.joinCode ? go : codeInput).focus();
    }

    function renderAuth(mode = isAdmin ? 'login' : loadPrefs().username ? 'login' : 'register') {
      state.phase = 'auth';
      const prefs = loadPrefs();
      const err = h('div', { class: 'error', role: 'alert', hidden: true });
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      const tabs = isAdmin ? null : h('div', { class: 'tabs', role: 'tablist' },
        h('button', { role: 'tab', 'aria-selected': String(mode === 'login'), onclick: () => renderAuth('login') }, 'Log in'),
        h('button', { role: 'tab', 'aria-selected': String(mode === 'register'), onclick: () => renderAuth('register') }, 'Create ninja'));
      const user = h('input', { name: 'username', autocomplete: 'username', value: mode === 'login' ? prefs.username || '' : '', maxlength: P.LIMITS.usernameMax, spellcheck: 'false' });
      const pass = h('input', { name: 'password', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', maxlength: P.LIMITS.passwordMax });
      const fields = [h('label', { class: 'field' }, h('span', {}, 'Username'), user), h('label', { class: 'field' }, h('span', {}, 'Password'), pass)];
      let name, color = (state.colors || P.NINJA_COLORS)[0];
      if (mode === 'register') {
        name = h('input', { name: 'ninjaName', maxlength: P.LIMITS.nameMax, placeholder: 'Ninja Hikaru', spellcheck: 'false' });
        const preview = h('canvas', { width: 80, height: 90 });
        const drawPreview = () => {
          const c = preview.getContext('2d');
          c.clearRect(0, 0, 80, 90);
          World.drawNinja(c, { x: 1, y: 1.6, color, headband: '#e8453c', belt: 'white' }, 40, performance.now());
        };
        const swatches = h('div', { class: 'swatches' }, (state.colors || P.NINJA_COLORS).map((c) => {
          const b = h('button', { type: 'button', class: 'swatch', style: { background: c }, 'aria-label': `Gi color ${c}`, 'aria-pressed': String(c === color),
            onclick: () => { color = c; swatches.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); drawPreview(); } });
          return b;
        }));
        fields.push(h('label', { class: 'field' }, h('span', {}, 'Ninja name (what others see)'), name),
          h('div', { class: 'field' }, h('span', {}, 'Starting gi'), h('div', { class: 'preview-row' }, preview, swatches)));
        setTimeout(drawPreview);
      }
      const go = h('button', { class: 'btn', type: 'submit' }, mode === 'login' ? 'Enter the village' : 'Create my ninja');
      const form = h('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          err.hidden = true; go.disabled = true;
          try {
            const body = { username: user.value.trim(), password: pass.value };
            if (mode === 'register') Object.assign(body, { name: name.value.trim(), color });
            const r = await conn.request(mode, body);
            savePrefs({ username: body.username });
            state.me = r.ninja;
            renderHud();
            emit('authed', state.me);
          } catch (ex) {
            fail(ex.message);
            go.disabled = false;
            if (!conn.open) resetToConnect(ex.message);
          }
        },
      }, err, ...fields, go);
      screens.replaceChildren(h('div', { class: 'screen' }, ...backdrop(),
        h('div', { class: 'card' },
          h('h1', { class: 'logo' }, 'CLUB', h('span', {}, 'DOJO')),
          h('div', { class: 'server-pill' }, h('i'), `${state.serverName} · ${state.online} online`),
          tabs, isAdmin ? h('p', { class: 'tagline' }, 'Log in with a Grandmaster account.') : null,
          form,
          h('p', { class: 'note' }, h('button', { class: 'linkish', type: 'button', onclick: () => { conn.close(); resetToConnect(null); } }, 'Use a different server')))));
      (mode === 'login' && user.value ? pass : user).focus();
    }

    renderConnect(null);

    return {
      conn, world, state, P, h, toast, openModal, closeModal, chatLine,
      on: (type, fn) => bus.addEventListener(type, (e) => fn(e.detail)),
      root: win,
    };
  }

  window.ClubDojoGame = { boot, h };
})();
