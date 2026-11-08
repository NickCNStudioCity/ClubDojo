// Go-Kart Race (client). Draws a Mode 7 chase view from the server's snapshots and sends
// steering/pedal states. Track geometry and the Mode 7 maths live in ./go-kart-mode7/.
// Server rules: server/src/minigames/games/go-kart-race.js   Plan: docs/minigames/go-kart-mode7-outline.md
(function () {
  // Helper scripts sit next to this file. currentScript is only set while this file first runs.
  const HELPER_BASE = (() => {
    const src = typeof document !== 'undefined' && document.currentScript && document.currentScript.src;
    return src ? src.replace(/[^/]*$/, 'go-kart-mode7/') : '../shared/client/minigames/games/go-kart-mode7/';
  })();
  let helpers = null;
  function loadHelpers() {
    if (!helpers) {
      const one = (file, global) => (window[global] ? Promise.resolve() : new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = HELPER_BASE + file;
        s.onload = () => (window[global] ? resolve() : reject(new Error(`${file} did not load`)));
        s.onerror = () => reject(new Error(`Missing ${file}. Update ClubDojo.`));
        document.head.append(s);
      }));
      helpers = Promise.all([
        one('track.js', 'ClubDojoKartTrack'), one('mode7.js', 'ClubDojoMode7'),
        one('sprites.js', 'ClubDojoKartSprites'), one('scenery.js', 'ClubDojoKartScenery'),
      ])
        .catch((e) => { helpers = null; throw e; });
    }
    return helpers;
  }

  // Internal render size. The canvas is scaled up with crisp pixels, like the original.
  const VIEW_W = 400;
  const VIEW_H = 240;
  const TEX_SCALE = 2;            // texels per world unit in the track image
  const TEX_PAD = 100;            // world units of grass around the world in the track image
  // Chase camera. At standstill it sits `behind` units back and `height` up; at top speed it pulls
  // back, rises a little and widens the view (lower focal), which reads as speed.
  const CAM = {
    behind: 62, behindFast: 82, height: 24, heightFast: 28, focal: 220, focalFast: 190, horizon: 84,
    turnFollow: 9,   // how fast the camera swings round behind the kart (per second, exponential)
    speedFollow: 3,  // how fast the speed effects catch up
    refSpeed: 201,   // the server's top speed on the road, 45 mph
    shake: 0.9,      // off-road rumble in screen pixels at full speed
  };
  // Track speed is in world units a second. 0.36 km/h per unit (so the top speed reads about 120 km/h
  // at 330 units); converted to miles per hour here.
  const MPH_PER_UNIT = 0.36 / 1.609344;
  const COLORS = { grass: '#3f8a3a', grass2: '#367d33', verge: '#7a9a3c', road: '#5b5f68', kerbA: '#e8453c', kerbB: '#f3efe2', wall: '#b9b1a0', sky1: '#4a98dc', sky2: '#bfe3f7' };
  const PROP_FAR_Z = 1300; // props further than this are skipped (tiny, and under the haze)
  const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  // Lap and race times: 0:07.42
  const stopwatch = (ms) => {
    const t = Math.max(0, Math.round(ms / 10));
    return `${Math.floor(t / 6000)}:${String(Math.floor(t / 100) % 60).padStart(2, '0')}.${String(t % 100).padStart(2, '0')}`;
  };
  // Personal bests (best lap, best 3-lap race) are kept on this computer only.
  const PB_KEY = 'clubdojo.gokart.pb.v1';
  const loadPb = () => { try { return JSON.parse(localStorage.getItem(PB_KEY)) || {}; } catch { return {}; } };
  const savePb = (pb) => { try { localStorage.setItem(PB_KEY, JSON.stringify(pb)); } catch { /* storage off */ } };
  // Drift spark colours by charge level (none yet, mini-turbo, super mini-turbo).
  const SPARK = ['rgba(255,255,255,.9)', '#5ab8ff', '#ff9f2e'];

  // Snapshots arrive at 20 Hz. Rendering about 100 ms behind the newest one gives a sample on
  // each side of the frame time almost every time, so motion stays smooth.
  const INTERP_DELAY_MS = 100;
  const BUFFER_MS = 1000;

  const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const angleLerp = (a, b, t) => a + wrapAngle(b - a) * t;

  ClubDojoMinigames.register({
    id: 'go-kart-race',

    mount(ctx) {
      const { h, el, avatar } = ctx;
      const timers = new Set();
      const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

      const style = h('style', {}, `
        .gk { display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; padding: 6px; box-sizing: border-box; }
        .gk-players { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
        .gk-p { display: flex; flex-direction: column; align-items: center; background: rgba(255,255,255,.08); border-radius: 10px; padding: 4px 8px; min-width: 80px; transition: opacity .3s; }
        .gk-p.out { opacity: .45; }
        .gk-p b { font-size: 12px; } .gk-p small { opacity: .85; }
        .gk-stage { position: relative; width: min(900px, 100%); flex: 1 1 auto; min-height: 0; display: flex; justify-content: center; align-items: center; }
        .gk-view { position: relative; width: 100%; aspect-ratio: ${VIEW_W} / ${VIEW_H}; container-type: inline-size; }
        /* HUD over the view. Sizes are in cqw (percent of the view's width) so it scales with it. */
        .gk-hud { position: absolute; inset: 0; pointer-events: none; font-family: var(--display); color: #fff; letter-spacing: .03em;
          text-shadow: 0 .25cqw 0 rgba(0,0,0,.55), 0 0 .6cqw rgba(0,0,0,.45); }
        .gk-place { position: absolute; left: 2.5%; top: 3%; line-height: .9; }
        .gk-place b { font-size: 9cqw; color: var(--pc, #fff); }
        .gk-place small { font-size: 3.4cqw; opacity: .9; margin-left: .4cqw; }
        .gk-lap { position: absolute; left: 2.8%; top: 19%; font-size: 3.4cqw; }
        .gk-lap.final { color: #f5b82e; }
        .gk-laptime { position: absolute; left: 2.8%; top: 25.5%; font-size: 2.6cqw; line-height: 1.35; font-variant-numeric: tabular-nums; }
        .gk-laptime span { display: block; opacity: .8; font-size: 2.2cqw; }
        .gk-laptime span.pb { color: #7be07b; opacity: 1; }
        .gk-boost { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .2s; border-radius: 12px;
          background: radial-gradient(ellipse at 50% 60%, transparent 55%, rgba(255,170,60,.35) 100%); }
        .gk-boost.on { opacity: 1; }
        .gk-drift { position: absolute; right: 2.5%; bottom: 4%; font-size: 2.6cqw; opacity: 0; transition: opacity .15s; }
        .gk-drift.on { opacity: 1; }
        .gk-drift.l1 { color: #5ab8ff; } .gk-drift.l2 { color: #ff9f2e; }
        .gk-p .cpu { width: 48px; height: 48px; border-radius: 8px; display: grid; place-items: center; font-size: 26px; background: var(--kc, #555); }
        .gk-time { position: absolute; left: 50%; top: 3%; transform: translateX(-50%); font-size: 3.6cqw; background: rgba(0,0,0,.3); border-radius: 1cqw; padding: .2cqw 1.4cqw; }
        .gk-time.low { color: #ff8a80; }
        .gk-speed { position: absolute; left: 2.5%; bottom: 4%; display: flex; align-items: flex-end; gap: 1cqw; }
        .gk-speed b { font-size: 5cqw; line-height: .9; min-width: 7cqw; text-align: right; }
        .gk-speed small { font-size: 2.2cqw; opacity: .85; }
        .gk-bars { display: flex; gap: .35cqw; align-items: flex-end; height: 4.4cqw; margin-left: .6cqw; }
        .gk-bars i { display: block; width: .9cqw; background: rgba(255,255,255,.22); border-radius: .2cqw; box-shadow: 0 .2cqw 0 rgba(0,0,0,.35); }
        .gk-bars i.on { background: #7be07b; } .gk-bars i.on.hot { background: #f5b82e; } .gk-bars i.on.max { background: #ff6b5e; }
        .gk-banner { position: absolute; left: 0; right: 0; top: 30%; text-align: center; font-size: 8cqw; transition: opacity .25s, transform .25s; }
        .gk-banner.hide { opacity: 0; transform: scale(.85); }
        .gk-banner.warn { color: #ffd23f; font-size: 6.5cqw; animation: gk-blink .5s steps(2) infinite; }
        .gk-banner small { display: block; font-size: 3.2cqw; margin-top: .6cqw; }
        @keyframes gk-blink { 50% { opacity: .25; } }
        .gk-canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; border-radius: 12px; box-shadow: 0 6px 0 rgba(0,0,0,.35); background: ${COLORS.grass}; }
        .gk-tags { position: absolute; inset: 0; z-index: 1; pointer-events: none; overflow: hidden; border-radius: 12px; }
        .gk-hud, .gk-map { z-index: 2; }
        .gk-tag { position: absolute; transform: translate(-50%, -100%); white-space: nowrap; font: 600 clamp(9px, 1.2vw + 5px, 12px) system-ui, sans-serif; color: #fff; background: rgba(0,0,0,.55); border-radius: 6px; padding: 1px 6px; border-bottom: 2px solid var(--kc, #fff); }
        .gk-map { position: absolute; right: 2%; top: 3%; width: 24%; aspect-ratio: 1000 / 640; opacity: .9; border-radius: 6px; background: rgba(0,0,0,.25); }
        .gk-help { font-size: 12px; opacity: .75; text-align: center; }
      `);

      // HUD: place, lap, timer and speed, plus a centre banner for GO!, laps, wrong way and the finish.
      const SPEED_BARS = 12;
      const hudPlace = h('div', { class: 'gk-place' });
      const hudLap = h('div', { class: 'gk-lap' });
      const hudTime = h('div', { class: 'gk-time' });
      const speedNum = h('b', {}, '0');
      const bars = h('div', { class: 'gk-bars' });
      for (let i = 0; i < SPEED_BARS; i++) {
        const bar = h('i', { style: `height: ${30 + (70 * i) / (SPEED_BARS - 1)}%` });
        if (i >= SPEED_BARS - 4) bar.classList.add(i >= SPEED_BARS - 2 ? 'max' : 'hot');
        bars.append(bar);
      }
      const hudSpeed = h('div', { class: 'gk-speed' }, speedNum, h('small', {}, 'mph'), bars);
      const status = h('div', { class: 'gk-banner' }, 'Get ready...');
      const hudLapTime = h('div', { class: 'gk-laptime' });
      const hudDrift = h('div', { class: 'gk-drift' }, 'DRIFT');
      const boostGlow = h('div', { class: 'gk-boost' });
      const hud = h('div', { class: 'gk-hud' }, boostGlow, hudPlace, hudLap, hudLapTime, hudTime, hudSpeed, hudDrift, status);
      hudSpeed.hidden = true;
      // The banner shows one message at a time; a timed one hides itself unless replaced.
      let bannerTimer = null;
      let bannerKind = '';
      function banner(html, { ms = 0, kind = '' } = {}) {
        if (bannerTimer) { clearTimeout(bannerTimer); timers.delete(bannerTimer); bannerTimer = null; }
        bannerKind = html ? kind : '';
        if (!html) { status.classList.add('hide'); return; }
        status.innerHTML = html;
        status.className = `gk-banner${kind === 'warn' ? ' warn' : ''}`;
        if (ms) bannerTimer = later(ms, () => { bannerTimer = null; bannerKind = ''; status.classList.add('hide'); });
      }
      // Under the lap counter: the running lap time, your best lap this race, and your all-time best.
      function renderLapPanel(fresh = false) {
        const current = hudLapTime.firstChild && hudLapTime.firstChild.nodeType === 3 ? hudLapTime.firstChild.textContent : '0:00.00';
        hudLapTime.textContent = '';
        hudLapTime.append(document.createTextNode(current),
          h('span', {}, bestLapMs ? `Best ${stopwatch(bestLapMs)}` : ''),
          h('span', { class: fresh ? 'pb' : '' }, pbNote));
      }
      const canvas = h('canvas', { class: 'gk-canvas', width: VIEW_W, height: VIEW_H });
      const g = canvas.getContext('2d');
      const mapCanvas = h('canvas', { class: 'gk-map', width: 250, height: 160 });
      const mg = mapCanvas.getContext('2d');
      // Name tags are DOM, not canvas, so they stay sharp over the scaled-up pixel view.
      const tagLayer = h('div', { class: 'gk-tags' });
      const view = h('div', { class: 'gk-view' }, canvas, tagLayer, mapCanvas, hud);
      const stage = h('div', { class: 'gk-stage' }, view);
      const playersRow = h('div', { class: 'gk-players' });
      const help = h('div', { class: 'gk-help' }, 'Drive: Arrow keys or WASD. Up / W gas, Down / S brake, Left and Right to steer. '
        + 'Hold Space or Shift while turning to drift; let go once the sparks turn blue or orange for a boost. Orange pads boost too.');
      el.append(style, h('div', { class: 'gk' }, playersRow, stage, help));

      // Keep the 5:3 view inside the stage at any window shape (CSS alone can't fit both axes).
      function fitView() {
        const r = stage.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.width, (r.height * VIEW_W) / VIEW_H));
        view.style.width = `${w}px`;
      }
      const resizer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fitView) : null;
      if (resizer) resizer.observe(stage);

      // Player cards with portraits from each ninja's loadout.
      // CPU racers get a card when the race starts (the server picks them).
      const cards = new Map();
      for (const p of ctx.players) {
        const place = h('small', {}, '—');
        const card = h('div', { class: 'gk-p' }, avatar.portrait(p.loadout, 48), h('b', {}, p.id === ctx.youId ? `${p.name} (you)` : p.name), place);
        cards.set(p.id, { card, place });
        playersRow.append(card);
      }
      function addCpuCard(k) {
        const place = h('small', {}, '—');
        const card = h('div', { class: 'gk-p' }, h('div', { class: 'cpu', style: `--kc: ${k.color}` }, '🤖'), h('b', {}, k.name), place);
        cards.set(k.id, { card, place });
        playersRow.append(card);
      }
      let pb = loadPb();
      let lapStartedAt = 0;  // performance.now() when your current lap began
      let bestLapMs = 0;     // your best lap this race
      let pbNote = '';       // last line under the lap timer

      let T = null;          // ClubDojoKartTrack, once loaded
      let M7 = null;         // ClubDojoMode7, once loaded
      let SP = null;         // ClubDojoKartSprites, once loaded
      let SC = null;         // ClubDojoKartScenery, once loaded
      let sky = null;        // 360° panorama strip
      let props = [];        // trackside billboards: { x, y, sheet, size }
      let gate = null;       // start gantry: { a, b, low, high, banner }
      let ready = false;
      const pending = [];    // messages that arrived before the helpers loaded
      let laps = 3;
      let tex = null;        // { data, w, h, scale } track image for the floor
      let mapLayer = null;   // small top-down track for the minimap
      let floor = null;      // ImageData for the floor pixels
      let floor32 = null;
      let grassPx = 0;
      let karts = new Map(); // id -> { color, buf: [{at,x,y,h}], shown: {x,y,h}, lap, f, o, active, v }
      let raceEndsAt = 0;
      let running = false;
      let finishedMe = false;
      let frame = 0;
      let lastFrameAt = 0;
      const camShown = { h: 0, speed: 0, inited: false };
      let myLap = 0;         // last lap seen for you, to announce the next one
      let wrongWayChecks = 0;

      // Keyboard state
      const keys = { up: false, down: false, left: false, right: false, drift: false };
      let lastSent = '';

      function sendControls() {
        const c = {
          steer: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
          gas: keys.up,
          brake: keys.down,
          drift: keys.drift,
        };
        const sig = `${c.steer}|${c.gas}|${c.brake}|${c.drift}`;
        if (sig === lastSent) return;
        lastSent = sig;
        ctx.send({ type: 'ctl', ...c });
      }

      const KEYMAP = {
        ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
        Space: 'drift', ShiftLeft: 'drift', ShiftRight: 'drift',
      };
      function onKeyDown(e) {
        const k = KEYMAP[e.code];
        if (!k) return;
        e.preventDefault();
        if (!keys[k]) { keys[k] = true; if (running && !finishedMe) sendControls(); }
      }
      function onKeyUp(e) {
        const k = KEYMAP[e.code];
        if (!k) return;
        keys[k] = false;
        if (running) sendControls();
      }
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('keyup', onKeyUp);

      // Draws the top-down track (placeholder art) from the shared geometry. Used for both the
      // Mode 7 floor texture and the minimap, so what you see always matches the server's track.
      function paintTrack(c2, scale, detail, pad = 0) {
        const { TRACK, HALF_WIDTH, WALL_MARGIN, WORLD } = T;
        c2.save();
        c2.scale(scale, scale);
        c2.fillStyle = COLORS.grass;
        c2.fillRect(-pad, -pad, WORLD.w + pad * 2, WORLD.h + pad * 2);
        if (detail) {
          // Mowing stripes so speed and turning read well in perspective.
          c2.fillStyle = COLORS.grass2;
          for (let x = 20 - pad; x < WORLD.w + pad; x += 40) c2.fillRect(x, -pad, 20, WORLD.h + pad * 2);
          // Darker and lighter tufts, and a few flowers, so the grass is not flat colour up close.
          const rand = SC.rng(3);
          for (let i = 0; i < 2600; i++) {
            const x = -pad + rand() * (WORLD.w + pad * 2), y = -pad + rand() * (WORLD.h + pad * 2);
            const r = rand();
            c2.fillStyle = r < 0.45 ? 'rgba(20,60,20,.28)' : r < 0.9 ? 'rgba(160,210,110,.22)' : (r < 0.95 ? '#f3efe2' : '#f5b82e');
            const s = r < 0.9 ? 2 + rand() * 3 : 1.2;
            c2.fillRect(x, y, s, s * 0.7);
          }
        }
        const path = () => {
          c2.beginPath();
          TRACK.pts.forEach((p, i) => (i ? c2.lineTo(p.x, p.y) : c2.moveTo(p.x, p.y)));
          c2.closePath();
        };
        c2.lineJoin = 'round';
        if (detail) {
          // Wall at the furthest a kart can drift, then the run-off verge inside it.
          path(); c2.strokeStyle = COLORS.wall; c2.lineWidth = (HALF_WIDTH + WALL_MARGIN) * 2 + 8; c2.stroke();
          path(); c2.strokeStyle = COLORS.verge; c2.lineWidth = (HALF_WIDTH + WALL_MARGIN) * 2; c2.stroke();
          // Kerbs: alternating red and white just outside the road.
          path(); c2.strokeStyle = COLORS.kerbB; c2.lineWidth = HALF_WIDTH * 2 + 10; c2.stroke();
          path(); c2.strokeStyle = COLORS.kerbA; c2.lineWidth = HALF_WIDTH * 2 + 10; c2.setLineDash([14, 14]); c2.stroke(); c2.setLineDash([]);
        }
        path(); c2.strokeStyle = COLORS.road; c2.lineWidth = HALF_WIDTH * 2; c2.stroke();
        path(); c2.strokeStyle = 'rgba(255,255,255,.75)'; c2.lineWidth = detail ? 2 : 3; c2.setLineDash([18, 14]); c2.stroke(); c2.setLineDash([]);
        // Boost pads: an orange plate with yellow chevrons pointing the way to drive.
        for (const pad of T.BOOST_PADS) {
          const r = T.BOOST_PAD_RADIUS;
          c2.save();
          c2.translate(pad.x, pad.y);
          c2.rotate(pad.h);
          c2.fillStyle = '#d35400';
          c2.fillRect(-r, -r * 0.8, r * 2, r * 1.6);
          if (detail) {
            c2.strokeStyle = '#ffd23f';
            c2.lineWidth = 3.2;
            c2.lineJoin = 'miter';
            for (const off of [-9, 0, 9]) {
              c2.beginPath();
              c2.moveTo(off - 4, -r * 0.55); c2.lineTo(off + 4, 0); c2.lineTo(off - 4, r * 0.55);
              c2.stroke();
            }
            c2.strokeStyle = 'rgba(0,0,0,.35)'; c2.lineWidth = 1.5;
            c2.strokeRect(-r, -r * 0.8, r * 2, r * 1.6);
          }
          c2.restore();
        }
        // Start/finish line: a checkered band across the road at point 0.
        const { a, b } = T.startLine();
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len; // across the road
        const fx = -uy, fy = ux;                               // along the road
        const cell = 6;
        for (let i = 0; i * cell < len; i++) {
          for (let j = 0; j < 2; j++) {
            c2.fillStyle = (i + j) % 2 ? '#111' : '#fff';
            const ox = a.x + ux * i * cell + fx * (j - 1) * cell;
            const oy = a.y + uy * i * cell + fy * (j - 1) * cell;
            c2.beginPath();
            c2.moveTo(ox, oy);
            c2.lineTo(ox + ux * cell, oy + uy * cell);
            c2.lineTo(ox + ux * cell + fx * cell, oy + uy * cell + fy * cell);
            c2.lineTo(ox + fx * cell, oy + fy * cell);
            c2.closePath();
            c2.fill();
          }
        }
        c2.restore();
      }

      function buildTrackImages() {
        const { WORLD } = T;
        // The walls poke a little past the world edges, so the floor image has a margin all round.
        const pad = TEX_PAD;
        const big = document.createElement('canvas');
        big.width = (WORLD.w + pad * 2) * TEX_SCALE; big.height = (WORLD.h + pad * 2) * TEX_SCALE;
        const bg = big.getContext('2d', { willReadFrequently: true });
        bg.translate(pad * TEX_SCALE, pad * TEX_SCALE);
        paintTrack(bg, TEX_SCALE, true, pad);
        const img = bg.getImageData(0, 0, big.width, big.height);
        tex = { data: new Uint32Array(img.data.buffer), w: big.width, h: big.height, scale: TEX_SCALE, ox: -pad, oy: -pad };
        const gc = parseInt(COLORS.grass.slice(1), 16);
        grassPx = M7.rgba(gc >> 16, (gc >> 8) & 255, gc & 255); // ground beyond the image

        mapLayer = document.createElement('canvas');
        mapLayer.width = mapCanvas.width; mapLayer.height = mapCanvas.height;
        paintTrack(mapLayer.getContext('2d'), mapCanvas.width / WORLD.w, false);

        floor = g.createImageData(VIEW_W, VIEW_H);
        floor32 = new Uint32Array(floor.data.buffer);

        // Scenery: the same seeded layout on every client.
        sky = SC.makeSkyStrip(CAM.focal, CAM.horizon + 4, COLORS);
        const sheets = SC.makePropSheets();
        props = SC.placeProps(T, { pad: pad - 20 }).map((p) => ({ x: p.x, y: p.y, sheet: sheets[p.kind], size: p.size }));
        gate = { ...SC.gantry(T), banner: SC.makeBanner('CLUB DOJO GP') };
      }

      // Every kart (yours included) as a billboard from its sprite sheet, drawn back to front.
      // The frame depends on the kart's heading relative to the line from the camera to it.
      const NEAR_Z = 8;      // closer than this the kart is behind or inside the camera
      const TAG_MAX_Z = 700; // name tags fade out by this distance
      // Karts, props and the start gantry share one back-to-front list, so a tree can hide a kart.
      function drawWorld(cam) {
        const list = [];
        for (const [id, k] of karts) {
          if (!k.active || !k.inited || !k.sheet) continue;
          const pt = M7.project(cam, k.shown.x, k.shown.y);
          if (!pt || pt.z < NEAR_Z) continue;
          list.push({ id, k, pt });
        }
        for (const p of props) {
          const pt = M7.project(cam, p.x, p.y);
          if (!pt || pt.z < NEAR_Z || pt.z > PROP_FAR_Z) continue;
          list.push({ prop: p, pt });
        }
        if (gate) {
          const pa = M7.project(cam, gate.a.x, gate.a.y);
          const pb = M7.project(cam, gate.b.x, gate.b.y);
          if (pa && pb && pa.z > NEAR_Z && pb.z > NEAR_Z) list.push({ gate: true, pt: { z: (pa.z + pb.z) / 2 } });
        }
        list.sort((a, b) => b.pt.z - a.pt.z);
        const seen = new Set();
        for (const item of list) {
          if (item.prop) { drawProp(item.prop, item.pt); continue; }
          if (item.gate) { drawGantry(cam); continue; }
          const { id, k, pt } = item;
          const s = k.sheet;
          const toKart = Math.atan2(k.shown.y - cam.y, k.shown.x - cam.x);
          // A drifting kart points its nose further into the bend than it is travelling.
          const frame = SP.frameFor(wrapAngle(k.shown.h + (k.slide || 0) - toKart));
          const px = pt.scale / s.ppu; // screen pixels per sheet pixel
          const w = s.fw * px, hgt = s.fh * px;
          const x = pt.x - s.ax * px, y = pt.y - s.ay * px;
          if (x > VIEW_W || x + w < 0 || y > VIEW_H || y + hgt < 0) continue;
          g.drawImage(s.canvas, frame * s.fw, 0, s.fw, s.fh, x, y, w, hgt);
          if (id !== ctx.youId && pt.z < TAG_MAX_Z) {
            seen.add(id);
            const tag = k.tag;
            tag.hidden = false;
            tag.style.left = `${(pt.x / VIEW_W) * 100}%`;
            tag.style.top = `${(y / VIEW_H) * 100}%`;
            tag.style.opacity = String(Math.min(1, (TAG_MAX_Z - pt.z) / 200));
            tag.style.zIndex = String(Math.round(10000 - pt.z));
          }
        }
        for (const [id, k] of karts) if (k.tag && !seen.has(id)) k.tag.hidden = true;
      }

      function drawProp(p, pt) {
        const s = p.sheet;
        const px = (pt.scale / s.ppu) * p.size;
        const w = s.fw * px, hgt = s.fh * px;
        const x = pt.x - s.ax * px, y = pt.y - s.ay * px;
        if (x > VIEW_W || x + w < 0 || y > VIEW_H || y + hgt < 0 || w < 0.6) return;
        g.drawImage(s.canvas, x, y, w, hgt);
      }

      // Two posts and a banner across the road. The banner is drawn in thin vertical slices, each
      // projected on its own, so it keeps the right perspective when seen at an angle.
      function drawGantry(cam) {
        const at = (t, up) => {
          const pt = M7.project(cam, gate.a.x + (gate.b.x - gate.a.x) * t, gate.a.y + (gate.b.y - gate.a.y) * t);
          return pt && { x: pt.x, y: pt.y - up * pt.scale, scale: pt.scale };
        };
        for (const t of [0, 1]) {
          const base = at(t, 0), top = at(t, gate.high);
          if (!base || !top) continue;
          const w = Math.max(1, 2.2 * base.scale);
          g.fillStyle = '#c9ced6'; g.fillRect(base.x - w / 2, top.y, w, base.y - top.y);
          g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(base.x, top.y, w / 2, base.y - top.y);
        }
        const SLICES = 16;
        const bw = gate.banner.width / SLICES, bh = gate.banner.height;
        for (let i = 0; i < SLICES; i++) {
          const t0 = i / SLICES, t1 = (i + 1) / SLICES;
          const a = at(t0, gate.high), b = at(t1, gate.high), c = at((t0 + t1) / 2, gate.low);
          if (!a || !b || !c) continue;
          const top = (a.y + b.y) / 2;
          const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
          // Seen from behind the banner the slices run right to left, so flip them back.
          const src = a.x <= b.x ? i : SLICES - 1 - i;
          g.drawImage(gate.banner, src * bw, 0, bw, bh, x0, top, x1 - x0 + 0.6, c.y - top);
        }
      }

      // Panorama behind the horizon, then a haze band just below it so distant ground (where the
      // floor texture shimmers most) fades into the hills.
      function drawSky(cam) {
        SC.drawSky(g, sky, cam.h, VIEW_W, cam.horizon, cam.focal / CAM.focal);
        const top = Math.ceil(cam.horizon);
        const haze = g.createLinearGradient(0, top, 0, top + 26);
        haze.addColorStop(0, 'rgba(191,227,247,.7)');
        haze.addColorStop(1, 'rgba(191,227,247,0)');
        g.fillStyle = haze;
        g.fillRect(0, top, VIEW_W, 26);
      }

      function drawMinimap() {
        mg.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
        mg.drawImage(mapLayer, 0, 0);
        const s = mapCanvas.width / T.WORLD.w;
        for (const [id, k] of karts) {
          if (!k.active || !k.inited) continue;
          const mine = id === ctx.youId;
          mg.fillStyle = k.color;
          mg.strokeStyle = mine ? '#fff' : 'rgba(0,0,0,.6)';
          mg.lineWidth = mine ? 2 : 1;
          mg.beginPath(); mg.arc(k.shown.x * s, k.shown.y * s, mine ? 5 : 4, 0, Math.PI * 2); mg.fill(); mg.stroke();
        }
      }

      function interpolate(k, at) {
        const buf = k.buf;
        if (!buf || buf.length === 0) return;
        // Find the last sample at or before `at`.
        let i = buf.length - 1;
        while (i > 0 && buf[i].at > at) i--;
        const a = buf[i];
        const b = buf[i + 1];
        if (!b || at <= a.at) {
          // Before the first sample, or no newer sample yet: hold the nearest known position.
          k.shown = { x: a.x, y: a.y, h: a.h };
          return;
        }
        const t = Math.min(1, Math.max(0, (at - a.at) / (b.at - a.at)));
        k.shown = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: angleLerp(a.h, b.h, t) };
      }

      function render() {
        frame = requestAnimationFrame(render);
        if (!tex) return;
        // Show each kart between the two snapshots that bracket a time slightly in the past.
        const renderAt = performance.now() - INTERP_DELAY_MS;
        for (const k of karts.values()) interpolate(k, renderAt);
        const me = karts.get(ctx.youId) || [...karts.values()][0];
        if (!me || !me.inited) return;
        const now = performance.now();
        const dt = lastFrameAt ? Math.min(0.1, (now - lastFrameAt) / 1000) : 0;
        lastFrameAt = now;
        // Chase camera: sits behind the kart and swings round a little later than it, so steering
        // shows. Smoothing uses elapsed time, so it feels the same at 30, 60 or 144 frames a second.
        const speed = Math.min(1, Math.abs(me.v || 0) / CAM.refSpeed);
        if (!camShown.inited) { camShown.h = me.shown.h; camShown.speed = speed; camShown.inited = true; }
        camShown.h += wrapAngle(me.shown.h - camShown.h) * (1 - Math.exp(-CAM.turnFollow * dt));
        camShown.speed += (speed - camShown.speed) * (1 - Math.exp(-CAM.speedFollow * dt));
        // A boost pulls the camera back and widens the view a little more than top speed does.
        camShown.boost = (camShown.boost || 0) + ((me.b ? 1 : 0) - (camShown.boost || 0)) * (1 - Math.exp(-6 * dt));
        const sp = camShown.speed + camShown.boost * 0.6;
        const behind = CAM.behind + (CAM.behindFast - CAM.behind) * sp;
        // Off the road the view rumbles a little, more the faster you go.
        const shake = me.o && !me.f ? Math.sin(now / 18) * CAM.shake * sp : 0;
        const cam = M7.camera({
          x: me.shown.x - Math.cos(camShown.h) * behind,
          y: me.shown.y - Math.sin(camShown.h) * behind,
          h: camShown.h,
          height: CAM.height + (CAM.heightFast - CAM.height) * sp,
          focal: CAM.focal + (CAM.focalFast - CAM.focal) * sp,
          horizon: CAM.horizon + shake,
          width: VIEW_W, rows: VIEW_H,
        });
        updateTyreEffects(dt);
        M7.renderFloor(cam, floor32, tex, grassPx);
        const top = Math.max(0, Math.floor(cam.horizon));
        g.putImageData(floor, 0, 0, 0, top, VIEW_W, VIEW_H - top);
        drawSky(cam);

        drawWorld(cam);
        drawSmoke(cam);
        drawMinimap();
        updateSpeed(me);
      }

      // Tyre marks and tyre smoke on hard cornering. Sideways speed (speed x turn rate) tells how
      // hard a kart is sliding. Marks are painted into the track image so they lie on the road;
      // smoke is a short-lived puff that drifts up from the rear wheels.
      const SKID_START = 260;     // sideways speed (units/s) where tyres start to slip
      const SKID_FULL = 140;      // how far past SKID_START it takes to slip fully
      const SKID_BACK = 5;        // world units behind the kart centre to the rear wheels
      const SKID_SIDE = 4;        // world units from the kart centre line to each rear wheel
      const SMOKE_MAX = 240;
      const wheels = new Map();   // kart id -> { h, yaw, slip, puff, marks: [{x,y}|null, {x,y}|null] }
      let smoke = [];
      let sparks = [];            // drift sparks and boost flames: short-lived bright specks
      const SPARK_MAX = 300;

      // Darkens one track-image point, by an amount 0..1, to draw a tyre mark.
      function paintMark(x, y, amount) {
        const cx = Math.floor((x - tex.ox) * tex.scale), cy = Math.floor((y - tex.oy) * tex.scale);
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const tx = cx + i, ty = cy + j;
            if (tx < 0 || ty < 0 || tx >= tex.w || ty >= tex.h) continue;
            const o = ty * tex.w + tx;
            const e = tex.data[o];
            const a = amount * 0.6;
            const mix = (c, to) => Math.round(c + (to - c) * a);
            tex.data[o] = M7.rgba(mix(e & 255, 40), mix((e >>> 8) & 255, 38), mix((e >>> 16) & 255, 36));
          }
        }
      }

      // Paints the marks from the last point to this one (a short line, so fast slides stay unbroken).
      function paintMarkLine(a, b, amount) {
        const d = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(d / 0.7));
        for (let i = 0; i <= steps; i++) paintMark(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, amount);
      }

      function updateTyreEffects(dt) {
        if (!tex || dt <= 0) return;
        for (const [id, k] of karts) {
          if (!k.active || !k.inited) continue;
          let w = wheels.get(id);
          if (!w) { w = { h: k.shown.h, yaw: 0, slip: 0, puff: 0, marks: [null, null] }; wheels.set(id, w); }
          // Turn rate, smoothed so the reading does not jump with each new snapshot.
          const yawRate = wrapAngle(k.shown.h - w.h) / dt;
          w.h = k.shown.h;
          w.yaw += (yawRate - w.yaw) * (1 - Math.exp(-12 * dt));
          const sideways = Math.abs(k.v || 0) * Math.abs(w.yaw);
          // A drift always leaves marks, however gentle the bend.
          const target = Math.max(k.dr ? 0.55 : 0, Math.min(1, Math.max(0, (sideways - SKID_START) / SKID_FULL)));
          w.slip += (target - w.slip) * (1 - Math.exp(-8 * dt));
          k.slide = (k.slide || 0) + ((k.dr ? Math.sign(k.dr) * 0.6 : 0) - (k.slide || 0)) * (1 - Math.exp(-10 * dt));

          const fx = Math.cos(k.shown.h), fy = Math.sin(k.shown.h);
          const wheelsAt = [-1, 1].map((s) => ({
            x: k.shown.x - fx * SKID_BACK - fy * SKID_SIDE * s,
            y: k.shown.y - fy * SKID_BACK + fx * SKID_SIDE * s,
          }));
          // Drift sparks from the rear wheels (colour shows the mini-turbo charge), and flames from
          // the exhaust while boosting.
          if (k.dr) {
            const level = Math.abs(k.dr) - 1;
            w.spark = (w.spark || 0) + dt * (level ? 70 : 35);
            while (w.spark >= 1) {
              w.spark -= 1;
              const p = wheelsAt[Math.random() < 0.5 ? 0 : 1];
              sparks.push({ x: p.x, y: p.y, up: 0.5, age: 0, life: 0.18 + Math.random() * 0.15, color: SPARK[level],
                vx: (Math.random() - 0.5) * 40 - fx * 25, vy: (Math.random() - 0.5) * 40 - fy * 25, vz: 12 + Math.random() * 18, size: 0.8 });
            }
          }
          if (k.b) {
            w.flame = (w.flame || 0) + dt * 60;
            while (w.flame >= 1) {
              w.flame -= 1;
              sparks.push({ x: k.shown.x - fx * (SKID_BACK + 3), y: k.shown.y - fy * (SKID_BACK + 3), up: 2.5, age: 0,
                life: 0.12 + Math.random() * 0.12, color: Math.random() < 0.5 ? '#ffd23f' : '#ff6b2e',
                vx: -fx * 60 + (Math.random() - 0.5) * 12, vy: -fy * 60 + (Math.random() - 0.5) * 12, vz: 4, size: 1.6 });
            }
          }
          if (w.slip < 0.2) { w.marks = [null, null]; continue; }
          wheelsAt.forEach((p, i) => {
            const prev = w.marks[i];
            if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 25) paintMarkLine(prev, p, w.slip);
            else paintMark(p.x, p.y, w.slip);
            w.marks[i] = p;
          });

          // Smoke: more of it the harder the slide. A drift on its own only smokes lightly (the sparks
          // are the show there).
          w.puff += dt * (k.dr ? 4 + 14 * w.slip : 14 + 50 * w.slip);
          while (w.puff >= 1) {
            w.puff -= 1;
            const p = wheelsAt[Math.random() < 0.5 ? 0 : 1];
            smoke.push({ x: p.x, y: p.y, age: 0, life: 0.8 + Math.random() * 0.6, size: 1.8 + Math.random() * 1.2,
              vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6 });
          }
        }
        for (const p of smoke) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; }
        smoke = smoke.filter((p) => p.age < p.life);
        if (smoke.length > SMOKE_MAX) smoke.splice(0, smoke.length - SMOKE_MAX);
        for (const p of sparks) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.up += p.vz * dt; p.vz -= 60 * dt; }
        sparks = sparks.filter((p) => p.age < p.life && p.up > 0);
        if (sparks.length > SPARK_MAX) sparks.splice(0, sparks.length - SPARK_MAX);
      }

      function drawSmoke(cam) {
        for (const p of smoke) {
          const pt = M7.project(cam, p.x, p.y);
          if (!pt || pt.z < NEAR_Z || pt.z > TAG_MAX_Z) continue;
          const t = p.age / p.life;
          const r = (p.size + t * 5) * pt.scale;
          const cy = pt.y - (1.5 + t * 10) * pt.scale; // the puff rises as it spreads
          if (r < 0.5 || pt.x + r < 0 || pt.x - r > VIEW_W || cy + r < 0 || cy - r > VIEW_H) continue;
          g.fillStyle = `rgba(236,236,232,${(0.5 * (1 - t)).toFixed(3)})`;
          g.beginPath(); g.arc(pt.x, cy, r, 0, Math.PI * 2); g.fill();
        }
        for (const p of sparks) {
          const pt = M7.project(cam, p.x, p.y);
          if (!pt || pt.z < NEAR_Z || pt.z > TAG_MAX_Z) continue;
          const sz = Math.max(1, p.size * pt.scale * (1 - (p.age / p.life) * 0.5));
          const sy = pt.y - p.up * pt.scale;
          if (pt.x + sz < 0 || pt.x - sz > VIEW_W || sy + sz < 0 || sy - sz > VIEW_H) continue;
          g.fillStyle = p.color;
          g.fillRect(pt.x - sz / 2, sy - sz / 2, sz, sz);
        }
      }

      let shownSpeed = -1;
      let shownBars = -1;
      let shownDrift = -1;
      function updateSpeed(me) {
        const mph = Math.round(Math.abs(me.v || 0) * MPH_PER_UNIT); // 45 at the road's top speed
        if (mph !== shownSpeed) { shownSpeed = mph; speedNum.textContent = String(mph); }
        boostGlow.classList.toggle('on', !!me.b);
        const lv = me.dr ? Math.abs(me.dr) - 1 : -1;
        if (lv !== shownDrift) {
          shownDrift = lv;
          hudDrift.className = `gk-drift${lv >= 0 ? ' on' : ''}${lv > 0 ? ` l${lv}` : ''}`;
          hudDrift.textContent = lv === 2 ? 'DRIFT ★★' : lv === 1 ? 'DRIFT ★' : 'DRIFT';
        }
        // Current lap time, ticking.
        if (running && !me.f && lapStartedAt && hudLapTime.firstChild) {
          hudLapTime.firstChild.textContent = stopwatch(performance.now() - lapStartedAt);
        }
        const lit = Math.round(Math.min(1, Math.abs(me.v || 0) / CAM.refSpeed) * SPEED_BARS);
        if (lit !== shownBars) {
          shownBars = lit;
          [...bars.children].forEach((b, i) => b.classList.toggle('on', i < lit));
        }
      }

      // Direction of the track at distance s along the centreline.
      function trackDirAt(s) {
        const { TRACK } = T;
        let i = 0;
        while (i < TRACK.seg.length - 1 && TRACK.cum[i + 1] <= s) i++;
        const sg = TRACK.seg[i];
        return { x: sg.dx / sg.len, y: sg.dy / sg.len };
      }

      function updateHud() {
        const me = karts.get(ctx.youId);
        const left = Math.max(0, Math.ceil((raceEndsAt - Date.now()) / 1000));
        hudTime.textContent = running ? clock(left) : '';
        hudTime.classList.toggle('low', running && left <= 15);
        if (!me) return;
        const ordered = [...karts.values()].filter((k) => k.active).sort((a, b) => b.progress - a.progress);
        const pos = ordered.indexOf(me) + 1;
        hudPlace.textContent = '';
        if (pos) {
          hudPlace.style.setProperty('--pc', pos === 1 ? '#f5b82e' : '#fff');
          hudPlace.append(h('b', {}, ordinal(pos)), h('small', {}, `/ ${ordered.length}`));
        }
        const lap = Math.min(me.lap + 1, laps);
        hudLap.textContent = me.f ? 'FINISHED' : `LAP ${lap}/${laps}`;
        hudLap.classList.toggle('final', !me.f && lap === laps && laps > 1);

        // Wrong way: facing against the track for half a second while moving.
        // Uses the newest snapshot, not the drawn position, so it works even when frames stall.
        const at = me.buf[me.buf.length - 1];
        if (running && !me.f && at && Math.abs(me.v || 0) > 30) {
          const dir = trackDirAt(T.nearest(at.x, at.y).s);
          const dot = Math.cos(at.h) * dir.x + Math.sin(at.h) * dir.y;
          wrongWayChecks = dot < -0.25 ? wrongWayChecks + 1 : 0;
        } else wrongWayChecks = 0;
        if (wrongWayChecks >= 2 && bannerKind !== 'warn') banner('WRONG WAY', { kind: 'warn' });
        else if (wrongWayChecks < 2 && bannerKind === 'warn') banner('');
      }

      // Announces each new lap for you: "LAP 2", then "FINAL LAP!".
      function checkLap(me) {
        if (!running || me.f || me.lap <= myLap) return;
        myLap = me.lap;
        if (myLap >= laps) return;
        const final = myLap + 1 === laps;
        if (bannerKind !== 'warn') banner(final ? 'FINAL LAP!' : `LAP ${myLap + 1}`, { ms: 1800 });
      }

      const hudTimer = setInterval(() => { if (running) updateHud(); }, 250);

      function updateSnapshot(list) {
        const now = performance.now();
        for (const s of list) {
          const k = karts.get(s.id);
          if (!k) continue;
          k.buf.push({ at: now, x: s.x, y: s.y, h: s.h });
          while (k.buf.length > 2 && k.buf[0].at < now - BUFFER_MS) k.buf.shift();
          if (!k.inited) { k.shown = { x: s.x, y: s.y, h: s.h }; k.inited = true; }
          k.lap = s.lap;
          k.progress = s.p; // distance along the track (unwrapped), used for place ordering
          k.v = s.v;
          k.f = s.f;
          k.o = s.o;
          k.dr = s.dr || 0;
          k.b = s.b || 0;
          k.active = !!s.active;
          if (s.id === ctx.youId) checkLap(k);
          const c = cards.get(s.id);
          if (c) {
            c.card.classList.toggle('out', !k.active);
            c.place.textContent = k.f ? 'Finished' : (s.o ? 'Off road' : `Lap ${Math.min(s.lap + 1, laps)}/${laps}`);
          }
        }
      }

      function handle(m) {
        switch (m.type) {
          case 'go': {
            laps = m.laps;
            buildTrackImages();
            // Every kart on the grid: the ninjas in this match plus any CPU racers the server added.
            const playerById = new Map(ctx.players.map((p) => [p.id, p]));
            tagLayer.textContent = '';
            karts = new Map();
            for (const info of m.karts) {
              const p = playerById.get(info.id);
              if (!p && !info.cpu) continue;
              const color = info.color || '#999';
              const name = p ? p.name : String(info.name || 'CPU');
              const band = info.cpu ? (info.band || '#ecf0f1') : ((p.loadout && p.loadout.headband) || '#e8453c');
              const tag = h('div', { class: 'gk-tag', hidden: true, style: `--kc: ${color}` }, name);
              tagLayer.append(tag);
              karts.set(info.id, { color, cpu: !!info.cpu, sheet: SP.makeKartSheet(color, band), tag, active: true, lap: 0, progress: 0, shown: { x: 0, y: 0, h: 0 }, buf: [] });
              if (info.cpu && !cards.has(info.id)) addCpuCard({ id: info.id, name, color });
            }
            running = true;
            raceEndsAt = Date.now() + m.timeMs;
            myLap = 0;
            lapStartedAt = performance.now();
            bestLapMs = 0;
            pbNote = pb.lap ? `PB ${stopwatch(pb.lap)}` : '';
            renderLapPanel();
            hudSpeed.hidden = false;
            banner('GO!', { ms: 1200 });
            updateHud();
            break;
          }
          case 'state':
            if (!tex) break;
            updateSnapshot(m.karts);
            break;
          case 'lap': {
            // Your lap is done: the server's time is the official one.
            const ms = Number(m.ms) || 0;
            lapStartedAt = performance.now();
            if (!bestLapMs || ms < bestLapMs) bestLapMs = ms;
            const newPb = ms > 0 && (!pb.lap || ms < pb.lap);
            if (newPb) {
              pb = { ...loadPb(), lap: ms };
              savePb(pb);
            }
            pbNote = newPb ? `NEW BEST ${stopwatch(ms)}` : (pb.lap ? `PB ${stopwatch(pb.lap)}` : '');
            renderLapPanel(newPb);
            // Lap banners ("LAP 2", "FINAL LAP!") come from the snapshot; add the best-lap news to them.
            if (newPb && Number(m.lap) < laps && bannerKind !== 'warn') {
              later(1900, () => { if (running && bannerKind !== 'warn') banner(`NEW BEST LAP!<small>${stopwatch(ms)}</small>`, { ms: 1600 }); });
            }
            break;
          }
          case 'boost':
            if (bannerKind !== 'warn' && m.from === 'drift') banner(m.level === 2 ? 'SUPER TURBO!' : 'TURBO!', { ms: 600 });
            break;
          case 'finish': {
            // The race can end in the same step (solo), before another snapshot says so.
            const fk = karts.get(m.id);
            if (fk) { fk.f = 1; fk.dr = 0; fk.b = 0; }
            if (m.id === ctx.youId) {
              finishedMe = true;
              const timeMs = Number(m.timeMs) || 0;
              const key = `race${laps}`;
              const record = timeMs > 0 && (!pb[key] || timeMs < pb[key]);
              const prev = pb[key];
              if (record) { pb = { ...loadPb(), [key]: timeMs }; savePb(pb); }
              const line = record
                ? `NEW RECORD ${stopwatch(timeMs)}${prev ? ` (was ${stopwatch(prev)})` : ''}`
                : `${stopwatch(timeMs)}${prev ? ` · record ${stopwatch(prev)}` : ''}`;
              banner(`FINISH!<small>${ordinal(Number(m.place) || 0)} place</small><small>${line}</small>`);
              if (hudLapTime.firstChild) hudLapTime.firstChild.textContent = stopwatch(timeMs);
              sendControls();
              updateHud();
            } else {
              const c = cards.get(m.id);
              if (c) c.place.textContent = `Finished #${m.place}`;
            }
            break;
          }
          default:
        }
      }

      let disposed = false;
      loadHelpers().then(() => {
        if (disposed) return;
        T = window.ClubDojoKartTrack;
        M7 = window.ClubDojoMode7;
        SP = window.ClubDojoKartSprites;
        SC = window.ClubDojoKartScenery;
        ready = true;
        fitView();
        // Older snapshots are stale by now; keep only the newest one.
        const lastState = pending.map((m) => m.type).lastIndexOf('state');
        pending.splice(0).forEach((m, i) => { if (m.type !== 'state' || i === lastState) handle(m); });
        frame = requestAnimationFrame(render);
      }).catch((e) => { if (!disposed) status.textContent = e.message; });

      return {
        onMessage(m) {
          if (ready) handle(m);
          else pending.push(m);
        },
        onResults() {
          running = false;
        },
        unmount() {
          running = false;
          disposed = true;
          cancelAnimationFrame(frame);
          clearInterval(hudTimer);
          if (resizer) resizer.disconnect();
          document.removeEventListener('keydown', onKeyDown);
          document.removeEventListener('keyup', onKeyUp);
          for (const t of timers) clearTimeout(t);
          timers.clear();
        },
      };
    },
  });
})();
