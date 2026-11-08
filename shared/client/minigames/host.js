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

  // Sizes a game canvas to fill its stage. The canvas's logical size starts at baseW x baseH and
  // grows along one side to match the stage's shape, so a game keeps its proportions and draws
  // extra scenery in the spare room instead of leaving bars. onFit({ w, h, scale }) runs now and
  // on every resize: w, h are the logical size, scale is backing pixels per logical pixel.
  // opts: fixedHeight (only the width changes), minW, maxScale (caps the pixels drawn each frame).
  function fitCanvas(stageEl, canvas, baseW, baseH, onFit, opts = {}) {
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', objectFit: 'cover' });
    let last = '';
    function apply() {
      const sw = stageEl.clientWidth, sh = stageEl.clientHeight;
      if (!sw || !sh) return;
      const aspect = sw / sh;
      let w = baseW, h = baseH;
      if (opts.fixedHeight) w = Math.max(opts.minW || 0, Math.round(baseH * aspect));
      else if (aspect > baseW / baseH) w = Math.round(baseH * aspect);
      else h = Math.round(baseW / aspect);
      const scale = Math.min(opts.maxScale || 2, (sw / w) * Math.min(2, window.devicePixelRatio || 1));
      const key = `${w}|${h}|${scale.toFixed(3)}`;
      if (key === last) return;
      last = key;
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      onFit({ w, h, scale });
    }
    apply();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    if (ro) ro.observe(stageEl);
    return () => { if (ro) ro.disconnect(); };
  }
  window.ClubDojoFit = fitCanvas;

  // Called by each game file: ClubDojoMinigames.register({ id, mount(ctx) { ... return { onMessage, unmount } } })
  // Optional fields: guide { summary, controls: [[keys, what]], tips: [] } for the lobby's how-to-play
  // panel, lobbyPanel({ h }) for game-specific lobby options, and ownEnding: true if the game shows
  // its own result in its last moments (otherwise the host adds a "Round over" tag).
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
    let ending = null; // timer while the round's last moments stay on screen before the fade
    let lobbyExtra = null; // { game, el } the game's own lobby options, kept while the lobby is open
    const fits = [];
    const FADE_MS = 450;
    const listeners = new Set();

    const title = h('h2', { class: 'mg-title' });
    const phaseEl = h('span', { class: 'mg-phase' });
    const leaveBtn = h('button', { class: 'btn ghost small', onclick: () => leave() }, 'Leave');
    const stage = h('div', { class: 'mg-stage' });
    const side = h('div', { class: 'mg-view' });
    const countdown = h('div', { class: 'mg-countdown', hidden: true });
    const fade = h('div', { class: 'mg-fade' });
    const endTag = h('div', { class: 'mg-endtag', hidden: true }, 'Round over!');
    const overlay = h('section', { class: 'mg-overlay', role: 'dialog', 'aria-modal': 'true', hidden: true },
      h('header', { class: 'mg-head' }, h('div', {}, title, phaseEl), leaveBtn),
      h('div', { class: 'mg-body' }, side, stage, countdown, endTag, fade));
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
      stopEnding();
      unmount();
      clearInterval(tick); tick = null;
      lobby = null; results = null; moduleError = null; lobbyExtra = null;
      overlay.hidden = true;
      notify();
    }

    function show(l) {
      const wasOpen = isOpen();
      lobby = l;
      overlay.style.setProperty('--mg-color', l.color || '#7a3b2e');
      overlay.hidden = false;
      if (!wasOpen) { load(l.game).then(render).catch((e) => { moduleError = e.message; render(); }); notify(); }
      if (l.phase === 'playing' && mountedKey !== l.key) mount();
      if (l.phase !== 'playing' && l.phase !== 'results') { stopEnding(); unmount(); }
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
        fit: (canvas, w, h2, onFit, opts) => { const stop = fitCanvas(stage, canvas, w, h2, onFit, opts); fits.push(stop); return stop; },
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
      for (const stop of fits.splice(0)) stop();
      stage.replaceChildren();
    }

    // The round is over: leave its last moments on screen, then fade through dark to the results.
    function playEnding(ms) {
      stopEnding();
      const mod = lobby && modules.get(lobby.game);
      endTag.hidden = !!(mod && mod.ownEnding);
      ending = setTimeout(() => {
        fade.classList.add('on');
        ending = setTimeout(() => {
          ending = null;
          endTag.hidden = true;
          unmount();
          render();
          requestAnimationFrame(() => fade.classList.remove('on'));
        }, FADE_MS);
      }, Math.max(0, ms - FADE_MS));
    }
    function stopEnding() {
      clearTimeout(ending); ending = null;
      endTag.hidden = true;
      fade.classList.remove('on');
    }

    function guidePanel() {
      const g = (modules.get(lobby.game) || {}).guide;
      if (!g) return null;
      return h('section', { class: 'mg-guide' },
        h('h3', {}, 'How to play'),
        h('p', {}, g.summary),
        h('ul', { class: 'mg-keys' }, g.controls.map(([keys, what]) => h('li', {}, h('kbd', {}, keys), h('span', {}, what)))),
        g.tips && g.tips.length ? h('ul', { class: 'mg-tips' }, g.tips.map((t) => h('li', {}, t))) : null);
    }

    // A game's own lobby options (a sled picker, say). Built once so a lobby update doesn't reset it.
    function extraPanel() {
      const mod = modules.get(lobby.game);
      if (!mod || !mod.lobbyPanel) return null;
      if (!lobbyExtra || lobbyExtra.game !== lobby.game) {
        let built = null;
        try { built = mod.lobbyPanel({ h }); } catch (e) { console.error(e); }
        lobbyExtra = { game: lobby.game, el: built };
      }
      return lobbyExtra.el;
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
      const onStage = lobby.phase === 'playing' || (lobby.phase === 'results' && ending !== null);
      const phaseText = ending !== null ? 'Finished' : { lobby: 'Lobby', countdown: 'Get ready', playing: 'Playing', results: 'Results' }[lobby.phase];
      overlay.classList.toggle('playing', onStage);
      phaseEl.textContent = `${phaseText} · ${lobby.players.length}/${lobby.max} ninjas`;
      countdown.hidden = lobby.phase !== 'countdown';
      countdown.textContent = String(secondsLeft() || 'Go!');
      stage.hidden = !onStage;
      side.hidden = onStage;

      if (moduleError) {
        side.hidden = false;
        side.replaceChildren(h('div', { class: 'mg-error' }, moduleError));
        return;
      }
      if (onStage) return;
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
            isHost ? h('button', { class: 'btn', disabled: !!need, onclick: () => conn.request('mg:start').then((r) => show(r.lobby)).catch((e) => toast(e.message, true)) }, 'Start now') : null) : '', // replaceChildren would print null as text
          extraPanel() || '',
          guidePanel() || '');
      }
    }

    conn.on('mg:lobby', (m) => { if (isOpen() || (m.lobby && m.lobby.players.some((p) => p.id === youId()))) show(m.lobby); });
    conn.on('mg:msg', (m) => { if (lobby && m.key === lobby.key) deliver(m.data); });
    conn.on('mg:results', (m) => {
      if (!lobby || m.key !== lobby.key) return;
      results = m.results;
      if (instance && instance.onResults) { try { instance.onResults(m.results); } catch (e) { console.error(e); } }
      if (instance) playEnding(m.endingMs || 0); else unmount();
      render();
    });
    conn.on('mg:notice', (m) => toast(m.text, true));
    conn.on('mg:closed', (m) => { if (lobby && m.key === lobby.key) { if (m.reason) toast(m.reason, true); close(); } });
    conn.on('_close', close);

    return { join, leave, close, isOpen, onChange: (fn) => listeners.add(fn) };
  }

  window.ClubDojoMinigames = { register, load, createHost, modules };
})();
