// Basketball (client). Your court fills the screen and your rivals play live on three small courts
// above it. Every court is the same scene drawn at a different scale. Server rules, timing windows
// and scoring: server/src/minigames/games/basketball.js
// Keyboard: A/D or the arrow keys move, hold Space or Enter to jump and let go to shoot, E or Shift
// for Shadow Clones. Mouse: hold on the court to shoot. Touch: the on-screen buttons, or hold the court.
ClubDojoMinigames.register({
  id: 'basketball',
  ownEnding: true, // the standings hold on screen after the buzzer
  guide: {
    summary: 'Four courts, one for each ninja, with bots on any empty ones. Score the most before the buzzer.',
    controls: [['A / D or ← →', 'Move along your court'], ['Hold Space or Enter', 'Jump, then let go in the gold to shoot'], ['E or Shift', 'Shadow Clones, when your chi bar is full'], ['Mouse or touch', 'Hold the court to shoot, or use the on-screen buttons']],
    tips: ['Longer shots hold longer and have tighter windows, but score 3 from outside the arc and 4 from deep.', 'Shoot from the hot spot for a bonus. A perfect shot in the paint is a dunk.', 'Clean makes fill your chi. Shadow Clones widen your windows and double your points, and the last 10 seconds count double too.', 'Every 4th make in a row throws a smoke bomb at the top rival.'],
  },

  mount(ctx) {
    const { h, el, avatar } = ctx;
    const W = 960, H = 600;             // logical canvas size
    const SW = 960, SH = 440;           // one court scene
    const COURTS = 4;
    const FEET = 362, FLOOR_TOP = 250, BALL_FLOOR = 392;
    const HX = 832, RIM_Y = 128;        // rim centre in scene coordinates
    const NINJA = 84, JUMP = 62, FALL_MS = 300;
    const courtX = (x) => 40 + x * 880;
    const MAIN = { x: 0, y: 160, s: 1 };
    const MINI_S = 0.325;
    const DISPLAY = (getComputedStyle(document.documentElement).getPropertyValue('--display') || '').trim() || 'Impact, sans-serif';
    const CALM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const BOT_NAMES = ['Ace', 'Blaze', 'Dunk', 'Swish'];
    const BOT_LOOKS = [
      { color: '#2b2f3a', headband: '#e8453c', belt: 'white' },
      { color: '#5a3b8c', headband: '#ffd23f', belt: 'white' },
      { color: '#1f6f5c', headband: '#ff8a3d', belt: 'white' },
      { color: '#8c3b3b', headband: '#7dd3ff', belt: 'white' },
    ];
    const CONFETTI = ['#ffd23f', '#ff8a3d', '#7dffb0', '#ffffff', '#6fb8ff'];
    const FIRE = ['#ffd23f', '#ff8a3d', '#ff5a2a'];
    const BLUE_FIRE = ['#bff0ff', '#6fb8ff', '#ffffff'];
    const VIOLET = ['#d7b8ff', '#a06bff', '#ffffff'];

    // Courts: humans first, then bots. The server builds the same list; begin{} corrects names.
    // Every player keeps their own ninja, loadout and accessories included.
    const lanes = ctx.players.slice(0, COURTS).map((p) => ({ id: p.id, name: p.name, bot: false, loadout: p.loadout }));
    let botNo = 0;
    while (lanes.length < COURTS) {
      const look = BOT_LOOKS[botNo % BOT_LOOKS.length];
      lanes.push({ id: `__bot${botNo}`, name: `Bot ${BOT_NAMES[botNo % BOT_NAMES.length]}`, bot: true, loadout: { v: 1, id: '__bot', name: 'Bot', accessories: {}, ...look } });
      botNo++;
    }
    lanes.forEach((l, i) => Object.assign(l, {
      index: i, row: null, dx: 0.5, shown: 0, pose: null, balls: [], parts: [], floats: [],
      rimAt: -9999, netAt: -9999, rimKick: 0, readyAt: 0, pending: 0, cheerAt: -9999,
    }));
    const laneOf = (id) => lanes.find((l) => l.id === id);
    const me = laneOf(ctx.youId) || lanes[0];
    const rivals = lanes.filter((l) => l !== me);
    rivals.forEach((l, i) => { l.rect = { x: 6 + i * 318, y: 8, s: MINI_S }; });
    me.rect = MAIN;

    let cfg = null;
    let leftMs = null;
    let finalOn = false;
    let over = null;            // { rank, score, stats, newBest } after the horn
    let shake = 0;
    let raf = 0;
    let last = 0;
    let charging = null;        // { t0, win } while your jump is on
    let frozen = null;          // { v, grade, at } the gauge after you let go
    let shotsTaken = 0;
    let note = null;            // { text, color, at } the banner line
    const bombs = [];           // smoke bombs crossing between courts
    const store = (() => {
      try { return JSON.parse(localStorage.getItem('clubdojo.basketball') || '{}') || {}; } catch (_) { return {}; }
    })();
    const saveStore = () => { try { localStorage.setItem('clubdojo.basketball', JSON.stringify(store)); } catch (_) { /* private window */ } };
    const crowd = [];
    {
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const tones = ['#c96a4a', '#5f8fd1', '#e0b64c', '#7dbb74', '#b070c8', '#d9d9e6', '#e8816f'];
      for (let row = 0; row < 3; row++) {
        for (let x = 14 + row * 11; x < SW; x += 25 + rnd() * 7) {
          crowd.push({ x, y: 158 + row * 30, r: 8 + row * 1.2 + rnd() * 1.5, color: tones[Math.floor(rnd() * tones.length)], phase: rnd() * 6.28 });
        }
      }
    }

    // ---- sound --------------------------------------------------------------------------------
    let actx = null;
    function tone(freq, dur, type = 'sine', vol = 0.05, slide = 0, delay = 0) {
      if (store.muted) return;
      if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return; } }
      if (actx.state === 'suspended') actx.resume().catch(() => {});
      const t = actx.currentTime + delay;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    const sfx = {
      swish: () => { tone(1500, 0.16, 'triangle', 0.035, -900); tone(900, 0.2, 'sine', 0.03, -500, 0.04); },
      rim: () => tone(420, 0.12, 'square', 0.03, -120),
      board: () => tone(170, 0.14, 'square', 0.05, -60),
      bounce: () => tone(110, 0.08, 'sine', 0.05, -40),
      perfect: () => { [660, 880, 1320].forEach((f, i) => tone(f, 0.14, 'triangle', 0.04, 0, i * 0.05)); },
      dunk: () => { tone(130, 0.3, 'sawtooth', 0.06, -80); [523, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.05, 0, 0.05 + i * 0.06)); },
      clones: () => { [330, 440, 660, 990].forEach((f, i) => tone(f, 0.2, 'sawtooth', 0.025, 0, i * 0.06)); },
      smoke: () => tone(280, 0.4, 'sawtooth', 0.03, -220),
      horn: () => { tone(196, 0.9, 'sawtooth', 0.06); tone(247, 0.9, 'sawtooth', 0.05); },
    };

    // ---- DOM and controls ---------------------------------------------------------------------
    const keys = new Set();     // held key codes
    const held = new Set();     // held on-screen buttons: 'L', 'R'
    let dir = 0;                // the direction last sent to the server

    const style = h('style', {}, `
      .bb { position: absolute; inset: 0; display: flex; flex-direction: column; background: #150f22; overflow: hidden; user-select: none; -webkit-user-select: none; }
      .bb-wrap { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
      .bb-canvas { display: block; touch-action: none; border-radius: 10px; cursor: pointer; }
      .bb-mute { position: absolute; right: 8px; bottom: 8px; width: 34px; height: 34px; border-radius: 50%; border: 0; background: rgba(0,0,0,.5); color: #fff; font-size: 15px; cursor: pointer; }
      .bb-btns { display: flex; gap: 8px; justify-content: center; padding: 6px; }
      .bb-pad { min-width: 76px; min-height: 52px; touch-action: none; }
      .bb-shoot { min-width: 120px; min-height: 52px; font-size: 18px; touch-action: none; }
      .bb-chi { min-width: 76px; min-height: 52px; touch-action: none; }
      .bb-chi[disabled] { opacity: .45; }
      @media (hover: hover) and (pointer: fine) { .bb-btns { display: none; } }
    `);
    const canvas = h('canvas', { class: 'bb-canvas', width: W, height: H });
    const c = canvas.getContext('2d');
    const holdBtn = (label, key) => h('button', {
      class: 'btn small bb-pad', tabindex: '-1',
      onpointerdown: (e) => { e.preventDefault(); held.add(key); refreshDir(); },
    }, label);
    const btnChi = h('button', { class: 'btn small bb-chi', tabindex: '-1', disabled: true, onpointerdown: (e) => { e.preventDefault(); useChi(); } }, 'Clones');
    const btnShoot = h('button', { class: 'btn small bb-shoot', tabindex: '-1', onpointerdown: (e) => { e.preventDefault(); startCharge(); } }, 'Hold: Shoot');
    const btnMute = h('button', { class: 'bb-mute', tabindex: '-1', 'aria-label': 'Sound on or off', onclick: () => { store.muted = !store.muted; saveStore(); muteLabel(); } });
    const muteLabel = () => { btnMute.textContent = store.muted ? '🔇' : '🔊'; };
    muteLabel();
    const wrap = h('div', { class: 'bb-wrap' }, canvas, btnMute);
    el.append(style, h('div', { class: 'bb' }, wrap, h('div', { class: 'bb-btns' }, holdBtn('◀', 'L'), holdBtn('▶', 'R'), btnChi, btnShoot)));

    // Keep the 8:5 canvas as large as the stage allows, drawn at the screen's real resolution.
    let k = 1;
    let backdrop = null;
    function fit() {
      const ww = wrap.clientWidth, wh = wrap.clientHeight;
      if (!ww || !wh) return;
      const cssW = Math.min(ww, wh * (W / H));
      canvas.style.width = `${Math.round(cssW)}px`;
      canvas.style.height = `${Math.round(cssW * (H / W))}px`;
      const nk = Math.min(2.5, (cssW / W) * Math.min(2, window.devicePixelRatio || 1));
      if (Math.abs(nk - k) < 0.01 && backdrop) return;
      k = nk;
      canvas.width = Math.round(W * k);
      canvas.height = Math.round(H * k);
      backdrop = buildBackdrop(k);
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(wrap);

    function windowsFor(d, focus, smoked) {
      const t = Math.max(0, Math.min(1, d / cfg.maxD));
      const mul = (focus ? cfg.focusMul : 1) * (smoked ? cfg.smokeMul : 1);
      const at = (w) => (w[0] + (w[1] - w[0]) * t) * mul;
      return { sweet: cfg.holdBase + d * cfg.holdPerD, perfect: at(cfg.window.perfect), good: at(cfg.window.good), close: at(cfg.window.close) };
    }
    const myD = () => cfg.hoopX - (me.row ? me.row.x : me.dx);
    const canShoot = () => cfg && !over && !charging && performance.now() >= me.readyAt;

    function startCharge() {
      if (!canShoot()) return;
      const now = performance.now();
      const d = myD();
      const win = windowsFor(d, !!(me.row && me.row.fo), !!(me.row && me.row.sm));
      charging = { t0: now, win };
      frozen = null;
      me.pose = { t0: now, sweet: win.sweet, rel: null, relLift: 0, dunk: false };
      ctx.send({ type: 'charge' });
    }
    function releaseCharge() {
      if (!charging) return;
      const now = performance.now();
      const span = charging.win.sweet + cfg.holdLate;
      frozen = { v: Math.min(1, (now - charging.t0) / span), win: charging.win, grade: null, at: now };
      charging = null;
      ctx.send({ type: 'release' });
      shotsTaken++;
    }
    function useChi() {
      if (cfg && !over && me.row && me.row.c >= cfg.chiFull && !me.row.fo) ctx.send({ type: 'focus' });
    }
    function refreshDir() {
      const right = keys.has('ArrowRight') || keys.has('KeyD') || held.has('R');
      const left = keys.has('ArrowLeft') || keys.has('KeyA') || held.has('L');
      const d = (right ? 1 : 0) - (left ? 1 : 0);
      if (d !== dir) { dir = d; ctx.send({ type: 'move', dir: d }); }
    }

    const onKeyDown = (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'Space' || e.code === 'Enter') { if (!e.repeat) startCharge(); return; }
      if (e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') { if (!e.repeat) useChi(); return; }
      if (!keys.has(e.code)) { keys.add(e.code); refreshDir(); }
    };
    const onKeyUp = (e) => {
      if (e.code === 'Space' || e.code === 'Enter') { releaseCharge(); return; }
      if (keys.delete(e.code)) refreshDir();
    };
    const onCanvasDown = (e) => { e.preventDefault(); startCharge(); };
    const onWindowUp = () => {
      releaseCharge();
      if (held.size) { held.clear(); refreshDir(); }
    };
    const onBlur = () => { releaseCharge(); keys.clear(); held.clear(); refreshDir(); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onCanvasDown);

    // ---- drawing helpers ----------------------------------------------------------------------
    function rr(g, x, y, w, hh, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + hh, r);
      g.arcTo(x + w, y + hh, x, y + hh, r);
      g.arcTo(x, y + hh, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }
    function text(s, x, y, size, color, align = 'center', outline = 4) {
      c.font = `${size}px ${DISPLAY}`;
      c.textAlign = align;
      c.lineJoin = 'round';
      if (outline) { c.lineWidth = outline; c.strokeStyle = 'rgba(20,12,30,.8)'; c.strokeText(s, x, y); }
      c.fillStyle = color;
      c.fillText(s, x, y);
    }

    // Everything that never changes on a court, drawn once and reused at every scale.
    function buildBackdrop(scale) {
      const off = document.createElement('canvas');
      off.width = Math.round(SW * scale);
      off.height = Math.round(SH * scale);
      const g = off.getContext('2d');
      g.scale(scale, scale);

      // The dojo hall: dark timber, glowing paper screens.
      const wall = g.createLinearGradient(0, 0, 0, FLOOR_TOP);
      wall.addColorStop(0, '#1d1533');
      wall.addColorStop(1, '#3a2750');
      g.fillStyle = wall;
      g.fillRect(0, 0, SW, FLOOR_TOP);
      for (let x = 16; x < SW; x += 132) {
        const glow = g.createLinearGradient(0, 18, 0, 140);
        glow.addColorStop(0, 'rgba(255,214,150,.42)');
        glow.addColorStop(1, 'rgba(255,170,110,.14)');
        g.fillStyle = glow;
        g.fillRect(x, 18, 116, 122);
        g.strokeStyle = 'rgba(30,18,40,.8)';
        g.lineWidth = 2;
        g.strokeRect(x, 18, 116, 122);
        g.lineWidth = 1.2;
        for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x + i * 29, 18); g.lineTo(x + i * 29, 140); g.stroke(); }
        for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x, 18 + i * 30.5); g.lineTo(x + 116, 18 + i * 30.5); g.stroke(); }
      }
      g.fillStyle = '#20142c';
      g.fillRect(0, 0, SW, 12);
      g.fillRect(0, 140, SW, 8);
      // Stands.
      for (let i = 0; i < 3; i++) {
        g.fillStyle = ['#2c2040', '#332548', '#3b2a52'][i];
        g.fillRect(0, 150 + i * 30, SW, 30);
        g.fillStyle = 'rgba(255,255,255,.05)';
        g.fillRect(0, 150 + i * 30, SW, 2);
      }
      // Floor: maple boards running to a far vanishing point.
      const wood = g.createLinearGradient(0, FLOOR_TOP, 0, SH);
      wood.addColorStop(0, '#c98d55');
      wood.addColorStop(0.45, '#e2a96c');
      wood.addColorStop(1, '#b97840');
      g.fillStyle = wood;
      g.fillRect(0, FLOOR_TOP, SW, SH - FLOOR_TOP);
      g.save();
      g.beginPath(); g.rect(0, FLOOR_TOP, SW, SH - FLOOR_TOP); g.clip();
      for (let i = -24; i <= 24; i++) {
        const xTop = 480 + i * 44, xBottom = 480 + i * 76;
        g.fillStyle = i % 2 ? 'rgba(90,40,10,.06)' : 'rgba(255,255,255,.035)';
        g.beginPath(); g.moveTo(xTop, FLOOR_TOP); g.lineTo(xTop + 44, FLOOR_TOP); g.lineTo(xBottom + 76, SH); g.lineTo(xBottom, SH); g.closePath(); g.fill();
      }
      g.strokeStyle = 'rgba(80,36,10,.14)';
      g.lineWidth = 1;
      for (let y = FLOOR_TOP + 10, step = 10; y < SH; step *= 1.16, y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(SW, y); g.stroke(); }
      // Overhead light pooling on the boards.
      const pool = g.createRadialGradient(470, FEET, 30, 470, FEET, 520);
      pool.addColorStop(0, 'rgba(255,240,205,.34)');
      pool.addColorStop(1, 'rgba(255,240,205,0)');
      g.fillStyle = pool;
      g.fillRect(0, FLOOR_TOP, SW, SH - FLOOR_TOP);

      // The paint, the arc, the deep line and a centre mark. Their distances match the server's zones.
      const px = courtX(0.7);
      g.fillStyle = 'rgba(190,60,40,.34)';
      g.beginPath(); g.moveTo(px + 24, 306); g.lineTo(SW - 24, 306); g.lineTo(SW + 8, 424); g.lineTo(px - 24, 424); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.9)';
      g.lineWidth = 3;
      g.stroke();
      g.beginPath(); g.ellipse(HX, FEET, HX - courtX(0.4), 74, 0, Math.PI * 0.5, Math.PI * 1.5); g.stroke();
      g.save();
      g.strokeStyle = 'rgba(255,210,63,.9)';
      g.setLineDash([14, 10]);
      g.beginPath(); g.ellipse(HX, FEET, HX - courtX(0.18), 112, 0, Math.PI * 0.5, Math.PI * 1.5); g.stroke();
      g.restore();
      g.strokeStyle = 'rgba(255,255,255,.28)';
      g.lineWidth = 10;
      g.beginPath(); g.ellipse(250, FEET, 74, 20, 0.05, 0.3, 5.9); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,.75)';
      g.lineWidth = 3;
      g.strokeRect(-10, 268, SW + 20, 156);
      g.restore();

      // The hoop's frame. The rim and net are live.
      g.fillStyle = 'rgba(30,10,0,.22)';
      g.beginPath(); g.ellipse(884, 396, 76, 14, 0, 0, 6.3); g.fill();
      g.fillStyle = '#2a2d3a';
      g.fillRect(904, 92, 13, 300);
      g.fillStyle = '#c23f30';
      rr(g, 896, 306, 29, 88, 6); g.fill();
      g.strokeStyle = '#2a2d3a';
      g.lineWidth = 8;
      g.beginPath(); g.moveTo(910, 100); g.lineTo(876, 92); g.stroke();
      g.fillStyle = 'rgba(232,242,255,.92)';
      g.beginPath(); g.moveTo(866, 44); g.lineTo(880, 36); g.lineTo(880, 138); g.lineTo(866, 150); g.closePath(); g.fill();
      g.strokeStyle = '#2a2d3a';
      g.lineWidth = 2.5;
      g.stroke();
      g.strokeStyle = '#e8453c';
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(869, 92); g.lineTo(877, 87); g.lineTo(877, 124); g.lineTo(869, 130); g.closePath(); g.stroke();

      // Paper lanterns.
      g.strokeStyle = 'rgba(0,0,0,.55)';
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, 18);
      for (let x = 0; x <= SW; x += 120) g.quadraticCurveTo(x + 60, 44, x + 120, 18);
      g.stroke();
      for (let x = 60; x < SW; x += 120) {
        const halo = g.createRadialGradient(x, 42, 2, x, 42, 44);
        halo.addColorStop(0, 'rgba(255,190,110,.55)');
        halo.addColorStop(1, 'rgba(255,190,110,0)');
        g.fillStyle = halo;
        g.fillRect(x - 44, 0, 88, 90);
        g.fillStyle = x % 240 === 60 ? '#d8452f' : '#e88a2f';
        g.beginPath(); g.ellipse(x, 42, 13, 16, 0, 0, 6.3); g.fill();
        g.fillStyle = '#2a1a10';
        g.fillRect(x - 5, 24, 10, 3);
        g.fillRect(x - 5, 57, 10, 3);
      }
      return off;
    }

    function drawCrowd(lane, now, time, big) {
      const cheer = Math.max(0, 1 - (now - lane.cheerAt) / 1200);
      const excited = finalOn ? 0.45 : 0;
      for (const p of crowd) {
        const hop = big ? Math.abs(Math.sin(time * 7 + p.phase)) * 9 * Math.max(cheer, excited) + Math.sin(time * 1.6 + p.phase) * 0.8 : 0;
        c.fillStyle = p.color;
        c.beginPath(); c.ellipse(p.x, p.y + p.r * 1.8 - hop, p.r * 1.1, p.r * 1.4, 0, 0, 6.3); c.fill();
        c.fillStyle = '#e8c6a4';
        c.beginPath(); c.arc(p.x, p.y - hop, p.r * 0.72, 0, 6.3); c.fill();
      }
    }

    function drawHotSpot(lane, time, now) {
      const row = lane.row;
      if (!row || !cfg) return;
      const x = courtX(row.h);
      const on = Math.abs(lane.dx - row.h) <= cfg.hotR;
      const rx = cfg.hotR * 880;
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      const beam = c.createLinearGradient(0, FEET - 150, 0, FEET);
      beam.addColorStop(0, 'rgba(255,190,70,0)');
      beam.addColorStop(1, `rgba(255,190,70,${on ? 0.5 : 0.28})`);
      c.fillStyle = beam;
      c.fillRect(x - rx, FEET - 150, rx * 2, 150);
      c.fillStyle = `rgba(255,190,70,${0.25 + pulse * 0.2})`;
      c.beginPath(); c.ellipse(x, FEET, rx, 16, 0, 0, 6.3); c.fill();
      c.strokeStyle = on ? '#fff3b0' : '#ffb84a';
      c.lineWidth = 4;
      c.beginPath(); c.ellipse(x, FEET, rx * (0.92 + pulse * 0.08), 16, 0, 0, 6.3); c.stroke();
      if (lane === me) text('+2', x, FEET - 22, 24, '#ffe9a0');
    }

    function drawRim(lane, now, front) {
      const flash = Math.max(0, 1 - (now - lane.rimAt) / 420);
      const kick = lane.rimKick * 7;
      c.save();
      if (flash > 0) { c.shadowColor = '#ffd23f'; c.shadowBlur = 20 * flash; }
      c.strokeStyle = flash > 0 ? '#ffe27a' : '#ff6a2a';
      c.lineWidth = 6;
      c.beginPath();
      c.ellipse(HX, RIM_Y + kick, 31, 9, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
      c.stroke();
      c.restore();
      if (front) {
        c.strokeStyle = '#ff6a2a';
        c.lineWidth = 5;
        c.beginPath(); c.moveTo(HX + 30, RIM_Y + kick * 0.6); c.lineTo(868, RIM_Y - 4); c.stroke();
      }
    }

    function drawNet(lane, now, time) {
      // The strings stretch and snap back when a ball goes through.
      const age = now - lane.netAt;
      const pull = age < 420 ? Math.sin((age / 420) * Math.PI) : 0;
      const sway = Math.sin(time * 3.2) * 1.2 + pull * Math.sin(age / 26) * 3;
      const len = 44 + pull * 20;
      const top = RIM_Y + lane.rimKick * 7 + 3;
      c.strokeStyle = 'rgba(255,255,255,.92)';
      c.lineWidth = 1.5;
      for (let i = -3; i <= 3; i++) {
        c.beginPath();
        c.moveTo(HX + i * 9.6, top);
        c.quadraticCurveTo(HX + i * 7.4 + sway, top + len * 0.55, HX + i * (4.8 + pull * 1.6) + sway * 1.3, top + len);
        c.stroke();
      }
      for (const u of [0.33, 0.66, 1]) {
        const halfW = 29 - 14 * u + pull * 2;
        c.beginPath();
        c.moveTo(HX - halfW + sway * u, top + len * u);
        c.quadraticCurveTo(HX + sway * u, top + len * u + 6, HX + halfW + sway * u, top + len * u);
        c.stroke();
      }
    }

    function drawBall(x, y, rot, size, alpha) {
      c.save();
      c.translate(x, y);
      c.globalAlpha = alpha;
      const g = c.createRadialGradient(-size * 0.35, -size * 0.4, size * 0.1, 0, 0, size);
      g.addColorStop(0, '#ffb26b');
      g.addColorStop(1, '#d9601f');
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, size, 0, 6.3); c.fill();
      c.rotate(rot);
      c.strokeStyle = '#3a1a06';
      c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(-size, 0); c.lineTo(size, 0); c.moveTo(0, -size); c.lineTo(0, size); c.stroke();
      c.beginPath(); c.arc(-size * 1.05, 0, size * 0.85, -0.85, 0.85); c.stroke();
      c.beginPath(); c.arc(size * 1.05, 0, size * 0.85, Math.PI - 0.85, Math.PI + 0.85); c.stroke();
      c.restore();
    }

    function burst(lane, x, y, n, palette, speed = 240) {
      const count = lane === me ? n : Math.ceil(n / 3);
      for (let i = 0; i < count; i++) {
        const a = Math.random() * 6.28, sp = 60 + Math.random() * speed;
        lane.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 110, life: 0.6 + Math.random() * 0.6, max: 1.2, color: palette[i % palette.length], r: 3 + Math.random() * 4 });
      }
    }
    function float(lane, s, x, y, color, size = 34) {
      lane.floats.push({ s, x, y, color, size, at: performance.now() });
    }

    // ---- the shot: each ball follows a list of arcs, and events fire as each arc begins -------
    function pathFor(kind, x0, y0, lift) {
      const dist = HX - x0;
      const peak = 140 + dist * 0.2;
      const flight = 500 + dist * 0.36;
      const air = (x, y, ms = flight, h = peak, ev) => ({ x, y, ms, h, ev });
      const roll = [
        { x: HX - 66, y: BALL_FLOOR, ms: 370, h: 48, ev: 'bounce' },
        { x: HX - 102, y: BALL_FLOOR, ms: 240, h: 18 },
      ];
      const through = [
        { x: HX, y: RIM_Y + 76, ms: 130, h: 0, ev: 'score', drop: true },
        { x: HX - 12, y: BALL_FLOOR, ms: 230, h: 0, drop: true },
      ];
      if (kind === 'swish') return [air(HX, RIM_Y - 2), ...through, ...roll];
      if (kind === 'dunk') return [{ ...air(HX, RIM_Y - 14, 260, 40), hidden: true }, ...through, ...roll];
      if (kind === 'in') return [air(HX - 24, RIM_Y - 4), { x: HX + 2, y: RIM_Y - 4, ms: 220, h: 24, ev: 'rim' }, ...through, ...roll];
      if (kind === 'rattle') {
        return [air(HX + 24, RIM_Y - 4), { x: HX - 26, y: RIM_Y - 4, ms: 240, h: 28, ev: 'rim' },
          { x: HX - 140, y: BALL_FLOOR, ms: 460, h: 44, ev: 'rimOut' }, { x: HX - 200, y: BALL_FLOOR, ms: 260, h: 22, ev: 'bounce' }];
      }
      if (kind === 'brick') {
        return [air(HX + 34, RIM_Y - 40), { x: HX - 170, y: BALL_FLOOR, ms: 560, h: 24, ev: 'board' }, { x: HX - 240, y: BALL_FLOOR, ms: 280, h: 26, ev: 'bounce' }];
      }
      const short = Math.max(x0 + 70, HX - 150);   // an airball drops well short
      return [air(short, BALL_FLOOR, 520 + dist * 0.2, 90 + lift * 0.4, undefined), { x: short + 60, y: BALL_FLOOR, ms: 300, h: 26, ev: 'floorAir' }];
    }

    function ballEvent(lane, ball, ev, now) {
      const a = ball.shot;
      if (ev === 'score') {
        lane.netAt = now;
        lane.rimAt = now;
        lane.cheerAt = now;
        lane.shown = a.score;
        lane.pending = Math.max(0, lane.pending - 1);
        const fire = a.streak >= 6 ? BLUE_FIRE : a.streak >= 3 ? FIRE : CONFETTI;
        burst(lane, HX, RIM_Y + 10, a.perfect ? 44 : 22, fire, a.perfect ? 320 : 220);
        float(lane, `+${a.points}`, HX - 70, RIM_Y + 34, a.perfect ? '#ffd23f' : '#7dffb0', 52);
        const tag = a.buzzer ? 'BUZZER BEATER!' : a.dunk ? 'DUNK!' : a.perfect ? 'SWISH!' : '';
        if (tag) float(lane, tag, HX - 150, RIM_Y - 6, '#ffffff', 38);
        if (a.hot) float(lane, 'HOT SPOT', HX - 190, RIM_Y + 66, '#ffc65a', 26);
        if (lane === me) {
          shake = Math.max(shake, a.dunk ? 1.3 : a.perfect ? 0.8 : 0.45);
          if (a.dunk) sfx.dunk(); else if (a.perfect) sfx.perfect(); else sfx.swish();
        }
      } else if (ev === 'rim' || ev === 'rimOut' || ev === 'board') {
        lane.rimKick = Math.max(lane.rimKick, 0.4);
        if (lane === me) (ev === 'board' ? sfx.board : sfx.rim)();
        if (ev !== 'rim') { missFinish(lane, a, ev === 'board' ? 'BRICK' : 'RATTLED OUT', now); }
      } else if (ev === 'floorAir') {
        missFinish(lane, a, 'AIRBALL', now);
        if (lane === me) sfx.bounce();
      } else if (ev === 'bounce' && lane === me) {
        sfx.bounce();
      }
    }
    function missFinish(lane, a, label, now) {
      lane.pending = Math.max(0, lane.pending - 1);
      lane.shown = a.score;
      float(lane, label, HX - 110, RIM_Y + 40, '#ff9a9a', 30);
    }

    function stepBall(lane, b, now, dt) {
      let elapsed = now - b.t0;
      for (const seg of b.path) {
        if (elapsed < seg.ms) {
          const from = seg.from;
          if (!seg.fired) { seg.fired = true; if (seg.ev && !b.ghost) ballEvent(lane, b, seg.ev, now); }
          const t = elapsed / seg.ms;
          const u = seg.drop ? t * t : t;
          b.x = from.x + (seg.x - from.x) * u;
          b.y = from.y + (seg.y - from.y) * u - seg.h * 4 * t * (1 - t);
          b.hidden = !!seg.hidden;
          b.rot += dt * 11;
          return true;
        }
        elapsed -= seg.ms;
        if (!seg.fired) { seg.fired = true; if (seg.ev && !b.ghost) ballEvent(lane, b, seg.ev, now); }
      }
      return false;
    }
    function launch(lane, shot, x0, y0, lift, ghost) {
      const path = pathFor(shot.kind, x0, y0, lift);
      let from = { x: x0, y: y0 };
      for (const seg of path) { seg.from = from; from = { x: seg.x, y: seg.y }; }
      lane.balls.push({ path, t0: performance.now(), x: x0, y: y0, rot: 0, shot, ghost, hidden: false });
    }

    // The ninja's height off the floor, and the sideways reach of a dunk.
    function poseOf(lane, now) {
      const p = lane.pose;
      if (!p) return { lift: 0, reach: 0, air: false };
      if (p.rel === null) return { lift: JUMP * Math.sin(Math.min(1, (now - p.t0) / p.sweet) * Math.PI / 2), reach: 0, air: true };
      const age = now - p.rel;
      if (p.dunk) {
        const home = courtX(lane.dx);
        const top = FEET - (RIM_Y + 96);
        const reachTo = HX - 26 - home;
        if (age < 260) { const u = age / 260; return { lift: p.relLift + (top - p.relLift) * Math.sin(u * Math.PI / 2), reach: reachTo * u, air: true }; }
        if (age < 500) { lane.rimKick = Math.max(lane.rimKick, 1); return { lift: top, reach: reachTo, air: true, hang: true }; }
        if (age < 840) { const u = (age - 500) / 340; return { lift: top * (1 - u * u), reach: reachTo * (1 - u), air: true }; }
        lane.pose = null;
        return { lift: 0, reach: 0, air: false };
      }
      const u = age / FALL_MS;
      if (u >= 1) { lane.pose = null; return { lift: 0, reach: 0, air: false }; }
      return { lift: p.relLift * (1 - u * u), reach: 0, air: true };
    }

    function drawNinja(lane, now, time, x, lift, walking, alpha, charging2) {
      c.save();
      c.globalAlpha = alpha;
      const feet = FEET - lift;
      if (alpha === 1 && lift > 0) {
        c.fillStyle = `rgba(30,10,0,${0.24 * (1 - Math.min(0.7, lift / 240))})`;
        c.beginPath(); c.ellipse(x, FEET, NINJA * 0.46, NINJA * 0.13, 0, 0, 6.3); c.fill();
      }
      const geo = avatar.draw(c, lane.loadout, { x, y: feet, size: NINJA, facing: 1, walking, time: now, shadow: lift === 0 && alpha === 1 });
      // Arms, in the ninja's own gi colour, and the ball they hold.
      const armY = geo.top + geo.bh * 0.5;
      const hasBall = charging2 || (lane.pose === null && now >= lane.readyAt);
      c.strokeStyle = lane.loadout.color || '#20262e';
      c.lineCap = 'round';
      c.lineWidth = NINJA * 0.16;
      if (charging2) {
        const by = geo.top - NINJA * 0.2;
        c.beginPath(); c.moveTo(x - geo.bw * 0.36, armY); c.lineTo(x + 4, by + 13); c.moveTo(x + geo.bw * 0.36, armY); c.lineTo(x + 14, by + 13); c.stroke();
        drawBall(x + 9, by, 0.4, 15, alpha);
      } else if (hasBall && alpha === 1) {
        const bounce = walking ? Math.abs(Math.sin(now / 130)) : Math.abs(Math.sin(now / 210));
        const by = FEET - 12 - bounce * 52;
        const bx = x + geo.bw * 0.72;
        c.beginPath(); c.moveTo(x + geo.bw * 0.38, armY); c.lineTo(bx - 2, Math.min(by - 8, armY + 24)); c.stroke();
        drawBall(bx, by, now / 200, 15, 1);
      }
      c.lineCap = 'butt';
      c.restore();
      return geo;
    }

    function drawGauge(x0) {
      const live = charging || (frozen && performance.now() - frozen.at < 560 ? frozen : null);
      if (!cfg || over) return;
      const smoked = !!(me.row && me.row.sm), focus = !!(me.row && me.row.fo);
      const win = live ? live.win : windowsFor(myD(), focus, smoked);
      const x = Math.max(32, courtX(me.dx) - 92);
      const top = FEET - 232, bot = FEET - 22, len = bot - top, w = 20;
      const span = win.sweet + cfg.holdLate;
      const yOf = (ms) => bot - (ms / span) * len;
      c.save();
      c.globalAlpha = live ? 1 : 0.55;
      c.fillStyle = 'rgba(18,10,28,.8)';
      rr(c, x - w / 2 - 4, top - 4, w + 8, len + 8, 10); c.fill();
      const band = (half, color) => { c.fillStyle = color; c.fillRect(x - w / 2, yOf(win.sweet + half), w, ((half * 2) / span) * len); };
      band(win.close, smoked ? '#7f8496' : '#d2a23a');
      band(win.good, '#3fc982');
      band(win.perfect, '#ffe066');
      if (live) {
        const v = charging ? Math.min(1, (performance.now() - charging.t0) / span) : frozen.v;
        const y = bot - v * len;
        c.fillStyle = 'rgba(255,255,255,.26)';
        c.fillRect(x - w / 2, y, w, bot - y);
        c.fillStyle = '#fff';
        c.fillRect(x - w / 2 - 4, y - 2.5, w + 8, 5);
        c.beginPath(); c.moveTo(x + w / 2 + 6, y); c.lineTo(x + w / 2 + 18, y - 8); c.lineTo(x + w / 2 + 18, y + 8); c.closePath(); c.fill();
      }
      c.restore();
      if (frozen && frozen.grade && performance.now() - frozen.at < 700) {
        const map = { perfect: ['PERFECT', '#ffe066'], good: ['GOOD', '#7dffb0'], close: ['CLOSE', '#ffc65a'], off: [frozen.early ? 'EARLY' : 'LATE', '#ff9a9a'] };
        const [t, col] = map[frozen.grade];
        text(t, x, top - 12, 26, col);
      }
    }

    function drawSmoke(lane, time) {
      if (!lane.row || !lane.row.sm) return;
      c.fillStyle = 'rgba(205,205,225,.13)';
      for (let i = 0; i < 18; i++) {
        const x = (i * 97 + time * (18 + i)) % (SW + 160) - 80;
        const y = 150 + ((i * 53) % 230) + Math.sin(time + i) * 14;
        c.beginPath(); c.arc(x, y, 60 + (i % 4) * 16, 0, 6.3); c.fill();
      }
    }

    // One court, in scene coordinates.
    function drawScene(lane, now, time, dt) {
      const big = lane === me;
      const row = lane.row;
      const smooth = 1 - Math.exp(-dt * (big && dir ? 7 : 15));
      if (row) {
        if (big && cfg && !charging && !lane.pose && dir) lane.dx = Math.max(cfg.minX, Math.min(cfg.maxX, lane.dx + dir * cfg.move * dt));
        lane.dx += (row.x - lane.dx) * smooth;
      }
      c.drawImage(backdrop, 0, 0, SW, SH);
      drawCrowd(lane, now, time, big);
      drawHotSpot(lane, time, now);

      const x = courtX(lane.dx);
      const p = poseOf(lane, now);
      const isCharging = big ? !!charging : !!(lane.pose && lane.pose.rel === null);
      const walking = !!(row && row.m) && !p.air;
      const focus = !!(row && row.fo);

      if (focus) {
        const auraX = x + p.reach, auraY = FEET - p.lift - 54;
        const g = c.createRadialGradient(auraX, auraY, 10, auraX, auraY, 130);
        g.addColorStop(0, 'rgba(160,107,255,.42)');
        g.addColorStop(1, 'rgba(160,107,255,0)');
        c.fillStyle = g;
        c.fillRect(auraX - 130, auraY - 130, 260, 260);
        // Shadow clones of this ninja, keeping every accessory they wear.
        const lag = Math.sin(time * 5) * 3;
        drawNinja(lane, now, time, x - 66 + lag, p.lift * 0.86, walking, 0.42, isCharging);
        drawNinja(lane, now, time, x + 66 - lag, p.lift * 0.86, walking, 0.42, isCharging);
      }

      drawRim(lane, now, false);
      drawNinja(lane, now, time, x + p.reach, p.lift, walking, 1, isCharging || !!p.hang);

      // Flames around a ninja on a streak.
      if (row && row.st >= 3 && Math.random() < dt * (big ? 40 : 14)) {
        const palette = row.st >= 6 ? BLUE_FIRE : FIRE;
        lane.parts.push({ x: x + p.reach + (Math.random() - 0.5) * 50, y: FEET - p.lift - Math.random() * 90, vx: (Math.random() - 0.5) * 30, vy: -110 - Math.random() * 80, life: 0.5, max: 0.5, color: palette[Math.floor(Math.random() * 3)], r: 4 + Math.random() * 5 });
      }

      for (let i = lane.balls.length - 1; i >= 0; i--) {
        const b = lane.balls[i];
        if (!stepBall(lane, b, now, dt)) { lane.balls.splice(i, 1); continue; }
        if (b.hidden) continue;
        if (b.shot.made && row && row.st >= 3 && !b.ghost && Math.random() < dt * 60) {
          lane.parts.push({ x: b.x, y: b.y, vx: 0, vy: -30, life: 0.35, max: 0.35, color: FIRE[Math.floor(Math.random() * 3)], r: 7 });
        }
        drawBall(b.x, b.y, b.rot, 15, b.ghost ? 0.5 : 1);
      }
      drawNet(lane, now, time);
      drawRim(lane, now, true);
      lane.rimKick = Math.max(0, lane.rimKick - dt * 4);

      for (let i = lane.parts.length - 1; i >= 0; i--) {
        const q = lane.parts[i];
        q.life -= dt;
        if (q.life <= 0) { lane.parts.splice(i, 1); continue; }
        q.vy += 620 * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        c.globalAlpha = Math.max(0, Math.min(1, q.life / q.max));
        c.fillStyle = q.color;
        c.fillRect(q.x, q.y, q.r, q.r);
      }
      c.globalAlpha = 1;

      drawSmoke(lane, time);
      if (big) drawGauge();

      for (let i = lane.floats.length - 1; i >= 0; i--) {
        const f = lane.floats[i];
        const age = (now - f.at) / 1000;
        if (age > 1.15) { lane.floats.splice(i, 1); continue; }
        c.globalAlpha = age > 0.8 ? (1.15 - age) / 0.35 : 1;
        const pop = Math.min(1, age * 7);
        text(f.s, f.x, f.y - age * 34, f.size * (0.7 + 0.3 * pop), f.color, 'center', 5);
        c.globalAlpha = 1;
      }
    }

    function rankOf(lane) {
      return 1 + lanes.filter((l) => l !== lane && l.shown > lane.shown).length;
    }
    const ORDINAL = ['', '1st', '2nd', '3rd', '4th'];

    function drawMiniLabels(lane) {
      const r = lane.rect, w = SW * r.s, hh = SH * r.s;
      c.fillStyle = 'rgba(16,10,26,.74)';
      rr(c, r.x + 5, r.y + 5, w - 10, 24, 7); c.fill();
      text(lane.name.slice(0, 14), r.x + 12, r.y + 23, 16, '#fff', 'left', 0);
      if (lane.bot) text('BOT', r.x + 12 + c.measureText(lane.name.slice(0, 14)).width + 8, r.y + 22, 11, '#8fd3ff', 'left', 0);
      text(`${lane.shown}`, r.x + w - 12, r.y + 24, 21, '#ffd23f', 'right', 0);
      const st = lane.row ? lane.row.st : 0;
      if (st >= 3) text(`🔥${st}`, r.x + w - 54 - (lane.shown > 99 ? 12 : 0), r.y + 23, 13, '#ffb26b', 'right', 0);
      if (lane.row && lane.row.sm) text('SMOKED', r.x + 12, r.y + hh - 8, 15, '#d8d8ea');
      if (lane.row && lane.row.fo) text('CLONES', r.x + w - 12, r.y + hh - 8, 15, '#d7b8ff', 'right');
      c.strokeStyle = rankOf(lane) === 1 && lane.shown > 0 ? '#ffd23f' : 'rgba(255,255,255,.14)';
      c.lineWidth = 2;
      rr(c, r.x, r.y, w, hh, 10); c.stroke();
    }

    function drawHud(now, time) {
      // Scoreboard over your court.
      const x = 340, y = MAIN.y + 6, w = 280, hh = 72;
      c.fillStyle = '#17101f';
      rr(c, x, y, w, hh, 10); c.fill();
      c.strokeStyle = finalOn && Math.sin(time * 10) > 0 ? '#ff5a4a' : '#6a5a30';
      c.lineWidth = 3;
      rr(c, x, y, w, hh, 10); c.stroke();
      const secs = leftMs === null ? '--' : String(Math.ceil(leftMs / 1000)).padStart(2, '0');
      text(secs, x + w / 2, y + 55, 52, finalOn ? '#ff7a6a' : '#ffe9a0', 'center', 0);
      text('YOU', x + 46, y + 22, 15, '#c7bddf', 'center', 0);
      text(`${me.shown}`, x + 46, y + 58, 36, '#ffd23f', 'center', 0);
      text('PLACE', x + w - 46, y + 22, 15, '#c7bddf', 'center', 0);
      text(ORDINAL[rankOf(me)], x + w - 46, y + 58, 32, rankOf(me) === 1 ? '#7dffb0' : '#fff', 'center', 0);
      if (finalOn) text('ALL POINTS x2', x + w / 2, y + hh + 22, 24, '#ff9a8a');
      if (store.best) text(`BEST ${store.best}`, x + w + 12, y + 24, 18, '#c7bddf', 'left', 3);

      // Chi.
      const chi = me.row ? me.row.c : 0, focus = !!(me.row && me.row.fo);
      const bx = 18, by = H - 34, bw = 250, bh = 16;
      text('CHI', bx, by - 7, 19, '#d7b8ff', 'left', 3);
      c.fillStyle = 'rgba(16,10,26,.85)';
      rr(c, bx, by, bw, bh, 8); c.fill();
      const full = cfg && chi >= cfg.chiFull;
      c.fillStyle = full || focus ? (Math.sin(time * 9) > 0 ? '#c6a0ff' : '#a06bff') : '#7b53c9';
      if (chi > 0 || focus) { rr(c, bx + 2, by + 2, Math.max(12, (bw - 4) * (focus ? 1 : chi / 100)), bh - 4, 6); c.fill(); }
      if (full && !focus) text('PRESS E: SHADOW CLONES', bx + 52, by - 7, 19, '#fff', 'left', 3);
      if (focus) text('SHADOW CLONES: DOUBLE POINTS', bx + 52, by - 7, 19, '#ffd9ff', 'left', 3);

      // Streak and where you are shooting from.
      const st = me.row ? me.row.st : 0;
      if (st >= 2) text(st >= 6 ? `INFERNO x${st}` : st >= 3 ? `ON FIRE x${st}` : `STREAK x${st}`, H * 1.6 - 18, H - 44, 30, st >= 6 ? '#8fd8ff' : st >= 3 ? '#ff9a4a' : '#ffd23f', 'right');
      if (cfg) {
        const d = myD();
        const tag = d > cfg.deepD ? ['DEEP · 4', '#ffd23f'] : d > cfg.threeD ? ['3 POINTS', '#ffffff'] : d <= cfg.paintD ? ['PAINT · DUNK ZONE', '#ff9a8a'] : ['2 POINTS', '#ffffff'];
        text(tag[0], Math.max(90, Math.min(W - 90, courtX(me.dx))), MAIN.y + FEET + 32, 21, tag[1]);
      }

      // A first-shot hint, then the banner line.
      if (cfg && !over && shotsTaken === 0) {
        const pulse = 0.75 + 0.25 * Math.sin(time * 5);
        c.globalAlpha = pulse;
        text(window.matchMedia && matchMedia('(hover: none)').matches ? 'HOLD SHOOT TO JUMP · LET GO IN THE GOLD' : 'HOLD SPACE TO JUMP · LET GO IN THE GOLD · A / D TO MOVE', W / 2, MAIN.y + 156, 25, '#fff');
        c.globalAlpha = 1;
      } else if (note && now - note.at < 2200) {
        c.globalAlpha = Math.min(1, (2200 - (now - note.at)) / 400);
        text(note.text, W / 2, MAIN.y + 156, 28, note.color);
        c.globalAlpha = 1;
      }
    }

    function drawBombs(now) {
      for (let i = bombs.length - 1; i >= 0; i--) {
        const b = bombs[i];
        const t = (now - b.t0) / 620;
        if (t >= 1) { bombs.splice(i, 1); continue; }
        const x = b.x0 + (b.x1 - b.x0) * t;
        const y = b.y0 + (b.y1 - b.y0) * t - Math.sin(t * Math.PI) * 90;
        c.fillStyle = '#23202e';
        c.beginPath(); c.arc(x, y, 13, 0, 6.3); c.fill();
        c.fillStyle = '#ffb84a';
        c.beginPath(); c.arc(x + 8, y - 11, 4 + Math.random() * 3, 0, 6.3); c.fill();
      }
    }

    function drawOver() {
      if (!over) return;
      c.fillStyle = 'rgba(12,8,20,.74)';
      c.fillRect(0, 0, W, H);
      const line = over.rank === 1 ? 'YOU WIN!' : `${ORDINAL[over.rank]} PLACE`;
      text(line, W / 2, 210, 88, over.rank === 1 ? '#ffd23f' : '#ffffff', 'center', 8);
      text(`${over.score} POINTS${over.newBest ? ' · NEW BEST!' : ''}`, W / 2, 278, 46, over.newBest ? '#7dffb0' : '#ffe9a0', 'center', 6);
      const s = over.stats;
      if (s) {
        const pct = s.shots ? Math.round((s.made / s.shots) * 100) : 0;
        text(`${s.made} of ${s.shots} shots (${pct}%)   ·   ${s.perfects} perfect   ·   best streak ${s.best}`, W / 2, 334, 26, '#d8cfea', 'center', 4);
      }
    }

    function render(ts) {
      raf = requestAnimationFrame(render);
      if (!backdrop) { fit(); if (!backdrop) return; }
      const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
      last = ts;
      const now = performance.now();
      const time = ts / 1000;
      if (leftMs !== null && !over) leftMs = Math.max(0, leftMs - dt * 1000);
      shake = Math.max(0, shake - dt * 4);

      c.setTransform(k, 0, 0, k, 0, 0);
      c.fillStyle = '#150f22';
      c.fillRect(0, 0, W, H);

      for (const lane of rivals) {
        const r = lane.rect;
        c.save();
        rr(c, r.x, r.y, SW * r.s, SH * r.s, 10); c.clip();
        c.translate(r.x, r.y);
        c.scale(r.s, r.s);
        drawScene(lane, now, time, dt);
        c.restore();
        drawMiniLabels(lane);
      }

      c.save();
      c.beginPath(); c.rect(MAIN.x, MAIN.y, SW, SH); c.clip();
      c.translate(MAIN.x, MAIN.y);
      if (shake > 0 && !CALM) c.translate((Math.random() - 0.5) * shake * 12, (Math.random() - 0.5) * shake * 12);
      drawScene(me, now, time, dt);
      c.restore();

      if (finalOn && !over) {
        const a = 0.14 + 0.1 * Math.sin(time * 8);
        const g = c.createRadialGradient(W / 2, H * 0.62, 240, W / 2, H * 0.62, 620);
        g.addColorStop(0, 'rgba(255,60,40,0)');
        g.addColorStop(1, `rgba(255,60,40,${a})`);
        c.fillStyle = g;
        c.fillRect(0, MAIN.y, W, SH);
      }
      drawHud(now, time);
      drawBombs(now);
      drawOver();

      // A shot held past the end of the gauge has gone by itself.
      if (charging && now - charging.t0 > charging.win.sweet + cfg.holdLate + 60) releaseCharge();
    }

    if (ro) fit();
    raf = requestAnimationFrame(render);

    const say = (t, color = '#fff') => { note = { text: t, color, at: performance.now() }; };

    return {
      onMessage(data) {
        if (data.type === 'begin') {
          cfg = data.cfg;
          leftMs = data.roundMs;
          for (const l of data.lanes) {
            const lane = laneOf(l.id);
            if (lane) { lane.name = l.name; lane.bot = l.bot; }
          }
        } else if (data.type === 'state') {
          leftMs = data.left;
          for (const row of data.lanes) {
            const lane = laneOf(row.id);
            if (!lane) continue;
            lane.row = row;
            if (!lane.pending) lane.shown = row.s;
          }
          btnChi.disabled = !(cfg && me.row && me.row.c >= cfg.chiFull && !me.row.fo);
        } else if (data.type === 'charge') {
          const lane = laneOf(data.id);
          if (!lane || lane === me || !cfg) return;
          lane.pose = { t0: performance.now(), sweet: windowsFor(cfg.hoopX - lane.dx, false, false).sweet, rel: null, relLift: 0, dunk: false };
        } else if (data.type === 'shot') {
          const lane = laneOf(data.id);
          if (!lane || !cfg) return;
          const now = performance.now();
          if (lane === me && charging) releaseCharge();    // the server let go for you
          lane.readyAt = now + (data.ready - data.t);
          const lift = poseOf(lane, now).lift;
          if (lane.pose) { lane.pose.rel = now; lane.pose.relLift = lift; lane.pose.dunk = data.dunk; }
          else lane.pose = { t0: now, sweet: 1, rel: now, relLift: JUMP * 0.8, dunk: data.dunk };
          const shotLift = lane.pose.relLift;
          const x = courtX(data.x);
          const y = FEET - shotLift - 125;
          const shot = { kind: data.kind, made: data.made, perfect: data.grade === 'perfect', dunk: data.dunk, points: data.points, hot: data.hot, streak: data.streak, buzzer: data.buzzer, score: data.score };
          lane.pending++;
          launch(lane, shot, x, y, shotLift, false);
          if (data.focus && data.kind !== 'dunk') {
            launch(lane, shot, x - 66, y + 8, shotLift, true);
            launch(lane, shot, x + 66, y + 8, shotLift, true);
          }
          if (lane === me && frozen) {
            frozen.grade = data.grade;
            frozen.early = data.kind === 'air';
          }
          if (lane === me && data.streak > 0 && data.streak % 3 === 0) say(data.streak >= 6 ? 'INFERNO! +2 EVERY MAKE' : 'ON FIRE! +1 EVERY MAKE', '#ff9a4a');
        } else if (data.type === 'focus') {
          const lane = laneOf(data.id);
          if (!lane) return;
          burst(lane, courtX(lane.dx), FEET - 60, 40, VIOLET, 300);
          if (lane === me) { say('SHADOW CLONES! WIDER WINDOWS, DOUBLE POINTS', '#d7b8ff'); sfx.clones(); }
        } else if (data.type === 'smoke') {
          const from = laneOf(data.from), to = laneOf(data.to);
          if (!from || !to) return;
          const centre = (l) => ({ x: l.rect.x + (SW * l.rect.s) / 2, y: l.rect.y + (SH * l.rect.s) / 2 });
          const a = centre(from), b = centre(to);
          bombs.push({ t0: performance.now(), x0: a.x, y0: a.y, x1: b.x, y1: b.y });
          if (to === me) { say(`${from.name} SMOKED YOU! TIGHTER TIMING`, '#d8d8ea'); sfx.smoke(); }
          if (from === me) say(`SMOKE BOMB ON ${to.name}!`, '#7dffb0');
        } else if (data.type === 'final') {
          finalOn = true;
          say('FINAL 10 SECONDS: EVERYTHING COUNTS DOUBLE', '#ff9a8a');
        } else if (data.type === 'buzzer') {
          sfx.horn();
          leftMs = 0;
          charging = null;
          for (const row of data.standings) {
            const lane = laneOf(row.id);
            if (lane) { lane.shown = row.score; lane.pending = 0; }
          }
          const mine = data.standings.find((r) => r.id === me.id);
          const score = mine ? mine.score : me.shown;
          const newBest = score > (store.best || 0);
          if (newBest) { store.best = score; saveStore(); }
          over = { rank: rankOf(me), score, stats: mine, newBest };
        } else if (data.type === 'takeover') {
          const lane = laneOf(data.id);
          if (lane) lane.bot = true;
          if (data.id !== ctx.youId) say(`${data.name} LEFT. A BOT TOOK THEIR COURT.`, '#d8d8ea');
        }
      },
      onResults() {},
      unmount() {
        cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('pointerup', onWindowUp);
        window.removeEventListener('pointercancel', onWindowUp);
        window.removeEventListener('blur', onBlur);
        canvas.removeEventListener('pointerdown', onCanvasDown);
        if (actx) actx.close().catch(() => {});
        keys.clear();
        held.clear();
        if (dir) { dir = 0; ctx.send({ type: 'move', dir: 0 }); }
      },
    };
  },
});
