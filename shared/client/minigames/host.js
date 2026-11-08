// Minigame host (client). Opens inside the game window (never a separate window) and runs the
// shared lobby -> countdown -> playing -> results flow. Game modules only draw the "playing" part.
// Game modules live in ./games/<id>.js and are loaded on demand. Guide: docs/minigames/README.md
(function () {
  const modules = new Map();
  const loading = new Map();
  const base = (() => {
    const src = document.currentScript && document.currentScript.src;
    return src ? src.replace(/[^/]*$/, 'games/') : '../shared/client/minigames/games/';
  })();

  // Called by each game file: ClubDojoMinigames.register({ id, mount(ctx) { ... return { onMessage, unmount } } })
  function register(def) {
    if (!def || !def.id || typeof def.mount !== 'function') throw new Error('Minigame modules need { id, mount(ctx) }.');
    modules.set(def.id, def);
  }

  function load(id) {
    if (modules.has(id)) return Promise.resolve(modules.get(id));
    if (!/^[a-z0-9-]+$/.test(id)) return Promise.reject(new Error('Bad minigame id.'));
    if (!loading.has(id)) {
      loading.set(id, new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = `${base}${id}.js`;
        el.onload = () => (modules.has(id) ? resolve(modules.get(id)) : reject(new Error(`${id}.js did not register a minigame.`)));
        el.onerror = () => { loading.delete(id); reject(new Error(`This client does not have the ${id} minigame yet. Update ClubDojo.`)); };
        document.head.append(el);
      }));
    }
    return loading.get(id);
  }

  function createHost({ root, conn, h, toast, getMe }) {
    const Avatar = window.ClubDojoAvatar;
    let lobby = null; // latest lobby payload from the server
    let instance = null; // mounted game module instance
    let mountedKey = null;
    let buffered = [];
    let results = null;
    let tick = null;
    let moduleError = null;
    const listeners = new Set();

    const title = h('h2', { class: 'mg-title' });
    const phaseEl = h('span', { class: 'mg-phase' });
    const leaveBtn = h('button', { class: 'btn ghost small', onclick: () => leave() }, 'Leave');
    const stage = h('div', { class: 'mg-stage' });
    const side = h('div', { class: 'mg-view' });
    const countdown = h('div', { class: 'mg-countdown', hidden: true });
    const overlay = h('section', { class: 'mg-overlay', role: 'dialog', 'aria-modal': 'true', hidden: true },
      h('header', { class: 'mg-head' }, h('div', {}, title, phaseEl), leaveBtn),
      h('div', { class: 'mg-body' }, side, stage, countdown));
    root.append(overlay);

    const isOpen = () => !overlay.hidden;
    const youId = () => (getMe() || {}).id;
    const notify = () => { for (const fn of listeners) fn(isOpen()); };

    async function join(spotId) {
      try {
        const r = await conn.request('mg:join', { spotId });
        show(r.lobby);
      } catch (e) { toast(e.message, true); }
    }

    function leave() {
      conn.request('mg:leave').catch(() => {});
      close();
    }

    function close() {
      unmount();
      clearInterval(tick); tick = null;
      lobby = null; results = null; moduleError = null;
      overlay.hidden = true;
      notify();
    }

    function show(l) {
      const wasOpen = isOpen();
      lobby = l;
      overlay.style.setProperty('--mg-color', l.color || '#7a3b2e');
      overlay.hidden = false;
      if (!wasOpen) { load(l.game).catch((e) => { moduleError = e.message; render(); }); notify(); }
      if (l.phase === 'playing' && mountedKey !== l.key) mount();
      if (l.phase !== 'playing' && l.phase !== 'results') unmount();
      if (l.phase === 'lobby') results = null;
      render();
      clearInterval(tick);
      if (l.endsAt) tick = setInterval(render, 200);
    }

    async function mount() {
      mountedKey = lobby.key;
      buffered = [];
      let mod;
      try { mod = await load(lobby.game); } catch (e) { moduleError = e.message; render(); return; }
      if (!lobby || mountedKey !== lobby.key || lobby.phase !== 'playing') return;
      stage.replaceChildren();
      await Avatar.preload(lobby.players.map((p) => p.loadout));
      // The round may have ended, or the lobby closed, while the avatars were loading.
      if (!lobby || mountedKey !== lobby.key || lobby.phase !== 'playing') return;
      const ctx = {
        el: stage,
        youId: youId(),
        players: lobby.players.map((p) => ({ id: p.id, name: p.name, loadout: p.loadout })),
        send: (data) => conn.request('mg:input', { data }).catch(() => {}),
        avatar: Avatar,
        protocol: window.ClubDojoProtocol,
        h,
        toast,
      };
      try {
        instance = mod.mount(ctx) || {};
      } catch (e) {
        console.error(e);
        moduleError = `The ${lobby.name} screen failed to load.`;
        render();
        return;
      }
      const queued = buffered; buffered = [];
      for (const d of queued) deliver(d);
      render();
    }

    function unmount() {
      if (instance && instance.unmount) { try { instance.unmount(); } catch (e) { console.error(e); } }
      instance = null; mountedKey = null; buffered = [];
      stage.replaceChildren();
    }

    function deliver(data) {
      if (!instance) { buffered.push(data); return; }
      if (instance.onMessage) { try { instance.onMessage(data); } catch (e) { console.error(e); } }
    }

    function secondsLeft() { return lobby && lobby.endsAt ? Math.max(0, Math.ceil((lobby.endsAt - Date.now()) / 1000)) : 0; }

    function render() {
      if (!lobby) return;
      title.textContent = lobby.name;
      const me = youId();
      const mine = lobby.players.find((p) => p.id === me);
      const phaseText = { lobby: 'Lobby', countdown: 'Get ready', playing: 'Playing', results: 'Results' }[lobby.phase];
      phaseEl.textContent = `${phaseText} · ${lobby.players.length}/${lobby.max} ninjas`;
      countdown.hidden = lobby.phase !== 'countdown';
      countdown.textContent = String(secondsLeft() || 'Go!');
      stage.hidden = lobby.phase !== 'playing';
      side.hidden = lobby.phase === 'playing';

      if (moduleError) {
        side.hidden = false;
        side.replaceChildren(h('div', { class: 'mg-error' }, moduleError));
        return;
      }
      if (lobby.phase === 'results' && results) {
        side.replaceChildren(
          h('h3', {}, 'Results'),
          h('ol', { class: 'mg-results' }, results.map((r) => {
            const p = lobby.players.find((x) => x.id === r.id);
            return h('li', { class: r.id === me ? 'you' : null },
              h('span', { class: 'mg-place' }, r.place === 1 ? '🏆' : `#${r.place}`),
              p ? Avatar.portrait(p.loadout, 44) : h('span'),
              h('b', { class: 'grow' }, r.name),
              h('span', { class: 'mg-score' }, `${r.score} pts`),
              h('span', { class: 'mg-reward' }, `+${r.coins} coins · +${r.xp} XP`));
          })),
          h('p', { class: 'muted' }, `Back to the lobby in ${secondsLeft()}s. Play again or leave.`));
        return;
      }
      if (lobby.phase === 'lobby' || lobby.phase === 'countdown') {
        const need = Math.max(0, lobby.min - lobby.players.length);
        const isHost = lobby.hostId === me;
        side.replaceChildren(
          h('div', { class: 'mg-cards' }, lobby.players.map((p) => h('div', { class: `mg-card${p.ready ? ' ready' : ''}` },
            Avatar.portrait(p.loadout, 72),
            h('b', {}, p.name, p.id === lobby.hostId ? ' ★' : ''),
            h('small', {}, p.ready ? 'Ready' : 'Not ready'))),
          Array.from({ length: Math.max(0, lobby.max - lobby.players.length) }, () => h('div', { class: 'mg-card empty' }, h('small', {}, 'Open slot')))),
          h('p', { class: 'mg-hint' }, lobby.phase === 'countdown' ? 'Starting...' : need ? `Waiting for ${need} more ninja${need > 1 ? 's' : ''}.` : 'Everyone ready starts the game, or the host can start now.'),
          lobby.phase === 'lobby' ? h('div', { class: 'mg-actions' },
            h('button', { class: `btn${mine && mine.ready ? ' ghost' : ''}`, onclick: () => conn.request('mg:ready', { ready: !(mine && mine.ready) }).then((r) => show(r.lobby)).catch((e) => toast(e.message, true)) }, mine && mine.ready ? 'Not ready' : 'Ready'),
            isHost ? h('button', { class: 'btn', disabled: !!need, onclick: () => conn.request('mg:start').then((r) => show(r.lobby)).catch((e) => toast(e.message, true)) }, 'Start now') : null) : null);
      }
    }

    conn.on('mg:lobby', (m) => { if (isOpen() || (m.lobby && m.lobby.players.some((p) => p.id === youId()))) show(m.lobby); });
    conn.on('mg:msg', (m) => { if (lobby && m.key === lobby.key) deliver(m.data); });
    conn.on('mg:results', (m) => {
      if (!lobby || m.key !== lobby.key) return;
      results = m.results;
      if (instance && instance.onResults) { try { instance.onResults(m.results); } catch (e) { console.error(e); } }
      unmount();
      render();
    });
    conn.on('mg:notice', (m) => toast(m.text, true));
    conn.on('mg:closed', (m) => { if (lobby && m.key === lobby.key) { if (m.reason) toast(m.reason, true); close(); } });
    conn.on('_close', close);

    return { join, leave, close, isOpen, onChange: (fn) => listeners.add(fn) };
  }

  window.ClubDojoMinigames = { register, load, createHost, modules };
})();
