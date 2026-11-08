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
    behind: 62, behindFast: 82, height: 24, heightFast: 28, focal: 236, focalFast: 204, horizon: 84,
    turnFollow: 9,   // how fast the camera swings round behind the kart (per second, exponential)
    speedFollow: 3,  // how fast the speed effects catch up
    refSpeed: 330,   // the server's default top speed on the road
    shake: 0.9,      // off-road rumble in screen pixels at full speed
  };
  const COLORS = { grass: '#3f8a3a', grass2: '#367d33', verge: '#7a9a3c', road: '#5b5f68', kerbA: '#e8453c', kerbB: '#f3efe2', wall: '#b9b1a0', sky1: '#4a98dc', sky2: '#bfe3f7' };
  const PROP_FAR_Z = 1300; // props further than this are skipped (tiny, and under the haze)
  const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

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
      const hudSpeed = h('div', { class: 'gk-speed' }, speedNum, h('small', {}, 'km/h'), bars);
      const status = h('div', { class: 'gk-banner' }, 'Get ready...');
      const hud = h('div', { class: 'gk-hud' }, hudPlace, hudLap, hudTime, hudSpeed, status);
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
      const canvas = h('canvas', { class: 'gk-canvas', width: VIEW_W, height: VIEW_H });
      const g = canvas.getContext('2d');
      const mapCanvas = h('canvas', { class: 'gk-map', width: 250, height: 160 });
      const mg = mapCanvas.getContext('2d');
      // Name tags are DOM, not canvas, so they stay sharp over the scaled-up pixel view.
      const tagLayer = h('div', { class: 'gk-tags' });
      const view = h('div', { class: 'gk-view' }, canvas, tagLayer, mapCanvas, hud);
      const stage = h('div', { class: 'gk-stage' }, view);
      const playersRow = h('div', { class: 'gk-players' });
      const help = h('div', { class: 'gk-help' }, 'Drive: Arrow keys or WASD. Up / W gas, Down / S brake, Left and Right to steer.');
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
      const cards = new Map();
      for (const p of ctx.players) {
        const place = h('small', {}, '—');
        const card = h('div', { class: 'gk-p' }, avatar.portrait(p.loadout, 48), h('b', {}, p.id === ctx.youId ? `${p.name} (you)` : p.name), place);
        cards.set(p.id, { card, place });
        playersRow.append(card);
      }

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
      const keys = { up: false, down: false, left: false, right: false };
      let lastSent = '';

      function sendControls() {
        const c = {
          steer: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
          gas: keys.up,
          brake: keys.down,
        };
        const sig = `${c.steer}|${c.gas}|${c.brake}`;
        if (sig === lastSent) return;
        lastSent = sig;
        ctx.send({ type: 'ctl', ...c });
      }

      const KEYMAP = {
        ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
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
          const frame = SP.frameFor(wrapAngle(k.shown.h - toKart));
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
        const sp = camShown.speed;
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
        M7.renderFloor(cam, floor32, tex, grassPx);
        const top = Math.max(0, Math.floor(cam.horizon));
        g.putImageData(floor, 0, 0, 0, top, VIEW_W, VIEW_H - top);
        drawSky(cam);

        drawWorld(cam);
        drawMinimap();
        updateSpeed(me);
      }

      let shownSpeed = -1;
      let shownBars = -1;
      function updateSpeed(me) {
        const kmh = Math.round(Math.abs(me.v || 0) * 0.36); // about 120 at the road's top speed
        if (kmh !== shownSpeed) { shownSpeed = kmh; speedNum.textContent = String(kmh); }
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
            const colorById = new Map(m.karts.map((k) => [k.id, k.color]));
            tagLayer.textContent = '';
            karts = new Map(ctx.players.map((p) => {
              const color = colorById.get(p.id) || '#999';
              const band = (p.loadout && p.loadout.headband) || '#e8453c';
              const tag = h('div', { class: 'gk-tag', hidden: true, style: `--kc: ${color}` }, p.name);
              tagLayer.append(tag);
              return [p.id, { color, sheet: SP.makeKartSheet(color, band), tag, active: true, lap: 0, progress: 0, shown: { x: 0, y: 0, h: 0 }, buf: [] }];
            }));
            running = true;
            raceEndsAt = Date.now() + m.timeMs;
            myLap = 0;
            hudSpeed.hidden = false;
            banner('GO!', { ms: 1200 });
            updateHud();
            break;
          }
          case 'state':
            if (!tex) break;
            updateSnapshot(m.karts);
            break;
          case 'finish':
            if (m.id === ctx.youId) {
              finishedMe = true;
              banner(`FINISH!<small>${ordinal(Number(m.place) || 0)} place</small>`);
              sendControls();
              updateHud();
            } else {
              const c = cards.get(m.id);
              if (c) c.place.textContent = `Finished #${m.place}`;
            }
            break;
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
