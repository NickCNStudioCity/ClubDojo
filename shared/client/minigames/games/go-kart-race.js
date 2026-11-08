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
      helpers = Promise.all([one('track.js', 'ClubDojoKartTrack'), one('mode7.js', 'ClubDojoMode7')])
        .catch((e) => { helpers = null; throw e; });
    }
    return helpers;
  }

  // Internal render size. The canvas is scaled up with crisp pixels, like the original.
  const VIEW_W = 400;
  const VIEW_H = 240;
  const TEX_SCALE = 2;            // texels per world unit in the track image
  const TEX_PAD = 100;            // world units of grass around the world in the track image
  const CAM = { behind: 72, height: 26, focal: 230, horizon: 84 };
  const COLORS = { grass: '#3f8a3a', grass2: '#367d33', verge: '#7a9a3c', road: '#5b5f68', kerbA: '#e8453c', kerbB: '#f3efe2', wall: '#b9b1a0', sky1: '#5aa7e6', sky2: '#bfe3f7' };

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
        .gk-hud { display: flex; gap: 18px; font-family: var(--display); font-size: 20px; letter-spacing: .04em; justify-content: center; }
        .gk-status { font-family: var(--display); font-size: 26px; min-height: 32px; text-align: center; }
        .gk-stage { position: relative; width: min(900px, 100%); flex: 1 1 auto; min-height: 0; display: flex; justify-content: center; align-items: center; }
        .gk-view { position: relative; width: 100%; aspect-ratio: ${VIEW_W} / ${VIEW_H}; }
        .gk-canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; border-radius: 12px; box-shadow: 0 6px 0 rgba(0,0,0,.35); background: ${COLORS.grass}; }
        .gk-map { position: absolute; right: 2%; top: 3%; width: 24%; aspect-ratio: 1000 / 640; opacity: .9; border-radius: 6px; background: rgba(0,0,0,.25); }
        .gk-help { font-size: 12px; opacity: .75; text-align: center; }
      `);

      const status = h('div', { class: 'gk-status' }, 'Get ready...');
      const hud = h('div', { class: 'gk-hud' });
      const canvas = h('canvas', { class: 'gk-canvas', width: VIEW_W, height: VIEW_H });
      const g = canvas.getContext('2d');
      const mapCanvas = h('canvas', { class: 'gk-map', width: 250, height: 160 });
      const mg = mapCanvas.getContext('2d');
      const view = h('div', { class: 'gk-view' }, canvas, mapCanvas);
      const stage = h('div', { class: 'gk-stage' }, view);
      const playersRow = h('div', { class: 'gk-players' });
      const help = h('div', { class: 'gk-help' }, 'Drive: Arrow keys or WASD. Up / W gas, Down / S brake, Left and Right to steer.');
      el.append(style, h('div', { class: 'gk' }, playersRow, hud, status, stage, help));

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
      const camShown = { x: 0, y: 0, h: 0, inited: false };

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
        grassPx = tex.data[0]; // top-left corner is plain grass

        mapLayer = document.createElement('canvas');
        mapLayer.width = mapCanvas.width; mapLayer.height = mapCanvas.height;
        paintTrack(mapLayer.getContext('2d'), mapCanvas.width / WORLD.w, false);

        floor = g.createImageData(VIEW_W, VIEW_H);
        floor32 = new Uint32Array(floor.data.buffer);
      }

      // Placeholder kart, seen from behind, with its contact point on the road at (x, y).
      function drawKartSprite(x, y, scale, color, band) {
        const w = 22 * scale, hgt = 13 * scale; // world units, matching the server's 12-unit kart radius
        g.fillStyle = 'rgba(0,0,0,.3)';
        g.beginPath(); g.ellipse(x, y, w * 0.6, hgt * 0.22, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#111';
        g.fillRect(x - w / 2, y - hgt * 0.45, w * 0.22, hgt * 0.45);
        g.fillRect(x + w / 2 - w * 0.22, y - hgt * 0.45, w * 0.22, hgt * 0.45);
        g.fillStyle = color;
        g.fillRect(x - w * 0.32, y - hgt * 0.75, w * 0.64, hgt * 0.55);
        // Driver: dark head with a headband stripe.
        g.fillStyle = '#20262e';
        g.beginPath(); g.arc(x, y - hgt * 0.95, hgt * 0.32, 0, Math.PI * 2); g.fill();
        g.fillStyle = band;
        g.fillRect(x - hgt * 0.32, y - hgt * 1.02, hgt * 0.64, Math.max(1, hgt * 0.12));
      }

      function drawSky() {
        const grad = g.createLinearGradient(0, 0, 0, CAM.horizon);
        grad.addColorStop(0, COLORS.sky1);
        grad.addColorStop(1, COLORS.sky2);
        g.fillStyle = grad;
        g.fillRect(0, 0, VIEW_W, Math.ceil(CAM.horizon));
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
        // Chase camera: sits behind the kart and turns a little later than it, so steering is visible.
        if (!camShown.inited) { Object.assign(camShown, me.shown); camShown.inited = true; }
        camShown.h += wrapAngle(me.shown.h - camShown.h) * 0.18;
        camShown.x = me.shown.x;
        camShown.y = me.shown.y;
        const cam = M7.camera({
          x: camShown.x - Math.cos(camShown.h) * CAM.behind,
          y: camShown.y - Math.sin(camShown.h) * CAM.behind,
          h: camShown.h, height: CAM.height, focal: CAM.focal, horizon: CAM.horizon, width: VIEW_W, rows: VIEW_H,
        });
        M7.renderFloor(cam, floor32, tex, grassPx);
        const top = Math.max(0, Math.floor(CAM.horizon));
        g.putImageData(floor, 0, 0, 0, top, VIEW_W, VIEW_H - top);
        drawSky();

        // Local kart only (other karts come in milestone 3; they show on the minimap for now).
        const pt = M7.project(cam, me.shown.x, me.shown.y);
        if (pt) {
          const player = ctx.players.find((p) => p.id === ctx.youId);
          const band = (player && player.loadout && player.loadout.headband) || '#e8453c';
          drawKartSprite(pt.x, pt.y, pt.scale, me.color, band);
        }
        drawMinimap();
      }

      function updateHud() {
        const left = Math.max(0, Math.ceil((raceEndsAt - Date.now()) / 1000));
        const me = karts.get(ctx.youId);
        const ordered = [...karts.values()].filter((k) => k.active).sort((a, b) => b.progress - a.progress);
        const pos = me ? ordered.indexOf(me) + 1 : 0;
        hud.textContent = '';
        hud.append(
          h('span', {}, me ? `Lap ${Math.min(me.lap + 1, laps)}/${laps}` : ''),
          h('span', {}, pos ? `Place ${pos}/${ordered.length}` : ''),
          h('span', {}, running ? `${left}s` : ''),
        );
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
            karts = new Map(ctx.players.map((p) => [p.id, { color: colorById.get(p.id) || '#999', active: true, lap: 0, progress: 0, shown: { x: 0, y: 0, h: 0 }, buf: [] }]));
            running = true;
            raceEndsAt = Date.now() + m.timeMs;
            status.textContent = 'GO!';
            later(1200, () => { if (running) status.textContent = ''; });
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
              status.textContent = `Finished! Place ${m.place}`;
              sendControls();
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
