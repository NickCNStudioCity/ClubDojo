// Tennis (client). Keyboard first. Draws the court from the server's ball and player positions and sends inputs.
// Move: arrows or WASD. Space (or Enter) is the swing: tap to volley, hold and release for a power shot.
// Release as the ball lands: early sends it left, late sends it right; right on the bounce is a Perfect.
// Full Focus + a power shot = Shadow Strike. Each player is their own ninja with a racket in their
// headband colour; the solo bot is a ninja too. Server rules: server/src/minigames/games/tennis.js
ClubDojoMinigames.register({
  id: 'tennis',

  mount(ctx) {
    const { h, el, avatar } = ctx;
    const W = 20, H = 30, S = 18;     // court units and pixels per unit
    const MX = 2.2;                   // stands on each side of the court, in units
    const NET = H / 2;
    const LW = Math.round((W + MX * 2) * S), LH = H * S;   // logical canvas size
    const OX = MX * S;
    const X = (u) => OX + u * S, Y = (v) => v * S;
    const BOT_ID = '__bot';
    const BOT_LOADOUT = { v: 1, id: BOT_ID, name: 'Sensei Bot', color: '#2b2f3a', headband: '#e8453c', belt: 'black', accessories: {} };
    const SWING_KEYS = ['Space', 'Enter'];
    const TEAM = { bottom: { main: '#3b7fc4', light: '#9cc8f2' }, top: { main: '#c0392b', light: '#f2a49c' } };
    const keys = new Set();
    let dirX = 0, dirY = 0;
    let state = null, prev = null;
    let stateAt = 0, prevAt = 0;
    let tune = { reach: 2.6, early: 350, late: 250, perfect: 70, spread: 4.5, tapMs: 200, chargeMs: 1000, superMinC: 0.6, finalMs: 10000, targetR: 1.8 };
    let solo = ctx.players.length === 1;
    let pressAt = null;               // local time (ms) the swing went down; null when not holding
    let raf = 0;
    let lastFrame = performance.now();
    const names = new Map(ctx.players.map((p) => [p.id, p.name]));
    const loadouts = new Map(ctx.players.map((p) => [p.id, p.loadout]));
    loadouts.set(BOT_ID, BOT_LOADOUT);
    names.set(BOT_ID, 'Sensei Bot');

    // ---------- DOM ----------
    const style = h('style', {}, `
      .tn { display: flex; flex-direction: column; align-items: center; gap: 6px; height: 100%; padding: 6px; box-sizing: border-box; }
      .tn-hud { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: center; width: min(100%, 520px); }
      .tn-card { display: flex; align-items: center; gap: 8px; background: rgba(0,0,0,.28); border-radius: 12px; padding: 4px 10px 4px 4px; min-width: 0; border: 2px solid transparent; }
      .tn-card.right { flex-direction: row-reverse; padding: 4px 4px 4px 10px; text-align: right; }
      .tn-card.me { border-color: #ffd23f; }
      .tn-card .nm { font-size: 12px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tn-card .sc { font-family: var(--display); font-size: 26px; line-height: 1; }
      .tn-card .info { min-width: 0; flex: 1; }
      .tn-focus { height: 6px; border-radius: 3px; background: rgba(255,255,255,.15); overflow: hidden; margin-top: 3px; }
      .tn-focus > i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #8a5cff, #d36bff); transition: width .2s; }
      .tn-focus.full > i { background: linear-gradient(90deg, #ffd23f, #d36bff, #8a5cff); animation: tnpulse .6s infinite alternate; }
      @keyframes tnpulse { from { filter: brightness(1); } to { filter: brightness(1.6); } }
      .tn-mid { text-align: center; font-family: var(--display); }
      .tn-mid .time { font-size: 26px; line-height: 1; }
      .tn-mid .time.final { color: #ffd23f; }
      .tn-mid .rally { font-size: 12px; opacity: .85; min-height: 15px; }
      .tn-status { font-family: var(--display); font-size: 20px; min-height: 26px; text-align: center; }
      .tn-hint { font-family: var(--display); font-size: 15px; min-height: 19px; text-align: center; color: var(--gold, #f5c542); }
      .tn-canvas { height: min(58vh, 600px); max-width: 100%; aspect-ratio: ${LW} / ${LH}; border-radius: 14px; box-shadow: 0 6px 0 rgba(0,0,0,.35); touch-action: none; }
      .tn-help { font-size: 12px; opacity: .75; text-align: center; max-width: 620px; }
      .tn-btns { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
      .tn-btns .btn.held { outline: 3px solid #f5c542; }
    `);
    function card(right) {
      const portrait = h('div', {});
      const nm = h('div', { class: 'nm' });
      const sc = h('div', { class: 'sc' }, '0');
      const fill = h('i', {});
      const focus = h('div', { class: 'tn-focus', title: 'Focus: fills as you rally. Full Focus + a power shot = Shadow Strike' }, fill);
      const root = h('div', { class: 'tn-card' + (right ? ' right' : '') }, portrait, h('div', { class: 'info' }, nm, sc, focus));
      return { root, portrait, nm, sc, fill, focus, id: null };
    }
    const cards = [card(false), card(true)];
    const timeEl = h('div', { class: 'time' }, '--');
    const rallyEl = h('div', { class: 'rally' });
    const hud = h('div', { class: 'tn-hud' }, cards[0].root, h('div', { class: 'tn-mid' }, timeEl, rallyEl), cards[1].root);
    const status = h('div', { class: 'tn-status' }, 'Get ready...');
    const hint = h('div', { class: 'tn-hint' });
    const canvas = h('canvas', { class: 'tn-canvas' });
    const DPR = Math.max(2, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = LW * DPR; canvas.height = LH * DPR;
    const g = canvas.getContext('2d');
    const actionBtn = h('button', { class: 'btn small', tabindex: '-1', onpointerdown: (e) => { e.preventDefault(); press(); } }, 'Swing (Space)');
    const help = h('div', { class: 'tn-help' });
    el.append(style, h('div', { class: 'tn' }, hud, status, hint, canvas, h('div', { class: 'tn-btns' }, actionBtn), help));

    // ---------- input ----------
    function send(dx, dy) { ctx.send({ type: 'move', dx, dy }); }
    function press() {
      if (pressAt !== null) return;
      pressAt = performance.now();
      ctx.send({ type: 'press' });
      actionBtn.classList.add('held');
    }
    function release() {
      if (pressAt === null) return;
      pressAt = null;
      ctx.send({ type: 'release' });
      actionBtn.classList.remove('held');
    }

    // Mirrors the server's shot rules so the preview matches what the server will do.
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const chargeFor = (ms) => (ms < tune.tapMs ? 0 : 0.15 + 0.85 * Math.min(1, (ms - tune.tapMs) / tune.chargeMs));
    const shiftFor = (d) => (d < 0 ? -tune.spread * Math.min(1, -d / tune.early) : tune.spread * Math.min(1, d / tune.late));
    const depthFor = (c, fromBottom) => (fromBottom
      ? (NET - 4) - c * ((NET - 4) - 3)
      : (NET + 4) + c * ((H - 3) - (NET + 4)));

    function applyMode() {
      help.textContent = 'Move: arrows or WASD. Tap Space to volley (a soft drop near the net). Hold Space to charge a deeper power shot, then release as the ball bounces: early sends it left, late right, right on the bounce is a Perfect. '
        + 'Fill Focus by rallying, then hit a power shot for a Shadow Strike. Long rallies and the final 10 seconds are worth extra, and lanterns are bonus targets.'
        + (solo ? ' The bot gets stronger every time you beat it.' : '');
    }
    applyMode();

    function refreshDir() {
      const x = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
      const y = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
      if (x !== dirX || y !== dirY) { dirX = x; dirY = y; send(x, y); }
    }
    const onKeyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (SWING_KEYS.includes(e.code)) { if (!e.repeat) press(); return; }
      if (!keys.has(e.code)) { keys.add(e.code); refreshDir(); }
    };
    const onKeyUp = (e) => {
      if (SWING_KEYS.includes(e.code)) { e.preventDefault(); release(); return; }
      if (keys.delete(e.code)) refreshDir();
    };
    const onBlur = () => { keys.clear(); refreshDir(); release(); };
    const onPointerUp = () => release();
    const onCanvasDown = (e) => { e.preventDefault(); press(); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerdown', onCanvasDown);

    // ---------- helpers ----------
    const incoming = () => (state && state.flight && state.flight.from !== ctx.youId ? state.flight : null);
    const rowOf = (s, id) => (s ? s.players.find((p) => p.id === id) : null);
    const etaNow = (f) => f.eta - (performance.now() - stateAt);
    const rand = (a, b) => a + Math.random() * (b - a);
    function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
    function roundRect(x, y, w, hh, r) {
      g.beginPath();
      g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r);
      g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    // Interpolated player position (units) between the last two server states.
    function playerPos(id) {
      const cur = rowOf(state, id);
      if (!cur) return null;
      const old = rowOf(prev, id);
      if (!old) return { x: cur.x, y: cur.y };
      const span = Math.max(30, stateAt - prevAt);
      const k = clamp((performance.now() - stateAt) / span, 0, 1);
      return { x: old.x + (cur.x - old.x) * k, y: old.y + (cur.y - old.y) * k };
    }

    // ---------- effects ----------
    const parts = [];      // { x, y, vx, vy, life, max, color, size, grav, kind }
    const floats = [];     // { x, y, text, color, at, size }
    const marks = [];      // ball marks on the court { x, y, at }
    let banner = null;     // { text, sub, color, at, until }
    let shakeUntil = 0, shakeAmp = 0;
    let cheerAt = -1e9;
    const swings = new Map();   // id -> { at, side }
    let lastFlightKey = null, bouncedKey = null, deadBall = null;
    const trail = [];

    function burst(x, y, color, n, speed, opts) {
      const o = opts || {};
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.up || 0), life: 0, max: o.life || 0.6, color: Array.isArray(color) ? color[i % color.length] : color, size: o.size || 2.5, grav: o.grav || 0, kind: o.kind || 'dot' });
      }
    }
    function floatText(x, y, text, color, size) { floats.push({ x, y, text, color, at: performance.now(), size: size || 14 }); }
    function showBanner(text, sub, color, ms) { const now = performance.now(); banner = { text, sub, color: color || '#fff', at: now, until: now + (ms || 1300) }; }
    function shake(ms, amp) { shakeUntil = performance.now() + ms; shakeAmp = amp; }

    // ---------- static court (drawn once) ----------
    const courtLayer = document.createElement('canvas');
    courtLayer.width = LW * DPR; courtLayer.height = LH * DPR;
    (function paintCourt() {
      const c = courtLayer.getContext('2d');
      c.scale(DPR, DPR);
      // stands
      const stand = c.createLinearGradient(0, 0, OX, 0);
      stand.addColorStop(0, '#3a2a22'); stand.addColorStop(1, '#5a4033');
      c.fillStyle = stand; c.fillRect(0, 0, OX, LH);
      const stand2 = c.createLinearGradient(LW, 0, LW - OX, 0);
      stand2.addColorStop(0, '#3a2a22'); stand2.addColorStop(1, '#5a4033');
      c.fillStyle = stand2; c.fillRect(LW - OX, 0, OX, LH);
      c.fillStyle = 'rgba(0,0,0,.25)';
      for (let y = 0; y < LH; y += 18) { c.fillRect(0, y, OX, 2); c.fillRect(LW - OX, y, OX, 2); }
      // runoff (green) and court (blue hard court)
      c.fillStyle = '#2f8a5b'; c.fillRect(OX, 0, W * S, LH);
      const surf = c.createLinearGradient(0, 0, 0, LH);
      surf.addColorStop(0, '#2a64a8'); surf.addColorStop(0.5, '#3274bd'); surf.addColorStop(1, '#2a64a8');
      c.fillStyle = surf; c.fillRect(X(1.5), Y(1.5), (W - 3) * S, (H - 3) * S);
      // grain
      for (let i = 0; i < 1400; i++) {
        c.fillStyle = hash(i) > 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.05)';
        c.fillRect(OX + hash(i + 7) * W * S, hash(i + 13) * LH, 1.5, 1.5);
      }
      // wear in front of each baseline
      c.fillStyle = 'rgba(255,255,255,.05)';
      c.beginPath(); c.ellipse(X(W / 2), Y(H - 2.2), S * 4, S * 1.3, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(X(W / 2), Y(2.2), S * 4, S * 1.3, 0, 0, Math.PI * 2); c.fill();
      // lines
      c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = 2.2; c.lineJoin = 'miter';
      c.strokeRect(X(1.5), Y(1.5), (W - 3) * S, (H - 3) * S);        // doubles
      c.strokeRect(X(2.5), Y(1.5), (W - 5) * S, (H - 3) * S);        // singles
      c.beginPath(); c.moveTo(X(2.5), Y(6.5)); c.lineTo(X(W - 2.5), Y(6.5)); c.stroke();
      c.beginPath(); c.moveTo(X(2.5), Y(H - 6.5)); c.lineTo(X(W - 2.5), Y(H - 6.5)); c.stroke();
      c.beginPath(); c.moveTo(X(W / 2), Y(6.5)); c.lineTo(X(W / 2), Y(H - 6.5)); c.stroke();
      c.beginPath(); c.moveTo(X(W / 2), Y(1.5)); c.lineTo(X(W / 2), Y(2)); c.stroke();
      c.beginPath(); c.moveTo(X(W / 2), Y(H - 1.5)); c.lineTo(X(W / 2), Y(H - 2)); c.stroke();
      // names on the runoff
      c.fillStyle = 'rgba(255,255,255,.22)'; c.font = `bold ${S * 0.7}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('CLUB DOJO', X(W / 2), Y(0.75));
      c.save(); c.translate(X(W / 2), Y(H - 0.75)); c.fillText('CLUB DOJO', 0, 0); c.restore();
      // net: shadow, mesh, tape, posts
      const ny = Y(NET);
      c.fillStyle = 'rgba(0,0,0,.28)'; c.fillRect(X(0.6), ny + 2, (W - 1.2) * S, 9);
      c.fillStyle = 'rgba(20,24,30,.55)'; c.fillRect(X(0.6), ny - 5, (W - 1.2) * S, 8);
      c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 0.8;
      for (let x = X(0.6); x < X(W - 0.6); x += 4) { c.beginPath(); c.moveTo(x, ny - 5); c.lineTo(x + 4, ny + 3); c.stroke(); c.beginPath(); c.moveTo(x + 4, ny - 5); c.lineTo(x, ny + 3); c.stroke(); }
      c.fillStyle = '#ffffff'; c.fillRect(X(0.6), ny - 6, (W - 1.2) * S, 2.5);
      for (const px of [0.6, W - 0.6]) {
        c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(X(px) + 2, ny + 5, 5, 3, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#1f2a33'; c.beginPath(); c.arc(X(px), ny - 3, 4.5, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#5c6b78'; c.beginPath(); c.arc(X(px) - 1, ny - 4, 2, 0, Math.PI * 2); c.fill();
      }
      // umpire chair in the left stand by the net
      c.fillStyle = '#c9a36b'; c.fillRect(OX * 0.25, ny - 10, OX * 0.5, 20);
      c.fillStyle = '#8a6a3f'; c.fillRect(OX * 0.25, ny - 12, OX * 0.5, 4);
    }());

    // Crowd heads in the stands, drawn live so they can cheer.
    const crowd = [];
    for (let i = 0; i < 2 * Math.floor(LH / 18); i++) {
      const right = i % 2 === 1;
      const row = Math.floor(i / 2);
      if (Math.abs(row * 18 + 9 - LH / 2) < 16 && !right) continue;   // the umpire chair
      const cols = ['#e8453c', '#f5b82e', '#3fbf7f', '#ffffff', '#2f6fd1', '#8a5cff', '#f28cb1', '#20262e'];
      crowd.push({ x: right ? LW - OX * (0.3 + hash(i) * 0.4) : OX * (0.3 + hash(i) * 0.4), y: row * 18 + 9, color: cols[Math.floor(hash(i + 3) * cols.length)], ph: hash(i + 9) * 6 });
    }
    function drawCrowd(now) {
      const cheer = now - cheerAt < 1200;
      for (const p of crowd) {
        const hop = cheer ? Math.abs(Math.sin(now / 90 + p.ph)) * 4 : Math.sin(now / 700 + p.ph) * 0.6;
        g.fillStyle = p.color;
        roundRect(p.x - 5, p.y - 3 - hop, 10, 9, 4); g.fill();
        g.fillStyle = '#f1d3b3'; g.beginPath(); g.arc(p.x, p.y - 6 - hop, 3.4, 0, Math.PI * 2); g.fill();
        if (cheer && p.ph > 3) { g.strokeStyle = '#f1d3b3'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(p.x - 4, p.y - 2 - hop); g.lineTo(p.x - 6, p.y - 10 - hop); g.moveTo(p.x + 4, p.y - 2 - hop); g.lineTo(p.x + 6, p.y - 10 - hop); g.stroke(); }
      }
    }

    // ---------- court overlays ----------
    function cross(x, y, color, size) {
      g.strokeStyle = color; g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(x - size, y - size); g.lineTo(x + size, y + size); g.stroke();
      g.beginPath(); g.moveTo(x + size, y - size); g.lineTo(x - size, y + size); g.stroke();
    }
    function drawTarget(t, now) {
      const x = X(t.x), y = Y(t.y), r = tune.targetR * S;
      const fade = clamp(t.t / 1500, 0, 1);
      g.save();
      g.globalAlpha = 0.4 + 0.6 * fade;
      const glow = g.createRadialGradient(x, y, 2, x, y, r * 1.2);
      glow.addColorStop(0, 'rgba(255,214,90,.45)'); glow.addColorStop(1, 'rgba(255,214,90,0)');
      g.fillStyle = glow; g.beginPath(); g.arc(x, y, r * 1.2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,214,90,.9)'; g.lineWidth = 2; g.setLineDash([6, 5]); g.lineDashOffset = -now / 40;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      // time left
      g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(t.t / 9000, 0, 1)); g.stroke();
      // paper lantern
      const bob = Math.sin(now / 300) * 2;
      g.fillStyle = '#d33a2c'; g.beginPath(); g.ellipse(x, y - 4 + bob, 7, 9, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f5c542'; g.fillRect(x - 5, y - 13 + bob, 10, 2.5); g.fillRect(x - 5, y + 3.5 + bob, 10, 2.5);
      g.fillStyle = 'rgba(255,240,180,.55)'; g.beginPath(); g.ellipse(x - 2, y - 6 + bob, 2, 4, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    // Reach radius around this player while the ball is coming to them. Green when the landing spot is in reach.
    function drawReach(me, f) {
      const r = (f.reach || tune.reach) * S;
      const inReach = Math.hypot(me.x - f.tx, me.y - f.ty) <= (f.reach || tune.reach);
      g.save();
      g.fillStyle = inReach ? 'rgba(124,252,138,.14)' : 'rgba(255,255,255,.07)';
      g.strokeStyle = inReach ? 'rgba(124,252,138,.95)' : 'rgba(255,255,255,.6)';
      g.lineWidth = 2; g.setLineDash([7, 5]);
      g.beginPath(); g.ellipse(X(me.x), Y(me.y), r, r, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.restore();
    }

    // Where the ball is going: a marker and a ring that closes in on the landing; green in the swing window.
    function drawLanding(f, mine) {
      const eta = etaNow(f);
      const inWindow = eta <= tune.early && eta >= -tune.late;
      const x = X(f.tx), y = Y(f.ty);
      if (f.out) { cross(x, y, 'rgba(255,90,90,.95)', 6); return; }
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(x, y, 4, 3, 0, 0, Math.PI * 2); g.stroke();
      if (!mine) return;
      const ring = 6 + clamp(eta, 0, 900) * 0.05;
      const perfect = Math.abs(eta) <= tune.perfect;
      g.strokeStyle = perfect ? 'rgba(255,214,90,1)' : inWindow ? 'rgba(124,252,138,.95)' : 'rgba(255,255,255,.6)';
      g.lineWidth = perfect ? 3.5 : inWindow ? 3 : 1.5;
      g.beginPath(); g.ellipse(x, y, ring, ring * 0.8, 0, 0, Math.PI * 2); g.stroke();
    }

    // The shot you would hit if you released now: a gold line and cross, from you to the landing spot.
    function drawPreview(me, c, f, serving, strike) {
      const shift = serving ? dirX * 3.5 : f ? shiftFor(-etaNow(f)) : 0;
      const tx = serving ? me.x + shift : clamp(me.x + shift, 0, W);
      const ty = depthFor(c, me.y > NET);
      const out = tx < 2.5 || tx > W - 2.5;
      const col = out ? 'rgba(255,110,110,.95)' : strike ? 'rgba(211,107,255,.95)' : 'rgba(245,197,66,.95)';
      g.save();
      g.setLineDash([6, 5]); g.strokeStyle = col; g.lineWidth = 2;
      g.beginPath(); g.moveTo(X(me.x), Y(me.y)); g.quadraticCurveTo(X((me.x + tx) / 2), Y((me.y + ty) / 2) - 30, X(tx), Y(ty)); g.stroke();
      g.restore();
      cross(X(tx), Y(ty), col, 6);
    }

    // ---------- ninjas ----------
    function drawRacket(x, y, ang, color, glow) {
      g.save();
      g.translate(x, y); g.rotate(ang);
      if (glow) { g.shadowColor = glow; g.shadowBlur = 12; }
      g.strokeStyle = '#3b2a1e'; g.lineWidth = 3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -8); g.stroke();
      g.strokeStyle = color; g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(0, -14, 5.5, 7, 0, 0, Math.PI * 2); g.stroke();
      g.shadowBlur = 0;
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 0.7;
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(i * 2, -20); g.lineTo(i * 2, -8); g.stroke(); }
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(-4.5, -14 + i * 2.4); g.lineTo(4.5, -14 + i * 2.4); g.stroke(); }
      g.restore();
    }

    function drawPlayer(row, now) {
      const pos = playerPos(row.id);
      if (!pos) return;
      const mine = row.id === ctx.youId;
      const bot = row.id === BOT_ID;
      const bottom = pos.y > NET;
      const team = bottom ? TEAM.bottom : TEAM.top;
      const loadout = loadouts.get(row.id) || BOT_LOADOUT;
      const x = X(pos.x), feet = Y(pos.y) + 8;
      const facing = row.dx > 0 ? 1 : row.dx < 0 ? -1 : 0;
      const focusFull = row.f >= 100;

      // ground ring
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x, feet, 15, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = team.main; g.globalAlpha = 0.45; g.beginPath(); g.ellipse(x, feet, 14, 5.5, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
      g.strokeStyle = mine ? '#ffd23f' : team.light; g.lineWidth = mine ? 2.5 : 1.5;
      g.beginPath(); g.ellipse(x, feet, 14 + (mine ? Math.sin(now / 180) * 1.2 : 0), 5.5, 0, 0, Math.PI * 2); g.stroke();
      // Shadow Strike aura
      if (focusFull) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 120);
        const aura = g.createRadialGradient(x, feet - 16, 4, x, feet - 16, 30);
        aura.addColorStop(0, `rgba(160,90,255,${0.25 + pulse * 0.2})`); aura.addColorStop(1, 'rgba(120,60,255,0)');
        g.fillStyle = aura; g.beginPath(); g.arc(x, feet - 16, 30, 0, Math.PI * 2); g.fill();
        if (Math.random() < 0.3) parts.push({ x: x + rand(-10, 10), y: feet - rand(0, 30), vx: 0, vy: -20, life: 0, max: 0.6, color: '#b48cff', size: 2, grav: 0, kind: 'dot' });
      }
      // charge arc (yours from your key, others from the server's flag)
      let charge = null;
      if (mine && pressAt !== null) charge = chargeFor(now - pressAt);
      else if (!mine && row.ch) charge = 0.5;
      if (charge !== null && mine) {
        const strike = focusFull && charge >= tune.superMinC;
        g.strokeStyle = charge === 0 ? 'rgba(255,255,255,.9)' : strike ? '#d36bff' : '#ffd23f'; g.lineWidth = 3.5;
        const k = charge === 0 ? clamp((now - pressAt) / tune.tapMs, 0, 1) * 0.15 : charge;
        g.beginPath(); g.ellipse(x, feet, 18, 8, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); g.stroke();
      }

      const geo = avatar.draw(g, loadout, { x, y: feet, size: 32, facing, walking: !!row.m, time: now, shadow: false });
      if (row.m && Math.random() < 0.12) burst(x + rand(-5, 5), feet, 'rgba(255,255,255,.5)', 1, 12, { life: 0.4, size: 2 });

      // racket: rests up, winds back while charging, sweeps through on a hit
      const side = facing < 0 ? -1 : 1;
      const hx = geo.cx + side * geo.bw * 0.55, hy = geo.top + geo.bh * 0.62;
      const sw = swings.get(row.id);
      const swingT = sw ? (now - sw.at) / 240 : 2;
      let ang;
      if (swingT < 1) {
        const e = 1 - Math.pow(1 - swingT, 3);
        ang = side * (1.6 - e * 3.4);
        g.strokeStyle = `rgba(255,255,255,${0.7 * (1 - swingT)})`; g.lineWidth = 3;
        g.beginPath(); g.arc(hx, hy, 18, -Math.PI / 2 + side * 1.6 - side * e * 3.4, -Math.PI / 2 + side * 1.6, side > 0); g.stroke();
      } else if (charge !== null) ang = side * (0.6 + 0.9 * Math.max(charge, 0.1)) + Math.sin(now / 40) * 0.04 * charge;
      else ang = side * 0.35 + Math.sin(now / 400) * 0.05;
      const glow = focusFull && charge !== null && charge >= tune.superMinC ? '#d36bff' : charge && charge > 0.8 ? '#ffd23f' : null;
      drawRacket(hx, hy, ang, loadout.headband || '#e8453c', glow);

      // name tag
      const label = mine ? 'You' : bot ? `Bot Lv ${state.lv || 1}` : (names.get(row.id) || 'Player');
      g.font = 'bold 10px sans-serif';
      const tw = g.measureText(label).width + 10;
      const ty = geo.top - (mine ? 20 : 8);
      g.fillStyle = mine ? '#ffd23f' : bot ? '#7a1f16' : team.main;
      roundRect(x - tw / 2, ty - 12, tw, 13, 6.5); g.fill();
      g.fillStyle = mine ? '#2b1d00' : '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, x, ty - 5.5);
      if (mine) {
        const bob = Math.sin(now / 200) * 2.5;
        g.fillStyle = '#ffd23f';
        g.beginPath(); g.moveTo(x - 5, geo.top - 6 + bob); g.lineTo(x + 5, geo.top - 6 + bob); g.lineTo(x, geo.top + bob); g.closePath(); g.fill();
      }
      if (charge !== null && mine) {
        const strike = focusFull && charge >= tune.superMinC;
        const txt = charge === 0 ? 'VOLLEY' : strike ? 'SHADOW STRIKE' : `POWER ${Math.round(charge * 100)}%`;
        g.font = 'bold 10px sans-serif'; g.fillStyle = strike ? '#e2b6ff' : '#fff';
        g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 3; g.strokeText(txt, x, feet + 16); g.fillText(txt, x, feet + 16);
      }
    }

    // ---------- ball ----------
    const PEAK = { volley: 44, drive: 30, power: 20, strike: 8, serve: 34 };
    function ballGround(f, now) {
      const eta = f.eta - (now - stateAt);
      const k = clamp(1 - eta / f.dur, 0, 1);
      let x = f.ox + (f.tx - f.ox) * k, y = f.oy + (f.ty - f.oy) * k;
      let z = Math.sin(Math.PI * k) * (PEAK[f.kind] || 28);
      if (eta < 0) {
        // after the bounce: a short hop on along the same line
        const post = clamp(-eta / 300, 0, 1);
        const d = Math.hypot(f.tx - f.ox, f.ty - f.oy) || 1;
        x = f.tx + ((f.tx - f.ox) / d) * post * 0.8;
        y = f.ty + ((f.ty - f.oy) / d) * post * 0.8;
        z = Math.sin(Math.PI * post) * (PEAK[f.kind] || 28) * 0.3;
      }
      return { x, y, z, eta };
    }
    function drawBallAt(sx, sy, z, kind, now) {
      g.fillStyle = 'rgba(0,0,0,.28)';
      g.beginPath(); g.ellipse(sx + z * 0.25, sy + 2, 5 - z * 0.03, 2.5, 0, 0, Math.PI * 2); g.fill();
      const by = sy - z, r = 5 + z * 0.04;
      if (kind !== 'serve') trail.push({ x: sx, y: by, kind, at: now });
      if (kind === 'strike') {
        const gl = g.createRadialGradient(sx, by, 1, sx, by, 14);
        gl.addColorStop(0, 'rgba(211,107,255,.8)'); gl.addColorStop(1, 'rgba(90,30,180,0)');
        g.fillStyle = gl; g.beginPath(); g.arc(sx, by, 14, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = kind === 'strike' ? '#f1e4ff' : '#e7f04a';
      g.beginPath(); g.arc(sx, by, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = kind === 'strike' ? '#6a2cff' : '#7a8a1a'; g.lineWidth = 1.3; g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1;
      g.beginPath(); g.arc(sx - r * 0.9, by, r * 0.8, -0.9, 0.9); g.stroke();
    }
    function drawTrail(now) {
      while (trail.length && now - trail[0].at > 160) trail.shift();
      for (const t of trail) {
        const a = 1 - (now - t.at) / 160;
        g.fillStyle = t.kind === 'strike' ? `rgba(150,80,255,${0.5 * a})` : t.kind === 'power' ? `rgba(255,190,80,${0.35 * a})` : `rgba(240,250,140,${0.25 * a})`;
        g.beginPath(); g.arc(t.x, t.y, 4.5 * a + 1, 0, Math.PI * 2); g.fill();
      }
    }

    function drawBall(now) {
      const f = state.flight;
      if (f) {
        const key = `${f.ox},${f.oy},${f.tx},${f.ty},${f.dur}`;
        if (key !== lastFlightKey) { lastFlightKey = key; deadBall = null; }
        const b = ballGround(f, now);
        if (b.eta <= 0 && bouncedKey !== key) {
          bouncedKey = key;
          burst(X(f.tx), Y(f.ty), f.out ? 'rgba(255,120,120,.8)' : 'rgba(255,255,255,.7)', 8, 40, { life: 0.4, size: 2 });
          marks.push({ x: f.tx, y: f.ty, at: now });
        }
        deadBall = { x: b.x, y: b.y, kind: f.kind, at: now, f };
        drawBallAt(X(b.x), Y(b.y), b.z, f.kind, now);
        return;
      }
      // No ball in play: a rally just ended (the ball rolls away) or someone is about to serve.
      if (deadBall && now - deadBall.at < 700) {
        const k = (now - deadBall.at) / 700;
        const f = deadBall.f, d = Math.hypot(f.tx - f.ox, f.ty - f.oy) || 1;
        const x = deadBall.x + ((f.tx - f.ox) / d) * k * 2.5, y = deadBall.y + ((f.ty - f.oy) / d) * k * 2.5;
        g.globalAlpha = 1 - k; drawBallAt(X(x), Y(y), Math.abs(Math.sin(k * Math.PI * 2)) * 6 * (1 - k), 'drive', now); g.globalAlpha = 1;
      }
      // The server's ball sits with whoever serves next: bounce it in their hand.
      const srv = state.serve ? playerPos(state.serve) : state.ball;
      if (srv) drawBallAt(X(srv.x) + 10, Y(srv.y) + 4, Math.abs(Math.sin(now / 320)) * 16 + 4, 'serve', now);
    }

    // ---------- particles, floats, banners ----------
    function drawFx(now, dt) {
      for (let i = marks.length - 1; i >= 0; i--) {
        const m = marks[i], a = 1 - (now - m.at) / 1800;
        if (a <= 0) { marks.splice(i, 1); continue; }
        g.fillStyle = `rgba(255,255,255,${0.35 * a})`; g.beginPath(); g.ellipse(X(m.x), Y(m.y), 5, 3, 0, 0, Math.PI * 2); g.fill();
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life += dt; if (p.life >= p.max) { parts.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.grav * dt;
        const a = 1 - p.life / p.max;
        g.globalAlpha = a; g.fillStyle = p.color;
        if (p.kind === 'confetti') { g.save(); g.translate(p.x, p.y); g.rotate(p.life * 10 + p.vx); g.fillRect(-3, -1.5, 6, 3); g.restore(); }
        else { g.beginPath(); g.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2); g.fill(); }
        g.globalAlpha = 1;
      }
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i], t = (now - f.at) / 1000;
        if (t > 1.1) { floats.splice(i, 1); continue; }
        g.globalAlpha = clamp(1.4 - t * 1.3, 0, 1);
        g.font = `bold ${f.size}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.strokeStyle = 'rgba(0,0,0,.65)'; g.lineWidth = 3.5;
        g.strokeText(f.text, f.x, f.y - t * 26); g.fillStyle = f.color; g.fillText(f.text, f.x, f.y - t * 26);
        g.globalAlpha = 1;
      }
    }
    function drawBanner(now) {
      if (!banner || now > banner.until) return;
      const t = (now - banner.at) / 1000;
      const scale = t < 0.2 ? 0.5 + (t / 0.2) * 0.65 : t < 0.32 ? 1.15 - ((t - 0.2) / 0.12) * 0.15 : 1;
      const a = clamp((banner.until - now) / 250, 0, 1);
      g.save();
      g.globalAlpha = a;
      g.translate(LW / 2, LH * 0.42); g.scale(scale, scale);
      g.fillStyle = 'rgba(10,14,24,.6)'; roundRect(-150, -30, 300, banner.sub ? 62 : 46, 14); g.fill();
      g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 5; g.strokeText(banner.text, 0, -8);
      g.fillStyle = banner.color; g.fillText(banner.text, 0, -8);
      if (banner.sub) { g.font = 'bold 13px sans-serif'; g.fillStyle = '#fff'; g.fillText(banner.sub, 0, 18); }
      g.restore();
    }

    // ---------- frame ----------
    function render() {
      raf = requestAnimationFrame(render);
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      g.clearRect(0, 0, LW, LH);
      if (now < shakeUntil) g.translate(rand(-shakeAmp, shakeAmp), rand(-shakeAmp, shakeAmp));
      g.drawImage(courtLayer, 0, 0, LW, LH);
      drawCrowd(now);
      if (!state) return;
      if (state.tgt) drawTarget(state.tgt, now);
      const me = playerPos(ctx.youId);
      const myRow = rowOf(state, ctx.youId);
      const f = state.flight;
      const inc = incoming();
      if (inc && me) drawReach(me, inc);
      if (f) drawLanding(f, !!inc);
      if (pressAt !== null && me && myRow) {
        const c = chargeFor(now - pressAt);
        const serving = state.serve === ctx.youId;
        if (serving || inc) drawPreview(me, c, inc, serving, myRow.f >= 100 && c >= tune.superMinC);
      }
      drawFx(now, dt);
      // depth sort: the top player is drawn first
      const rows = [...state.players].sort((a, b) => a.y - b.y);
      const ballY = f ? ballGround(f, now).y : state.ball.y;
      let ballDrawn = false;
      for (const r of rows) {
        if (!ballDrawn && ballY < r.y) { drawTrail(now); drawBall(now); ballDrawn = true; }
        drawPlayer(r, now);
      }
      if (!ballDrawn) { drawTrail(now); drawBall(now); }
      if (state.final) {
        g.strokeStyle = `rgba(255,210,63,${0.45 + 0.35 * Math.sin(now / 150)})`; g.lineWidth = 6;
        g.strokeRect(3, 3, LW - 6, LH - 6);
      }
      drawBanner(now);
    }

    // ---------- HUD ----------
    function setupCards() {
      const order = solo ? [ctx.youId, BOT_ID] : ctx.players.map((p) => p.id);
      order.forEach((id, i) => {
        const cd = cards[i];
        cd.id = id;
        cd.portrait.replaceChildren(avatar.portrait(loadouts.get(id) || BOT_LOADOUT, 40));
        cd.nm.textContent = id === ctx.youId ? 'You' : id === BOT_ID ? 'Sensei Bot' : names.get(id);
        cd.root.classList.toggle('me', id === ctx.youId);
      });
    }
    setupCards();
    function updateHud() {
      if (!state) return;
      for (const cd of cards) {
        const r = rowOf(state, cd.id);
        if (!r) continue;
        if (cd.sc.textContent !== String(r.s)) cd.sc.textContent = String(r.s);
        cd.fill.style.width = `${r.f}%`;
        cd.focus.classList.toggle('full', r.f >= 100);
        if (cd.id === BOT_ID) cd.nm.textContent = `Sensei Bot · Lv ${state.lv || 1}`;
      }
      const secs = Math.ceil((state.left || 0) / 1000);
      timeEl.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      timeEl.classList.toggle('final', !!state.final);
      const worth = (1 + Math.floor(Math.max(0, state.rally - 1) / 5)) * (state.final ? 2 : 1);
      rallyEl.textContent = state.rally > 1 ? `Rally ${state.rally} · point worth ${worth}` : state.final ? 'Points worth double!' : '';
    }

    const KIND_NAME = { volley: 'Drop volley', drive: 'Drive', power: 'Power shot', strike: 'SHADOW STRIKE', serve: 'Serve' };
    function describe(data) {
      const dir = data.kind === 'serve' ? '' : data.shift <= -1 ? ', left' : data.shift >= 1 ? ', right' : ', down the middle';
      return (data.perfect ? 'Perfect ' : '') + (KIND_NAME[data.kind] || 'Shot') + dir;
    }
    const WHY = { out: 'out', reach: 'couldn\'t reach it', ace: 'ace!', strike: 'Shadow Strike!' };

    raf = requestAnimationFrame(render);

    return {
      onMessage(data) {
        const now = performance.now();
        if (data.type === 'begin') {
          solo = !!data.solo;
          if (data.tune) tune = { ...tune, ...data.tune };
          applyMode();
          setupCards();
          status.textContent = solo ? 'Rally! Beat Sensei Bot to level it up' : `Rally! ${Math.round(data.roundMs / 1000)} seconds`;
        } else if (data.type === 'state') {
          prev = state; prevAt = stateAt;
          state = data;
          stateAt = now;
          const myRow = rowOf(state, ctx.youId);
          if (data.serve === ctx.youId) hint.textContent = 'Your serve: tap Space, or hold for power. Hold ← or → to angle it';
          else if (incoming()) hint.textContent = myRow && myRow.f >= 100 ? 'Focus full! Hold for power and release on the bounce: Shadow Strike' : 'Get in the circle, release Space as the ball bounces';
          else hint.textContent = myRow && myRow.f >= 100 ? 'Focus full: your next power shot is a Shadow Strike' : '';
          updateHud();
        } else if (data.type === 'hit') {
          const pos = playerPos(data.id);
          const side = pos && data.shift < 0 ? -1 : 1;
          swings.set(data.id, { at: now, side });
          if (pos) {
            const hx = X(pos.x), hy = Y(pos.y) - 10;
            burst(hx, hy, 'rgba(255,255,255,.8)', 5, 50, { life: 0.25, size: 2 });
            if (data.perfect) { burst(hx, hy, ['#ffd23f', '#fff6c2'], 14, 90, { life: 0.5 }); floatText(hx, hy - 30, 'PERFECT!', '#ffd23f', 15); }
            if (data.kind === 'strike') {
              burst(hx, hy, ['#8a5cff', '#d36bff', '#2b1b4a'], 26, 120, { life: 0.7, size: 3 });
              shake(320, 4);
              showBanner('SHADOW STRIKE!', data.id === ctx.youId ? 'Reach shrinks for this ball' : 'Watch out: your reach shrinks', '#d36bff', 1000);
            }
            if (data.rally && data.rally > 0 && data.rally % 5 === 0) floatText(X(W / 2), Y(NET) - 14, `Rally ${data.rally}! Point worth +1`, '#9cf2b0', 13);
          }
          if (data.id === ctx.youId) status.textContent = describe(data);
        } else if (data.type === 'whiff') {
          const me = playerPos(ctx.youId);
          const txt = data.why === 'early' ? 'Too early!' : data.why === 'late' ? 'Too late!' : 'Too far!';
          if (me) floatText(X(me.x), Y(me.y) - 40, txt, '#ff8a80', 13);
        } else if (data.type === 'bonus') {
          const x = X(data.x), y = Y(data.y);
          burst(x, y, ['#ffd23f', '#d33a2c', '#fff6c2'], 24, 110, { life: 0.8, size: 3 });
          floatText(x, y - 20, `${data.id === ctx.youId ? 'Lantern' : 'Lantern'} +${data.value}`, '#ffd23f', 16);
        } else if (data.type === 'final') {
          showBanner('FINAL 10 SECONDS', 'Every point is worth double!', '#ffd23f', 1600);
          cheerAt = now;
        } else if (data.type === 'point') {
          const won = data.winner === ctx.youId;
          const who = won ? 'You' : data.winner === BOT_ID ? 'Bot' : (names.get(data.winner) || 'They');
          const why = WHY[data.why] ? ` (${WHY[data.why]})` : '';
          status.textContent = `${who} win${who === 'You' || who === 'They' ? '' : 's'} the point${why}`;
          const title = won ? (data.why === 'ace' ? 'ACE!' : data.why === 'strike' ? 'UNSTOPPABLE!' : data.why === 'out' ? 'THEIR ERROR' : 'WINNER!') : (data.why === 'out' ? 'OUT!' : data.why === 'ace' ? 'ACED' : 'POINT LOST');
          const sub = `+${data.value} ${won ? 'for you' : `for ${who}`}${data.rally > 1 ? ` · ${data.rally}-shot rally` : ''}`;
          showBanner(title, sub, won ? '#9cf2b0' : '#ff8a80', 1300);
          if (data.x !== null && data.x !== undefined) floatText(X(data.x), Y(data.y) - 10, `+${data.value}`, won ? '#9cf2b0' : '#ff8a80', 18);
          if (won) {
            cheerAt = now;
            for (let i = 0; i < 40; i++) parts.push({ x: rand(OX, LW - OX), y: -5, vx: rand(-30, 30), vy: rand(60, 160), life: 0, max: 1.6, color: ['#ffd23f', '#e8453c', '#3fbf7f', '#2f6fd1', '#ffffff'][i % 5], size: 3, grav: 60, kind: 'confetti' });
          }
          if (solo && won && data.lv > 1) floatText(X(W / 2), Y(4), `Sensei Bot is now Lv ${data.lv}`, '#f2a49c', 13);
        } else if (data.type === 'stats') {
          timeEl.textContent = '0:00';
          const mine = data.players.find((p) => p.id === ctx.youId);
          if (mine) status.textContent = `Best rally ${mine.bestRally} · Perfects ${mine.perfects} · Strikes ${mine.strikes} · Aces ${mine.aces} · Lanterns ${mine.targets}${data.lv ? ` · Bot reached Lv ${data.lv}` : ''}`;
        }
      },
      onResults() {},
      unmount() {
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointerdown', onCanvasDown);
        release();
        keys.clear();
        if (dirX || dirY) { dirX = 0; dirY = 0; send(0, 0); }
      },
    };
  },
});
