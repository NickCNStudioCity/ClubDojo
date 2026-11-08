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
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
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
        if (state.pendingNpc) {
          const npc = state.pendingNpc;
          state.pendingNpc = null;
          if (P.propDistance(npc, t.x, t.y) <= 2) openNpc(npc);
        }
        mountain.arrived(t);
        if (state.pendingSpot) {
          const spot = (state.room.minigames || []).find((sp) => sp.id === state.pendingSpot);
          state.pendingSpot = null;
          const pad = spot && P.spotPad(spot);
          if (pad && pad.x === t.x && pad.y === t.y) minigames.join(spot.id);
        }
      },
    });
    world.start();

    // Minigames run in an overlay inside this window (shared/client/minigames/host.js).
    const minigames = window.ClubDojoMinigames.createHost({ root: win, conn, h, toast: (m, bad) => toast(m, bad), getMe: () => state.me });

    // The world map and fast travel (shared/client/atlas.js).
    const atlas = window.ClubDojoAtlas.create({
      root: win, hud, conn, world, h, toast: (m, bad) => toast(m, bad), getMe: () => state.me,
      staleGame: () => !minigames.isOpen(),
      onOpen: () => { closeEmotes(); state.pendingPortal = false; state.pendingSpot = null; state.pendingNpc = null; },
    });

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
    ui.streak = h('span', { class: 'streak-chip', title: 'Daily login streak', hidden: true });
    ui.exits = h('nav', { class: 'exits', 'aria-label': 'Exits from this room' });
    ui.chatLog = h('div', { class: 'chat-log', role: 'log', 'aria-label': 'Room chat messages' });
    ui.chatInput = h('input', { type: 'text', placeholder: 'Say something... (Enter)', 'aria-label': 'Chat message', maxlength: P.LIMITS.chatMax });
    ui.emotePop = h('div', { class: 'panel emote-pop', hidden: true, role: 'toolbar', 'aria-label': 'Emotes' },
      EMOTE_KEYS.map((k, i) => h('button', { title: k, onclick: () => { doEmote(k); ui.emotePop.hidden = true; } }, P.EMOTES[k], h('kbd', {}, String(i + 1)))));
    ui.chat = h('section', { class: 'panel chat', 'aria-label': 'Room chat' },
      h('div', { class: 'chat-head' }, h('span', { class: 'label' }, 'Room chat'),
        h('button', { class: 'chat-toggle', onclick: () => { ui.chat.classList.toggle('collapsed'); } }, 'hide / show')),
      ui.chatLog,
      h('form', { class: 'chat-input', onsubmit: (e) => { e.preventDefault(); sendChat(); } }, ui.chatInput));

    // Mountain Town and Peak: the day's card, the Guide, cocoa, the bell and finds.
    const mountain = window.ClubDojoMountainUi.create({ h, conn, world, state, toasts, toast: (m, bad) => toast(m, bad), openModal: (...a) => openModal(...a), closeModal: () => closeModal(), confetti: (...a) => confetti(...a), showBanner: (...a) => showBanner(...a), chatLine: (...a) => chatLine(...a) });

    // The card collection screen, and the Cafe's cat, piano and Hall of Fame.
    const cardsUi = window.ClubDojoCards.create({ root: win, h, conn, world, state, toast: (m, bad) => toast(m, bad), toasts, openModal: (...a) => openModal(...a), closeModal: () => closeModal(), confetti: (...a) => confetti(...a), chatLine: (...a) => chatLine(...a) });

    const menuItems = [
      ['Quests', openQuests, true], ['Ninja', openNinja], ['Cards', () => cardsUi.open()], ['Inventory', openInventory], ['Shop', openShop],
      ['Friends', openFriends], ['Minigames', openMinigames, true], ['Emotes', () => { ui.emotePop.hidden = !ui.emotePop.hidden; }],
    ];

    hud.append(
      h('section', { class: 'panel belt-card', 'aria-label': 'Belt progress' },
        h('div', { class: 'belt-row' }, ui.sash, h('div', {}, ui.beltName, ui.ninjaName)),
        h('div', { class: 'xp', 'aria-hidden': 'true' }, ui.xpFill), ui.xpText),
      h('div', { class: 'panel room-tag', 'aria-label': 'Current room' }, ui.roomName, ui.online),
      h('div', { class: 'top-right' },
        h('button', { class: 'panel map-btn', title: 'World map (M)', 'aria-label': 'Open world map', onclick: () => atlas.open() }, h('span', { 'aria-hidden': 'true' }, '🗺️'), 'Map'),
        h('div', { class: 'panel coins', 'aria-label': 'Coins' }, ui.streak, h('span', { class: 'coin', 'aria-hidden': 'true' }), ui.coins)),
      ui.exits,
      ui.quest = h('button', { class: 'panel quest', 'aria-label': 'Active quest. Open quest log.', onclick: openQuests },
        ui.questLabel = h('div', { class: 'label' }, 'Daily challenge'), ui.questTitle = h('b', {}, 'Earn your next belt'),
        ui.questStep = h('div', { class: 'step' }, ''),
        h('div', { class: 'qbar', 'aria-hidden': 'true' }, ui.questFill = h('i'))),
      ui.chat,
      ui.emotePop,
      h('nav', { class: 'panel menu', 'aria-label': 'Game menu' },
        menuItems.map(([label, fn, primary]) => h('button', { class: `btn${primary ? '' : ' alt'}`, onclick: fn }, label))),
      mountain.panel,
    );

    function renderHud() {
      const me = state.me;
      if (!me) return;
      mountain.update();
      const belt = P.beltById(me.belt);
      const next = P.nextBelt(me.belt);
      ui.sash.style.background = belt.color;
      ui.beltName.textContent = belt.name;
      ui.ninjaName.textContent = `${me.role === 'grandmaster' ? '★ ' : me.role === 'sensei' ? '☆ ' : ''}${me.name} · ${me.xp.toLocaleString()} XP`;
      if (next) {
        const pct = Math.max(0, Math.min(100, ((me.xp - belt.xp) / (next.xp - belt.xp)) * 100));
        ui.xpFill.style.width = `${pct}%`;
        ui.xpText.textContent = me.xp >= next.xp ? `XP ready for the ${next.name} test` : `Next: ${next.name}, ${(next.xp - me.xp).toLocaleString()} XP to go`;
      } else {
        ui.xpFill.style.width = '100%';
        ui.xpText.textContent = 'Highest belt. Keep training!';
      }
      ui.coins.textContent = me.coins.toLocaleString();
      const daily = me.daily;
      ui.streak.hidden = !(daily && daily.streak > 0);
      if (daily) ui.streak.textContent = `🔥 ${daily.streak}`;
      // Quest card: a ready belt test comes first, then the next unfinished daily challenge.
      const test = me.beltTest;
      const open = daily ? daily.challenges.filter((c) => !c.done) : [];
      ui.quest.classList.toggle('ready', !!(test && test.ready));
      if (test && test.ready) {
        ui.questLabel.textContent = 'Belt test ready';
        ui.questTitle.textContent = `Take the ${test.name} test`;
        ui.questStep.textContent = 'Visit Sensei Oru in the Main Dojo';
        ui.questFill.style.width = '100%';
      } else if (open.length) {
        const c = open[0];
        ui.questLabel.textContent = `Daily challenge · ${daily.challenges.length - open.length}/${daily.challenges.length} done`;
        ui.questTitle.textContent = c.text;
        ui.questStep.textContent = `${c.progress}/${c.goal} · reward ${c.coins} coins, ${c.xp} XP`;
        ui.questFill.style.width = `${(c.progress / c.goal) * 100}%`;
      } else if (test) {
        const left = test.reqs.find((r) => r.have < r.need);
        ui.questLabel.textContent = daily ? 'All daily challenges done!' : 'Belt path';
        ui.questTitle.textContent = `Next: ${test.name}`;
        ui.questStep.textContent = left ? `${left.text} (${Math.min(left.have, left.need).toLocaleString()}/${left.need.toLocaleString()})` : 'Visit Sensei Oru';
        ui.questFill.style.width = `${Math.min(100, (test.reqs.filter((r) => r.have >= r.need).length / test.reqs.length) * 100)}%`;
      } else {
        ui.questLabel.textContent = 'Belt path';
        ui.questTitle.textContent = 'Black Belt master';
        ui.questStep.textContent = 'New challenges every day';
        ui.questFill.style.width = '100%';
      }
    }
    function renderRoomTag() {
      ui.roomName.textContent = state.room ? state.room.name : '';
      ui.online.textContent = `${state.online} online`;
    }
    // One button per exit, under the room name. Always reachable, even on a small window.
    function renderExits() {
      const portals = (state.room && state.room.portals) || [];
      ui.exits.replaceChildren(...portals.map((p) => h('button', {
        class: 'exit-btn', title: `Walk to ${p.label}`,
        onclick: () => walkTo({ x: p.x + Math.floor(((p.w || 1) - 1) / 2), y: p.y + Math.floor(((p.h || 1) - 1) / 2) }),
      }, h('span', { 'aria-hidden': 'true' }, exitArrow(p)), p.label)));
      ui.exits.hidden = !portals.length;
    }
    function exitArrow(p) {
      return { left: '←', right: '→', up: '↑', down: '↓' }[World.portalEdge(state.room, p, 3)] || '⛩';
    }

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
      state.pendingSpot = null;
      state.pendingNpc = null;
      const npc = World.interactAt(state.room, t.x, t.y);
      if (npc) {
        // Clicking Sensei walks up to him and opens his dialog on arrival.
        const me0 = world.players.get(state.me.id);
        if (me0 && P.propDistance(npc, me0.x, me0.y) <= 2 && !me0.path.length) { openNpc(npc); return; }
        const midX = npc.x + Math.floor((npc.w || 1) / 2), lowY = npc.y + (npc.h || 1) - 1;
        const near = [[0, 1], [-1, 1], [1, 1], [0, 2], [-1, 0], [1, 0]].map(([dx, dy]) => ({ x: midX + dx, y: lowY + dy }))
          .find((c) => P.isWalkable(state.room, c.x, c.y) && !P.portalAt(state.room, c.x, c.y));
        if (near) { state.pendingNpc = npc; t = near; target = near; }
      }
      const spot = P.spotAt(state.room, t.x, t.y);
      if (spot) {
        // Clicking a pavilion walks to its pad, then joins the lobby on arrival.
        target = P.spotPad(spot);
        state.pendingSpot = spot.id;
      }
      const portal = P.portalAt(state.room, target.x, target.y);
      if (!spot && !portal && !P.isWalkable(state.room, t.x, t.y)) {
        // Clicking a building walks to its door; otherwise go to the nearest open tile.
        target = nearestDoor(t) || nearestWalkable(t);
        if (!target) { world.showMarker(t, false); return; }
      }
      state.pendingPortal = !!P.portalAt(state.room, target.x, target.y);
      world.showMarker(target, true);
      const me = world.players.get(state.me.id);
      if (me && me.x === target.x && me.y === target.y && !me.path.length) {
        if (state.pendingPortal) { state.pendingPortal = false; conn.request('portal').catch((e) => toast(e.message, true)); }
        if (state.pendingSpot) { const id = state.pendingSpot; state.pendingSpot = null; minigames.join(id); }
        if (state.pendingNpc) { const n = state.pendingNpc; state.pendingNpc = null; openNpc(n); }
        return;
      }
      const failed = (e) => { state.pendingPortal = false; state.pendingSpot = null; state.pendingNpc = null; world.showMarker(target, false); if (e.code === 'busy') toast(e.message, true); };
      conn.request('move', target).catch((e) => {
        // The server still has us in a minigame this window already closed (for example a lost
        // leave message): leave it properly, then walk.
        if (e.code === 'busy' && !minigames.isOpen()) return conn.request('mg:leave').then(() => conn.request('move', target)).catch(failed);
        failed(e);
      });
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

    // Quest log: today's challenges and streak, then the belt path with the next test.
    function openQuests() {
      const me = state.me;
      const daily = me.daily;
      const test = me.beltTest;
      const curIdx = P.BELTS.findIndex((x) => x.id === me.belt);
      const challenges = daily ? daily.challenges.map((c) => h('div', { class: `objective${c.done ? ' complete' : ''}` },
        h('span', { class: `check${c.done ? ' done' : ''}`, 'aria-hidden': 'true' }),
        h('div', { class: 'grow' }, c.text,
          h('div', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: { width: `${(c.progress / c.goal) * 100}%` } })),
          h('small', { class: 'muted' }, c.done ? 'Done! Reward paid.' : `${c.progress}/${c.goal}`)),
        h('span', { class: 'reward' }, `+${c.coins}`, h('span', { class: 'coin sm', 'aria-hidden': 'true' })))) : [];
      const belts = P.BELTS.map((b, i) => {
        const done = i <= curIdx;
        const isNext = test && test.belt === b.id;
        return h('div', { class: `objective${isNext ? ' next' : ''}` },
          h('span', { class: `check${done ? ' done' : ''}`, 'aria-hidden': 'true' }),
          h('span', { class: 'belt-chip', style: { background: b.color } }),
          h('div', { class: 'grow' }, b.name,
            isNext ? h('ul', { class: 'reqs' }, test.reqs.map((r) => h('li', { class: r.have >= r.need ? 'ok' : null },
              `${r.have >= r.need ? '✓' : '○'} ${r.text} `, h('small', { class: 'muted' }, `${Math.min(r.have, r.need).toLocaleString()}/${r.need.toLocaleString()}`))))
              : h('small', { class: 'muted', style: { display: 'block' } }, b.xp ? `${b.xp} XP plus a belt test` : 'Account creation')),
          b.id === me.belt ? h('b', {}, 'Current') : null);
      });
      openModal('Quest log', 'Daily challenges',
        h('p', { class: 'muted' }, 'New challenges every day, the same for every ninja in the village.',
          daily && daily.streak ? ` Login streak: 🔥 ${daily.streak} day${daily.streak === 1 ? '' : 's'}.` : ''),
        ...challenges,
        h('h2', { class: 'sub' }, 'Belt path'),
        h('p', { class: 'muted' }, test ? (test.ready ? `You are ready! Visit Sensei Oru in the Main Dojo to take the ${test.name} test.` : `Meet every step below, then visit Sensei Oru in the Main Dojo.`) : 'You wear the Black Belt. Respect.'),
        ...belts,
        h('div', { class: 'foot' }, h('span', { class: 'muted' }, `${me.xp.toLocaleString()} XP · ${daily ? daily.challengesDone : 0} challenges completed`), h('button', { class: 'btn ghost', onclick: closeModal }, 'Close')));
    }

    function openNpc(npc) { if (cardsUi.talk(npc) || mountain.talk(npc)) return; openSensei(npc); }

    // Sensei Oru: belt tests.
    function openSensei(npc) {
      const me = state.me;
      const test = me.beltTest;
      const preview = h('canvas', { width: 90, height: 110 });
      setTimeout(() => { const c = preview.getContext('2d'); World.drawNinja(c, { x: 1.1, y: 2.35, color: '#f3f8fb', headband: '#f5b82e', belt: 'black' }, 40, performance.now()); });
      const say = !test ? 'You have walked the whole belt path. Now teach the young ones.'
        : test.ready ? `Your training shows, ${me.name}. Are you ready for the ${test.name} test?`
          : `Not yet, ${me.name}. A ${test.name} needs more training.`;
      const reqs = test ? h('ul', { class: 'reqs' }, test.reqs.map((r) => h('li', { class: r.have >= r.need ? 'ok' : null },
        `${r.have >= r.need ? '✓' : '○'} ${r.text} `, h('small', { class: 'muted' }, `${Math.min(r.have, r.need).toLocaleString()}/${r.need.toLocaleString()}`)))) : null;
      const go = test && test.ready ? h('button', { class: 'btn', onclick: () => {
        go.disabled = true;
        conn.request('belt:test').then((r) => { closeModal(); toast(`Sensei bows. You earned the ${r.name}${r.coins ? ` and ${r.coins} coins` : ''}!`); })
          .catch((e) => { go.disabled = false; toast(e.message, true); });
      } }, `Take the ${test.name} test`) : null;
      openModal('Main Dojo', npc.name || 'Sensei Oru',
        h('div', { class: 'preview-row' }, preview, h('p', { class: 'sensei-say' }, `“${say}”`)),
        test ? h('div', { class: 'label', style: { marginTop: '10px' } }, `${test.name} test`) : null, reqs,
        test && test.coins ? h('p', { class: 'muted' }, `Passing pays ${test.coins} coins, and the whole village will hear of it.`) : null,
        h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: closeModal }, 'Bow and leave'), go || h('span')));
    }

    // Login streak reward: a week of stamps, today's highlighted.
    function showStreak(m) {
      const days = m.week.map((c, i) => h('div', { class: `stamp${i + 1 < m.day ? ' got' : ''}${i + 1 === m.day ? ' today' : ''}` },
        h('small', {}, `Day ${i + 1}`), h('b', {}, c), h('span', { class: 'coin sm', 'aria-hidden': 'true' })));
      openModal('Daily reward', m.streak > 1 ? `${m.streak}-day streak!` : 'Welcome back!',
        h('p', { class: 'muted' }, m.streak > 1 ? 'Log in every day to keep your streak. Day 7 pays the most.' : 'Log in tomorrow to start a streak. Day 7 pays the most.'),
        h('div', { class: 'week' }, days),
        h('p', { class: 'streak-pay' }, `+${m.coins} coins · +${m.xp} XP`),
        h('div', { class: 'foot' }, h('span', { class: 'muted' }, 'Three new daily challenges are waiting in the Quest log.'), h('button', { class: 'btn', onclick: closeModal }, 'Collect')));
      confetti(28);
    }

    // A burst of paper confetti over the window.
    function confetti(n, colors) {
      const box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
      const pal = colors || ['#e8453c', '#f5b82e', '#3fbf7f', '#2f6fd1', '#ff7eb6', '#ffffff'];
      for (let i = 0; i < n; i++) {
        box.append(h('i', { style: { left: `${Math.random() * 100}%`, background: pal[i % pal.length], '--dx': `${(Math.random() - 0.5) * 160}px`, '--r': `${Math.random() * 720 - 360}deg`, animationDelay: `${Math.random() * 0.4}s`, animationDuration: `${1.6 + Math.random() * 1.2}s` } }));
      }
      win.append(box);
      setTimeout(() => box.remove(), 3400);
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
    // Minigame list: every installed game, where to find it, lobby status, your best score,
    // and the games that are still being built.
    async function openMinigames() {
      let data;
      try { data = await conn.request('mg:list'); } catch (e) { toast(e.message, true); return; }
      const stats = new Map((data.stats || []).map((r) => [r.game_id, r]));
      const rows = data.games.map((g) => {
        const spots = data.spots.filter((sp) => sp.game === g.id);
        const st = stats.get(g.id);
        const here = spots.filter((sp) => sp.roomId === state.room.id);
        const where = spots.length ? [...new Set(spots.map((sp) => sp.roomName))].join(', ') : 'Not placed on the map yet';
        const busy = spots.reduce((n, sp) => n + (sp.lobby ? sp.lobby.count : 0), 0);
        const status = !g.available ? 'Coming soon' : !g.enabled ? 'Closed' : busy ? `${busy} playing or waiting` : 'Open';
        return h('li', { class: `mg-row${g.available ? '' : ' planned'}` },
          h('span', { class: 'mg-icon', style: { background: g.color } }, g.icon),
          h('div', { class: 'grow' },
            h('b', {}, g.name), ' ', h('span', { class: `pill${g.available && g.enabled ? ' open' : ''}` }, status),
            h('div', { class: 'muted' }, g.description),
            h('div', { class: 'muted' }, `${g.minPlayers === g.maxPlayers ? g.minPlayers : `${g.minPlayers}-${g.maxPlayers}`} ninja${g.maxPlayers === 1 ? '' : 's'} · ${g.available ? where : 'In development'}`
              + (st ? ` · best ${st.best} pts, ${st.plays} play${st.plays === 1 ? '' : 's'}` : ''))),
          g.available && g.enabled && here.length
            ? h('button', { class: 'btn small', onclick: () => { closeModal(); walkTo({ x: here[0].x + 1, y: here[0].y }); } }, 'Go play')
            : null);
      });
      openModal('Minigames', 'Minigame list',
        h('p', { class: 'muted' }, 'Walk up to a pavilion in the village to join its lobby. Games award coins and XP.'),
        h('ul', { class: 'list mg-list' }, rows),
        h('div', { class: 'foot' }, h('span', { class: 'muted' }, 'More minigames are on the way.'), h('button', { class: 'btn ghost', onclick: closeModal }, 'Close')));
    }

    // ---------- keyboard ----------
    document.addEventListener('keydown', (e) => {
      if (state.phase !== 'game') return;
      if (minigames.isOpen()) return; // the minigame owns the keyboard
      if (cardsUi.isOpen()) return; // the card screen has its own buttons
      if (atlas.isOpen()) { atlas.key(e); return; }
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
      if (e.key === 'm' || e.key === 'M') { atlas.open(); e.preventDefault(); return; }
      const n = Number(e.key);
      if (n >= 1 && n <= EMOTE_KEYS.length) doEmote(EMOTE_KEYS[n - 1]);
    });

    // ---------- server events ----------
    conn.on('room:enter', (m) => {
      state.room = m.room;
      world.setRoom(m.room, m.players, m.you, { quiet: !!m.updated, held: atlas.traveling() });
      atlas.roomChanged(m.room.id);
      state.pendingPortal = false;
      state.pendingNpc = null;
      state.pendingSpot = null;
      renderRoomTag();
      renderExits();
      mountain.update();
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
    conn.on('mg:spots', (m) => { if (state.room && m.roomId === state.room.id) world.spotStatus = m.spots; });
    conn.on('presence', (m) => { state.online = m.online; renderRoomTag(); atlas.refresh(); });
    conn.on('you', (m) => {
      const before = state.me;
      state.me = m.ninja;
      renderHud();
      if (before && before.belt !== m.ninja.belt) { /* the celebrate event shows the banner */ }
      else if (before && before.beltTest && m.ninja.beltTest && !before.beltTest.ready && m.ninja.beltTest.ready) toast(`Belt test unlocked! Visit Sensei Oru in the Main Dojo.`);
      else if (before && m.ninja.coins > before.coins && !(performance.now() < (state.quietCoinsUntil || 0))) toast(`+${m.ninja.coins - before.coins} coins`);
      emit('me', state.me);
    });
    conn.on('progress', (m) => {
      state.quietCoinsUntil = performance.now() + 1500;
      if (m.kind === 'streak') showStreak(m);
      else if (m.kind === 'challenge') {
        const t = h('div', { class: 'toast win' }, h('small', {}, 'Daily challenge complete'), m.text, h('span', { class: 'toast-pay' }, `+${m.coins} coins · +${m.xp} XP`));
        toasts.append(t);
        setTimeout(() => t.remove(), 4200);
        confetti(18);
      }
    });
    conn.on('celebrate', (m) => {
      const you = state.me && m.id === state.me.id;
      showBanner(you ? `You earned the ${m.beltName}!` : `${m.name} earned the ${m.beltName}!`, 'Sensei Oru');
      chatLine(`🥋 ${m.name} passed the ${m.beltName} test!`, 'ann');
      confetti(you ? 60 : 24, [m.color, '#f5b82e', '#ffffff', m.color]);
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
      atlas.prefetch();
      emit('game', state);
    }

    function resetToConnect(message) {
      state.phase = 'connect';
      state.me = null; state.room = null;
      hud.hidden = true;
      banner.hidden = true;
      closeModal();
      atlas.reset();
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
      conn, world, state, P, h, toast, openModal, closeModal, chatLine, minigames,
      on: (type, fn) => bus.addEventListener(type, (e) => fn(e.detail)),
      root: win,
    };
  }

  window.ClubDojoGame = { boot, h };
})();
