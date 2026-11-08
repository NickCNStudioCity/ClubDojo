// Fishing (client). Server rules: server/src/minigames/games/fishing.js
// The bobber follows the mouse cursor (or a finger). When the hook is out of the water, click
// (or tap, or press Space) to take each fish off the hook.
// The server sends 15 snapshots a second; this file interpolates between them and adds the
// scenery, particles and banners. The personal best and the catch journal are kept in
// localStorage (per computer, cosmetic only).
ClubDojoMinigames.register({
  id: 'fishing',

  mount(ctx) {
    const { h, el } = ctx;
    // Must match the kinds in the server file (colors, sizes and names are client-only).
    const FISH_STYLE = {
      minnow: { name: 'Minnow', color: '#9ad0ec', dark: '#4f93bd', len: 0.065 },
      perch: { name: 'Perch', color: '#f5b82e', dark: '#b9771a', len: 0.09, stripes: true },
      snapper: { name: 'Snapper', color: '#ef5a4c', dark: '#a8261d', len: 0.12 },
      golden: { name: 'Golden Koi', color: '#ffd84a', dark: '#c78e00', len: 0.14, shine: true },
      timefish: { name: 'Time Fish', color: '#5ee0c8', dark: '#1c8f7d', len: 0.08, clock: true },
    };
    const KIND_ORDER = ['minnow', 'perch', 'snapper', 'timefish', 'golden'];
    // Depth 0..1 maps to the height of the canvas. Depth 0 is out of the water.
    const WATER = 0.12; // depth where the surface is (same as the server)
    const hookY = (d) => 0.1 + d * 0.85;
    const W = 800; // logical canvas size; the backing store is scaled for sharp HiDPI drawing
    const H = 450;
    const SURFACE = hookY(WATER) * H;
    const TICK_MS = 1000 / 15;

    // ---- saved progress (best score, best combo, species caught) ----
    const SAVE_KEY = 'clubdojo.fishing.v1';
    function loadSave() {
      try {
        const v = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
        return { best: Number(v.best) || 0, bestStreak: Number(v.bestStreak) || 0, journal: v.journal && typeof v.journal === 'object' ? v.journal : {} };
      } catch (e) { return { best: 0, bestStreak: 0, journal: {} }; }
    }
    const save = loadSave();
    const startBest = save.best;
    function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage blocked */ } }

    const style = h('style', {}, `
      .fi { display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; padding: 8px; box-sizing: border-box; }
      .fi-hud { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 18px; font-family: var(--display); font-size: 22px; }
      .fi-hud b { color: var(--gold); }
      .fi-hud .fi-low b { color: #ff6b5e; }
      .fi-hud .fi-combo b { color: #7fe3ff; }
      .fi-canvas { width: 100%; max-width: 800px; height: auto; aspect-ratio: 800 / 450; border-radius: 14px; touch-action: none; cursor: crosshair; user-select: none; box-shadow: 0 6px 24px rgba(0,0,0,.25); }
      .fi-canvas.fi-grab { cursor: pointer; }
      .fi-status { font-family: var(--display); font-size: 20px; min-height: 28px; text-align: center; }
      .fi-journal { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; font-size: 13px; }
      .fi-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; background: rgba(0,0,0,.18); }
      .fi-chip i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
      .fi-chip.fi-new { outline: 2px solid var(--gold); }
      .fi-chip.fi-unknown { opacity: .55; }
    `);
    const coinsEl = h('b', {}, '0');
    const timeEl = h('b', {}, '--');
    const comboEl = h('b', {}, 'x1');
    const bestEl = h('b', {}, String(save.best));
    const timeBox = h('span', {}, 'Time ', timeEl);
    const hud = h('div', { class: 'fi-hud' },
      h('span', {}, 'Coins ', coinsEl), timeBox,
      h('span', { class: 'fi-combo' }, 'Combo ', comboEl),
      h('span', {}, 'Best ', bestEl));
    const status = h('div', { class: 'fi-status' }, 'Move the mouse to steer the bobber...');
    const journalEl = h('div', { class: 'fi-journal', title: 'Your catch journal (all rounds on this computer)' });
    const canvas = h('canvas', { class: 'fi-canvas', width: W, height: H });
    el.append(style, h('div', { class: 'fi' }, hud, canvas, status, journalEl));
    const g = canvas.getContext('2d');

    const timers = new Set();
    const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

    let prev = null; // previous server snapshot
    let state = null; // latest server snapshot
    let stateAt = 0; // when it arrived (performance.now)
    let aim = null; // latest cursor position, as canvas fractions
    let aimDirty = false;
    let lastSent = 0;
    let raf = 0;
    let unmounted = false;
    let lastFrame = 0;
    let shake = 0;
    let frenzyShown = false;
    let lastOut = true;
    const newKinds = new Set();
    const particles = [];
    const banners = []; // { text, color, born, life, big }

    const me = (ctx.players || []).find((p) => p.id === ctx.youId) || (ctx.players || [])[0];

    // Canvas fraction y -> hook depth. The hook sits at hookY(depth); anything above it is out of the water.
    const depthAt = (fy) => Math.min(1, Math.max(0, (fy - hookY(0)) / (hookY(1) - hookY(0))));
    const lerp = (a, b, k) => a + (b - a) * k;
    const isOut = (s) => s && s.line.depth <= WATER;

    // ---- interpolation between server snapshots ----
    function view() {
      if (!state) return null;
      const k = prev ? Math.min(1, (performance.now() - stateAt) / TICK_MS) : 1;
      const before = new Map(prev ? prev.fish.map((f) => [f.id, f]) : []);
      const jBefore = new Map(prev && prev.jellies ? prev.jellies.map((j) => [j.id, j]) : []);
      const mix = (cur, old) => (old ? { ...cur, x: lerp(old.x, cur.x, k), depth: lerp(old.depth, cur.depth, k) } : cur);
      return {
        line: prev ? { ...state.line, x: lerp(prev.line.x, state.line.x, k), depth: lerp(prev.line.depth, state.line.depth, k) } : state.line,
        fish: state.fish.map((f) => mix(f, before.get(f.id))),
        jellies: (state.jellies || []).map((j) => mix(j, jBefore.get(j.id))),
      };
    }

    // Where each hooked fish is drawn, as canvas fractions. Under water they dangle below the hook;
    // out of the water they fan out beside it so they're easy to click.
    function hookedLayout(v) {
      if (!v) return [];
      const hooked = v.fish.filter((f) => f.hooked);
      const out = v.line.depth <= WATER;
      return hooked.map((f, k) => out
        ? { f, x: Math.min(0.92, Math.max(0.08, v.line.x)) + (k - (hooked.length - 1) / 2) * 0.1, y: hookY(v.line.depth) + 0.045 }
        : { f, x: v.line.x, y: hookY(v.line.depth) + 0.035 + k * 0.05 });
    }

    function fromEvent(e) {
      const r = canvas.getBoundingClientRect();
      return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height };
    }

    function unhookAt(fx, fy) {
      const v = view();
      const items = hookedLayout(v);
      if (!state || !isOut(state) || !items.length) return false;
      // Take a fish off the hook: the one clicked, or the nearest one if the click missed.
      let pick = items[0];
      let best = Infinity;
      for (const item of items) {
        const dist = Math.hypot((fx - item.x) * (W / H), fy - item.y);
        if (dist < best) { best = dist; pick = item; }
      }
      ctx.send({ type: 'unhook', id: pick.f.id });
      return true;
    }

    // Send the cursor about 20 times a second at most, with a trailing send so the last spot arrives.
    let sendTimer = 0;
    function sendAim() {
      sendTimer = 0;
      if (!aimDirty || !aim || !state || unmounted) return;
      const wait = 50 - (performance.now() - lastSent);
      if (wait > 0) { sendTimer = later(wait, sendAim); return; }
      ctx.send({ type: 'move', x: aim.x, y: depthAt(aim.y) });
      aimDirty = false;
      lastSent = performance.now();
    }

    function setAim(e) {
      const { fx, fy } = fromEvent(e);
      aim = { x: Math.min(1, Math.max(0, fx)), y: Math.min(1, Math.max(0, fy)) };
      aimDirty = true;
      if (!sendTimer) sendAim();
    }

    function onDown(e) {
      if (e.button !== 0 || !state) return;
      e.preventDefault();
      const { fx, fy } = fromEvent(e);
      if (unhookAt(fx, fy)) return;
      setAim(e); // a tap on a touch screen moves the bobber there
    }

    // Track the cursor anywhere in the window, so the bobber keeps following it past the canvas edge.
    function onMove(e) {
      if (e.pointerType === 'touch' && e.target !== canvas) return;
      setAim(e);
    }

    function onKey(e) {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (!state || !isOut(state)) return;
      e.preventDefault();
      const items = hookedLayout(view());
      if (items.length) ctx.send({ type: 'unhook', id: items[0].f.id });
    }

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('keydown', onKey);

    // ---- scenery (fixed per round) ----
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const clouds = Array.from({ length: 5 }, () => ({ x: rnd() * W, y: 10 + rnd() * 34, s: 0.6 + rnd() * 0.7, v: 4 + rnd() * 6 }));
    const weeds = Array.from({ length: 14 }, () => ({ x: rnd() * W, h: 40 + rnd() * 70, c: rnd() < 0.5 ? '#2e8b57' : '#3fa66a', p: rnd() * 6 }));
    const rocks = Array.from({ length: 8 }, () => ({ x: rnd() * W, r: 10 + rnd() * 22, c: rnd() < 0.5 ? '#5a6b7a' : '#6f7f8c' }));
    const rays = Array.from({ length: 5 }, () => ({ x: rnd() * W, w: 40 + rnd() * 60, p: rnd() * 6 }));

    // ---- particles ----
    function burst(x, y, n, opts) {
      for (let i = 0; i < n; i++) {
        const a = (opts.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (opts.spread ?? Math.PI);
        const sp = (opts.speed ?? 120) * (0.5 + Math.random() * 0.7);
        particles.push({ kind: opts.kind || 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: opts.life ?? 0.7, color: opts.color || '#fff', size: opts.size ?? 3, grav: opts.grav ?? 300 });
      }
    }
    function floatText(x, y, text, color) {
      particles.push({ kind: 'text', x, y, vx: 0, vy: -45, life: 0, max: 1.3, color, text, grav: 0 });
    }
    function banner(text, color, big) {
      banners.push({ text, color, born: performance.now(), life: big ? 1600 : 1200, big: !!big });
      if (banners.length > 3) banners.shift();
    }
    function splash(x) {
      burst(x, SURFACE, 12, { color: 'rgba(220,245,255,.9)', speed: 150, spread: 1.6, life: 0.6, size: 3 });
      particles.push({ kind: 'ring', x, y: SURFACE, life: 0, max: 0.9, color: 'rgba(255,255,255,.7)', vx: 0, vy: 0, grav: 0 });
    }

    function stepParticles(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.life >= p.max) { particles.splice(i, 1); continue; }
        p.vy += p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      // ambient bubbles
      if (Math.random() < dt * 3) particles.push({ kind: 'bubble', x: Math.random() * W, y: H - 10, vx: 0, vy: -25 - Math.random() * 25, life: 0, max: 6, color: 'rgba(255,255,255,.35)', size: 1.5 + Math.random() * 3, grav: 0 });
    }

    function drawParticles(t) {
      for (const p of particles) {
        const a = 1 - p.life / p.max;
        g.globalAlpha = Math.max(0, a);
        if (p.kind === 'text') {
          g.font = 'bold 22px system-ui, sans-serif';
          g.textAlign = 'center';
          g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.45)';
          g.strokeText(p.text, p.x, p.y);
          g.fillStyle = p.color; g.fillText(p.text, p.x, p.y);
        } else if (p.kind === 'ring') {
          g.strokeStyle = p.color; g.lineWidth = 2;
          const r = 6 + (p.life / p.max) * 34;
          g.beginPath(); g.ellipse(p.x, p.y, r, r * 0.3, 0, 0, Math.PI * 2); g.stroke();
        } else if (p.kind === 'bubble') {
          if (p.y < SURFACE + 4) { p.life = p.max; continue; }
          g.globalAlpha = 0.7;
          g.strokeStyle = p.color; g.lineWidth = 1;
          g.beginPath(); g.arc(p.x + Math.sin(t / 300 + p.y / 20) * 2, p.y, p.size, 0, Math.PI * 2); g.stroke();
        } else if (p.kind === 'star') {
          g.fillStyle = p.color;
          star(p.x, p.y, p.size * a + 1);
        } else {
          g.fillStyle = p.color;
          g.beginPath(); g.arc(p.x, p.y, p.size, 0, Math.PI * 2); g.fill();
        }
      }
      g.globalAlpha = 1;
    }

    function star(x, y, r) {
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const rr = i % 2 ? r * 0.35 : r;
        const a = (i / 8) * Math.PI * 2;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.closePath(); g.fill();
    }

    // ---- drawing ----
    // Where the rod tip is. The line runs from here to the bobber.
    const ROD_TIP = { x: 0.64 * W, y: 0.03 * H };
    const PIER_Y = 76;

    function drawBackground(t) {
      // sky
      const sky = g.createLinearGradient(0, 0, 0, SURFACE);
      sky.addColorStop(0, '#8fd3ff'); sky.addColorStop(1, '#e8f8ff');
      g.fillStyle = sky; g.fillRect(0, 0, W, SURFACE);
      // sun
      const sun = g.createRadialGradient(90, 26, 4, 90, 26, 46);
      sun.addColorStop(0, 'rgba(255,250,210,1)'); sun.addColorStop(0.35, 'rgba(255,236,150,.9)'); sun.addColorStop(1, 'rgba(255,236,150,0)');
      g.fillStyle = sun; g.beginPath(); g.arc(90, 26, 46, 0, Math.PI * 2); g.fill();
      // clouds
      g.fillStyle = 'rgba(255,255,255,.92)';
      for (const c of clouds) {
        const x = ((c.x + (t / 1000) * c.v) % (W + 120)) - 60;
        g.beginPath();
        g.ellipse(x, c.y, 26 * c.s, 9 * c.s, 0, 0, Math.PI * 2);
        g.ellipse(x + 16 * c.s, c.y - 6 * c.s, 16 * c.s, 9 * c.s, 0, 0, Math.PI * 2);
        g.ellipse(x - 14 * c.s, c.y - 3 * c.s, 13 * c.s, 7 * c.s, 0, 0, Math.PI * 2);
        g.fill();
      }
      // far snowy shore
      g.fillStyle = '#d7ecf7';
      g.beginPath(); g.moveTo(0, SURFACE);
      for (let x = 0; x <= W * 0.6; x += 20) g.lineTo(x, SURFACE - 10 - Math.sin(x / 70) * 6 - Math.sin(x / 23) * 2);
      g.lineTo(W * 0.6, SURFACE); g.closePath(); g.fill();
      g.fillStyle = '#2f6b4f';
      for (let i = 0; i < 9; i++) {
        const x = 30 + i * 52, b = SURFACE - 12, s = 8 + (i % 3) * 3;
        g.beginPath(); g.moveTo(x, b - s * 2.2); g.lineTo(x - s, b); g.lineTo(x + s, b); g.closePath(); g.fill();
      }

      // water
      const water = g.createLinearGradient(0, SURFACE, 0, H);
      water.addColorStop(0, '#3fa3e0'); water.addColorStop(0.5, '#1d6fa8'); water.addColorStop(1, '#0b2f55');
      g.fillStyle = water; g.fillRect(0, SURFACE, W, H - SURFACE);

      // light rays
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const r of rays) {
        const sway = Math.sin(t / 2200 + r.p) * 30;
        const grad = g.createLinearGradient(0, SURFACE, 0, H * 0.85);
        grad.addColorStop(0, 'rgba(180,230,255,.13)'); grad.addColorStop(1, 'rgba(180,230,255,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.moveTo(r.x, SURFACE); g.lineTo(r.x + r.w, SURFACE);
        g.lineTo(r.x + r.w * 1.8 + sway, H * 0.85); g.lineTo(r.x + r.w * 0.6 + sway, H * 0.85);
        g.closePath(); g.fill();
      }
      g.restore();

      // depth band hints (deeper = more valuable)
      g.fillStyle = 'rgba(255,215,90,.05)';
      g.fillRect(0, hookY(0.72) * H, W, H - hookY(0.72) * H);

      // sand, rocks and seaweed
      const sandY = H - 22;
      const sand = g.createLinearGradient(0, sandY - 10, 0, H);
      sand.addColorStop(0, '#c9a96b'); sand.addColorStop(1, '#8f7448');
      g.fillStyle = sand;
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 20) g.lineTo(x, sandY + Math.sin(x / 60) * 5);
      g.lineTo(W, H); g.closePath(); g.fill();
      for (const r of rocks) { g.fillStyle = r.c; g.beginPath(); g.ellipse(r.x, sandY + 6, r.r, r.r * 0.6, 0, Math.PI, 0); g.fill(); }
      g.lineCap = 'round';
      for (const w of weeds) {
        g.strokeStyle = w.c; g.lineWidth = 5;
        g.beginPath(); g.moveTo(w.x, sandY + 4);
        for (let k = 1; k <= 6; k++) {
          const yy = sandY + 4 - (w.h * k) / 6;
          g.lineTo(w.x + Math.sin(t / 700 + w.p + k * 0.7) * k * 2.2, yy);
        }
        g.stroke();
      }
      g.lineCap = 'butt';
    }

    function drawSurface(t) {
      // waves with a highlight line on top of everything under water
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.beginPath(); g.moveTo(0, SURFACE);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, SURFACE + Math.sin(x / 26 + t / 400) * 3);
      g.lineTo(W, SURFACE + 10); g.lineTo(0, SURFACE + 10); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.75)';
      g.lineWidth = 2.5;
      g.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = SURFACE + Math.sin(x / 26 + t / 400) * 3;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }

    function drawPier() {
      // posts into the water, then the deck
      g.fillStyle = '#5c3a1e';
      for (const px of [575, 660, 760]) g.fillRect(px, PIER_Y, 9, SURFACE - PIER_Y + 26);
      g.fillStyle = 'rgba(0,0,0,.18)';
      for (const px of [575, 660, 760]) g.fillRect(px, SURFACE, 9, 26);
      g.fillStyle = '#9a6634';
      g.fillRect(560, PIER_Y, W - 560, 10);
      g.fillStyle = '#7d5128';
      for (let x = 560; x < W; x += 30) g.fillRect(x, PIER_Y, 2, 10);
      g.fillStyle = '#6b4226';
      g.fillRect(560, PIER_Y + 10, W - 560, 3);
    }

    // The player's own ninja sits on the pier holding the rod.
    function drawAngler(t) {
      let hand = { x: 628, y: 58 };
      try {
        if (ctx.avatar && me && me.loadout) {
          const geo = ctx.avatar.draw(g, me.loadout, { x: 650, y: PIER_Y, size: 50, facing: -1, time: t / 1000, shadow: false });
          if (geo) hand = { x: geo.cx - geo.bw * 0.45, y: geo.top + geo.bh * 0.6 };
        } else throw new Error('no avatar');
      } catch (e) {
        // fallback ninja
        g.fillStyle = '#20262e';
        g.beginPath(); g.ellipse(650, PIER_Y - 28, 20, 28, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#e8453c'; g.fillRect(630, PIER_Y - 48, 40, 6);
      }
      // rod: hand to tip, bending a little when fish are on
      const load = state ? state.fish.filter((f) => f.hooked).length : 0;
      g.strokeStyle = '#4a2c14';
      g.lineWidth = 3.5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(hand.x + 8, hand.y + 6);
      g.quadraticCurveTo((hand.x + ROD_TIP.x) / 2, ROD_TIP.y - 8 + load * 6, ROD_TIP.x, ROD_TIP.y + load * 5);
      g.stroke();
      g.fillStyle = '#c0c0c0';
      g.beginPath(); g.arc(hand.x + 4, hand.y + 2, 4, 0, Math.PI * 2); g.fill(); // reel
      g.lineCap = 'butt';
      return { x: ROD_TIP.x, y: ROD_TIP.y + load * 5 };
    }

    function drawFish(x, y, kind, dir, t, hooked, glow) {
      const st = FISH_STYLE[kind] || FISH_STYLE.minnow;
      const len = st.len * W;
      const cx = x * W;
      const cy = y * H + Math.sin(t / 180 + x * 10) * (hooked ? 0 : 3);
      const wag = Math.sin(t / (hooked ? 60 : 140) + x * 20) * (hooked ? 0.35 : 0.18);
      g.save();
      g.translate(cx, cy);
      if (hooked) g.rotate(Math.sin(t / 90 + x * 9) * 0.25);
      g.scale(dir, 1);
      if (glow) {
        g.strokeStyle = `rgba(255,236,120,${0.5 + Math.sin(t / 120) * 0.3})`;
        g.lineWidth = 3;
        g.beginPath(); g.ellipse(0, 0, len * 0.75, len * 0.45, 0, 0, Math.PI * 2); g.stroke();
      }
      if (st.shine) {
        const aura = g.createRadialGradient(0, 0, len * 0.2, 0, 0, len * 0.75);
        aura.addColorStop(0, 'rgba(255,230,120,.28)'); aura.addColorStop(1, 'rgba(255,230,120,0)');
        g.fillStyle = aura;
        g.beginPath(); g.ellipse(0, 0, len * 0.75, len * 0.45, 0, 0, Math.PI * 2); g.fill();
      }
      // tail, wagging
      g.save();
      g.translate(-len / 2 + 3, 0);
      g.rotate(wag);
      g.fillStyle = st.dark;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-len / 3, -len / 4); g.quadraticCurveTo(-len / 4.5, 0, -len / 3, len / 4); g.closePath(); g.fill();
      g.restore();
      // dorsal fin
      g.fillStyle = st.dark;
      g.beginPath(); g.moveTo(-len / 6, -len / 5); g.quadraticCurveTo(0, -len / 2.3, len / 7, -len / 5.5); g.closePath(); g.fill();
      // body
      const body = g.createLinearGradient(0, -len / 4, 0, len / 4);
      body.addColorStop(0, st.dark); body.addColorStop(0.45, st.color); body.addColorStop(1, '#ffffff');
      g.fillStyle = body;
      g.beginPath(); g.ellipse(0, 0, len / 2, len / 4, 0, 0, Math.PI * 2); g.fill();
      if (st.stripes) {
        g.strokeStyle = 'rgba(90,50,10,.45)'; g.lineWidth = 2.5;
        for (const sx of [-0.18, 0, 0.16]) { g.beginPath(); g.moveTo(sx * len, -len / 4.6); g.lineTo(sx * len - 2, len / 6); g.stroke(); }
      }
      if (st.clock) {
        g.fillStyle = '#fff'; g.beginPath(); g.arc(-len / 12, len / 40, len / 7, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#1c8f7d'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(-len / 12, len / 40); g.lineTo(-len / 12, -len / 12); g.moveTo(-len / 12, len / 40); g.lineTo(len / 30, len / 40); g.stroke();
      }
      // side fin and gill
      g.fillStyle = 'rgba(255,255,255,.5)';
      g.beginPath(); g.ellipse(len / 14, len / 9, len / 9, len / 20, 0.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1.2;
      g.beginPath(); g.arc(len / 7, 0, len / 6, -0.9, 0.9); g.stroke();
      // eye
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(len / 4.2, -len / 14, len / 13, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#1b1b1b';
      g.beginPath(); g.arc(len / 4.2 + 1, -len / 14, len / 26, 0, Math.PI * 2); g.fill();
      g.restore();
      if (st.shine && Math.random() < 0.08) particles.push({ kind: 'star', x: cx + (Math.random() - 0.5) * len, y: cy + (Math.random() - 0.5) * len * 0.5, vx: 0, vy: -10, life: 0, max: 0.6, color: '#fff7c2', size: 4, grav: 0 });
    }

    function drawJelly(j, t) {
      const x = j.x * W;
      const y = hookY(j.depth) * H;
      const pulse = 1 + Math.sin(t / 260 + j.id) * 0.08;
      g.save();
      g.translate(x, y);
      const glow = g.createRadialGradient(0, 0, 2, 0, 0, 34);
      glow.addColorStop(0, 'rgba(255,140,220,.35)'); glow.addColorStop(1, 'rgba(255,140,220,0)');
      g.fillStyle = glow; g.beginPath(); g.arc(0, 0, 34, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,170,230,.75)'; g.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        g.beginPath(); g.moveTo(i * 5, 4);
        for (let k = 1; k <= 5; k++) g.lineTo(i * 5 + Math.sin(t / 200 + k + i) * 3, 4 + k * 6);
        g.stroke();
      }
      g.fillStyle = 'rgba(255,150,225,.85)';
      g.beginPath(); g.ellipse(0, 0, 17 * pulse, 13 / pulse, 0, Math.PI, 0); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.55)';
      g.beginPath(); g.ellipse(-6, -6, 5, 3, -0.4, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    // Line from the rod tip to the bobber on the surface, then straight down to the hook.
    function drawLine(v, tip, t) {
      const lx = v.line.x * W;
      const hy = hookY(v.line.depth) * H;
      const under = v.line.depth > WATER;
      const zapped = v.line.zapped;
      const bobY = under ? SURFACE + Math.sin(t / 300) * 2 : hy - 12;
      g.strokeStyle = zapped ? (Math.floor(t / 70) % 2 ? '#fff36b' : '#ffffff') : 'rgba(245,245,245,.95)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(tip.x, tip.y);
      const sag = Math.min(40, Math.abs(tip.x - lx) * 0.12 + 10);
      g.quadraticCurveTo((tip.x + lx) / 2, (tip.y + bobY) / 2 + sag, lx, bobY);
      g.lineTo(lx, hy);
      g.stroke();
      // hook
      g.strokeStyle = '#d4d4d4';
      g.lineWidth = 3;
      g.beginPath(); g.arc(lx - 5, hy + 6, 6, -0.2, Math.PI * 0.95); g.stroke();
      g.fillStyle = '#d4d4d4'; g.beginPath(); g.moveTo(lx - 11, hy + 6); g.lineTo(lx - 13, hy + 1); g.lineTo(lx - 9, hy + 3); g.fill();
      // bobber
      g.save();
      g.translate(lx, bobY);
      g.fillStyle = '#e8453c';
      g.beginPath(); g.arc(0, 0, 7, Math.PI, 0); g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(0, 0, 7, 0, Math.PI); g.fill();
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1;
      g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#222'; g.fillRect(-1, -12, 2, 5);
      g.restore();
      if (under && Math.random() < 0.06) particles.push({ kind: 'ring', x: lx, y: SURFACE + 2, life: 0, max: 1.1, color: 'rgba(255,255,255,.45)', vx: 0, vy: 0, grav: 0 });
      if (under && !zapped && Math.random() < 0.05) particles.push({ kind: 'bubble', x: lx, y: hy, vx: 0, vy: -40, life: 0, max: 4, color: 'rgba(255,255,255,.5)', size: 2, grav: 0 });
    }

    function drawAim() {
      if (!aim || aim.x <= 0 || aim.x >= 1) return;
      const x = aim.x * W;
      const y = Math.min(H - 4, Math.max(hookY(0) * H, aim.y * H));
      g.strokeStyle = 'rgba(255,255,255,.35)';
      g.lineWidth = 1.5;
      g.setLineDash([4, 4]);
      g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }

    function drawBanners(now) {
      let row = 0;
      for (let i = banners.length - 1; i >= 0; i--) {
        const b = banners[i];
        const age = now - b.born;
        if (age > b.life) { banners.splice(i, 1); continue; }
        const k = age / b.life;
        const scale = k < 0.15 ? 0.6 + (k / 0.15) * 0.4 : 1;
        g.save();
        g.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
        g.translate(W / 2, H * 0.42 + row * 40 - k * 12);
        g.scale(scale, scale);
        g.font = `900 ${b.big ? 40 : 28}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.lineWidth = 6; g.strokeStyle = 'rgba(0,20,40,.6)';
        g.strokeText(b.text, 0, 0);
        g.fillStyle = b.color; g.fillText(b.text, 0, 0);
        g.restore();
        row++;
      }
    }

    function drawHookCount(v) {
      // little pips under the HUD corner showing how full the hook is
      const max = (state && state.maxHook) || 3;
      const n = v.fish.filter((f) => f.hooked).length;
      for (let i = 0; i < max; i++) {
        g.fillStyle = i < n ? '#ffd84a' : 'rgba(255,255,255,.3)';
        g.beginPath(); g.arc(W - 18 - i * 16, H - 16, 5, 0, Math.PI * 2); g.fill();
      }
      if (state && state.frenzy) {
        g.font = '900 18px system-ui, sans-serif';
        g.textAlign = 'left';
        g.fillStyle = `rgba(255,${180 + Math.sin(performance.now() / 120) * 60},80,1)`;
        g.fillText('FRENZY!', 12, H - 10);
      }
    }

    function render(t, dt) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (shake > 0) {
        g.translate((Math.random() - 0.5) * shake * 10, (Math.random() - 0.5) * shake * 10);
        shake = Math.max(0, shake - dt * 2.5);
      }
      drawBackground(t);
      const v = view();
      if (v) for (const j of v.jellies) drawJelly(j, t);
      if (v) {
        for (const f of v.fish) {
          if (f.hooked) continue;
          drawFish(f.x, hookY(f.depth), f.kind, f.dir, t, false);
        }
      }
      drawSurface(t);
      drawParticles(t);
      drawPier();
      const tip = drawAngler(t);
      if (v) {
        const out = v.line.depth <= WATER;
        drawLine(v, tip, t);
        for (const item of hookedLayout(v)) drawFish(item.x, item.y, item.f.kind, item.f.dir, t, true, out);
        drawHookCount(v);
        canvas.classList.toggle('fi-grab', out && hookedLayout(v).length > 0);
      }
      drawAim();
      drawBanners(performance.now());
      if (v && v.line.zapped) {
        g.fillStyle = `rgba(255,120,220,${0.08 + Math.sin(t / 60) * 0.05})`;
        g.fillRect(0, 0, W, H);
      }
    }

    // Sharp drawing on HiDPI screens: the backing store matches the device pixels.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;

    function frame(t) {
      if (unmounted) return;
      const dt = lastFrame ? Math.min(0.05, (t - lastFrame) / 1000) : 0;
      lastFrame = t;
      stepParticles(dt);
      render(t, dt);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // ---- HUD, status and journal ----
    function renderJournal() {
      journalEl.replaceChildren(...KIND_ORDER.map((k) => {
        const n = Number(save.journal[k]) || 0;
        const st = FISH_STYLE[k];
        const cls = `fi-chip${n ? '' : ' fi-unknown'}${newKinds.has(k) ? ' fi-new' : ''}`;
        return h('span', { class: cls, title: n ? `${st.name}: ${n} caught` : 'Not caught yet' },
          h('i', { style: `background:${n ? st.color : '#777'}` }), n ? `${st.name} ×${n}` : '???');
      }));
    }
    renderJournal();

    function updateHud() {
      if (!state) return;
      coinsEl.textContent = String(state.score);
      const secs = Math.ceil(state.timeLeft / 1000);
      timeEl.textContent = `${secs}s`;
      timeBox.classList.toggle('fi-low', secs <= 10);
      comboEl.textContent = `x${state.mult || 1}${state.streak ? ` (${state.streak})` : ''}`;
      bestEl.textContent = String(Math.max(save.best, state.score));
    }

    function updateStatus() {
      if (!state || status.dataset.flash) return;
      const onHook = state.fish.some((f) => f.hooked);
      if (isOut(state) && onHook) status.textContent = 'Out of the water! Click (or press Space) to take each fish off the hook.';
      else if (onHook) status.textContent = `Got ${state.fish.filter((f) => f.hooked).length}! Hook more, or bring them up out of the water.`;
      else status.textContent = 'Steer the bobber to the fish. Deeper fish are worth more. Watch out for jellyfish!';
    }

    function flash(text, ms = 1300) {
      status.dataset.flash = '1';
      status.textContent = text;
      later(ms, () => { delete status.dataset.flash; updateStatus(); });
    }

    return {
      onMessage(m) {
        switch (m.type) {
          case 'state': {
            prev = state;
            state = m;
            stateAt = performance.now();
            const out = isOut(m);
            if (out !== lastOut && prev) splash(m.line.x * W);
            lastOut = out;
            if (m.frenzy && !frenzyShown) { frenzyShown = true; banner('FRENZY! Fish everywhere!', '#ffb347', true); }
            updateHud();
            updateStatus();
            break;
          }
          case 'hooked': {
            const f = state && state.fish.find((x) => x.id === m.id);
            const x = state ? state.line.x * W : W / 2;
            const y = state ? hookY(state.line.depth) * H : H / 2;
            burst(x, y, 8, { color: 'rgba(255,255,255,.8)', speed: 60, spread: Math.PI * 2, life: 0.5, size: 2, grav: 0 });
            if (f && f.kind === 'golden') banner('A Golden Koi! Bring it up!', '#ffd84a');
            break;
          }
          case 'escaped':
            flash(`The ${(FISH_STYLE[m.kind] || {}).name || 'fish'} wriggled free! Combo lost.`);
            break;
          case 'zap': {
            const x = m.x * W, y = hookY(m.depth) * H;
            burst(x, y, 22, { color: '#ff9ce6', speed: 180, spread: Math.PI * 2, life: 0.6, size: 3, grav: 0 });
            shake = 1;
            banner(m.lost ? `ZAP! Lost ${m.lost} fish` : 'ZAP!', '#ff8fe0');
            flash('A jellyfish shocked the line! Steer around them.');
            break;
          }
          case 'landed': {
            const st = FISH_STYLE[m.kind] || FISH_STYLE.minnow;
            coinsEl.textContent = String(m.score);
            const x = state ? state.line.x * W : W / 2;
            const y = state ? hookY(state.line.depth) * H : H * 0.2;
            floatText(x, y + 10, `+${m.value}`, '#ffd84a');
            burst(x, y + 20, 10, { kind: 'star', color: '#ffe680', speed: 140, life: 0.8, size: 5, grav: 200 });
            if (m.addMs) { floatText(x + 40, y + 34, `+${Math.round(m.addMs / 1000)}s`, '#7ff0dc'); banner(`+${Math.round(m.addMs / 1000)} seconds!`, '#7ff0dc'); }
            if (m.haul) banner(`FULL HAUL! +${m.haul}`, '#ffd84a', true);
            if (m.streak > 1 && m.streak % 4 === 0) banner(`Combo x${Math.min(3, 1 + Math.floor(m.streak / 4) * 0.5)}!`, '#7fe3ff');
            // journal and bests
            const first = !save.journal[m.kind];
            save.journal[m.kind] = (Number(save.journal[m.kind]) || 0) + 1;
            if (first) { newKinds.add(m.kind); banner(`New species: ${st.name}!`, '#b6ff8a'); }
            if (m.streak > save.bestStreak) save.bestStreak = m.streak;
            if (m.score > save.best) {
              if (save.best === startBest && startBest > 0) banner('New personal best!', '#ffd84a');
              save.best = m.score;
            }
            writeSave();
            renderJournal();
            updateHud();
            flash(`Landed a ${st.name}! +${m.value} coins${m.mult > 1 ? ` (x${m.mult} combo)` : ''}`);
            break;
          }
          default:
        }
      },
      unmount() {
        unmounted = true;
        cancelAnimationFrame(raf);
        canvas.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('keydown', onKey);
        for (const t of timers) clearTimeout(t);
        timers.clear();
      },
    };
  },
});
