// Sled Race (client). Draws the mountain run and the sleds; the server decides every position.
// Camera: an angled view looking up the run, so each rider sleds down-right toward you and you
// can see their face, gi and headband. Lanes spread across the run from lower-left to upper-right.
// Keys: Left/Right or A/D steer, hold Down/S to tuck (faster, steers slower), Space/Up/W does a
// trick in the air after a ramp. On a touch screen, use the buttons at the bottom.
// Personal bests, medals and a ghost of your best run are kept on this computer.
// Server rules: server/src/minigames/games/sled-race.js
ClubDojoMinigames.register({
  id: 'sled-race',

  mount(ctx) {
    const { h, el, avatar } = ctx;
    const canvas = h('canvas', { class: 'sr-canvas' });
    const hudPlace = h('div', { class: 'sr-place' });
    const hudClock = h('div', { class: 'sr-clock' });
    const hudStyle = h('div', { class: 'sr-style' });
    const rail = h('div', { class: 'sr-rail' }, h('div', { class: 'flag' }, '🏁'));
    const banner = h('div', { class: 'sr-banner', hidden: true });
    const combo = h('div', { class: 'sr-combo', hidden: true });
    const hint = h('div', { class: 'sr-hint' }, '◀ ▶ steer · hold ▼ to tuck · Space for a trick in the air');
    const card = h('div', { class: 'sr-card', hidden: true });
    const btn = (cls, label, text) => h('button', { class: `sr-btn ${cls}`, 'aria-label': label }, text);
    const btnLeft = btn('left', 'Steer left', '◀');
    const btnRight = btn('right', 'Steer right', '▶');
    const btnTuck = btn('tuck', 'Tuck', 'Tuck');
    const btnTrick = btn('trick', 'Trick', 'Trick');
    const style = h('style', {}, `
      .sr { position: absolute; inset: 0; overflow: hidden; background: #dfeaf3; user-select: none; }
      .sr-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
      .sr-place, .sr-clock, .sr-style { position: absolute; top: 10px; font-family: var(--display); color: #fff;
        text-shadow: 0 2px 4px rgba(0,0,0,.55); pointer-events: none; background: rgba(16,36,58,.55);
        border-radius: 14px; padding: 4px 12px; line-height: 1.15; }
      .sr-place { left: 12px; font-size: 30px; }
      .sr-place small { font-size: 16px; opacity: .8; }
      .sr-clock { left: 50%; transform: translateX(-50%); font-size: 22px; text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .sr-clock small { display: block; font-size: 12px; opacity: .8; font-family: system-ui, sans-serif; }
      .sr-style { right: 12px; font-size: 18px; text-align: right; }
      .sr-style b { color: #ffd96b; }
      .sr-coin { display: inline-block; position: relative; width: 16px; height: 16px; box-sizing: border-box; border-radius: 50%;
        background: #f5b82e; border: 2px solid #a86f00; vertical-align: -2px; }
      .sr-coin::after { content: ''; position: absolute; inset: 3px; background: #a86f00; }
      .sr-rail { position: absolute; right: 22px; top: 96px; bottom: 100px; width: 8px; border-radius: 4px;
        background: rgba(16,36,58,.35); pointer-events: none; }
      .sr-rail .flag { position: absolute; left: 50%; top: 100%; transform: translate(-30%, 2px); font-size: 16px; }
      .sr-rail .dot { position: absolute; left: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
        border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.5); }
      .sr-rail .dot.you { width: 18px; height: 18px; margin: -9px 0 0 -9px; border-color: #ffd96b; z-index: 2; }
      .sr-rail .dot.ghost { background: rgba(255,255,255,.55); border-style: dashed; }
      .sr-banner { position: absolute; top: 30%; left: 0; right: 0; text-align: center; font-family: var(--display); font-size: 44px;
        color: #ffd96b; text-shadow: 0 3px 0 #7a4a00, 0 6px 14px rgba(0,0,0,.5); pointer-events: none; animation: sr-pop .35s ease-out; }
      .sr-combo { position: absolute; top: 66px; right: 12px; font-family: var(--display); font-size: 18px; color: #fff;
        background: linear-gradient(90deg, #ff8a3d, #e8453c); border-radius: 12px; padding: 2px 10px; pointer-events: none;
        animation: sr-pop .3s ease-out; }
      .sr-hint { position: absolute; bottom: 92px; left: 0; right: 0; text-align: center; color: #10243a; font: 600 14px system-ui, sans-serif;
        opacity: .8; pointer-events: none; transition: opacity .8s; padding: 0 16px; }
      .sr-hint.gone { opacity: 0; }
      .sr-card { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); min-width: 260px; max-width: 86%;
        background: rgba(255,255,255,.95); color: #10243a; border-radius: 18px; padding: 16px 20px; text-align: center;
        box-shadow: 0 10px 30px rgba(0,0,0,.35); font-family: system-ui, sans-serif; animation: sr-card-pop .35s ease-out; pointer-events: none; }
      .sr-card h3 { margin: 0 0 4px; font-family: var(--display); font-size: 30px; }
      .sr-card .medal { font-size: 46px; line-height: 1; }
      .sr-card .row { display: flex; justify-content: center; gap: 16px; margin-top: 8px; font-size: 13px; }
      .sr-card .row b { display: block; font-size: 20px; }
      .sr-card .pb { margin-top: 10px; font-weight: 700; color: #1f8a4c; }
      .sr-card .sub { margin-top: 6px; font-size: 13px; opacity: .7; }
      .sr-btn { position: absolute; bottom: 14px; height: 64px; border-radius: 18px; border: 0; color: #fff; font: 700 18px system-ui, sans-serif;
        background: rgba(16,36,58,.38); touch-action: none; user-select: none; -webkit-user-select: none; }
      .sr-btn.left, .sr-btn.right { width: 78px; font-size: 26px; }
      .sr-btn.left { left: 14px; } .sr-btn.right { left: 100px; }
      .sr-btn.tuck, .sr-btn.trick { width: 86px; }
      .sr-btn.tuck { right: 108px; } .sr-btn.trick { right: 14px; background: rgba(232,69,60,.55); }
      .sr-btn.on { background: rgba(255,255,255,.6); color: #10243a; }
      .sr-btn.trick.ready { background: #e8453c; box-shadow: 0 0 0 3px #ffd96b; }
      @keyframes sr-pop { from { transform: scale(.6); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      @keyframes sr-card-pop { from { transform: translate(-50%, -50%) scale(.7); opacity: 0; } to { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
    `);
    const root = h('div', { class: 'sr' }, canvas, rail, hudPlace, hudClock, hudStyle, combo, banner, hint, card,
      btnLeft, btnRight, btnTuck, btnTrick);
    el.append(style, root);

    const g = canvas.getContext('2d');
    const byId = new Map(ctx.players.map((p) => [p.id, p]));
    const sleds = new Map();
    for (const p of ctx.players) {
      sleds.set(p.id, {
        x: 0, y: 0, rx: 0, ry: 0, vy: 0, lastStateAt: 0, lean: 0, finished: false, stunned: false, boosted: false,
        air: false, tuck: 0, drafting: false, combo: 0, style: 0, coins: 0, flash: 0, airT0: 0, airMs: 0, trickT0: -1e9,
        tricked: false, wasAir: false, trail: [], place: null, finishMs: null,
      });
    }

    let track = { length: 2800, obstacles: [], roundMs: 75000, medals: null };
    let startAt = null; // performance time when the round started
    let raceMs = 0; // race clock, kept in step with the server
    let over = false;
    let raf = 0;
    let last = performance.now();
    let cam = 0, camX = 0;
    let shake = 0;
    let dir = 0;
    const held = { left: false, right: false, tuck: false };
    const taken = new Set(); // coins you have picked up (each rider collects their own)
    const particles = []; // snow spray, sparkles and puffs, in track space
    const floaters = []; // floating "+2" texts, in track space
    const flakes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2.2, s: 0.4 + Math.random() * 0.8 }));
    const timers = new Set();
    const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    let bannerTimer = null;
    const notice = (text, ms = 1400) => {
      banner.textContent = text; banner.hidden = false;
      banner.style.animation = 'none'; void banner.offsetWidth; banner.style.animation = '';
      if (bannerTimer) { clearTimeout(bannerTimer); timers.delete(bannerTimer); }
      bannerTimer = later(ms, () => { banner.hidden = true; });
    };
    later(7000, () => hint.classList.add('gone'));

    // ---- Personal best, medals and ghost, kept on this computer ----
    const STORE = 'clubdojo.sledRace.v2';
    const loadBest = () => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } };
    const saveBest = (v) => { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch {} };
    const best = loadBest();
    const ghost = Array.isArray(best.ghost) && best.ghost.length > 4 ? best.ghost : null; // [[x, y], ...] every 100 ms
    const myRun = [];
    let nextSample = 0;
    const ghostAt = (ms) => {
      if (!ghost) return null;
      const i = ms / 100, a = Math.floor(i);
      if (a >= ghost.length - 1) { const e = ghost[ghost.length - 1]; return { x: e[0], y: e[1] }; }
      const t = i - a, p = ghost[a], q = ghost[a + 1];
      return { x: p[0] + (q[0] - p[0]) * t, y: p[1] + (q[1] - p[1]) * t };
    };

    // ---- Input ----
    function setDir(d) {
      if (d === dir) return;
      dir = d;
      ctx.send({ type: 'steer', dir: d });
    }
    function syncDir() {
      setDir((held.right ? 1 : 0) - (held.left ? 1 : 0));
      btnLeft.classList.toggle('on', held.left); btnRight.classList.toggle('on', held.right);
    }
    function setTuck(on) {
      if (held.tuck === on) return;
      held.tuck = on;
      btnTuck.classList.toggle('on', on);
      ctx.send({ type: 'tuck', on });
    }
    function trick() { if (!over) ctx.send({ type: 'trick' }); }
    const KEY = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right',
      ArrowDown: 'tuck', s: 'tuck', S: 'tuck', ' ': 'trick', ArrowUp: 'trick', w: 'trick', W: 'trick' };
    function onKey(e, down) {
      const k = KEY[e.key];
      if (!k) return;
      e.preventDefault();
      if (over) return;
      if (k === 'trick') { if (down && !e.repeat) trick(); return; }
      if (k === 'tuck') { setTuck(down); return; }
      held[k] = down;
      syncDir();
    }
    const kd = (e) => onKey(e, true);
    const ku = (e) => onKey(e, false);
    document.addEventListener('keydown', kd);
    document.addEventListener('keyup', ku);
    const bindHold = (b, on, off) => {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!over) on(); });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, off);
    };
    bindHold(btnLeft, () => { held.left = true; syncDir(); }, () => { held.left = false; syncDir(); });
    bindHold(btnRight, () => { held.right = true; syncDir(); }, () => { held.right = false; syncDir(); });
    bindHold(btnTuck, () => setTuck(true), () => setTuck(false));
    btnTrick.addEventListener('pointerdown', (e) => { e.preventDefault(); trick(); });

    // ---- Camera ----
    // The run comes toward the camera: "ahead" (distance y) goes down-right on screen, and lanes
    // (x) go across it from lower-left (-1) to upper-right (+1). The view is affine, so sizes stay
    // the same along the run and the whole slope reads at a glance.
    // On a wide screen the run slants gently across; on a tall (phone) screen it turns to run
    // more steeply down the screen so there's still plenty of slope ahead.
    const FWD = { x: 0.82, y: 0.57 };
    const ACROSS = { x: 0.57, y: -0.82 };
    let FWD_ANGLE = Math.atan2(FWD.y, FWD.x);
    const EDGE = 1.12; // groomed run edge, in lane units
    let W = 1, H = 1, U = 1, K = 1, AX = 0, AY = 0, LANE = 1;
    function layout(w, hgt) {
      W = w; H = hgt;
      const tall = Math.max(0, Math.min(1, (1.3 - w / hgt) / 0.8)); // 0 for landscape, 1 for a phone held upright
      FWD_ANGLE = 0.608 + tall * 0.42;
      FWD.x = Math.cos(FWD_ANGLE); FWD.y = Math.sin(FWD_ANGLE);
      ACROSS.x = FWD.y; ACROSS.y = -FWD.x;
      U = Math.min(hgt, w * (0.95 + tall * 0.25)); // one "screen unit", so narrow windows still fit the run
      K = (U / 520) * 0.9; // px per track unit along the run
      LANE = U * 0.34; // px from the centre line to lane x = 1
      AX = w * (0.36 + tall * 0.1); AY = hgt * (0.36 - tall * 0.14); // where your sled sits, leaving most of the screen for the run ahead
    }
    function project(x, y, z = 0) {
      const d = (y - cam) * K, a = (x - camX) * LANE;
      return { sx: AX + ACROSS.x * a + FWD.x * d, sy: AY + ACROSS.y * a + FWD.y * d - z * K };
    }
    function visible() { // the range of track coordinates the screen can show
      let d0 = Infinity, d1 = -Infinity, x0 = Infinity, x1 = -Infinity;
      for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]]) {
        const ox = cx - AX, oy = cy - AY;
        const d = (ox * FWD.x + oy * FWD.y) / K, a = (ox * ACROSS.x + oy * ACROSS.y) / LANE;
        d0 = Math.min(d0, d); d1 = Math.max(d1, d); x0 = Math.min(x0, a); x1 = Math.max(x1, a);
      }
      return { y0: cam + d0 - 40, y1: cam + d1 + 60, x0: camX + x0 - 0.3, x1: camX + x1 + 0.3 };
    }
    const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

    function path(pts) { g.beginPath(); g.moveTo(pts[0].sx, pts[0].sy); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].sx, pts[i].sy); g.closePath(); }
    function quad(x0, y0, x1, y1, z = 0) { path([project(x0, y0, z), project(x1, y0, z), project(x1, y1, z), project(x0, y1, z)]); }

    // ---- Drawing: the snow ----
    function drawGround(v, now) {
      // Deep snow off the run
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#c9dcec'); bg.addColorStop(0.5, '#e8f1f8'); bg.addColorStop(1, '#cfe0ee');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      // Soft drifts in the deep snow
      g.fillStyle = 'rgba(255,255,255,.55)';
      const D = 90;
      for (let j = Math.floor(v.y0 / D); j <= Math.ceil(v.y1 / D); j++) {
        for (const side of [-1, 1]) {
          const r = hash(j * 2 + (side > 0 ? 1 : 0));
          const p = project(side * (1.6 + r * 1.6), j * D + r * 40);
          g.beginPath(); g.ellipse(p.sx, p.sy, 46 * K * 2, 12 * K * 2, -0.6, 0, Math.PI * 2); g.fill();
        }
      }
      // Snow bank lips along both edges
      g.fillStyle = '#b9cfe2'; quad(-EDGE - 0.2, v.y0, -EDGE, v.y1); g.fill(); quad(EDGE, v.y0, EDGE + 0.2, v.y1); g.fill();
      g.fillStyle = '#f7fbff'; quad(-EDGE - 0.16, v.y0, -EDGE + 0.02, v.y1, 6); g.fill(); quad(EDGE - 0.02, v.y0, EDGE + 0.12, v.y1, 6); g.fill();
      // The groomed run, in bands so the speed reads
      const BAND = 70;
      for (let i = Math.floor(v.y0 / BAND); i <= Math.ceil(v.y1 / BAND); i++) {
        g.fillStyle = i % 2 ? '#fbfdff' : '#eef5fb';
        quad(-EDGE, i * BAND, EDGE, (i + 1) * BAND); g.fill();
      }
      // Corduroy grooming lines along the run
      g.strokeStyle = 'rgba(120,160,200,.12)'; g.lineWidth = 1;
      for (let lx = -1; lx <= 1.001; lx += 0.125) {
        const a = project(lx, v.y0), b = project(lx, v.y1);
        g.beginPath(); g.moveTo(a.sx, a.sy); g.lineTo(b.sx, b.sy); g.stroke();
      }
      // Faint lane guides
      g.strokeStyle = 'rgba(60,110,160,.16)'; g.lineWidth = 2; g.setLineDash([14, 22]);
      for (const lx of [-0.5, 0, 0.5]) {
        const a = project(lx, v.y0), b = project(lx, v.y1);
        g.beginPath(); g.moveTo(a.sx, a.sy); g.lineTo(b.sx, b.sy); g.stroke();
      }
      g.setLineDash([]);

      // Start and finish lines, and quarter markers painted on the snow
      drawLine(0, ['#2f6fd1', '#ffffff'], v);
      drawLine(track.length, ['#1b1b1b', '#ffffff'], v);
      for (const f of [0.25, 0.5, 0.75]) {
        const y = track.length * f;
        if (y < v.y0 || y > v.y1) continue;
        g.strokeStyle = 'rgba(232,69,60,.35)'; g.lineWidth = 3; g.setLineDash([10, 10]);
        const a = project(-EDGE, y), b = project(EDGE, y);
        g.beginPath(); g.moveTo(a.sx, a.sy); g.lineTo(b.sx, b.sy); g.stroke(); g.setLineDash([]);
      }

      // Sled trails: two runner grooves behind each sled (none while it's in the air)
      g.strokeStyle = 'rgba(110,150,190,.28)'; g.lineWidth = Math.max(1.5, 3 * K * 2); g.lineCap = 'round';
      for (const sl of sleds.values()) {
        if (sl.trail.length < 2) continue;
        for (const off of [-0.07, 0.07]) {
          g.beginPath();
          let started = false;
          for (const t of sl.trail) {
            if (t.air) { started = false; continue; }
            const p = project(t.x + off, t.y);
            if (!started) { g.moveTo(p.sx, p.sy); started = true; } else g.lineTo(p.sx, p.sy);
          }
          g.stroke();
        }
      }

      // Flat things on the snow: boost pads and ramps
      for (const ob of track.obstacles) {
        if (ob.y < v.y0 - 60 || ob.y > v.y1 + 60) continue;
        if (ob.kind === 'boost') drawBoostPad(ob, now);
        else if (ob.kind === 'ramp') drawRamp(ob);
      }
    }

    function drawLine(y, colors, v) {
      if (y < v.y0 - 20 || y > v.y1 + 20) return;
      const cells = 14, cw = (2 * EDGE) / cells;
      for (let r = 0; r < 2; r++) {
        for (let i = 0; i < cells; i++) {
          g.fillStyle = colors[(i + r) % 2];
          quad(-EDGE + i * cw, y - 10 + r * 10, -EDGE + (i + 1) * cw, y + r * 10); g.fill();
        }
      }
    }

    function drawBoostPad(ob, now) {
      const hw = 0.17, len = 44;
      g.fillStyle = 'rgba(64,176,255,.85)';
      quad(ob.x - hw, ob.y - len / 2, ob.x + hw, ob.y + len / 2); g.fill();
      // Chevrons sliding down the pad
      const phase = (now / 300) % 1;
      g.strokeStyle = '#fff'; g.lineWidth = Math.max(2, 3 * K * 2); g.lineJoin = 'round';
      for (let i = 0; i < 3; i++) {
        const y = ob.y - len / 2 + ((i + phase) / 3) * len;
        const a = project(ob.x - hw * 0.7, y - 6), b = project(ob.x, y + 4), c = project(ob.x + hw * 0.7, y - 6);
        g.globalAlpha = 0.4 + 0.6 * Math.sin(((i + phase) / 3) * Math.PI);
        g.beginPath(); g.moveTo(a.sx, a.sy); g.lineTo(b.sx, b.sy); g.lineTo(c.sx, c.sy); g.stroke();
      }
      g.globalAlpha = 1;
    }

    function drawRamp(ob) {
      // A packed-snow kicker: flush with the run at the back, rising to a lip at the front
      const hw = 0.2, y0 = ob.y - 38, y1 = ob.y + 6, lift = 11;
      const P = (x, y, z) => project(ob.x + x, y, z);
      const zAt = (y) => (lift * (y - y0)) / (y1 - y0);
      g.fillStyle = 'rgba(40,70,100,.2)'; // shadow past the lip
      path([P(-hw, y1), P(hw, y1), P(hw + 0.04, y1 + 12), P(-hw + 0.04, y1 + 12)]); g.fill();
      g.fillStyle = '#8fb8da'; // front face of the lip
      path([P(-hw, y1, lift), P(hw, y1, lift), P(hw, y1), P(-hw, y1)]); g.fill();
      g.fillStyle = '#a9cbe6'; // the near side wall
      path([P(-hw, y0), P(-hw, y1, lift), P(-hw, y1)]); g.fill();
      const top = g.createLinearGradient(P(0, y0).sx, P(0, y0).sy, P(0, y1, lift).sx, P(0, y1, lift).sy);
      top.addColorStop(0, '#eef6fd'); top.addColorStop(1, '#ffffff');
      g.fillStyle = top; path([P(-hw, y0), P(hw, y0), P(hw, y1, lift), P(-hw, y1, lift)]); g.fill();
      // Orange edges and an arrow so it reads as a jump from far away
      g.strokeStyle = '#ff8a3d'; g.lineWidth = Math.max(2, 2.5 * K * 2); g.lineJoin = 'round'; g.lineCap = 'round';
      for (const sx of [-hw, hw]) { const a = P(sx, y0), b = P(sx, y1, lift); g.beginPath(); g.moveTo(a.sx, a.sy); g.lineTo(b.sx, b.sy); g.stroke(); }
      g.beginPath(); g.moveTo(P(-hw, y1, lift).sx, P(-hw, y1, lift).sy); g.lineTo(P(hw, y1, lift).sx, P(hw, y1, lift).sy); g.stroke();
      const ya = y0 + (y1 - y0) * 0.35, yb = y0 + (y1 - y0) * 0.75;
      const a = P(-hw * 0.55, ya, zAt(ya)), b = P(0, yb, zAt(yb)), c = P(hw * 0.55, ya, zAt(ya));
      g.beginPath(); g.moveTo(a.sx, a.sy); g.lineTo(b.sx, b.sy); g.lineTo(c.sx, c.sy); g.stroke();
    }

    // ---- Drawing: upright things, sorted so nearer ones (lower on screen) overlap farther ones ----
    function collectSprites(v, now) {
      const list = [];
      // Pines off the run, placed from a hash so they never jump around
      const TREE = 34;
      for (let j = Math.floor(v.y0 / TREE) - 1; j <= Math.ceil(v.y1 / TREE) + 1; j++) {
        for (let side = -1; side <= 1; side += 2) {
          for (let k = 0; k < 2; k++) {
            const r = hash(j * 7.13 + side * 3.1 + k * 17.7);
            if (r < 0.25) continue;
            const x = side * (EDGE + 0.42 + hash(j * 1.7 + k * 9.1 + side) * (side > 0 ? 2.6 : 2.2) + k * 0.4);
            if (x < v.x0 || x > v.x1) continue;
            const y = j * TREE + hash(j * 3.3 + k) * TREE;
            const p = project(x, y);
            list.push({ sy: p.sy, draw: () => drawPine(p, 0.75 + r * 0.6) });
          }
        }
      }
      // Marker poles along the run edges
      for (let y = Math.floor(v.y0 / 120) * 120; y <= v.y1; y += 120) {
        for (const side of [-1, 1]) {
          const p = project(side * (EDGE + 0.08), y);
          list.push({ sy: p.sy, draw: () => drawPole(p, (y / 120 + (side > 0 ? 1 : 0)) % 2 ? '#e8453c' : '#2f6fd1', now) });
        }
      }
      // Gates over the start and finish lines
      for (const [y, text, color] of [[0, 'START', '#2f6fd1'], [track.length, 'FINISH', '#e8453c']]) {
        if (y < v.y0 - 80 || y > v.y1 + 80) continue;
        const a = project(-EDGE - 0.1, y), b = project(EDGE + 0.1, y);
        list.push({ sy: Math.max(a.sy, b.sy), draw: () => drawGate(a, b, text, color) });
      }
      // Rocks and coins
      for (const ob of track.obstacles) {
        if (ob.y < v.y0 - 40 || ob.y > v.y1 + 40) continue;
        if (ob.kind === 'rock') { const p = project(ob.x, ob.y); list.push({ sy: p.sy, draw: () => drawRock(p, ob.n) }); }
        else if (ob.kind === 'coin' && !taken.has(ob.n)) { const p = project(ob.x, ob.y); list.push({ sy: p.sy, draw: () => drawCoin(ob, now) }); }
      }
      // Your ghost
      if (ghost && startAt !== null) {
        const gp = ghostAt(raceMs);
        if (gp && gp.y > v.y0 && gp.y < v.y1) list.push({ sy: project(gp.x, gp.y).sy, draw: () => drawGhost(gp, now) });
      }
      // Sleds
      for (const [id, sl] of sleds) {
        const pl = byId.get(id);
        if (!pl) continue;
        const p = project(sl.rx, sl.ry);
        if (p.sx < -150 || p.sx > W + 150 || p.sy < -150 || p.sy > H + 150) continue;
        list.push({ sy: p.sy + 0.01, draw: () => drawSled(id, sl, pl, now) });
      }
      return list.sort((a, b) => a.sy - b.sy);
    }

    function drawPine(p, s) {
      const u = 26 * K * 2 * s;
      g.fillStyle = 'rgba(40,70,100,.18)';
      g.beginPath(); g.ellipse(p.sx + u * 0.5, p.sy + u * 0.1, u * 0.9, u * 0.3, -0.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#6b4a2e'; g.fillRect(p.sx - u * 0.1, p.sy - u * 0.5, u * 0.2, u * 0.5);
      for (const [b, t, wdt] of [[0.5, 1.0, 0.85], [1.1, 1.65, 0.65], [1.6, 2.2, 0.45]]) {
        const tip = p.sy - u * t * 1.15;
        g.fillStyle = '#1f5a45';
        g.beginPath(); g.moveTo(p.sx - u * wdt, p.sy - u * b); g.lineTo(p.sx, tip); g.lineTo(p.sx + u * wdt, p.sy - u * b); g.closePath(); g.fill();
        g.fillStyle = '#2a7358'; // sunlit side
        g.beginPath(); g.moveTo(p.sx, p.sy - u * b); g.lineTo(p.sx, tip); g.lineTo(p.sx + u * wdt, p.sy - u * b); g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,.92)'; // snow on each tier
        const sy1 = p.sy - u * (b + (t - b) * 0.45), sy2 = p.sy - u * (b + (t - b) * 0.5);
        g.beginPath(); g.moveTo(p.sx - u * wdt * 0.5, sy1); g.lineTo(p.sx, tip); g.lineTo(p.sx + u * wdt * 0.45, sy2);
        g.quadraticCurveTo(p.sx, p.sy - u * (b + (t - b) * 0.62), p.sx - u * wdt * 0.5, sy1); g.fill();
      }
    }

    function drawPole(p, color, now) {
      const u = 22 * K * 2;
      g.strokeStyle = '#3a3f46'; g.lineWidth = Math.max(1.5, u * 0.08);
      g.beginPath(); g.moveTo(p.sx, p.sy); g.lineTo(p.sx, p.sy - u * 1.6); g.stroke();
      const wave = Math.sin(now / 260 + p.sx * 0.05) * u * 0.08;
      g.fillStyle = color;
      g.beginPath(); g.moveTo(p.sx, p.sy - u * 1.6); g.lineTo(p.sx - u * 0.75, p.sy - u * 1.42 + wave); g.lineTo(p.sx, p.sy - u * 1.22); g.closePath(); g.fill();
    }

    function drawGate(a, b, text, color) {
      const u = 22 * K * 2, top = u * 3.1;
      g.strokeStyle = '#3a3f46'; g.lineWidth = Math.max(3, u * 0.18);
      for (const p of [a, b]) { g.beginPath(); g.moveTo(p.sx, p.sy); g.lineTo(p.sx, p.sy - top); g.stroke(); }
      g.fillStyle = color;
      path([{ sx: a.sx, sy: a.sy - top }, { sx: b.sx, sy: b.sy - top }, { sx: b.sx, sy: b.sy - top + u * 0.9 }, { sx: a.sx, sy: a.sy - top + u * 0.9 }]); g.fill();
      g.save();
      g.translate((a.sx + b.sx) / 2, (a.sy + b.sy) / 2 - top + u * 0.45); g.rotate(Math.atan2(b.sy - a.sy, b.sx - a.sx));
      g.fillStyle = '#fff'; g.font = `700 ${Math.round(u * 0.6)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, 0, 0);
      g.restore();
    }

    function drawRock(p, n) {
      // A rounded boulder with a snow cap, and sometimes a small stone beside it
      const r = 0.058 * U, j = hash(n);
      const boulder = (cx, cy, rr) => {
        g.fillStyle = 'rgba(40,70,100,.25)';
        g.beginPath(); g.ellipse(cx + rr * 0.3, cy + rr * 0.08, rr * 1.15, rr * 0.42, 0, 0, Math.PI * 2); g.fill();
        const body = g.createLinearGradient(cx - rr, 0, cx + rr, 0);
        body.addColorStop(0, '#8d97a3'); body.addColorStop(0.55, '#6c7682'); body.addColorStop(1, '#4b535d');
        g.fillStyle = body;
        g.beginPath();
        g.moveTo(cx - rr, cy);
        g.bezierCurveTo(cx - rr * 1.05, cy - rr * 0.9, cx - rr * 0.2, cy - rr * 1.25, cx + rr * 0.35, cy - rr * 1.0);
        g.bezierCurveTo(cx + rr * 0.95, cy - rr * 0.8, cx + rr * 1.1, cy - rr * 0.2, cx + rr * 0.95, cy);
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(40,45,52,.35)'; g.lineWidth = Math.max(1, rr * 0.06); // a crack
        g.beginPath(); g.moveTo(cx + rr * 0.2, cy - rr * 0.95); g.lineTo(cx + rr * 0.05, cy - rr * 0.55); g.lineTo(cx + rr * 0.25, cy - rr * 0.25); g.stroke();
        g.fillStyle = '#f6f9fc'; // snow cap
        g.beginPath();
        g.moveTo(cx - rr * 0.85, cy - rr * 0.55);
        g.bezierCurveTo(cx - rr * 0.8, cy - rr * 1.05, cx + rr * 0.1, cy - rr * 1.3, cx + rr * 0.6, cy - rr * 0.85);
        g.quadraticCurveTo(cx + rr * 0.3, cy - rr * 0.65, cx + rr * 0.05, cy - rr * 0.78);
        g.quadraticCurveTo(cx - rr * 0.35, cy - rr * 0.5, cx - rr * 0.85, cy - rr * 0.55);
        g.fill();
      };
      if (j > 0.5) boulder(p.sx + r * 0.95, p.sy - r * 0.35, r * 0.45);
      boulder(p.sx, p.sy, r);
    }

    function drawCoin(ob, now) {
      const bob = 8 + Math.sin(now / 220 + ob.n) * 3;
      const ground = project(ob.x, ob.y), p = project(ob.x, ob.y, bob);
      const r = 0.024 * U;
      const spin = Math.cos(now / 180 + ob.n * 0.7);
      g.fillStyle = 'rgba(40,70,100,.2)'; g.beginPath(); g.ellipse(ground.sx, ground.sy, r * 0.8, r * 0.3, 0, 0, Math.PI * 2); g.fill();
      const rx = Math.max(r * 0.15, r * Math.abs(spin));
      g.fillStyle = spin > 0 ? '#f5b82e' : '#d99a16';
      g.beginPath(); g.ellipse(p.sx, p.sy - r, rx, r, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#a86f00'; g.lineWidth = Math.max(1, r * 0.14); g.stroke();
      if (rx > r * 0.4) { g.fillStyle = '#a86f00'; g.fillRect(p.sx - rx * 0.28, p.sy - r - r * 0.28, rx * 0.56, r * 0.56); } // square hole of a ryo coin
      g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.ellipse(p.sx - rx * 0.35, p.sy - r * 1.4, rx * 0.2, r * 0.2, 0, 0, Math.PI * 2); g.fill();
    }

    function drawGhost(gp, now) {
      const p = project(gp.x, gp.y);
      const me = byId.get(ctx.youId);
      const s = 0.05 * U;
      g.save();
      g.globalAlpha = 0.35;
      drawToboggan(p, s, 0, '#ffffff', '#cfe3f5');
      if (me) avatar.draw(g, { ...me.loadout, color: '#cfe3f5', headband: '#ffffff', accessories: {} }, { x: p.sx - FWD.x * s * 0.35, y: p.sy - FWD.y * s * 0.35, size: s * 1.25, facing: 1, time: now, shadow: false });
      g.restore();
      label(p.sx, p.sy - s * 2.4, 'Your best', 'rgba(255,255,255,.9)', 11);
    }

    // A wooden toboggan pointing down the run, with a curled front and a stripe in the rider's colour
    function drawToboggan(p, s, yaw, stripe, wood = '#b9773f') {
      g.save();
      g.translate(p.sx, p.sy);
      g.rotate(FWD_ANGLE + yaw);
      g.scale(1, 0.55); // seen at an angle from above, the deck looks narrower across than along
      const L = s * 2.2, Wd = s * 0.95;
      g.fillStyle = wood;
      g.beginPath();
      g.moveTo(-L * 0.5, -Wd * 0.5); g.lineTo(L * 0.32, -Wd * 0.5);
      g.quadraticCurveTo(L * 0.62, -Wd * 0.5, L * 0.6, 0); g.quadraticCurveTo(L * 0.62, Wd * 0.5, L * 0.32, Wd * 0.5);
      g.lineTo(-L * 0.5, Wd * 0.5); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(80,45,20,.45)'; g.lineWidth = Math.max(1, s * 0.05);
      for (const t of [-0.17, 0.17]) { g.beginPath(); g.moveTo(-L * 0.48, Wd * t); g.lineTo(L * 0.45, Wd * t); g.stroke(); }
      g.fillStyle = stripe;
      g.fillRect(-L * 0.12, -Wd * 0.5, L * 0.14, Wd);
      g.fillStyle = '#8a5a32'; // curled front
      g.beginPath(); g.ellipse(L * 0.52, 0, L * 0.09, Wd * 0.5, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    function drawSled(id, sl, pl, now) {
      const you = id === ctx.youId;
      const base = project(sl.rx, sl.ry);
      const s = 0.05 * U; // sled half-size in px
      const look = pl.loadout || {};
      // Height in the air: a smooth arc over the jump, with a full spin for a trick
      let z = 0, spin = 0;
      if (sl.airMs && now - sl.airT0 < sl.airMs) {
        z = Math.sin(Math.PI * ((now - sl.airT0) / sl.airMs)) * 0.09 * U;
        const tt = (now - sl.trickT0) / 450;
        if (tt >= 0 && tt <= 1) spin = easeInOut(tt) * Math.PI * 2;
      }
      const lean = sl.lean; // -1..1, from sideways movement
      const wobble = sl.stunned ? Math.sin(now / 45) * 0.25 : 0;

      // The shadow stays on the snow and shrinks while the sled is in the air
      const shrink = 1 - z / (0.16 * U);
      g.fillStyle = 'rgba(20,40,60,.25)';
      g.beginPath(); g.ellipse(base.sx, base.sy + s * 0.15, s * 1.25 * shrink, s * 0.42 * shrink, FWD_ANGLE, 0, Math.PI * 2); g.fill();
      if (you) {
        g.strokeStyle = 'rgba(255,217,107,.9)'; g.lineWidth = 3;
        g.beginPath(); g.ellipse(base.sx, base.sy + s * 0.15, s * 1.5, s * 0.6, FWD_ANGLE, 0, Math.PI * 2); g.stroke();
      }

      const p = { sx: base.sx, sy: base.sy - z };
      g.save();
      g.translate(p.sx, p.sy); g.rotate(spin + wobble * 0.5); g.translate(-p.sx, -p.sy);

      if (sl.boosted) { // glow under the sled
        const gl = g.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, s * 2);
        gl.addColorStop(0, 'rgba(90,200,255,.55)'); gl.addColorStop(1, 'rgba(90,200,255,0)');
        g.fillStyle = gl; g.beginPath(); g.ellipse(p.sx, p.sy, s * 2.2, s * 1.1, 0, 0, Math.PI * 2); g.fill();
      }
      drawToboggan(p, s, lean * 0.3 + wobble, look.headband || '#e8453c');

      // The rider sits toward the back of the sled and leans into turns; tucking crouches low.
      // The avatar renderer draws their own gi, headband, belt and accessories.
      const seat = { sx: p.sx - FWD.x * s * 0.35, sy: p.sy - FWD.y * s * 0.35 };
      const size = s * 1.25;
      const squash = 0.8 - 0.14 * sl.tuck;
      g.save();
      g.translate(seat.sx, seat.sy); g.rotate(lean * 0.22 + wobble); g.scale(1, squash); g.translate(-seat.sx, -seat.sy);
      avatar.draw(g, look, { x: seat.sx, y: seat.sy, size, facing: 1, walking: false, time: now, shadow: false });
      g.restore();
      // Legs stretched forward along the deck, in front of the body
      const legEnd = { sx: seat.sx + FWD.x * s * 0.95, sy: seat.sy + FWD.y * s * 0.95 - s * 0.05 };
      g.strokeStyle = shade(look.color || '#20262e', -0.15); g.lineCap = 'round'; g.lineWidth = s * 0.34;
      for (const off of [-0.22, 0.22]) {
        const ox = ACROSS.x * s * off, oy = ACROSS.y * s * off * 0.55;
        g.beginPath(); g.moveTo(seat.sx + ox, seat.sy - s * 0.1 + oy); g.lineTo(legEnd.sx + ox, legEnd.sy + oy); g.stroke();
        g.fillStyle = '#1b1b1b'; g.beginPath(); g.ellipse(legEnd.sx + ox, legEnd.sy + oy, s * 0.2, s * 0.15, 0, 0, Math.PI * 2); g.fill();
      }
      // Hands holding the steering rope tied to the front
      const rope = { sx: p.sx + FWD.x * s * 1.05, sy: p.sy + FWD.y * s * 1.05 * 0.55 };
      for (const off of [-0.5, 0.5]) {
        const hx = seat.sx + ACROSS.x * s * off + FWD.x * s * 0.45;
        const hy = seat.sy + ACROSS.y * s * off * 0.55 - size * 0.45 * squash + FWD.y * s * 0.3;
        g.strokeStyle = '#e8d6a8'; g.lineWidth = Math.max(1.5, s * 0.07);
        g.beginPath(); g.moveTo(rope.sx, rope.sy); g.lineTo(hx, hy); g.stroke();
        g.fillStyle = look.color || '#20262e';
        g.beginPath(); g.arc(hx, hy, s * 0.17, 0, Math.PI * 2); g.fill();
      }
      if (sl.flash > 0 && Math.floor(now / 80) % 2) {
        g.fillStyle = 'rgba(255,80,60,.35)'; g.beginPath(); g.ellipse(seat.sx, seat.sy - size * 0.5, size * 0.6, size * 0.75, 0, 0, Math.PI * 2); g.fill();
      }
      g.restore();

      // Dizzy stars after a crash
      const headY = p.sy - size * 1.15 * squash - s * 0.2;
      if (sl.stunned) {
        for (let i = 0; i < 3; i++) {
          const a = now / 180 + (i * Math.PI * 2) / 3;
          star(seat.sx + Math.cos(a) * s * 0.7, headY - s * 0.15 + Math.sin(a) * s * 0.2, s * 0.16, '#ffd96b');
        }
      }
      // Wind lines while drafting
      if (sl.drafting) {
        g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const o = ((now / 120 + i / 3) % 1) * s * 1.6;
          const ax = p.sx - FWD.x * (s * 1.4 + o) + ACROSS.x * s * (i - 1) * 0.6, ay = p.sy - FWD.y * (s * 1.4 + o) + ACROSS.y * s * (i - 1) * 0.6 - s * 0.6;
          g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax - FWD.x * s * 0.7, ay - FWD.y * s * 0.7); g.stroke();
        }
      }
      // Name tag; yours is gold with a bouncing arrow so it's easy to spot
      const tagY = headY - s * 0.55;
      label(seat.sx, tagY, pl.name, you ? '#ffd96b' : '#fff', 12);
      if (you) {
        const by = tagY - 16 + Math.sin(now / 200) * 2;
        g.fillStyle = '#ffd96b'; g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(seat.sx - 7, by - 8); g.lineTo(seat.sx + 7, by - 8); g.lineTo(seat.sx, by); g.closePath(); g.stroke(); g.fill();
      }
    }

    function label(x, y, text, color, px) {
      g.font = `700 ${px}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.lineWidth = 3; g.strokeStyle = 'rgba(10,25,40,.7)'; g.lineJoin = 'round';
      g.strokeText(text, x, y); g.fillStyle = color; g.fillText(text, x, y);
    }
    function star(x, y, r, color) {
      g.fillStyle = color;
      g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
      g.closePath(); g.fill();
    }
    function shade(hex, amt) {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
      if (!m) return hex;
      const n = parseInt(m[1], 16);
      const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))));
      return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
    }
    const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

    // ---- Particles ----
    function emit(x, y, n, kind, o = {}) {
      for (let i = 0; i < n; i++) {
        particles.push({
          x: x + (Math.random() - 0.5) * 0.08, y: y + (Math.random() - 0.5) * 6, z: o.z ?? 2,
          vx: (o.vx ?? 0) + (Math.random() - 0.5) * (o.spread ?? 0.6), vy: (o.vy ?? -30) + (Math.random() - 0.5) * 30,
          vz: (o.vz ?? 30) + Math.random() * 30, life: 0, max: (o.life ?? 0.6) * (0.7 + Math.random() * 0.6), kind,
          color: o.color || '#ffffff',
        });
      }
      if (particles.length > 400) particles.splice(0, particles.length - 400);
    }
    function stepParticles(dt) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const q = particles[i];
        q.life += dt;
        if (q.life >= q.max) { particles.splice(i, 1); continue; }
        q.x += q.vx * dt; q.y += q.vy * dt; q.z = Math.max(0, q.z + q.vz * dt); q.vz -= 160 * dt;
      }
      for (let i = floaters.length - 1; i >= 0; i--) { floaters[i].life += dt; if (floaters[i].life > 0.9) floaters.splice(i, 1); }
    }
    function drawParticles() {
      for (const q of particles) {
        const p = project(q.x, q.y, q.z);
        g.globalAlpha = 1 - q.life / q.max;
        const r = (q.kind === 'puff' ? 7 * (1 + q.life * 2) : q.kind === 'spark' ? 4 : 3.5) * K * 2;
        if (q.kind === 'spark') star(p.sx, p.sy, r, q.color);
        else { g.fillStyle = q.color; g.beginPath(); g.arc(p.sx, p.sy, r, 0, Math.PI * 2); g.fill(); }
      }
      for (const f of floaters) {
        const p = project(f.x, f.y, 30 + f.life * 50);
        g.globalAlpha = 1 - f.life / 0.9;
        label(p.sx, p.sy, f.text, f.color, 15);
      }
      g.globalAlpha = 1;
    }

    function drawOverlay(now, dt) {
      // Speed streaks while boosting
      const me = sleds.get(ctx.youId);
      if (me && me.boosted) {
        g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2;
        for (let i = 0; i < 14; i++) {
          const r1 = hash(i * 9.7 + Math.floor(now / 90)), r2 = hash(i * 3.1 + Math.floor(now / 90));
          const x = r1 * W, y = r2 * H, len = 40 + r1 * 60;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - FWD.x * len, y - FWD.y * len); g.stroke();
        }
      }
      // Falling snow
      g.fillStyle = 'rgba(255,255,255,.85)';
      for (const f of flakes) {
        f.y += f.s * dt * 0.12; f.x -= f.s * dt * 0.03;
        if (f.y > 1) { f.y -= 1; f.x = Math.random(); }
        if (f.x < 0) f.x += 1;
        g.beginPath(); g.arc(f.x * W, f.y * H, f.r, 0, Math.PI * 2); g.fill();
      }
      // A soft vignette keeps the eye on the middle
      const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(16,36,58,0)'); vg.addColorStop(1, 'rgba(16,36,58,.28)');
      g.fillStyle = vg; g.fillRect(0, 0, W, H);
    }

    function drawScene(now, dt) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, root.clientWidth), hgt = Math.max(1, root.clientHeight);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
      }
      layout(w, hgt);
      const jx = shake > 0 ? (Math.random() - 0.5) * shake * 14 : 0, jy = shake > 0 ? (Math.random() - 0.5) * shake * 14 : 0;
      g.setTransform(dpr, 0, 0, dpr, jx * dpr, jy * dpr);
      const v = visible();
      drawGround(v, now);
      for (const sp of collectSprites(v, now)) sp.draw();
      drawParticles();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawOverlay(now, dt);
    }

    // ---- HUD ----
    const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
    const fmt = (ms) => { const t = Math.max(0, ms) / 1000; return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`; };
    const railDots = new Map();
    let hudKey = '';
    function updateHud(now) {
      const me = sleds.get(ctx.youId);
      const order = [...sleds.entries()].filter(([id]) => byId.has(id))
        .sort((a, b) => ((a[1].place ?? 99) - (b[1].place ?? 99)) || (b[1].y - a[1].y));
      const pos = order.findIndex(([id]) => id === ctx.youId) + 1;
      const left = startAt === null ? track.roundMs : Math.max(0, track.roundMs - raceMs);
      const clock = fmt(me && me.finishMs !== null ? me.finishMs : raceMs);
      const key = `${pos}|${order.length}|${clock}|${Math.ceil(left / 1000)}|${me ? me.coins : 0}|${me ? me.style : 0}|${best.bestMs}`;
      if (key !== hudKey) { // only touch the DOM when something shown has changed
        hudKey = key;
        hudPlace.replaceChildren(pos ? ordinal(pos) : '-', h('small', {}, ` / ${order.length}`));
        const bestTxt = best.bestMs ? `Best ${fmt(best.bestMs)}` : 'No best time yet';
        hudClock.replaceChildren(clock, h('small', {}, `${bestTxt} · ${Math.ceil(left / 1000)}s left`));
        hudStyle.replaceChildren(h('span', {}, h('i', { class: 'sr-coin' }), ' ', h('b', {}, String(me ? me.coins : 0))), h('br'), h('span', {}, `Style ${me ? me.style : 0}`));
      }
      if (me && me.combo >= 3) {
        const m = 1 + Math.min(2, Math.floor(me.combo / 5));
        const txt = `Combo ${me.combo}${m > 1 ? ` · x${m}` : ''}`;
        if (combo.textContent !== txt || combo.hidden) { combo.textContent = txt; combo.hidden = false; }
      } else if (!combo.hidden) combo.hidden = true;
      btnTrick.classList.toggle('ready', !!(me && me.airMs && now - me.airT0 < me.airMs - 200 && !me.tricked));
      // Progress rail: one dot per racer in their gi colour, plus your ghost
      const want = new Set();
      const place = (k, frac, color, cls) => {
        want.add(k);
        let d = railDots.get(k);
        if (!d) { d = h('div', { class: `dot ${cls}` }); railDots.set(k, d); rail.append(d); }
        d.style.top = `${Math.min(1, Math.max(0, frac)) * 100}%`;
        if (color) d.style.background = color;
      };
      for (const [id, sl] of sleds) {
        const pl = byId.get(id);
        if (pl) place(`p${id}`, sl.ry / track.length, (pl.loadout && pl.loadout.color) || '#20262e', id === ctx.youId ? 'you' : '');
      }
      if (ghost && startAt !== null) { const gp = ghostAt(raceMs); if (gp) place('ghost', gp.y / track.length, null, 'ghost'); }
      for (const [k, d] of railDots) if (!want.has(k)) { d.remove(); railDots.delete(k); }
    }

    function showFinishCard(m) {
      const medals = track.medals || {};
      const medal = m.ms <= medals.gold ? ['🥇', 'gold', 3] : m.ms <= medals.silver ? ['🥈', 'silver', 2] : m.ms <= medals.bronze ? ['🥉', 'bronze', 1] : null;
      const prevBest = best.bestMs;
      const pb = !prevBest || m.ms < prevBest;
      const next = { ...best, races: (best.races || 0) + 1, finishes: (best.finishes || 0) + 1 };
      if (pb) { next.bestMs = m.ms; next.ghost = myRun.slice(); }
      if (medal && medal[2] > (best.medal || 0)) next.medal = medal[2];
      if ((m.style || 0) > (best.bestStyle || 0)) next.bestStyle = m.style;
      if (m.place === 1 && byId.size > 1) next.wins = (best.wins || 0) + 1;
      saveBest(next);
      Object.assign(best, next);
      const goal = !medal ? `bronze at ${fmt(medals.bronze)}` : medal[1] === 'bronze' ? `silver at ${fmt(medals.silver)}`
        : medal[1] === 'silver' ? `gold at ${fmt(medals.gold)}` : null;
      card.replaceChildren(
        medal ? h('div', { class: 'medal' }, medal[0]) : null,
        h('h3', {}, m.place === 1 ? (byId.size > 1 ? 'You win!' : 'Finished!') : `${ordinal(m.place)} place`),
        h('div', { class: 'row' },
          h('span', {}, h('b', {}, fmt(m.ms)), 'time'),
          h('span', {}, h('b', {}, String(m.coins || 0)), 'coins'),
          h('span', {}, h('b', {}, String(m.tricks || 0)), 'tricks'),
          h('span', {}, h('b', {}, String(m.style || 0)), 'style')),
        pb ? h('div', { class: 'pb' }, prevBest ? `New personal best! ${((prevBest - m.ms) / 1000).toFixed(1)}s faster` : 'First finish! Your ghost will race you next time.')
          : h('div', { class: 'sub' }, `Personal best ${fmt(prevBest)}`),
        h('div', { class: 'sub' }, goal ? `Next goal: ${goal}` : 'Gold medal! Now beat your own ghost.'));
      card.hidden = false;
    }

    // ---- Main loop ----
    function step(now) {
      raf = requestAnimationFrame(step);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (startAt !== null && !over) raceMs += dt * 1000;
      const k = 1 - Math.exp(-dt * 12);
      for (const [id, sl] of sleds) {
        // Predict a little past the last update so movement stays smooth between server messages
        const ahead = sl.finished ? 0 : Math.min(0.15, (now - sl.lastStateAt) / 1000) * sl.vy;
        const ty = Math.min(track.length, sl.y + ahead);
        const prevX = sl.rx;
        sl.rx += (sl.x - sl.rx) * k;
        sl.ry += (ty - sl.ry) * k;
        const vx = dt > 0 ? (sl.rx - prevX) / dt : 0;
        sl.lean += (Math.max(-1, Math.min(1, vx / 1.1)) - sl.lean) * (1 - Math.exp(-dt * 8));
        if (sl.flash > 0) sl.flash -= dt;
        const air = !!(sl.airMs && now - sl.airT0 < sl.airMs);
        // Runner grooves and snow spray
        const lastPt = sl.trail[sl.trail.length - 1];
        if (!lastPt || sl.ry - lastPt.y > 5 || Math.abs(sl.rx - lastPt.x) > 0.05) {
          sl.trail.push({ x: sl.rx, y: sl.ry, air });
          if (sl.trail.length > 140) sl.trail.shift();
        }
        if (!air && !sl.finished && startAt !== null && sl.vy > 10) {
          const spray = Math.abs(sl.lean) > 0.35 ? 3 : sl.tuck > 0.5 || sl.boosted ? 1 : Math.random() < 0.3 ? 1 : 0;
          if (spray) emit(sl.rx - sl.lean * 0.06, sl.ry - 6, spray, 'snow', { vx: -sl.lean * 0.5, vy: -20, vz: 25 + Math.abs(sl.lean) * 40, spread: 0.4, life: 0.5 });
        }
        if (sl.wasAir && !air) { // landing
          emit(sl.rx, sl.ry, 14, 'snow', { vz: 50, spread: 1.2, life: 0.6 });
          if (id === ctx.youId) shake = Math.max(shake, 0.3);
        }
        sl.wasAir = air;
      }
      stepParticles(dt);
      if (shake > 0) shake = Math.max(0, shake - dt * 2.5);
      const me = sleds.get(ctx.youId);
      // The camera follows your sled down the run and drifts a little toward your lane
      cam += ((me ? me.ry : track.length / 2) - cam) * (1 - Math.exp(-dt * 7));
      camX += ((me ? me.rx * 0.35 : 0) - camX) * (1 - Math.exp(-dt * 3));
      // Record your run for the ghost, every 100 ms of race time
      if (me && startAt !== null && !me.finished && raceMs >= nextSample) {
        myRun.push([Math.round(me.x * 1000) / 1000, Math.round(me.y * 10) / 10]);
        nextSample += 100;
      }
      drawScene(now, dt);
      updateHud(now);
    }

    raf = requestAnimationFrame(step);

    return {
      onMessage(data) {
        const now = performance.now();
        if (data.type === 'track') {
          track = { length: data.length, roundMs: data.roundMs, obstacles: data.obstacles || [], medals: data.medals || null };
          startAt = now;
          raceMs = 0;
          notice('Go!', 1000);
        } else if (data.type === 'state') {
          if (typeof data.t === 'number' && Math.abs(data.t - raceMs) > 250) raceMs = data.t; // keep the clock honest
          for (const [id, v] of Object.entries(data.players)) {
            const sl = sleds.get(Number(id)); // JSON object keys arrive as strings
            if (!sl) continue;
            const dtS = sl.lastStateAt ? (now - sl.lastStateAt) / 1000 : 0;
            if (dtS > 0.02) sl.vy += ((v[1] - sl.y) / dtS - sl.vy) * 0.6;
            if (!sl.lastStateAt) { sl.rx = v[0]; sl.ry = v[1]; }
            sl.lastStateAt = now;
            sl.x = v[0]; sl.y = v[1]; sl.finished = !!v[2]; sl.stunned = !!v[3]; sl.boosted = !!v[4];
            sl.air = !!v[5]; sl.tuck = v[6] || 0; sl.drafting = !!v[7]; sl.combo = v[8] || 0; sl.style = v[9] || 0;
            if (sl.finished) sl.vy = 0;
          }
        } else if (data.type === 'hit') {
          const sl = sleds.get(data.id);
          if (!sl) return;
          const you = data.id === ctx.youId;
          if (data.kind === 'rock') {
            sl.flash = 0.7;
            emit(sl.rx, sl.ry, 16, 'puff', { vz: 40, spread: 1, life: 0.7 });
            if (you) { shake = 1; notice('Ouch!', 700); }
          } else if (data.kind === 'boost') {
            emit(sl.rx, sl.ry, 10, 'spark', { vz: 50, spread: 0.8, life: 0.6, color: '#7fd4ff' });
            if (you) notice('Boost!', 700);
          } else if (data.kind === 'ramp') {
            sl.airT0 = now; sl.airMs = data.ms || 800; sl.tricked = false;
            if (you) notice('Air! Press Space', 900);
          } else if (data.kind === 'coin') {
            taken.add(data.n);
            sl.coins += 1;
            sl.combo = data.combo; sl.style = data.style;
            const ob = track.obstacles.find((o) => o.n === data.n);
            if (ob) {
              emit(ob.x, ob.y, 6, 'spark', { z: 10, vz: 40, spread: 0.5, life: 0.5, color: '#ffd96b' });
              floaters.push({ x: ob.x, y: ob.y, text: '+1', color: '#ffd96b', life: 0 });
            }
          }
        } else if (data.type === 'trick') {
          const sl = sleds.get(data.id);
          if (!sl) return;
          sl.trickT0 = now; sl.tricked = true; sl.combo = data.combo; sl.style = data.style;
          emit(sl.rx, sl.ry, 12, 'spark', { z: 40, vz: 30, spread: 1, life: 0.7, color: '#ffd96b' });
          if (data.id === ctx.youId) notice(['Spin!', 'Sweet trick!', 'Ninja spin!', 'Stylish!'][Math.floor(Math.random() * 4)], 900);
        } else if (data.type === 'finish') {
          const sl = sleds.get(data.id);
          const p = byId.get(data.id);
          if (sl) { sl.place = data.place; sl.finishMs = data.ms; }
          if (data.id === ctx.youId) {
            held.left = held.right = false; syncDir(); setTuck(false);
            notice(data.place === 1 ? '🏆 First!' : `Finished ${ordinal(data.place)}!`, 1600);
            if (sl) emit(sl.rx, sl.ry, 30, 'spark', { z: 20, vz: 80, spread: 2, life: 1.1, color: ['#ffd96b', '#e8453c', '#2f6fd1', '#3fbf7f'][data.place % 4] });
            later(900, () => showFinishCard(data));
          } else if (p) notice(`${p.name} finished ${ordinal(data.place)}`, 1400);
        } else if (data.type === 'over') {
          over = true;
          held.left = held.right = false;
          setDir(0); setTuck(false);
          for (const [id, v] of Object.entries(data.players || {})) {
            const sl = sleds.get(Number(id));
            if (sl) { sl.x = v[0]; sl.y = v[1]; sl.vy = 0; }
          }
          const me = sleds.get(ctx.youId);
          if (me && !me.finished) {
            notice("Time's up!", 1600);
            const next = { ...best, races: (best.races || 0) + 1 };
            saveBest(next); Object.assign(best, next);
          }
        }
      },
      unmount() {
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', kd);
        document.removeEventListener('keyup', ku);
        for (const t of timers) clearTimeout(t);
        timers.clear();
      },
    };
  },
});
