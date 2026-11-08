// Football (client): Lantern Kicks. Field goals in turns, kicked by each player's own ninja in a
// lantern-lit stadium. On your turn pick a distance, then swing: one press locks the aim, the next
// locks the power. While someone else kicks you can read a Gust Scroll against them.
// Server rules: server/src/minigames/games/football.js
ClubDojoMinigames.register({
  id: 'football',
  ownEnding: true, // the last kick and final standings play out before the results
  guide: {
    summary: 'Lantern Kicks: field goals in turns. Everyone gets five kicks, and the last one counts double. Solo games add a bot to beat.',
    controls: [['↑ ↓ or W / S', 'Set the distance on your turn'], ['Space or Enter', 'Start the swing, lock your aim, then lock your power'], ['G', 'Read your Gust Scroll while someone else kicks']],
    tips: ['Longer kicks score more, but the goal narrows and they need more power.', 'Short kicks are easy to overhit, and too much power hooks the ball.', 'Light the lantern for a bonus, or split the posts dead centre for a Perfect.'],
  },

  mount(ctx) {
    const { h, el, avatar } = ctx;
    const BOT_ID = '__bot';
    const BOT_LOADOUT = { v: 1, id: BOT_ID, name: 'Sensei Bot', color: '#2b2f3a', headband: '#e8453c', belt: 'black', accessories: {} };
    const SCENE_H = 600, MIN_W = 680, BAR_ROOM = 62, BAR_ROOM_NARROW = 106;   // logical scene height, narrowest width, room for the buttons
    const HZ = 245;                                    // the horizon
    const PX = 20;                                     // pixels per yard at the goal
    const TEE_Y = 492;
    const AIM_Y = 546;
    const POWER_H = 160, POWER_Y = 335;
    const RUN_MS = 320;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const calmMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const displayFont = (getComputedStyle(el).getPropertyValue('--display') || '').trim() || 'sans-serif';

    const loadouts = new Map(ctx.players.map((p) => [p.id, p.loadout]));
    loadouts.set(BOT_ID, BOT_LOADOUT);
    const loadoutOf = (id) => loadouts.get(id) || BOT_LOADOUT;
    const nameOf = (id) => (id === ctx.youId ? 'You' : (roster.find((p) => p.id === id) || {}).name || 'Kicker');

    let spots = new Map();
    let sweep = 12, windYd = 1.2, attempts = 5, grace = 0.02;
    let roster = [];
    let turn = null;              // { id, name, n, of, golden, streak }
    let wind = 0, shownWind = 0, lantern = 0.6;
    let dist = 35, viewDist = 35;
    let deadline = 0, deadlineMs = 15000;
    let phase = null;             // 'set' | 'aim' | 'power' | null
    let meterStart = 0, meterPeriod = 1.8;
    let lockedAim = 0, frozen = null;   // frozen: { phase, value } from the moment you pressed
    let awaiting = false;         // a press is on its way to the server
    let gusts = 1, gustUsed = false;
    let anim = null;              // the kick being played back
    let final = null;
    let banner = null;
    let flash = 0, shake = 0, cheer = 0, gustFx = 0;
    let lastFrame = performance.now();
    let raf = 0;
    const trail = [];
    const particles = [];
    const scores = new Map();
    const history = new Map();
    const streaks = new Map();
    const scrolls = new Map();

    const style = h('style', {}, `
      .fb { position: absolute; inset: 0; overflow: hidden; background: #16203f; }
      .fb-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
      .fb-top { position: absolute; top: 6px; left: 6px; right: 6px; display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; }
      .fb-hud { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
      .fb-card { display: flex; align-items: center; gap: 6px; padding: 2px 10px 2px 2px; border-radius: 12px; background: rgba(12,16,34,.72); color: #fff; border: 2px solid transparent; }
      .fb-card.on { border-color: #ffd23f; background: rgba(60,46,10,.82); }
      .fb-card canvas { border-radius: 9px; background: rgba(255,255,255,.08); }
      .fb-nm { font-size: 11px; opacity: .85; max-width: 84px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .fb-sc { font-family: var(--display); font-size: 19px; line-height: 1; }
      .fb-sc small { font-size: 12px; margin-left: 4px; color: #ffb35c; }
      .fb-pips { display: flex; gap: 3px; margin-top: 3px; }
      .fb-pips i { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,.2); }
      .fb-pips i.hit { background: #5fe08f; }
      .fb-pips i.miss { background: #f0675f; }
      .fb-pips i.gold { box-shadow: 0 0 0 1.5px #ffd23f; }
      .fb-status { font-family: var(--display); font-size: 17px; color: #fff; text-align: center; padding: 1px 12px; border-radius: 10px; background: rgba(12,16,34,.55); }
      .fb-status:empty { display: none; }
      .fb-ctl { position: absolute; left: 0; right: 0; bottom: 8px; display: flex; gap: 8px; justify-content: center; align-items: center; flex-wrap: nowrap; padding: 0 8px; }
      .fb-ctl .btn { white-space: nowrap; }
      .fb-spot { min-width: 104px; text-align: center; font-family: var(--display); color: #fff; font-size: 17px; line-height: 1.05; }
      .fb-spot small { display: block; font-size: 12px; color: #ffd23f; }
      .fb-gust[disabled] { opacity: .45; }
      @media (max-width: 560px) { .fb-status { font-size: 14px; } .fb-spot { min-width: 74px; font-size: 15px; } .fb-ctl { flex-wrap: wrap; gap: 6px; } }
    `);
    const hud = h('div', { class: 'fb-hud' });
    const status = h('div', { class: 'fb-status' }, 'Heading out to the field...');
    const canvas = h('canvas', { class: 'fb-canvas' });
    const g = canvas.getContext('2d');
    const onPress = (fn) => (e) => { e.preventDefault(); fn(); };
    const btnLess = h('button', { class: 'btn small', tabindex: '-1', onpointerdown: onPress(() => setDist(-1)) }, '− Closer');
    const spotLabel = h('div', { class: 'fb-spot' }, '35 yd');
    const btnMore = h('button', { class: 'btn small', tabindex: '-1', onpointerdown: onPress(() => setDist(1)) }, 'Farther +');
    const btnKick = h('button', { class: 'btn', tabindex: '-1', onpointerdown: onPress(() => press()) }, 'Kick');
    const btnGust = h('button', { class: 'btn small fb-gust', tabindex: '-1', title: 'Whips up the wind against the kicker. One per match.', onpointerdown: onPress(() => sendGust()) }, 'Gust Scroll (G)');
    const btnMute = h('button', { class: 'btn ghost small', tabindex: '-1', 'aria-label': 'Sound', onpointerdown: onPress(() => toggleMute()) });
    el.append(style, h('div', { class: 'fb' }, canvas, h('div', { class: 'fb-top' }, hud, status), h('div', { class: 'fb-ctl' }, btnLess, spotLabel, btnMore, btnKick, btnGust, btnMute)));

    // ---------- sound ----------
    let muted = false;
    try { muted = localStorage.getItem('clubdojo.football.muted') === '1'; } catch { /* the default is fine */ }
    btnMute.textContent = muted ? '🔇' : '🔊';
    function toggleMute() {
      muted = !muted;
      btnMute.textContent = muted ? '🔇' : '🔊';
      try { localStorage.setItem('clubdojo.football.muted', muted ? '1' : '0'); } catch { /* stays for this round */ }
    }
    let actx = null;
    function audio() {
      if (muted) return null;
      if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
      if (actx.state === 'suspended') actx.resume().catch(() => {});
      return actx;
    }
    function tone(freq, dur, type = 'sine', vol = 0.08, end = null, delay = 0) {
      const a = audio();
      if (!a) return;
      const t = a.currentTime + delay;
      const o = a.createOscillator(), v = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (end) o.frequency.exponentialRampToValueAtTime(end, t + dur);
      v.gain.setValueAtTime(vol, t);
      v.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(v).connect(a.destination);
      o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol, cutoff, rise = 0.02) {
      const a = audio();
      if (!a) return;
      const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = a.createBufferSource(), f = a.createBiquadFilter(), v = a.createGain(), t = a.currentTime;
      src.buffer = buf;
      f.type = 'bandpass'; f.frequency.value = cutoff; f.Q.value = 0.8;
      v.gain.setValueAtTime(0.0008, t);
      v.gain.exponentialRampToValueAtTime(vol, t + rise);
      v.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      src.connect(f).connect(v).connect(a.destination);
      src.start(t);
    }
    const sfx = {
      tick: () => tone(660, 0.06, 'square', 0.03),
      step: () => tone(380, 0.05, 'triangle', 0.05),
      thump: () => { tone(150, 0.16, 'sine', 0.22, 55); noise(0.08, 0.1, 900); },
      doink: () => { tone(1480, 0.5, 'triangle', 0.11, 1320); tone(2240, 0.32, 'sine', 0.05); },
      cheer: () => { noise(1.5, 0.11, 1500, 0.25); tone(784, 0.12, 'triangle', 0.05); tone(1047, 0.2, 'triangle', 0.05, null, 0.11); },
      groan: () => { noise(0.8, 0.05, 420, 0.1); tone(240, 0.55, 'sawtooth', 0.025, 130); },
      gong: () => [196, 392, 523, 811].forEach((f, i) => tone(f, 1.4 - i * 0.2, 'sine', 0.1 / (i + 1))),
      gust: () => noise(0.9, 0.16, 650, 0.2),
      golden: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.06, null, i * 0.08)),
    };

    // ---------- input ----------
    const mySpot = () => spots.get(dist) || { pts: 0, half: 3, need: 0.5, band: 0.14 };
    const myTurn = () => !!turn && turn.id === ctx.youId && !!phase && !anim;

    function setDist(step) {
      if (!myTurn() || phase !== 'set') return;
      ctx.send({ type: 'dist', step });
      sfx.step();
    }
    function press() {
      if (!myTurn() || awaiting) return;
      awaiting = true;
      if (phase !== 'set') {
        const at = performance.now() - meterStart;
        frozen = { phase, value: meterValue(at) };
        sfx.tick();
        ctx.send({ type: 'press', at: Math.round(at) });
      } else {
        ctx.send({ type: 'press' });
      }
      refreshControls();
    }
    function sendGust() {
      if (!canGust()) return;
      ctx.send({ type: 'gust' });
    }
    const canGust = () => !!turn && turn.id !== ctx.youId && gusts > 0 && !gustUsed && (phase === 'set' || phase === 'aim') && !anim && !final;

    const onKeyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'ArrowUp' || e.code === 'KeyW') setDist(1);
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') setDist(-1);
      else if (e.code === 'Space' || e.code === 'Enter') press();
      else if (e.code === 'KeyG') sendGust();
    };
    const onCanvasDown = (e) => { e.preventDefault(); press(); };
    document.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('pointerdown', onCanvasDown);

    function refreshControls() {
      const mine = myTurn();
      btnLess.disabled = btnMore.disabled = !(mine && phase === 'set');
      btnKick.disabled = !mine || awaiting;
      btnKick.textContent = !mine || phase === 'set' ? 'Kick (Space)' : phase === 'aim' ? 'Lock aim (Space)' : 'Lock power (Space)';
      btnGust.disabled = !canGust();
      btnGust.textContent = gusts > 0 ? 'Gust Scroll (G)' : 'Scroll spent';
      const sp = mySpot();
      spotLabel.replaceChildren(`${dist} yd`, h('small', {}, `${sp.pts} pts${turn && turn.golden ? ' × 2' : ''}`));
    }

    // ---------- sizing ----------
    const bg = document.createElement('canvas');
    let viewW = MIN_W, viewH = SCENE_H, oy = 0, scale = 1, cx = MIN_W / 2, dpr = 1;
    let crowd = [];

    function fit() {
      const r = el.getBoundingClientRect();
      const w = Math.max(240, r.width), hgt = Math.max(240, r.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const room = w <= 560 ? BAR_ROOM_NARROW : BAR_ROOM;
      scale = Math.min((hgt - room) / SCENE_H, w / MIN_W);
      viewW = w / scale;
      viewH = hgt / scale;
      oy = Math.max(0, (hgt - room) / scale - SCENE_H);
      cx = viewW / 2;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
      paintBackground();
    }
    const ro = new ResizeObserver(fit);

    // A repeatable random sequence, so the crowd doesn't reshuffle when the window changes size.
    function seeded(a) {
      return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }

    function paintBackground() {
      bg.width = canvas.width; bg.height = canvas.height;
      const b = bg.getContext('2d');
      b.setTransform(scale * dpr, 0, 0, scale * dpr, 0, oy * scale * dpr);
      const top = -oy, bottom = viewH - oy;
      const rnd = seeded(77);

      // dusk sky, stars and moon
      const sky = b.createLinearGradient(0, top, 0, HZ);
      sky.addColorStop(0, '#141d44'); sky.addColorStop(0.5, '#3a3a78'); sky.addColorStop(0.85, '#c06a78'); sky.addColorStop(1, '#f4a765');
      b.fillStyle = sky; b.fillRect(0, top, viewW, HZ - top);
      b.fillStyle = 'rgba(255,255,255,.75)';
      for (let i = 0; i < 90; i++) { const s = rnd() * 1.6 + 0.4; b.fillRect(rnd() * viewW, top + rnd() * (150 - top), s, s); }
      b.fillStyle = 'rgba(255,240,205,.14)'; b.beginPath(); b.arc(viewW * 0.8, 74, 52, 0, 7); b.fill();
      b.fillStyle = '#fff1cf'; b.beginPath(); b.arc(viewW * 0.8, 74, 28, 0, 7); b.fill();

      // mountains behind the stadium
      for (const [col, base, amp] of [['#4b4780', 140, 44], ['#37345f', 158, 30]]) {
        b.fillStyle = col; b.beginPath(); b.moveTo(0, HZ);
        for (let x = 0; x <= viewW + 40; x += 40) b.lineTo(x, base - Math.abs(Math.sin(x * 0.009 + base)) * amp - rnd() * 8);
        b.lineTo(viewW, HZ); b.fill();
      }

      // the stands, in tiers
      const TOP = 150;
      const stand = b.createLinearGradient(0, TOP, 0, HZ);
      stand.addColorStop(0, '#26264a'); stand.addColorStop(1, '#17172f');
      b.fillStyle = stand; b.fillRect(0, TOP, viewW, HZ - TOP);
      b.fillStyle = '#8c2f2b'; b.fillRect(0, TOP - 5, viewW, 7);
      b.fillStyle = 'rgba(255,255,255,.05)';
      for (let y = TOP + 12; y < HZ; y += 16) b.fillRect(0, y, viewW, 7);
      // red banners
      for (let x = 40; x < viewW; x += 148) {
        b.fillStyle = '#b23229'; b.beginPath(); b.moveTo(x, TOP); b.lineTo(x + 32, TOP); b.lineTo(x + 32, TOP + 34); b.lineTo(x + 16, TOP + 44); b.lineTo(x, TOP + 34); b.fill();
        b.fillStyle = '#f4e6c8'; b.beginPath(); b.arc(x + 16, TOP + 16, 8, 0, 7); b.fill();
      }
      // pad wall at the front of the stands
      b.fillStyle = '#7f2a26'; b.fillRect(0, HZ - 12, viewW, 12);
      b.fillStyle = '#d9a441'; b.fillRect(0, HZ - 12, viewW, 2);

      // turf outside the field
      b.fillStyle = '#2a6a35'; b.fillRect(0, HZ, viewW, bottom - HZ);
      const sideX = (y) => 60 + ((y - HZ) / (SCENE_H - HZ)) * (viewW * 0.42);
      // mown bands, closer together with distance
      const band = 13;
      for (let i = 0; i < band; i++) {
        const y0 = HZ + (bottom - HZ) * (i / band) ** 2;
        const y1 = HZ + (bottom - HZ) * ((i + 1) / band) ** 2;
        b.fillStyle = i % 2 ? '#4ba24a' : '#419240';
        b.beginPath();
        b.moveTo(cx - sideX(y0), y0); b.lineTo(cx + sideX(y0), y0);
        b.lineTo(cx + sideX(y1), y1); b.lineTo(cx - sideX(y1), y1);
        b.fill();
        if (i > 1) { b.fillStyle = 'rgba(255,255,255,.55)'; b.fillRect(cx - sideX(y0), y0 - 0.5, sideX(y0) * 2, Math.max(1, i * 0.28)); }
      }
      b.strokeStyle = '#f6f6ee'; b.lineWidth = 3;
      for (const dir of [-1, 1]) { b.beginPath(); b.moveTo(cx + dir * sideX(HZ), HZ); b.lineTo(cx + dir * sideX(bottom), bottom); b.stroke(); }

      // crest painted on the turf
      b.save();
      b.translate(cx, 412); b.scale(1, 0.42);
      b.fillStyle = 'rgba(178,50,41,.5)'; b.beginPath(); b.arc(0, 0, 66, 0, 7); b.fill();
      b.strokeStyle = 'rgba(255,255,255,.65)'; b.lineWidth = 5; b.beginPath(); b.arc(0, 0, 66, 0, 7); b.stroke();
      b.fillStyle = 'rgba(255,255,255,.8)'; b.font = `76px ${displayFont}`; b.textAlign = 'center'; b.textBaseline = 'middle'; b.fillText('道', 0, 4);
      b.restore();
      b.textBaseline = 'alphabetic';

      // kicking tee mark
      b.fillStyle = 'rgba(255,255,255,.5)'; b.fillRect(cx - 40, TEE_Y + 12, 80, 3);

      // floodlights
      for (const x of [viewW * 0.09, viewW * 0.91]) {
        b.fillStyle = '#20223c'; b.fillRect(x - 3, 60, 6, HZ - 60);
        b.fillStyle = '#343859'; b.fillRect(x - 26, 44, 52, 22);
        b.fillStyle = '#fff7d6';
        for (let i = 0; i < 4; i++) { b.beginPath(); b.arc(x - 18 + i * 12, 55, 5, 0, 7); b.fill(); }
        const glow = b.createRadialGradient(x, 55, 4, x, 55, 150);
        glow.addColorStop(0, 'rgba(255,245,200,.34)'); glow.addColorStop(1, 'rgba(255,245,200,0)');
        b.fillStyle = glow; b.fillRect(x - 150, -95, 300, 300);
      }

      const colors = ['#e8453c', '#f5b82e', '#2f6fd1', '#3bb273', '#f2f2f2', '#d36bff', '#ff9a4d'];
      crowd = [];
      const spacing = Math.max(7, viewW / 130);
      for (let y = TOP + 15; y < HZ - 16; y += 16) {
        for (let x = 6; x < viewW; x += spacing) {
          if (rnd() < 0.17) continue;
          crowd.push({ x: x + rnd() * 3, y, c: colors[Math.floor(rnd() * colors.length)], p: rnd() * 6.28 });
        }
      }
    }

    // ---------- geometry ----------
    const spotFor = (d) => {
      const f = (d - 20) / 40;
      return { half: 4 - f * 2, s: 1 - f * 0.5 };
    };
    function goal(d) {
      const { half, s } = spotFor(d);
      const base = HZ + 8 + 92 * (s - 0.5) * 2;
      const bar = base - 118 * s;
      return { s, half, base, bar, top: bar - 170 * s, hw: half * PX };
    }
    function meterValue(elapsed) {
      const t = ((elapsed / 1000) / meterPeriod) % 1;
      return t < 0.5 ? t * 2 : 2 - t * 2;
    }

    // ---------- drawing ----------
    function rr(x, y, w, hgt, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + hgt, r);
      g.arcTo(x + w, y + hgt, x, y + hgt, r);
      g.arcTo(x, y + hgt, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }
    function label(text, x, y, size, color, align = 'center') {
      g.font = `${size}px ${displayFont}`;
      g.textAlign = align;
      g.lineJoin = 'round';
      g.lineWidth = Math.max(3, size * 0.16);
      g.strokeStyle = 'rgba(10,12,30,.85)';
      g.strokeText(text, x, y);
      g.fillStyle = color;
      g.fillText(text, x, y);
    }

    function drawCrowd(now) {
      const excited = cheer > 0;
      for (const c of crowd) {
        const hop = excited ? Math.abs(Math.sin(now / 130 + c.p)) * 5 * Math.min(1, cheer) : Math.sin(now / 900 + c.p) * 0.6;
        g.fillStyle = c.c;
        g.fillRect(c.x, c.y - hop, 5, 6);
        g.fillStyle = '#f1d3b3';
        g.fillRect(c.x + 1, c.y - hop - 3, 3, 3);
      }
    }

    function pennant(x, y, s, now) {
      const dir = shownWind === 0 ? 0 : Math.sign(shownWind);
      const len = (10 + Math.abs(shownWind) * 5) * s;
      const flap = Math.sin(now / (130 - Math.abs(shownWind) * 12)) * 4 * s;
      g.fillStyle = '#ff5f4e';
      g.beginPath();
      g.moveTo(x, y);
      if (dir === 0) { g.lineTo(x + 3 * s, y + 18 * s); g.lineTo(x - 3 * s, y + 16 * s); }
      else { g.lineTo(x + dir * len, y + 4 * s + flap); g.lineTo(x, y + 10 * s); }
      g.closePath();
      g.fill();
    }

    function drawGoal(geo, now) {
      const { s, base, bar, top, hw } = geo;
      const lw = 3 + 5 * s;
      // shadow and padded post
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(cx, base + 2, hw * 0.34, 4 + 4 * s, 0, 0, 7); g.fill();
      g.fillStyle = '#b23229'; rr(cx - lw * 1.2, bar, lw * 2.4, base - bar, lw); g.fill();
      g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(cx - lw * 0.7, bar + 4, lw * 0.5, base - bar - 8);
      const gold = g.createLinearGradient(cx - hw, 0, cx + hw, 0);
      gold.addColorStop(0, '#f8c72d'); gold.addColorStop(0.5, '#ffe67a'); gold.addColorStop(1, '#eeb31e');
      g.strokeStyle = gold; g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(cx - hw, top); g.lineTo(cx - hw, bar); g.lineTo(cx + hw, bar); g.lineTo(cx + hw, top);
      g.stroke();
      g.lineCap = 'butt';
      pennant(cx - hw, top, s, now);
      pennant(cx + hw, top, s, now);

      if (flash > 0) {
        g.strokeStyle = `rgba(255,255,240,${flash * 0.8})`; g.lineWidth = lw + 8 * flash;
        g.beginPath(); g.moveTo(cx - hw, top); g.lineTo(cx - hw, bar); g.lineTo(cx + hw, bar); g.lineTo(cx + hw, top); g.stroke();
      }

      // The lantern hangs between the uprights on a wire.
      if (turn) {
        const wireY = bar - 118 * s;
        const lit = anim && anim.lanternLit;
        const x = cx + clamp(lantern, -1, 1) * hw;
        const sway = Math.sin(now / 520) * 3 * s + shownWind * 1.2 * s;
        const y = wireY + 34 * s;
        g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(cx - hw, wireY); g.quadraticCurveTo(cx, wireY + 10 * s, cx + hw, wireY); g.stroke();
        g.beginPath(); g.moveTo(x, wireY + 4 * s); g.lineTo(x + sway, y - 14 * s); g.stroke();
        if (!lit) {
          const pulse = 0.5 + Math.sin(now / 240) * 0.2;
          const halo = g.createRadialGradient(x + sway, y, 2, x + sway, y, 34 * s + 8);
          halo.addColorStop(0, `rgba(255,190,90,${pulse})`); halo.addColorStop(1, 'rgba(255,190,90,0)');
          g.fillStyle = halo; g.beginPath(); g.arc(x + sway, y, 34 * s + 8, 0, 7); g.fill();
          g.fillStyle = '#e8453c';
          g.beginPath(); g.ellipse(x + sway, y, 12 * s + 3, 15 * s + 3, 0, 0, 7); g.fill();
          g.strokeStyle = 'rgba(255,220,160,.8)'; g.lineWidth = 1;
          for (const k of [-0.5, 0, 0.5]) { g.beginPath(); g.ellipse(x + sway, y, (12 * s + 3) * Math.abs(k), 15 * s + 3, 0, 0, 7); g.stroke(); }
          g.fillStyle = '#2b1a14';
          g.fillRect(x + sway - 6 * s, y - 16 * s - 3, 12 * s, 3);
          g.fillRect(x + sway - 6 * s, y + 15 * s + 1, 12 * s, 3);
        }
      }
    }

    function drawBall(x, y, r, spin, gold) {
      const squash = 0.62 + 0.3 * Math.abs(Math.sin(spin));
      g.save();
      g.translate(x, y);
      g.rotate(-0.35 + Math.sin(spin) * 0.25);
      const body = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.2);
      body.addColorStop(0, gold ? '#ffeb9c' : '#b87845'); body.addColorStop(1, gold ? '#d59a18' : '#6b3e22');
      g.fillStyle = body;
      g.beginPath(); g.ellipse(0, 0, r, r * squash, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = Math.max(1, r * 0.1);
      g.beginPath(); g.moveTo(-r * 0.4, 0); g.lineTo(r * 0.4, 0); g.stroke();
      for (const k of [-0.24, 0, 0.24]) { g.beginPath(); g.moveTo(r * k, -r * 0.15); g.lineTo(r * k, r * 0.15); g.stroke(); }
      g.restore();
    }

    // Where the ball is, for the current kick. Returns { x, y, r, shadowY, behind } or null before impact.
    function ballAt(e, a, geo) {
      const f = e - RUN_MS;
      if (f < 0) return null;
      const t = Math.min(1, f / a.flightMs);
      const d = 1 - (1 - t) ** 2;
      const aim = a.aim ?? 0, land = a.landing ?? 0;
      const short = a.outcome === 'short';
      const px = cx + aim * PX * d + a.wind * windYd * PX * d * d + (land - aim - a.wind * windYd) * PX * d ** 3;
      const groundY = lerp(TEE_Y + 8, geo.base + 8, d);
      const r = lerp(15, 4 + 4 * geo.s, d);
      if (short) {
        const y = lerp(TEE_Y, geo.base + 12, d) - Math.sin(Math.min(1, t * 1.05) * Math.PI) * 74;
        if (t < 1) return { x: px, y, r, shadowY: groundY };
        const b = (f - a.flightMs) / 500;
        return { x: px, y: geo.base + 10 - Math.abs(Math.sin(b * Math.PI * 1.5)) * 10 * Math.max(0, 1 - b), r, shadowY: groundY };
      }
      const hit = a.outcome === 'post-in' || a.outcome === 'post-out';
      const gx = hit ? cx + Math.sign(land || 1) * geo.hw : px;
      const gy = hit ? geo.bar - 60 * geo.s : geo.bar - 42 * geo.s;
      if (t < 1) {
        return { x: hit ? lerp(cx, gx, d) : px, y: lerp(TEE_Y, gy, d) - Math.sin(t * Math.PI) * 78, r, shadowY: groundY };
      }
      const after = (f - a.flightMs) / 620;
      const sign = Math.sign(land || 1);
      if (a.outcome === 'post-in') return { x: gx - sign * geo.hw * 0.75 * Math.min(1, after), y: gy - 16 * Math.sin(Math.min(1, after) * 3) - after * 6, r: r * lerp(1, 0.6, Math.min(1, after)), shadowY: groundY, behind: after > 0.4 };
      if (a.outcome === 'post-out') {
        return { x: gx + sign * 66 * Math.min(1.4, after), y: gy + 150 * after * after - 20 * after, r, shadowY: groundY };
      }
      return { x: gx + (a.outcome === 'wide' ? sign * 18 * after : 0), y: gy - 30 * Math.min(1, after), r: r * lerp(1, 0.55, Math.min(1, after)), shadowY: groundY, behind: true };
    }

    function arrive(a, geo) {
      a.arrived = true;
      const landX = cx + (a.landing ?? 0) * PX;
      if (a.made) {
        cheer = 2.6;
        flash = 1;
        const look = loadoutOf(a.id);
        burst(cx, geo.bar - 40 * geo.s, 70, [look.headband || '#e8453c', '#ffd23f', '#ffffff', look.color || '#2f6fd1'], 240);
        sfx.cheer();
      } else if (a.outcome !== 'post-out') {
        sfx.groan();
      }
      if (a.parts.lantern) {
        a.lanternLit = true;
        burst(cx + lantern * geo.hw, geo.bar - 84 * geo.s, 46, ['#ffb35c', '#ffd23f', '#ff6a3d'], 200);
        shake = 0.7;
        flash = 1;
        sfx.gong();
      }
      if (a.outcome === 'post-in' || a.outcome === 'post-out') {
        burst(cx + Math.sign(a.landing || 1) * geo.hw, geo.bar - 60 * geo.s, 26, ['#ffffff', '#ffd23f'], 180);
        shake = 1;
        sfx.doink();
        if (a.outcome === 'post-out') sfx.groan();
      }
      if (a.outcome === 'short') burst(landX, geo.base + 10, 12, ['#7a5a3a', '#4ba24a'], 80);
      showResultBanner(a);
    }

    function showResultBanner(a) {
      const dir = (a.landing ?? 0) < 0 ? 'left' : 'right';
      const text = {
        good: a.parts.lantern ? 'Lantern lit!' : a.parts.perfect ? 'Perfect!' : "It's good!",
        'post-in': 'Doink... it\'s in!',
        'post-out': 'Doink! No good',
        wide: `Wide ${dir}`,
        short: 'Short!',
      }[a.outcome] || 'Out of time';
      const bits = [];
      if (a.parts.base) bits.push(`${a.parts.base} kick`);
      if (a.parts.streak) bits.push(`+${a.parts.streak} streak`);
      if (a.parts.perfect) bits.push(`+${a.parts.perfect} perfect`);
      if (a.parts.lantern) bits.push(`+${a.parts.lantern} lantern`);
      if (a.made && a.parts.golden) bits.push('× 2 golden');
      setBanner(text, a.made ? `${bits.join('  ')}  =  ${a.points}` : '', a.made ? '#8bffb6' : '#ff9a8f', 1800);
    }

    function setBanner(text, sub, color, ms) { banner = { t0: performance.now(), text, sub, color, ms }; }

    function burst(x, y, n, colors, speed) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28, v = speed * (0.3 + Math.random() * 0.7);
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.35, life: 0, max: 0.9 + Math.random() * 0.9, c: colors[Math.floor(Math.random() * colors.length)], s: 2.5 + Math.random() * 3.5, spin: Math.random() * 6 });
      }
    }

    function drawKicker(now) {
      if (!turn && !anim) return;
      const id = anim ? anim.id : turn.id;
      const look = loadoutOf(id);
      const footY = TEE_Y + 20;
      let x = cx - 76, lift = 0, rot = 0, walking = false, leg = null;
      if (anim) {
        const e = now - anim.t0;
        if (e < RUN_MS) {
          const p = e / RUN_MS;
          x = lerp(cx - 120, cx - 42, p * p);
          walking = true;
          rot = 0.05;
        } else if (e < RUN_MS + 260) {
          leg = (e - RUN_MS) / 260;
          x = cx - 42;
          rot = -0.34 * Math.sin(leg * Math.PI);
        } else {
          x = cx - 42;
          if (anim.arrived && anim.made) lift = Math.abs(Math.sin(now / 150)) * 30;
          else if (anim.arrived) rot = 0.14;
        }
      } else if (phase === 'power') {
        rot = 0.08 + Math.sin(now / 100) * 0.01;
      }
      g.fillStyle = 'rgba(0,0,0,.28)';
      g.beginPath(); g.ellipse(x, footY + 2, 36 - lift * 0.3, 11, 0, 0, 7); g.fill();
      g.save();
      g.translate(x, footY - lift);
      g.rotate(rot);
      if (leg !== null) {
        const ang = lerp(2.5, -0.25, leg);
        const hipY = -24;
        const fx = Math.cos(ang) * 50, fy = hipY + Math.sin(ang) * 50;
        g.strokeStyle = look.headband || '#e8453c';
        g.globalAlpha = 0.55;
        g.lineWidth = 8;
        g.beginPath(); g.arc(0, hipY, 54, ang + 0.7, ang, true); g.stroke();
        g.globalAlpha = 1;
        g.strokeStyle = look.color || '#20262e'; g.lineWidth = 17; g.lineCap = 'round';
        g.beginPath(); g.moveTo(0, hipY); g.lineTo(fx, fy); g.stroke();
        g.lineCap = 'butt';
        g.fillStyle = '#f1d3b3'; g.beginPath(); g.arc(fx, fy, 8, 0, 7); g.fill();
      }
      avatar.draw(g, look, { x: 0, y: 0, size: 76, facing: 1, walking, time: now, shadow: false });
      g.restore();
      if (!anim) label(id === ctx.youId ? 'You' : turn.name, x, footY + 24, 15, id === ctx.youId ? '#ffd23f' : '#ffffff');
    }

    function drawWatchers(now) {
      const kicker = anim ? anim.id : (turn && turn.id);
      const idle = final ? [] : roster.filter((p) => p.id !== kicker);
      const edge = Math.min(viewW / 2 - 46, 330);
      idle.forEach((p, i) => {
        const side = i % 2 ? 1 : -1;
        const row = Math.floor(i / 2);
        const x = cx + side * (edge - row * 62);
        const y = 492 + row * 14;
        const jump = cheer > 0 ? Math.abs(Math.sin(now / 135 + i)) * 20 * Math.min(1, cheer) : 0;
        g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(x, y + 1, 21 - jump * 0.2, 7, 0, 0, 7); g.fill();
        avatar.draw(g, loadoutOf(p.id), { x, y: y - jump, size: 48, facing: side > 0 ? -1 : 1, time: now, shadow: false, you: p.id === ctx.youId });
        label(p.id === ctx.youId ? 'You' : p.name, x, y + 17, 12, '#ffffff');
      });
    }

    function drawWindGauge() {
      const w = 128, x = viewW - w - 12, y = 72;
      g.fillStyle = 'rgba(12,16,34,.72)'; rr(x, y, w, 44, 10); g.fill();
      label('WIND', x + 10, y + 16, 12, '#a9c9ff', 'left');
      const strength = Math.abs(wind);
      const dir = Math.sign(wind) || 1;
      label(wind === 0 ? 'calm' : `${strength} ${dir > 0 ? 'right' : 'left'}`, x + w - 10, y + 16, 13, strength >= 4 ? '#ff9a8f' : '#ffffff', 'right');
      for (let i = 0; i < 5; i++) {
        const cxi = x + 18 + i * 23;
        const lit = i < strength;
        g.strokeStyle = lit ? (strength >= 4 ? '#ff9a8f' : '#7dd3ff') : 'rgba(255,255,255,.18)';
        g.lineWidth = 3;
        g.beginPath(); g.moveTo(cxi - dir * 5, y + 25); g.lineTo(cxi + dir * 4, y + 31); g.lineTo(cxi - dir * 5, y + 37); g.stroke();
      }
    }

    function drawClock(now) {
      if (!deadline || anim || final) return;
      const left = Math.max(0, deadline - now);
      const secs = Math.ceil(left / 1000);
      const x = 42, y = 94;
      g.fillStyle = 'rgba(12,16,34,.72)'; g.beginPath(); g.arc(x, y, 26, 0, 7); g.fill();
      g.strokeStyle = secs <= 5 ? '#ff7a6e' : '#ffd23f'; g.lineWidth = 4;
      g.beginPath(); g.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + (left / deadlineMs) * 6.283); g.stroke();
      label(String(secs), x, y + 7, 19, '#ffffff');
    }

    function drawPower(now) {
      if (!turn || anim) return;
      const sp = mySpot();
      const x = cx + 104, y = POWER_Y, w = 22;
      const toY = (p) => y + POWER_H * (1 - p);
      const active = phase === 'power';
      g.globalAlpha = active ? 1 : 0.5;
      g.fillStyle = 'rgba(12,16,34,.8)'; rr(x - 4, y - 4, w + 8, POWER_H + 8, 8); g.fill();
      const low = clamp(sp.need - grace, 0, 1), high = clamp(sp.need + sp.band, 0, 1);
      g.fillStyle = '#a23b34'; g.fillRect(x, toY(low), w, y + POWER_H - toY(low));
      g.fillStyle = '#4fd98a'; g.fillRect(x, toY(high), w, toY(low) - toY(high));
      const over = g.createLinearGradient(0, toY(1), 0, toY(high));
      over.addColorStop(0, '#e5533f'); over.addColorStop(1, '#f2b53b');
      g.fillStyle = over; g.fillRect(x, y, w, toY(high) - y);
      label('POWER', x + w / 2, y - 10, 12, '#ffffff');
      g.globalAlpha = 1;
      if (active) {
        const v = frozen && frozen.phase === 'power' ? frozen.value : meterValue(now - meterStart);
        const ny = toY(v);
        g.fillStyle = '#ffffff';
        g.fillRect(x - 7, ny - 2.5, w + 14, 5);
        g.beginPath(); g.moveTo(x - 7, ny - 7); g.lineTo(x - 15, ny); g.lineTo(x - 7, ny + 7); g.fill();
      }
    }

    function drawAim(now, geo) {
      if (!turn || anim) return;
      const sp = mySpot();
      const half = sweep * PX;
      const x0 = cx - half, y = AIM_Y, hgt = 16;
      const toX = (yd) => cx + yd * PX;
      g.fillStyle = 'rgba(12,16,34,.8)'; rr(x0 - 6, y - 6, half * 2 + 12, hgt + 12, 9); g.fill();
      g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(x0, y, half * 2, hgt);
      const centre = -wind * windYd;
      g.fillStyle = '#3fbf7f'; g.fillRect(toX(centre - sp.half), y, sp.half * 2 * PX, hgt);
      g.fillStyle = '#b9ffd8'; g.fillRect(toX(centre - 0.8), y, 1.6 * PX, hgt);
      g.fillStyle = '#ffb94d'; g.fillRect(toX(centre + lantern * sp.half - 0.9), y, 1.8 * PX, hgt);
      g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(cx - 1, y - 3, 2, hgt + 6);

      let aimYd = null;
      if (phase === 'aim') aimYd = frozen && frozen.phase === 'aim' ? (frozen.value - 0.5) * 2 * sweep : (meterValue(now - meterStart) - 0.5) * 2 * sweep;
      else if (phase === 'power') aimYd = lockedAim;
      if (aimYd === null) return;
      const mx = toX(aimYd);
      g.fillStyle = '#ffffff'; g.fillRect(mx - 2.5, y - 8, 5, hgt + 16);
      g.beginPath(); g.moveTo(mx - 8, y - 15); g.lineTo(mx + 8, y - 15); g.lineTo(mx, y - 6); g.fill();

      // Where the ball will end up once the wind has had its say, and the curve it takes to get there.
      const lx = toX(aimYd + wind * windYd);
      const ly = geo.bar - 42 * geo.s;
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; g.setLineDash([3, 9]);
      g.beginPath(); g.moveTo(cx, TEE_Y - 8);
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, d = 1 - (1 - t) ** 2;
        g.lineTo(cx + aimYd * PX * d + wind * windYd * PX * d * d, lerp(TEE_Y - 8, ly, d) - Math.sin(t * Math.PI) * 78);
      }
      g.stroke(); g.setLineDash([]);
      const inGoal = Math.abs(aimYd + wind * windYd) <= sp.half;
      g.strokeStyle = inGoal ? '#7dffb0' : '#ff9a8f'; g.lineWidth = 3;
      g.beginPath(); g.arc(lx, ly, 13, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(lx - 19, ly); g.lineTo(lx - 7, ly); g.moveTo(lx + 7, ly); g.lineTo(lx + 19, ly); g.moveTo(lx, ly - 19); g.lineTo(lx, ly - 7); g.moveTo(lx, ly + 7); g.lineTo(lx, ly + 19); g.stroke();
    }

    function drawBanner(now) {
      if (!banner) return;
      const age = now - banner.t0;
      if (age > banner.ms) { banner = null; return; }
      const pop = age < 150 ? 0.6 + (age / 150) * 0.5 : age < 240 ? 1.1 - ((age - 150) / 90) * 0.1 : 1;
      g.save();
      g.globalAlpha = age > banner.ms - 300 ? (banner.ms - age) / 300 : 1;
      g.translate(cx, 322);
      g.scale(pop, pop);
      label(banner.text, 0, 0, 58, banner.color);
      if (banner.sub) label(banner.sub, 0, 34, 21, '#ffffff');
      g.restore();
    }

    function drawFinal(now) {
      const e = now - final.t0;
      g.fillStyle = `rgba(10,12,30,${Math.min(0.72, e / 500)})`;
      g.fillRect(0, -oy, viewW, viewH);
      const top = final.standings[0];
      const tie = final.standings[1] && final.standings[1].score === top.score;
      const headline = tie ? "It's a tie!" : top.id === ctx.youId ? 'You win!' : `${top.name} wins!`;
      label(headline, cx, 165, 56, '#ffd23f');
      if (final.bonus) label(`+${final.bonus} for beating the bot`, cx, 200, 20, '#8bffb6');
      const n = final.standings.length;
      const gap = Math.min(150, (viewW - 80) / n);
      final.standings.forEach((row, i) => {
        const x = cx + (i - (n - 1) / 2) * gap;
        const winner = row.score === top.score;
        const y = 400 - (winner ? 34 + Math.abs(Math.sin(now / 170 + i)) * 26 : 0);
        g.fillStyle = 'rgba(255,255,255,.1)';
        g.fillRect(x - 54, 400, 108, 60);
        avatar.draw(g, loadoutOf(row.id), { x, y, size: 84, facing: 0, time: now });
        label(String(row.score), x, 438, 30, winner ? '#ffd23f' : '#ffffff');
        label(row.id === ctx.youId ? 'You' : row.name, x, 482, 16, '#ffffff');
      });
    }

    function step(dt, now) {
      viewDist += (dist - viewDist) * Math.min(1, dt * 10);
      shownWind += (wind - shownWind) * Math.min(1, dt * 7);
      flash = Math.max(0, flash - dt * 1.8);
      shake = Math.max(0, shake - dt * 2.6);
      cheer = Math.max(0, cheer - dt);
      gustFx = Math.max(0, gustFx - dt * 0.9);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.life > p.max) { particles.splice(i, 1); continue; }
        p.vy += 330 * dt;
        p.vx += shownWind * 22 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.spin += dt * 9;
      }
    }

    const breezes = Array.from({ length: 26 }, (_, i) => ({ x: (i * 37) % 100, y: 80 + (i * 53) % 380, v: 0.7 + (i % 5) * 0.12 }));
    function drawBreeze(now) {
      const strength = Math.abs(shownWind);
      if (strength < 0.15) return;
      g.strokeStyle = `rgba(235,246,255,${Math.min(0.42, 0.08 + strength * 0.07 + gustFx * 0.3)})`;
      g.lineWidth = 2;
      const dir = Math.sign(shownWind);
      for (const b of breezes) {
        const span = viewW + 120;
        const x = ((((b.x / 100) * span + dir * now * 0.05 * b.v * (1 + strength)) % span) + span) % span - 60;
        const len = 14 + strength * 12;
        const y = b.y + Math.sin(now / 400 + b.x) * 5;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + dir * len * 0.5, y - 3, x + dir * len, y); g.stroke();
      }
    }

    function draw(now, dt) {
      step(dt, now);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(bg, 0, 0);
      const quake = calmMotion ? 0 : shake * 7;
      g.setTransform(scale * dpr, 0, 0, scale * dpr, (Math.random() - 0.5) * quake * scale * dpr, (oy + (Math.random() - 0.5) * quake) * scale * dpr);
      drawCrowd(now);

      const geo = goal(viewDist);
      let ball = null;
      if (anim) {
        const e = now - anim.t0;
        if (e >= RUN_MS && !anim.struck) { anim.struck = true; sfx.thump(); shake = Math.max(shake, 0.25); }
        ball = anim.outcome === 'timeout' ? null : ballAt(e, anim, geo);
        if (ball && !anim.arrived && e - RUN_MS >= anim.flightMs) arrive(anim, geo);
        if (anim.outcome === 'timeout' && !anim.arrived && e > 400) arrive(anim, geo);
      }

      if (ball && ball.behind) ballDraw(ball, now);
      drawGoal(geo, now);
      drawBreeze(now);
      drawWatchers(now);

      if (ball && !ball.behind) ballDraw(ball, now);
      if ((!anim && turn) || (anim && now - anim.t0 < RUN_MS)) {
        drawBall(cx, TEE_Y, 15, 0.6, !!(turn && turn.golden));
        g.fillStyle = '#e8c34d'; g.fillRect(cx - 5, TEE_Y + 10, 10, 5);
      }
      drawKicker(now);

      for (const p of particles) {
        g.globalAlpha = 1 - p.life / p.max;
        g.fillStyle = p.c;
        g.save(); g.translate(p.x, p.y); g.rotate(p.spin); g.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); g.restore();
      }
      g.globalAlpha = 1;

      drawAim(now, geo);
      drawPower(now);
      drawWindGauge();
      drawClock(now);

      if (turn && turn.golden && !final) {
        const pulse = 0.35 + Math.sin(now / 220) * 0.2;
        g.strokeStyle = `rgba(255,210,63,${pulse})`;
        g.lineWidth = 10;
        g.strokeRect(5, 5 - oy, viewW - 10, viewH - 10);
      }
      if (gustFx > 0) { g.fillStyle = `rgba(180,225,255,${gustFx * 0.16})`; g.fillRect(0, -oy, viewW, viewH); }
      drawBanner(now);
      if (final) drawFinal(now);
    }

    function ballDraw(ball, now) {
      const a = anim;
      const look = loadoutOf(a.id);
      const hot = a.golden || a.streak >= 2;
      trail.push({ x: ball.x, y: ball.y, r: ball.r });
      if (trail.length > 16) trail.shift();
      trail.forEach((t, i) => {
        g.globalAlpha = (i / trail.length) * (hot ? 0.75 : 0.32);
        g.fillStyle = a.golden ? '#ffd23f' : (look.headband || '#e8453c');
        g.beginPath(); g.arc(t.x, t.y, t.r * (hot ? 0.9 : 0.6) * (i / trail.length + 0.25), 0, 7); g.fill();
      });
      g.globalAlpha = 1;
      if (ball.shadowY) {
        g.fillStyle = 'rgba(0,0,0,.25)';
        g.beginPath(); g.ellipse(ball.x, ball.shadowY, ball.r * 0.9, ball.r * 0.34, 0, 0, 7); g.fill();
      }
      drawBall(ball.x, ball.y, ball.r, now / 55, a.golden);
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      draw(now, dt);
    }

    // ---------- HUD ----------
    const cards = new Map();
    function buildHud() {
      hud.replaceChildren();
      cards.clear();
      for (const p of roster) {
        const nm = h('div', { class: 'fb-nm' });
        const sc = h('div', { class: 'fb-sc' });
        const pips = h('div', { class: 'fb-pips' });
        let portrait;
        try { portrait = avatar.portrait(loadoutOf(p.id), 38); } catch { portrait = h('span', {}); }
        const root = h('div', { class: 'fb-card' }, portrait, h('div', {}, nm, sc, pips));
        hud.append(root);
        cards.set(p.id, { root, nm, sc, pips });
      }
      drawHud();
    }
    function drawHud() {
      for (const p of roster) {
        const c = cards.get(p.id);
        if (!c) continue;
        c.root.classList.toggle('on', !!turn && turn.id === p.id && !anim);
        c.nm.textContent = `${p.id === ctx.youId ? 'You' : p.name}${scrolls.get(p.id) > 0 ? ' 🌀' : ''}`;
        const st = streaks.get(p.id) || 0;
        c.sc.replaceChildren(String(scores.get(p.id) || 0));
        if (st >= 2) c.sc.append(h('small', {}, `🔥${st}`));
        const list = history.get(p.id) || [];
        c.pips.replaceChildren(...Array.from({ length: attempts }, (_, i) => {
          const r = list[i];
          return h('i', { class: `${r === undefined ? '' : r ? 'hit' : 'miss'}${i === attempts - 1 ? ' gold' : ''}` });
        }));
      }
    }
    function setStatus() {
      if (final || !turn || anim) { status.textContent = ''; return; }
      if (myTurn()) {
        const sp = mySpot();
        status.textContent = phase === 'set'
          ? `Your kick, ${turn.n} of ${turn.of}. Pick a distance (${sp.pts} pts), then Space to swing.`
          : phase === 'aim' ? 'Lock your aim while the marker is in the green.' : 'Now your power. Stop the needle in the green.';
      } else {
        status.textContent = `${turn.name} is kicking (${turn.n} of ${turn.of}).${canGust() ? ' Press G to curse them with a gust!' : ''}`;
      }
    }

    ro.observe(el);
    fit();
    buildHud();
    refreshControls();
    raf = requestAnimationFrame(loop);

    return {
      onMessage(data) {
        if (data.type === 'begin') {
          attempts = data.attempts;
          sweep = data.sweep;
          windYd = data.windYd;
          grace = data.grace;
          spots = new Map(data.spots.map((sp) => [sp.d, sp]));
          roster = data.roster || [];
          for (const p of roster) { scores.set(p.id, 0); history.set(p.id, []); streaks.set(p.id, 0); scrolls.set(p.id, 1); }
          buildHud();
          refreshControls();
        } else if (data.type === 'turn') {
          turn = { id: data.id, name: data.name, n: data.n, of: data.of, golden: data.golden, streak: data.streak };
          wind = data.wind;
          lantern = data.lantern;
          dist = data.dist;
          phase = 'set';
          frozen = null;
          awaiting = false;
          gustUsed = false;
          lockedAim = 0;
          anim = null;
          trail.length = 0;
          deadlineMs = data.ms;
          deadline = performance.now() + data.ms;
          if (data.golden) { setBanner('Golden Kick', 'Points count double', '#ffd23f', 1500); sfx.golden(); }
          refreshControls(); drawHud(); setStatus();
        } else if (data.type === 'dist') {
          dist = data.dist;
          refreshControls(); setStatus();
        } else if (data.type === 'phase') {
          phase = data.phase;
          meterStart = performance.now();
          meterPeriod = data.period;
          if (data.aim !== undefined && data.aim !== null) lockedAim = data.aim;
          frozen = null;
          awaiting = false;
          refreshControls(); setStatus();
        } else if (data.type === 'gust') {
          wind = data.wind;
          gustUsed = true;
          gustFx = 1;
          scrolls.set(data.from, data.gusts);
          if (data.from === ctx.youId) gusts = data.gusts;
          setBanner(`${nameOf(data.from)} read a Gust Scroll!`, `Wind ${Math.abs(wind)} ${wind > 0 ? 'right' : 'left'}`, '#a9dcff', 1400);
          sfx.gust();
          refreshControls(); drawHud(); setStatus();
        } else if (data.type === 'attempt') {
          scores.set(data.id, data.score);
          streaks.set(data.id, data.streak);
          history.get(data.id).push(data.made);
          dist = data.dist;
          wind = data.wind;
          phase = null;
          frozen = null;
          awaiting = false;
          deadline = 0;
          trail.length = 0;
          anim = {
            ...data, t0: performance.now(), golden: !!data.parts.golden,
            flightMs: 950 + data.dist * 6,
          };
          refreshControls(); drawHud(); setStatus();
        } else if (data.type === 'final') {
          final = { standings: data.standings, bonus: data.bonus, t0: performance.now() };
          turn = null; anim = null; banner = null;
          cheer = 3;
          const top = data.standings[0];
          if (top && top.id === ctx.youId) { burst(cx, 180, 120, ['#ffd23f', '#ffffff', '#ff6a3d', '#7dd3ff'], 320); sfx.cheer(); sfx.golden(); }
          refreshControls(); drawHud(); setStatus();
        }
      },
      onResults() {},
      unmount() {
        cancelAnimationFrame(raf);
        ro.disconnect();
        document.removeEventListener('keydown', onKeyDown);
        canvas.removeEventListener('pointerdown', onCanvasDown);
        if (actx) { actx.close().catch(() => {}); actx = null; }
      },
    };
  },
});
