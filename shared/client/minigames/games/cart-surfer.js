// Cart Surfer (client). Server rules: server/src/minigames/games/cart-surfer.js
// You ride a mine cart down a lantern-lit tunnel, seen from behind. Your own ninja (gi, headband,
// belt and back accessory) sits in the cart. Left / right switch rails, up / space jumps a boulder,
// down ducks under a low beam (keys, on-screen buttons or swipes). The server decides coins,
// crashes, lives and distance; this file draws the tunnel and sends inputs. A local mission ladder
// and personal best (browser storage, cosmetic only) give each run something extra to chase.
ClubDojoMinigames.register({
  id: 'cart-surfer',
  ownEnding: true,
  guide: {
    summary: 'Ride the mine cart as far as you can. You have three carts, and every crash costs one.',
    controls: [['← → or A / D', 'Switch rails'], ['↑, W or Space', 'Jump over a boulder'], ['↓ or S', 'Duck under a low beam'], ['Touch', 'Swipe in any direction, or use the buttons']],
    tips: ['Coins in a row build your multiplier, and a crash resets it.', 'A magnet pulls in coins from every rail. A lantern shield takes one crash for you.', 'It keeps getting faster, so look ahead and pick your rail early.'],
  },

  mount(ctx) {
    const { h, el } = ctx;
    const P = ctx.protocol || window.ClubDojoProtocol;
    let W = 800; // logical width follows the screen's shape; the height stays fixed
    const H = 450;
    let scale = 1;
    const HZ = H * 0.3; // horizon: the far end of the tunnel
    const CAMH = H * 0.62; // camera height in pixels; the floor at depth 0 sits at HZ + CAMH
    const FOCAL = 170; // perspective strength
    const NEAR = -60; // nearest depth drawn (just behind the cart)
    const VIEW = 760; // farthest depth drawn, in track units
    const WALL = 420; // tunnel half-width
    const CEIL = 380; // tunnel ceiling height
    const LANE_X = 170; // lane spacing at depth 0
    const RAIL = 26; // half the gap between the two rails of a lane
    const BEAM_GAP = 110; // wooden support frames along the tunnel
    const SLEEP_GAP = 40; // sleepers on the track
    const DISTANCE_PER_POINT = 100; // matches the server's scoring
    const STREAK_STEP = 8; // matches the server's multiplier steps
    const JUMP_H = 88; // how high a jump lifts the cart
    const FOG = [10, 9, 16];
    const STORE_KEY = 'clubdojo.cartSurfer.v1';

    let camX = 0; // the camera drifts toward your rail
    const scaleAt = (d) => FOCAL / (FOCAL + d);
    // 3D point (sideways X, height Y, depth d) to screen [x, y]
    const project = (X, Y, d) => {
      const sc = scaleAt(d);
      return [W / 2 + (X - camX) * sc, HZ + (CAMH - Y) * sc];
    };
    const fogAt = (d) => Math.max(0, Math.min(1, d / VIEW)) ** 1.3 * 0.92;
    // Fog colours are worked out once per colour and fog step, not for every shape on every frame.
    const shadeCache = new Map();
    const shade = (rgb, d, lit = 0) => {
      const step = Math.round(fogAt(d) * 40);
      const key = (((rgb[0] | 0) << 16) | ((rgb[1] | 0) << 8) | (rgb[2] | 0)) * 1024 + step * 8 + Math.round(lit * 10);
      let out = shadeCache.get(key);
      if (!out) {
        const f = step / 40;
        const c = rgb.map((v, i) => Math.round(Math.min(255, v * (1 + lit)) * (1 - f) + FOG[i] * f));
        out = `rgb(${c[0]},${c[1]},${c[2]})`;
        if (shadeCache.size > 6000) shadeCache.clear();
        shadeCache.set(key, out);
      }
      return out;
    };
    const hash = (n) => { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

    // ---- local progress: personal best and the mission ladder (cosmetic, this browser only) ----
    const MISSIONS = [
      { id: 'coins', text: (n) => `Collect ${n} coins in one run`, n: 25 },
      { id: 'hops', text: (n) => `Jump over ${n} boulders`, n: 3 },
      { id: 'mult', text: (n) => `Reach a x${n} coin multiplier`, n: 2, fixed: true },
      { id: 'ducks', text: (n) => `Duck under ${n} low beams`, n: 2 },
      { id: 'gems', text: (n) => `Grab ${n} gem${n > 1 ? 's' : ''}`, n: 1 },
      { id: 'metres', text: (n) => `Ride ${n} m in one run`, n: 220 },
      { id: 'saves', text: () => 'Let a lantern shield save you', n: 1, fixed: true },
      { id: 'mult', text: (n) => `Reach a x${n} coin multiplier`, n: 3, fixed: true },
      { id: 'hops', text: (n) => `Jump over ${n} boulders`, n: 8 },
      { id: 'clean', text: () => 'Reach the finish without crashing', n: 1, fixed: true },
    ];
    const RANKS = [[0, 'Rookie Rider'], [2, 'Rail Runner'], [5, 'Tunnel Rat'], [9, 'Ore Hunter'], [14, 'Cave Surfer'], [20, 'Mine Master']];
    function loadStore() {
      try { return { best: 0, bestDist: 0, done: 0, runs: 0, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { return { best: 0, bestDist: 0, done: 0, runs: 0 }; }
    }
    function saveStore() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* storage blocked: progress just isn't kept */ } }
    const store = loadStore();
    function currentMission() {
      const m = MISSIONS[store.done % MISSIONS.length];
      const lap = Math.floor(store.done / MISSIONS.length); // later laps ask for more
      const n = m.fixed ? m.n : Math.round(m.n * (1 + lap * 0.5));
      return { ...m, n, label: m.text(n) };
    }
    const rankName = () => RANKS.filter(([at]) => store.done >= at).pop()[1];
    let mission = currentMission();
    let missionDone = false;
    const run = { coins: 0, hops: 0, ducks: 0, gems: 0, mult: 1, saves: 0, crashes: 0, finished: false };
    function missionValue() {
      switch (mission.id) {
        case 'metres': return Math.floor(Math.min(myY(), track ? track.length : Infinity) / 10);
        case 'clean': return run.finished && run.crashes === 0 ? 1 : 0;
        default: return run[mission.id] || 0;
      }
    }

    const style = h('style', {}, `
      .cs { position: absolute; inset: 0; overflow: hidden; background: #0b0a12; }
      .cs-canvas { user-select: none; touch-action: none; }
      .cs-info { position: absolute; left: 1.5%; top: 28%; max-width: 30%; display: flex; flex-direction: column; gap: 4px; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.9); pointer-events: none; z-index: 1; }
      .cs-touch { position: absolute; right: 12px; bottom: 34px; display: flex; gap: 10px; z-index: 1; }
      .cs-touch .btn { min-width: 64px; font-size: 20px; }
      @media (hover: hover) and (pointer: fine) { .cs-touch { display: none; } }
      .cs-status { font-family: var(--display); font-size: 18px; }
      .cs-mission { font-size: 13px; opacity: .9; }
      .cs-mission b { color: #ffd23f; }
    `);

    const canvas = h('canvas', { class: 'cs-canvas', width: W, height: H });
    const status = h('div', { class: 'cs-status' }, 'Get ready to ride!');
    const missionEl = h('div', { class: 'cs-mission' });
    const btn = (label, title, fn) => h('button', { class: 'btn', title, onclick: fn }, label);
    el.append(style, h('div', { class: 'cs' },
      canvas, h('div', { class: 'cs-info' }, status, missionEl),
      h('div', { class: 'cs-touch' },
        btn('◀', 'Left rail', () => move(-1)), btn('▲', 'Jump', jump), btn('▼', 'Duck', duck), btn('▶', 'Right rail', () => move(1)))));
    const g = canvas.getContext('2d', { alpha: false }); // the tunnel is opaque, so the browser can skip blending it

    // Glows are painted once and stamped, which is far cheaper than new gradients every frame.
    function makeGlow(stops) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const x = c.getContext('2d');
      const gr = x.createRadialGradient(64, 64, 1, 64, 64, 64);
      for (const [at, col] of stops) gr.addColorStop(at, col);
      x.fillStyle = gr;
      x.fillRect(0, 0, 128, 128);
      return c;
    }
    const lampGlow = makeGlow([[0, 'rgba(255,190,90,1)'], [0.35, 'rgba(255,150,60,.3)'], [1, 'rgba(255,130,40,0)']]);
    const floorGlow = makeGlow([[0, 'rgba(255,170,80,1)'], [1, 'rgba(255,170,80,0)']]);
    const railShine = g.createLinearGradient(0, H, 0, HZ);
    railShine.addColorStop(0, '#e8eef4');
    railShine.addColorStop(1, 'rgba(160,170,190,0.05)');
    let farDark = null;
    ctx.fit(canvas, 800, H, (f) => {
      W = f.w; scale = f.scale;
      farDark = g.createRadialGradient(W / 2, HZ, 4, W / 2, HZ, 190);
      farDark.addColorStop(0, 'rgba(4,4,10,0.95)');
      farDark.addColorStop(1, 'rgba(4,4,10,0)');
    }, { fixedHeight: true, minW: 560, maxScale: 1.25 });

    const loadouts = new Map(ctx.players.map((p) => [String(p.id), p.loadout]));
    const names = new Map(ctx.players.map((p) => [String(p.id), p.name]));
    const meKey = String(ctx.youId);
    let portrait = null;
    try { if (loadouts.get(meKey) && ctx.avatar.portrait) portrait = ctx.avatar.portrait(loadouts.get(meKey), 60); } catch { portrait = null; }

    let track = null; // { length, roundMs, lives, jumpMs, duckMs, items }
    let roundEnd = 0;
    let maxLives = 3;
    // id -> { lane, y, finished, stunned, coins, lives, pose, mult, shield, magnet } as last sent by the server
    let players = {};
    let shown = {}; // id -> { lane, y, airStart, duckUntil, lastPose } smoothed for drawing
    let got = new Set(); // pickups you have collected
    let flying = []; // coins pulled toward your cart: { lane, d, kind, born }
    let popups = []; // { text, color, x, y, born, big }
    let parts = []; // screen-space particles
    let myCoins = 0;
    let myLives = 3;
    let myMult = 1;
    let myStreak = 0;
    let myShield = false;
    let myMagnetEnd = 0;
    let shake = 0;
    let flash = 0; // red crash flash, 0..1
    let banner = null; // { text, color, born }
    let over = false;
    let out = false;
    let raf = 0;
    let unmounted = false;
    let lastFrame = performance.now();
    let lanePredictUntil = 0; // your own rail changes show at once; server updates can't undo them until this time
    let itemStart = 0; // track items behind the camera are skipped
    let missionKey = '';
    const myY = () => (shown[meKey] ? shown[meKey].y : 0);

    function updateMission() {
      if (!missionDone && missionValue() >= mission.n) {
        missionDone = true;
        store.done++;
        saveStore();
        bannerShow('Mission complete!', '#7dffb0');
        popup('Mission complete!', '#7dffb0', W / 2, 250, true);
      }
      const v = Math.min(mission.n, missionValue());
      const key = `${missionDone}|${mission.label}|${v}|${store.best}`;
      if (key === missionKey) return; // only touch the page when the text changes
      missionKey = key;
      missionEl.replaceChildren(
        h('span', {}, missionDone ? '✔ ' : 'Mission: '), h('b', {}, mission.label), missionDone ? '' : ` (${v}/${mission.n})`,
        h('span', {}, ` · Rank: ${rankName()}`),
        store.best ? h('span', {}, ` · Best: ${store.best}`) : '');
    }
    updateMission();

    // ---- input ----
    function canAct() { return !over && !out && track && !(players[meKey] && players[meKey].finished); }
    function move(dir) {
      if (!canAct()) return;
      const st = players[meKey];
      if (st) { st.lane = Math.max(-1, Math.min(1, st.lane + dir)); lanePredictUntil = performance.now() + 180; }
      ctx.send({ type: 'move', dir });
    }
    function jump() {
      if (!canAct()) return;
      const me = shown[meKey];
      const now = performance.now();
      if (me && !(players[meKey] && players[meKey].stunned) && !airborne(me, now)) { me.airStart = now; me.duckUntil = 0; }
      ctx.send({ type: 'jump' });
    }
    function duck() {
      if (!canAct()) return;
      const me = shown[meKey];
      const now = performance.now();
      if (me && !(players[meKey] && players[meKey].stunned)) { me.airStart = 0; me.duckUntil = now + (track.duckMs || 720); }
      ctx.send({ type: 'duck' });
    }
    function onKey(e) {
      if (e.repeat) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); move(-1); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); move(1); }
      else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') { e.preventDefault(); jump(); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); duck(); }
    }
    window.addEventListener('keydown', onKey);
    let swipe = null;
    canvas.addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', (e) => {
      if (!swipe) return;
      const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
      swipe = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 1 : -1);
      else if (dy < 0) jump();
      else duck();
    });

    const airborne = (o, now) => o.airStart && now - o.airStart < ((track && track.jumpMs) || 620);
    const jumpHeight = (o, now) => {
      if (!airborne(o, now)) return 0;
      const p = (now - o.airStart) / ((track && track.jumpMs) || 620);
      return Math.sin(Math.PI * p) * JUMP_H;
    };

    // Server snapshot: id -> [lane, y, finished, stunned, coins, lives, pose, mult, shield, magnet tenths, speed]
    function applyPlayers(snapshot) {
      const now = performance.now();
      for (const id of Object.keys(snapshot)) {
        const [srvLane, y, finished, stunned, coins, lives, pose = 0, mult = 1, shield = 0, magnet = 0, v = 0] = snapshot[id];
        const lane = id === meKey && players[id] && now < lanePredictUntil ? players[id].lane : srvLane;
        players[id] = { lane, y, finished: !!finished, stunned: !!stunned, coins, lives, pose, mult, shield: !!shield, magnet, v, at: now };
        const o = shown[id];
        if (o && pose !== o.lastPose) { // pose changes start the animation for riders we did not predict
          if (pose === 1 && !airborne(o, now)) o.airStart = now;
          if (pose === 2 && o.duckUntil < now) o.duckUntil = now + ((track && track.duckMs) || 720) * 0.8;
          o.lastPose = pose;
        }
        if (id === meKey) {
          myCoins = coins; myLives = lives; myMult = mult; myShield = !!shield;
          if (magnet) myMagnetEnd = now + magnet * 100; else myMagnetEnd = 0;
        }
      }
      for (const id of Object.keys(players)) if (!snapshot[id]) delete players[id];
    }

    function popup(text, color, x, y, big = false) { popups.push({ text, color, x, y, born: performance.now(), big }); }
    function bannerShow(text, color) { banner = { text, color, born: performance.now() }; }
    function burst(x, y, n, colors, speed = 3, life = 600, grav = 0.12, size = 3) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random());
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.6, life, born: performance.now(), color: colors[i % colors.length], grav, size: size * (0.6 + Math.random() * 0.8) });
      }
    }
    function cartScreen() {
      const me = shown[meKey];
      const [x, y] = project((me ? me.lane : 0) * LANE_X, 0, 0);
      return [x, y - (me ? jumpHeight(me, performance.now()) : 0)];
    }

    // ---- drawing helpers ----
    function poly(pts, fill) {
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    }
    function rr(x, y, w, hh, r) {
      g.beginPath();
      g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r);
      g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    const flick = (seed, t) => 0.82 + 0.1 * Math.sin(t / 90 + seed * 7) + 0.08 * Math.sin(t / 37 + seed * 3);

    // A wooden support frame across the tunnel at depth d. Every other frame carries a lantern.
    function drawFrame(j, d, t) {
      const sc = scaleAt(d);
      const wood = [176, 112, 44], dark = [104, 64, 22];
      poly([project(-WALL, 300, d), project(WALL, 300, d), project(WALL, 334, d), project(-WALL, 334, d)], shade(wood, d, 0.1));
      poly([project(-WALL, 300, d), project(WALL, 300, d), project(WALL, 306, d), project(-WALL, 306, d)], shade([230, 170, 90], d));
      for (const X of [-WALL + 14, WALL - 14]) {
        const [x, yB] = project(X, 0, d);
        const [, yT] = project(X, 334, d);
        g.fillStyle = shade(wood, d);
        g.fillRect(x - 15 * sc, yT, 30 * sc, yB - yT);
        g.fillStyle = shade(dark, d);
        g.fillRect(x + (X < 0 ? 6 : -14) * sc, yT, 8 * sc, yB - yT);
      }
      if (j % 2 === 0) { // lantern hanging under the cross beam
        const side = j % 4 === 0 ? -1 : 1;
        const [lx, ly] = project(side * (WALL - 70), 262, d);
        const [, by] = project(side * (WALL - 70), 300, d);
        g.strokeStyle = shade([60, 50, 40], d);
        g.lineWidth = Math.max(1, 3 * sc);
        g.beginPath(); g.moveTo(lx, by); g.lineTo(lx, ly - 14 * sc); g.stroke();
        g.fillStyle = shade([50, 44, 40], d);
        g.fillRect(lx - 12 * sc, ly - 16 * sc, 24 * sc, 6 * sc);
        g.fillStyle = shade([255, 214, 120], d * 0.5, 0.2);
        rr(lx - 10 * sc, ly - 10 * sc, 20 * sc, 26 * sc, 5 * sc); g.fill();
      }
    }
    function lanternGlow(j, d, t) {
      if (j % 2 !== 0 || d < NEAR) return;
      const sc = scaleAt(d);
      const side = j % 4 === 0 ? -1 : 1;
      const [lx, ly] = project(side * (WALL - 70), 262, d);
      const k = flick(j, t) * (1 - fogAt(d) * 0.75);
      const r = 230 * sc;
      g.globalAlpha = 0.4 * k;
      g.drawImage(lampGlow, lx - r, ly - r, r * 2, r * 2);
      // warm pool on the floor below
      const [fx, fy] = project(side * (WALL - 130), 0, d);
      const pr = 200 * sc;
      g.globalAlpha = 0.22 * k;
      g.drawImage(floorGlow, fx - pr, fy - pr * 0.32, pr * 2, pr * 0.64);
    }

    // Crystals and ore veins on the walls; fixed per stretch of tunnel so they scroll past.
    function drawWallDecor(j, d, t) {
      for (let k = 0; k < 2; k++) {
        const r = hash(j * 3 + k);
        if (r > 0.55) continue;
        const side = hash(j * 7 + k) < 0.5 ? -1 : 1;
        const dd = d + 20 + hash(j * 11 + k) * 70;
        if (dd < NEAR + 20 || dd > VIEW) continue;
        const Y = 60 + hash(j * 13 + k) * 200;
        const sc = scaleAt(dd);
        const [x, y] = project(side * WALL, Y, dd);
        const gem = r < 0.2;
        const col = gem ? (hash(j + k) < 0.5 ? [120, 220, 255] : [200, 130, 255]) : [150, 140, 150];
        if (gem) {
          const pulse = 0.6 + 0.4 * Math.sin(t / 400 + j);
          g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.18 * pulse * (1 - fogAt(dd))})`;
          g.beginPath(); g.arc(x, y, 40 * sc, 0, Math.PI * 2); g.fill();
        }
        for (let c = 0; c < 3; c++) {
          const cx = x - side * (c * 9 - 6) * sc, s2 = (gem ? 16 : 10) * sc * (1 - c * 0.2);
          poly([[cx, y - s2 * 1.6], [cx + s2 * 0.6, y], [cx, y + s2 * 0.5], [cx - s2 * 0.6, y]], shade(col, dd, gem ? 0.2 : 0));
        }
      }
    }

    function drawTunnel(camY, t) {
      g.fillStyle = '#0b0a12';
      g.fillRect(0, 0, W, H);
      const near = NEAR, far = VIEW;

      // rock strata: each stretch between frames gets its own tone
      const segs = [];
      for (let j = Math.floor((camY + near) / BEAM_GAP); j * BEAM_GAP - camY <= far; j++) segs.push(j);
      segs.sort((a, b) => b - a);
      for (const j of segs) {
        const d0 = Math.max(near, j * BEAM_GAP - camY), d1 = Math.min(far, (j + 1) * BEAM_GAP - camY);
        if (d1 <= d0) continue;
        const v = hash(j) * 18 - 9;
        const L = [92 + v, 86 + v, 96 + v], R = [74 + v, 69 + v, 80 + v];
        const dm = (d0 + d1) / 2;
        poly([project(-WALL, CEIL, d0), project(WALL, CEIL, d0), project(WALL, CEIL, d1), project(-WALL, CEIL, d1)], shade([44 + v, 40 + v, 52 + v], dm));
        poly([project(-WALL, 0, d0), project(-WALL, CEIL, d0), project(-WALL, CEIL, d1), project(-WALL, 0, d1)], shade(L, dm));
        poly([project(WALL, 0, d0), project(WALL, CEIL, d0), project(WALL, CEIL, d1), project(WALL, 0, d1)], shade(R, dm));
        // a darker stratum band on each wall
        poly([project(-WALL, 140 + v * 3, d0), project(-WALL, 175 + v * 3, d0), project(-WALL, 175 + v * 3, d1), project(-WALL, 140 + v * 3, d1)], shade(L.map((c) => c * 0.75), dm));
        poly([project(WALL, 120 - v * 3, d0), project(WALL, 150 - v * 3, d0), project(WALL, 150 - v * 3, d1), project(WALL, 120 - v * 3, d1)], shade(R.map((c) => c * 0.75), dm));
        poly([project(-WALL, 0, d0), project(WALL, 0, d0), project(WALL, 0, d1), project(-WALL, 0, d1)], shade([84 + v, 76 + v, 70 + v], dm));
        for (const lane of [-1, 0, 1]) { // ballast bed under each track
          poly([project(lane * LANE_X - 62, 0, d0), project(lane * LANE_X + 62, 0, d0), project(lane * LANE_X + 62, 0, d1), project(lane * LANE_X - 62, 0, d1)], shade([62 + v, 56 + v, 52 + v], dm));
        }
        drawWallDecor(j, j * BEAM_GAP - camY, t);
      }

      // light at the end of the tunnel as the finish nears
      if (track) {
        const left = track.length - camY;
        if (left < VIEW + 400) {
          const k = Math.max(0, Math.min(1, 1 - (left - 100) / (VIEW + 300)));
          const [ex, ey] = project(0, CEIL * 0.45, Math.max(left, 20));
          const r = 60 + k * 260;
          const grd = g.createRadialGradient(ex, ey, 4, ex, ey, r);
          grd.addColorStop(0, `rgba(255,248,220,${0.9 * k})`);
          grd.addColorStop(1, 'rgba(255,240,200,0)');
          g.fillStyle = grd;
          g.fillRect(ex - r, ey - r, r * 2, r * 2);
        }
      }

      // sleepers, scrolling toward you
      for (let j = Math.ceil((camY + far) / SLEEP_GAP); j * SLEEP_GAP - camY >= near; j--) {
        const d = j * SLEEP_GAP - camY;
        if (d > 380 && j % 2) continue; // far sleepers are a few pixels tall: draw half of them
        for (const lane of [-1, 0, 1]) {
          poly([project(lane * LANE_X - 50, 0, d), project(lane * LANE_X + 50, 0, d), project(lane * LANE_X + 50, 0, d + 11), project(lane * LANE_X - 50, 0, d + 11)], shade([96, 66, 40], d));
        }
      }

      // rails: a dark base and a bright running edge
      for (const lane of [-1, 0, 1]) {
        for (const off of [-RAIL, RAIL]) {
          const X = lane * LANE_X + off;
          poly([project(X - 5, 0, near), project(X + 5, 0, near), project(X + 2, 0, far), project(X - 2, 0, far)], '#3b3f48');
          poly([project(X - 2, 0.5, near), project(X + 2, 0.5, near), project(X + 0.6, 0.5, far), project(X - 0.6, 0.5, far)], railShine);
        }
      }

      // support frames, far first
      const frames = [];
      for (let j = Math.ceil((camY + near) / BEAM_GAP); j * BEAM_GAP - camY <= far; j++) frames.push(j);
      frames.sort((a, b) => b - a);
      for (const j of frames) drawFrame(j, j * BEAM_GAP - camY, t);
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const j of frames) lanternGlow(j, j * BEAM_GAP - camY, t);
      g.restore();

      // the far end of the tunnel falls into shadow
      g.fillStyle = farDark;
      g.fillRect(0, 0, W, H);
    }

    function drawFinishLine(d) {
      const sc = scaleAt(d);
      for (const X of [-WALL + 40, WALL - 40]) {
        const [x, yB] = project(X, 0, d), [, yT] = project(X, 250, d);
        g.fillStyle = '#ddd'; g.fillRect(x - 6 * sc, yT, 12 * sc, yB - yT);
      }
      const n = 16;
      for (let i = 0; i < n; i++) {
        for (let r = 0; r < 2; r++) {
          const X0 = -WALL + 40 + ((WALL - 40) * 2 * i) / n, X1 = -WALL + 40 + ((WALL - 40) * 2 * (i + 1)) / n;
          poly([project(X0, 250 - r * 22, d), project(X1, 250 - r * 22, d), project(X1, 228 - r * 22, d), project(X0, 228 - r * 22, d)], (i + r) % 2 ? '#111' : '#fafafa');
        }
      }
      // chequered strip on the floor
      for (let i = 0; i < 12; i++) {
        const X0 = -WALL * 0.7 + (WALL * 1.4 * i) / 12, X1 = X0 + (WALL * 1.4) / 12;
        poly([project(X0, 0.5, d), project(X1, 0.5, d), project(X1, 0.5, d + 14), project(X0, 0.5, d + 14)], i % 2 ? '#111' : '#fafafa');
      }
    }

    function drawCoin(d, X, Y, t, alpha = 1) {
      const sc = scaleAt(d);
      const [x, y] = project(X, Y, d);
      const spin = Math.abs(Math.cos(t / 220 + X));
      const r = 18 * sc;
      g.globalAlpha = alpha * (1 - fogAt(d) * 0.6);
      g.fillStyle = 'rgba(255,210,63,.25)';
      g.beginPath(); g.arc(x, y, r * 1.8, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b8860b';
      g.beginPath(); g.ellipse(x, y, r * Math.max(0.15, spin), r, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffd23f';
      g.beginPath(); g.ellipse(x - r * 0.08 * spin, y, r * Math.max(0.1, spin) * 0.86, r * 0.86, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.beginPath(); g.ellipse(x - r * 0.3 * spin, y - r * 0.35, r * 0.16 * spin, r * 0.24, 0, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }

    function drawGem(d, lane, t) {
      const sc = scaleAt(d);
      const [x, y0] = project(lane * LANE_X, 0, d);
      const y = y0 - (48 + Math.sin(t / 250) * 8) * sc;
      const s = 22 * sc;
      g.globalAlpha = 1 - fogAt(d) * 0.5;
      const glow = g.createRadialGradient(x, y, 1, x, y, s * 3);
      glow.addColorStop(0, 'rgba(210,140,255,.6)'); glow.addColorStop(1, 'rgba(210,140,255,0)');
      g.fillStyle = glow; g.fillRect(x - s * 3, y - s * 3, s * 6, s * 6);
      poly([[x - s, y - s * 0.3], [x - s * 0.5, y - s], [x + s * 0.5, y - s], [x + s, y - s * 0.3], [x, y + s * 1.1]], '#9b4dff');
      poly([[x - s * 0.5, y - s], [x + s * 0.5, y - s], [x + s * 0.3, y - s * 0.3], [x - s * 0.3, y - s * 0.3]], '#e2c4ff');
      poly([[x - s * 0.3, y - s * 0.3], [x + s * 0.3, y - s * 0.3], [x, y + s * 1.1]], '#c08cff');
      g.globalAlpha = 1;
    }

    function drawMagnet(d, lane, t) {
      const sc = scaleAt(d);
      const [x, y0] = project(lane * LANE_X, 0, d);
      const y = y0 - (50 + Math.sin(t / 260) * 7) * sc;
      g.globalAlpha = 1 - fogAt(d) * 0.5;
      g.save(); g.translate(x, y); g.scale(sc, sc); g.rotate(Math.sin(t / 300) * 0.2);
      g.fillStyle = 'rgba(255,90,90,.25)'; g.beginPath(); g.arc(0, 0, 44, 0, Math.PI * 2); g.fill();
      g.lineWidth = 15; g.strokeStyle = '#e8453c';
      g.beginPath(); g.arc(0, -4, 16, Math.PI, 0, false); g.lineTo(16, 16); g.moveTo(-16, -4); g.lineTo(-16, 16); g.stroke();
      g.fillStyle = '#e8eef4'; g.fillRect(-24, 14, 16, 10); g.fillRect(8, 14, 16, 10);
      g.restore();
      g.globalAlpha = 1;
    }

    function drawLanternPickup(d, lane, t) {
      const sc = scaleAt(d);
      const [x, y0] = project(lane * LANE_X, 0, d);
      const y = y0 - (52 + Math.sin(t / 240) * 7) * sc;
      g.globalAlpha = 1 - fogAt(d) * 0.4;
      const glow = g.createRadialGradient(x, y, 2, x, y, 60 * sc);
      glow.addColorStop(0, 'rgba(255,220,120,.8)'); glow.addColorStop(1, 'rgba(255,200,80,0)');
      g.fillStyle = glow; g.fillRect(x - 60 * sc, y - 60 * sc, 120 * sc, 120 * sc);
      g.save(); g.translate(x, y); g.scale(sc, sc);
      g.fillStyle = '#3a3330'; g.fillRect(-16, -26, 32, 7); g.fillRect(-14, 18, 28, 6);
      g.strokeStyle = '#3a3330'; g.lineWidth = 3; g.beginPath(); g.arc(0, -30, 8, Math.PI, 0); g.stroke();
      g.fillStyle = '#ffe08a'; rr(-12, -19, 24, 37, 6); g.fill();
      g.fillStyle = '#fff6d0'; rr(-5, -12, 10, 22, 4); g.fill();
      g.strokeStyle = '#3a3330'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, -19); g.lineTo(0, 18); g.stroke();
      g.restore();
      g.globalAlpha = 1;
    }

    function drawRock(d, lane, t, n) {
      const sc = scaleAt(d);
      const [x, y] = project(lane * LANE_X, 0, d);
      const k = 1 - fogAt(d);
      g.fillStyle = `rgba(0,0,0,${0.35 * k})`;
      g.beginPath(); g.ellipse(x, y, 66 * sc, 14 * sc, 0, 0, Math.PI * 2); g.fill();
      // dust trickling from the ceiling over a fresh rockfall
      if (d > 60 && d < 520) {
        const [, cy] = project(lane * LANE_X, CEIL, d);
        g.fillStyle = `rgba(170,160,150,${0.35 * k})`;
        for (let i = 0; i < 5; i++) {
          const p = ((t / 700 + hash(n + i)) % 1);
          g.beginPath(); g.arc(x + (hash(n * 3 + i) - 0.5) * 70 * sc, cy + (y - 70 * sc - cy) * p, 2.5 * sc + 0.5, 0, Math.PI * 2); g.fill();
        }
      }
      const pts = [[-58, 0], [-54, -34], [-30, -66], [6, -76], [40, -60], [58, -28], [56, 0]];
      g.beginPath();
      pts.forEach(([px, py], i) => (i ? g.lineTo(x + px * sc, y + py * sc) : g.moveTo(x + px * sc, y + py * sc)));
      g.closePath();
      const grd = g.createLinearGradient(x - 50 * sc, y - 70 * sc, x + 50 * sc, y);
      grd.addColorStop(0, shade([150, 140, 135], d, 0.1));
      grd.addColorStop(1, shade([62, 56, 58], d));
      g.fillStyle = grd;
      g.fill();
      g.strokeStyle = shade([40, 36, 38], d);
      g.lineWidth = Math.max(1, 2.5 * sc);
      g.beginPath(); g.moveTo(x - 10 * sc, y - 70 * sc); g.lineTo(x + 2 * sc, y - 44 * sc); g.lineTo(x - 14 * sc, y - 24 * sc); g.stroke();
      g.fillStyle = shade([190, 180, 172], d);
      g.beginPath(); g.ellipse(x - 20 * sc, y - 52 * sc, 12 * sc, 7 * sc, -0.5, 0, Math.PI * 2); g.fill();
      // little warning boulder icon above far rocks, so they read early
      if (d > 380) {
        g.fillStyle = `rgba(255,190,60,${0.6 * k})`;
        g.beginPath(); g.moveTo(x, y - 100 * sc - 10); g.lineTo(x + 7, y - 100 * sc + 3); g.lineTo(x - 7, y - 100 * sc + 3); g.closePath(); g.fill();
      }
    }

    // A low beam across all three rails: duck under it.
    function drawBeam(d, t) {
      const sc = scaleAt(d);
      const Y0 = 124, Y1 = 158;
      for (const X of [-WALL + 30, WALL - 30]) {
        const [x, yB] = project(X, 0, d), [, yT] = project(X, Y1, d);
        g.fillStyle = shade([120, 80, 40], d);
        g.fillRect(x - 10 * sc, yT, 20 * sc, yB - yT);
      }
      poly([project(-WALL + 20, Y0, d), project(WALL - 20, Y0, d), project(WALL - 20, Y1, d), project(-WALL + 20, Y1, d)], shade([176, 120, 60], d));
      // hazard stripes
      g.save();
      g.beginPath();
      [project(-WALL + 20, Y0 + 8, d), project(WALL - 20, Y0 + 8, d), project(WALL - 20, Y1 - 8, d), project(-WALL + 20, Y1 - 8, d)]
        .forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath(); g.clip();
      g.fillStyle = shade([250, 196, 30], d, 0.1);
      const [lx, ly] = project(-WALL + 20, Y1, d), [rx] = project(WALL - 20, Y1, d);
      const bh = (Y1 - Y0) * sc;
      g.fillRect(lx, ly, rx - lx, bh);
      g.fillStyle = shade([24, 22, 22], d);
      for (let sx = lx - bh; sx < rx; sx += 36 * sc) {
        g.beginPath(); g.moveTo(sx, ly + bh); g.lineTo(sx + 18 * sc, ly + bh); g.lineTo(sx + 18 * sc + bh, ly); g.lineTo(sx + bh, ly); g.closePath(); g.fill();
      }
      g.restore();
      if (d > 120 && d < 600) { // "duck" hint arrows
        g.fillStyle = `rgba(255,255,255,${0.8 * (1 - fogAt(d))})`;
        for (const lane of [-1, 0, 1]) {
          const [ax, ay] = project(lane * LANE_X, Y1 + 46, d);
          const s = 14 * sc + 3;
          g.beginPath(); g.moveTo(ax - s, ay - s * 0.6); g.lineTo(ax + s, ay - s * 0.6); g.lineTo(ax, ay + s * 0.6); g.closePath(); g.fill();
        }
      }
    }

    // ---- the cart and the ninja riding it, both drawn in local units with the rails at (0, 0) ----
    function cartBack(trim) {
      g.fillStyle = '#2b2e35';
      g.fillRect(-54, -74, 108, 18);
      g.fillStyle = trim;
      g.globalAlpha = 0.35;
      g.fillRect(-54, -74, 108, 4);
      g.globalAlpha = 1;
    }
    function cartFront(trim, t, moving) {
      // wheels first, so the body sits over them
      for (const wx of [-40, 40]) {
        g.fillStyle = '#1d1f24';
        g.beginPath(); g.arc(wx, -9, 11, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#6b7079'; g.lineWidth = 2;
        const a = moving ? t / 60 : 0;
        g.beginPath(); g.moveTo(wx + Math.cos(a) * 8, -9 + Math.sin(a) * 8); g.lineTo(wx - Math.cos(a) * 8, -9 - Math.sin(a) * 8); g.stroke();
      }
      const body = g.createLinearGradient(-60, -56, 60, -22);
      body.addColorStop(0, '#a3acb6'); body.addColorStop(0.5, '#7d8691'); body.addColorStop(1, '#565e68');
      g.fillStyle = body;
      g.beginPath();
      g.moveTo(-62, -58); g.lineTo(62, -58); g.lineTo(48, -18); g.lineTo(-48, -18);
      g.closePath(); g.fill();
      g.fillStyle = trim; // painted band in your headband colour
      g.beginPath(); g.moveTo(-58, -46); g.lineTo(58, -46); g.lineTo(55, -38); g.lineTo(-55, -38); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(-55, -46, 110, 2);
      g.fillStyle = '#3d434b'; // rivets
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.arc(i * 22, -27, 2.5, 0, Math.PI * 2); g.fill(); }
      const rim = g.createLinearGradient(0, -80, 0, -66);
      rim.addColorStop(0, '#e2e8ee'); rim.addColorStop(1, '#8e98a3');
      g.fillStyle = rim;
      rr(-66, -80, 132, 12, 4); g.fill();
    }

    // Your ninja seen from behind: gi, headband knot and tails, belt knot, back accessory.
    function riderBack(loadout, o) {
      const col = (loadout && loadout.color) || '#20262e';
      const band = (loadout && loadout.headband) || '#e8453c';
      let beltCol = '#f4f4f4';
      try { if (P && loadout) beltCol = P.beltById(loadout.belt).color; } catch { /* keep white */ }
      const duck = o.pose === 2;
      const air = o.pose === 1;
      const bw = duck ? 76 : 70;
      const bh = duck ? 66 : 100;
      const base = duck ? -48 : -58;
      const top = base - bh;
      const t = o.t;
      const wind = 0.4 + o.speed * 0.6;

      // arms: holding the rim, flung up in a jump
      const shY = top + bh * (duck ? 0.5 : 0.42);
      const arm = (sx, hx, hy) => {
        g.strokeStyle = col; g.lineCap = 'round'; g.lineWidth = 15;
        g.beginPath(); g.moveTo(sx, shY); g.quadraticCurveTo(sx * 1.25, (shY + hy) / 2, hx, hy); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 15;
        g.beginPath(); g.moveTo(sx, shY); g.quadraticCurveTo(sx * 1.25, (shY + hy) / 2, hx, hy); g.stroke();
        g.fillStyle = '#2a2a30'; g.beginPath(); g.arc(hx, hy, 8, 0, Math.PI * 2); g.fill();
      };
      if (air) {
        const wave = Math.sin(t / 70) * 4;
        arm(-bw * 0.38, -50, top - 8 + wave);
        arm(bw * 0.38, 50, top - 8 - wave);
      } else {
        arm(-bw * 0.38, -52, -78);
        arm(bw * 0.38, 52, -78);
      }

      // body: one rounded shape, like the ninja in the world
      g.save();
      rr(-bw / 2, top, bw, bh, bw * 0.45);
      g.fillStyle = col; g.fill();
      g.clip();
      const sh = g.createLinearGradient(-bw / 2, 0, bw / 2, 0);
      sh.addColorStop(0, 'rgba(255,220,170,.18)'); sh.addColorStop(0.5, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.32)');
      g.fillStyle = sh; g.fillRect(-bw / 2, top, bw, bh);
      g.fillStyle = 'rgba(0,0,0,.12)'; // hood seam
      g.fillRect(-1.5, top + 4, 3, bh * 0.28);
      // headband wraps round the back of the head
      g.fillStyle = band;
      g.fillRect(-bw / 2, top + bh * 0.13, bw, bh * 0.085);
      g.fillStyle = 'rgba(0,0,0,.15)';
      g.fillRect(-bw / 2, top + bh * 0.13 + bh * 0.06, bw, bh * 0.025);
      // shoulder line and belt
      g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(0, top + bh * 0.4, bw * 0.38, 7, 0, Math.PI * 0.1, Math.PI * 0.9); g.stroke();
      g.fillStyle = beltCol;
      g.fillRect(-bw / 2, top + bh * 0.68, bw, bh * 0.1);
      g.restore();

      // headband knot and tails streaming back toward you
      const ky = top + bh * 0.17;
      g.fillStyle = band;
      rr(-7, ky - 6, 14, 12, 4); g.fill();
      for (const s of [-1, 1]) {
        const f = Math.sin(t / 55 + s) * 6 * wind;
        g.beginPath();
        g.moveTo(s * 3, ky - 2);
        g.quadraticCurveTo(s * (14 + f), ky + 16 * wind, s * (20 + f * 1.4), ky + 34 * wind + 8);
        g.lineTo(s * (12 + f * 1.4), ky + 36 * wind + 8);
        g.quadraticCurveTo(s * (8 + f), ky + 14 * wind, s * 1, ky + 4);
        g.closePath(); g.fill();
      }
      // belt knot and ends
      const by = top + bh * 0.73;
      g.fillStyle = beltCol;
      rr(-6, by - 6, 12, 11, 3); g.fill();
      if (beltCol === '#f4f4f4' || beltCol.toLowerCase() === '#ffffff') { g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.stroke(); }
      for (const s of [-1, 1]) {
        const f = Math.sin(t / 70 + s * 2) * 3 * wind;
        g.fillRect(s * 2 - 3 + f, by + 4, 6, 14 + wind * 4);
      }

      // a back-slot accessory (sword, quiver) is what you see from behind, so draw it on top
      const backId = loadout && loadout.accessories && loadout.accessories.back;
      const acc = backId && ctx.avatar && ctx.avatar.accessories && ctx.avatar.accessories.get && ctx.avatar.accessories.get(backId);
      if (acc && acc.draw) {
        g.save();
        try { acc.draw(g, { cx: 0, top, feet: base, bw, bh, T: bw / 0.78, facing: 0, time: t, back: true }, loadout); } catch { /* skip a broken item */ }
        g.restore();
      }
    }

    function drawCartAt(id, lane, d, o) {
      const sc = scaleAt(d);
      const [x, floorY] = project(lane * LANE_X, 0, d);
      const lift = o.lift || 0;
      const jig = o.stunned ? Math.sin(o.t / 30) * 4 : Math.sin(o.t / 45 + d) * 0.8;
      const loadout = loadouts.get(id);
      const trim = (loadout && loadout.headband) || '#e8453c';
      // shadow stays on the rails while the cart is in the air
      g.globalAlpha = o.alpha * (1 - fogAt(d) * 0.6);
      g.fillStyle = 'rgba(0,0,0,.4)';
      g.beginPath(); g.ellipse(x, floorY - 2 * sc, 70 * sc * (1 - lift / 300), 12 * sc * (1 - lift / 300), 0, 0, Math.PI * 2); g.fill();
      g.save();
      g.translate(x, floorY - lift * sc + jig * sc);
      g.scale(sc, sc);
      g.rotate(o.lean * 0.12 + (o.stunned ? Math.sin(o.t / 40) * 0.08 : 0));
      if (o.shield) {
        const k = 0.6 + 0.4 * Math.sin(o.t / 160);
        const sg = g.createRadialGradient(0, -80, 10, 0, -80, 120);
        sg.addColorStop(0, 'rgba(255,220,120,0)'); sg.addColorStop(0.75, `rgba(255,214,110,${0.18 * k})`); sg.addColorStop(1, 'rgba(255,214,110,0)');
        g.fillStyle = sg; g.beginPath(); g.arc(0, -80, 120, 0, Math.PI * 2); g.fill();
      }
      if (o.magnet) {
        g.strokeStyle = `rgba(255,110,110,${0.35 + 0.25 * Math.sin(o.t / 90)})`;
        g.lineWidth = 3;
        for (let i = 0; i < 2; i++) { const r = 70 + ((o.t / 8 + i * 40) % 80); g.beginPath(); g.arc(0, -50, r, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
      }
      cartBack(trim);
      g.save();
      g.rotate(o.lean * 0.18);
      riderBack(loadout, { pose: o.pose, t: o.t, speed: o.speed || 0.5 });
      g.restore();
      cartFront(trim, o.t, !o.stunned);
      if (o.stunned) {
        g.fillStyle = '#ffe36b';
        for (let i = 0; i < 3; i++) {
          const a = o.t / 160 + (i * Math.PI * 2) / 3;
          const sx = Math.cos(a) * 34, sy = -150 + Math.sin(a) * 8;
          g.beginPath();
          for (let k = 0; k < 5; k++) { const r = k % 2 ? 3 : 8, b = (k * Math.PI) / 2.5 - Math.PI / 2; g.lineTo(sx + Math.cos(b) * r, sy + Math.sin(b) * r); }
          g.closePath(); g.fill();
        }
      }
      if (o.name) {
        g.font = '700 17px sans-serif';
        g.textAlign = 'center';
        g.strokeStyle = 'rgba(0,0,0,.8)';
        g.lineWidth = 5;
        g.strokeText(o.name, 0, -170);
        g.fillStyle = trim;
        g.fillText(o.name, 0, -170);
      }
      g.restore();
      g.globalAlpha = 1;
    }

    function drawCartIcon(x, y, lost, trim) {
      g.save();
      g.translate(x, y);
      g.scale(0.36, 0.36);
      g.globalAlpha = lost ? 0.25 : 1;
      cartBack(trim);
      cartFront(trim, 0, false);
      g.restore();
    }

    function outlined(text, x, y, font, fill, align = 'center', lw = 5) {
      g.font = font; g.textAlign = align;
      g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = lw; g.lineJoin = 'round';
      g.strokeText(text, x, y);
      g.fillStyle = fill; g.fillText(text, x, y);
    }

    function drawHud(me, now, t) {
      const loadout = loadouts.get(meKey);
      const trim = (loadout && loadout.headband) || '#e8453c';
      // you: portrait badge, then your carts (lives)
      g.fillStyle = 'rgba(0,0,0,.45)';
      rr(10, 10, 92 + maxLives * 42, 64, 32); g.fill();
      g.fillStyle = '#1c1b24';
      g.beginPath(); g.arc(42, 42, 27, 0, Math.PI * 2); g.fill();
      if (portrait) {
        g.save(); g.beginPath(); g.arc(42, 42, 26, 0, Math.PI * 2); g.clip();
        g.drawImage(portrait, 12, 12, 60, 60);
        g.restore();
      }
      g.strokeStyle = trim; g.lineWidth = 3;
      g.beginPath(); g.arc(42, 42, 27, 0, Math.PI * 2); g.stroke();
      for (let i = 0; i < maxLives; i++) drawCartIcon(98 + i * 42, 58, i >= myLives, trim);

      // power-ups under the badge
      let px = 28;
      if (myShield) {
        g.fillStyle = 'rgba(255,214,110,.9)'; g.beginPath(); g.arc(px, 92, 11, 0, Math.PI * 2); g.fill();
        outlined('🏮', px, 97, '14px sans-serif', '#fff', 'center', 0);
        px += 30;
      }
      if (myMagnetEnd > now) {
        const left = (myMagnetEnd - now) / 6000;
        g.strokeStyle = '#e8453c'; g.lineWidth = 4;
        g.beginPath(); g.arc(px, 92, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, left)); g.stroke();
        outlined('🧲', px, 97, '13px sans-serif', '#fff', 'center', 0);
      }

      // score top-right, with the streak multiplier under it
      const dist = track ? Math.min(me.y, track.length) : me.y;
      const score = myCoins + Math.floor(dist / DISTANCE_PER_POINT);
      outlined('SCORE', W - 24, 26, 'italic 800 14px sans-serif', '#ffd23f', 'right', 4);
      outlined(String(score).padStart(6, '0'), W - 24, 62, '800 36px sans-serif', '#fff', 'right');
      const mx = W - 24, my = 82;
      const pulse = myMult > 1 ? 1 + 0.06 * Math.sin(t / 120) : 1;
      g.save(); g.translate(mx - 30, my + 10); g.scale(pulse, pulse);
      g.fillStyle = myMult >= 3 ? '#ff7a2f' : myMult === 2 ? '#ffb02f' : 'rgba(255,255,255,.2)';
      rr(-30, -14, 60, 28, 14); g.fill();
      outlined(`x${myMult}`, 0, 8, '800 20px sans-serif', '#fff', 'center', 4);
      g.restore();
      const into = myMult >= 3 ? 1 : (myStreak % STREAK_STEP) / STREAK_STEP;
      g.fillStyle = 'rgba(0,0,0,.45)'; rr(W - 160, my + 2, 90, 10, 5); g.fill();
      g.fillStyle = '#ffd23f'; rr(W - 160, my + 2, Math.max(10, 90 * into), 10, 5); g.fill();
      outlined(`streak ${myStreak}`, W - 160, my - 4, '700 11px sans-serif', '#fff', 'left', 3);

      // distance in the middle, with the time left under it
      outlined(`${Math.floor(dist / 10)} m`, W / 2, 50, '800 40px sans-serif', '#fff');
      if (roundEnd && !over) {
        const secs = Math.max(0, Math.ceil((roundEnd - now) / 1000));
        outlined(`${secs}s`, W / 2, 74, '700 16px sans-serif', secs <= 10 ? '#ff8a7a' : '#d8dde6', 'center', 4);
      }

      // progress bar: every rider, your best run and the finish
      if (track) {
        const x0 = 150, x1 = W - 150, y = H - 16;
        g.fillStyle = 'rgba(0,0,0,.5)'; rr(x0 - 8, y - 7, x1 - x0 + 16, 14, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,.18)'; rr(x0, y - 2, x1 - x0, 4, 2); g.fill();
        for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#111' : '#fff'; g.fillRect(x1 + 2, y - 6 + i * 3, 4, 3); g.fillStyle = i % 2 ? '#fff' : '#111'; g.fillRect(x1 + 6, y - 6 + i * 3, 4, 3); }
        if (store.bestDist > 0) {
          const bx = x0 + (x1 - x0) * Math.min(1, (store.bestDist * 10) / track.length);
          g.fillStyle = '#7dffb0'; g.fillRect(bx - 1, y - 9, 2, 18);
          outlined('BEST', bx, y - 11, '700 9px sans-serif', '#7dffb0', 'center', 3);
        }
        for (const id of Object.keys(shown)) {
          const o = shown[id];
          const lx = x0 + (x1 - x0) * Math.min(1, o.y / track.length);
          const lo = loadouts.get(id);
          g.fillStyle = (lo && lo.color) || '#888';
          g.strokeStyle = id === meKey ? '#fff' : (lo && lo.headband) || '#000';
          g.lineWidth = 2;
          g.beginPath(); g.arc(lx, y, id === meKey ? 7 : 5, 0, Math.PI * 2); g.fill(); g.stroke();
        }
      }
    }

    function drawEffects(now, dt) {
      // particles
      parts = parts.filter((p) => now - p.born < p.life);
      for (const p of parts) {
        p.vy += p.grav * dt * 0.06;
        p.x += p.vx * dt * 0.06; p.y += p.vy * dt * 0.06;
        g.globalAlpha = 1 - (now - p.born) / p.life;
        g.fillStyle = p.color;
        g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
      g.globalAlpha = 1;
      // coins flying into the cart
      const [cx, cy] = cartScreen();
      flying = flying.filter((f) => now - f.born < 260);
      for (const f of flying) {
        const k = (now - f.born) / 260;
        const [sx, sy] = project(f.lane * LANE_X, 36, f.d);
        const x = sx + (cx - sx) * k, y = sy + (cy - 90 - sy) * k;
        g.globalAlpha = 1 - k * 0.5;
        g.fillStyle = f.kind === 'gem' ? '#c08cff' : '#ffd23f';
        g.beginPath(); g.arc(x, y, 12 * (1 - k * 0.5), 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      // floating text
      popups = popups.filter((p) => now - p.born < 1000);
      for (const p of popups) {
        const age = (now - p.born) / 1000;
        g.globalAlpha = 1 - age * age;
        outlined(p.text, p.x, p.y - age * 50, p.big ? '800 30px sans-serif' : '800 22px sans-serif', p.color, 'center', 5);
      }
      g.globalAlpha = 1;
      if (banner) {
        const age = now - banner.born;
        if (age > 1600) banner = null;
        else {
          const k = Math.min(1, age / 160);
          g.globalAlpha = age > 1200 ? 1 - (age - 1200) / 400 : 1;
          g.save(); g.translate(W / 2, 150); g.scale(0.6 + k * 0.4, 0.6 + k * 0.4);
          outlined(banner.text, 0, 0, '900 46px sans-serif', banner.color, 'center', 8);
          g.restore();
          g.globalAlpha = 1;
        }
      }
      if (flash > 0) {
        g.fillStyle = `rgba(255,60,40,${flash * 0.35})`;
        g.fillRect(0, 0, W, H);
        flash = Math.max(0, flash - dt / 400);
      }
    }

    // speed streaks along the edges once the cart gets going
    function drawSpeedLines(t, speed) {
      if (speed < 0.45) return;
      const k = (speed - 0.45) / 0.55;
      g.strokeStyle = `rgba(255,240,220,${0.12 * k})`;
      g.lineWidth = 2;
      for (let i = 0; i < 14; i++) {
        const a = hash(i) * Math.PI * 2;
        const p = ((t / 300 + hash(i + 9)) % 1);
        const r0 = 180 + p * 360, r1 = r0 + 40 + k * 60;
        const cx = W / 2, cy = HZ + 40;
        if (Math.abs(Math.sin(a)) < 0.3 && Math.cos(a) > -2) {
          g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.6); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.6); g.stroke();
        }
      }
    }

    function render(t) {
      if (unmounted) return;
      const now = performance.now();
      const dt = Math.min(64, now - lastFrame);
      lastFrame = now;
      g.setTransform(scale, 0, 0, scale, 0, 0);
      // Carts keep rolling at their last known speed between server updates, and ease toward where
      // the server says they should be, so the camera moves smoothly at any frame rate.
      const laneEase = 1 - Math.exp(-dt / 55), posEase = 1 - Math.exp(-dt / 140);
      for (const id of Object.keys(players)) {
        const target = players[id];
        const cur = shown[id];
        if (!cur || Math.abs(cur.y - target.y) > 400) shown[id] = { lane: target.lane, y: target.y, airStart: 0, duckUntil: 0, lastPose: target.pose };
        else {
          const end = track ? track.length : Infinity;
          const expected = Math.min(end, target.y + (target.v * Math.min(140, now - target.at)) / 1000);
          cur.lane += (target.lane - cur.lane) * laneEase;
          cur.y = Math.min(end, cur.y + (target.v * dt) / 1000);
          cur.y += (expected - cur.y) * posEase;
        }
      }
      for (const id of Object.keys(shown)) if (!players[id]) delete shown[id];

      const me = shown[meKey];
      const camY = me ? me.y : 0;
      if (me) camX += (me.lane * LANE_X * 0.35 - camX) * (1 - Math.exp(-dt / 120));
      const speed = Math.min(1, (players[meKey] ? players[meKey].v : 0) / 420);
      const lean = me && players[meKey] ? Math.max(-1, Math.min(1, (players[meKey].lane - me.lane) * 2)) : 0;

      g.save();
      if (shake > 0) { g.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake = Math.max(0, shake - dt * 0.03); }
      g.translate(W / 2, H); g.rotate(-lean * 0.015); g.translate(-W / 2, -H);
      drawTunnel(camY, t);

      // everything that can be seen, drawn far to near
      const list = [];
      if (track) {
        const fd = track.length - camY;
        if (fd > -30 && fd < VIEW) list.push({ d: fd, draw: () => drawFinishLine(fd) });
        const items = track.items;
        while (itemStart < items.length && items[itemStart].y - camY < -20) itemStart++;
        for (let i = itemStart; i < items.length; i++) {
          const item = items[i];
          const d = item.y - camY;
          if (d > VIEW) break; // sorted by distance, so nothing further on is in view
          if (got.has(item.n)) continue;
          let draw;
          switch (item.kind) {
            case 'coin': draw = () => drawCoin(d, item.lane * LANE_X, 36, t); break;
            case 'rock': draw = () => drawRock(d, item.lane, t, item.n); break;
            case 'beam': draw = () => drawBeam(d, t); break;
            case 'gem': draw = () => drawGem(d, item.lane, t); break;
            case 'magnet': draw = () => drawMagnet(d, item.lane, t); break;
            case 'shield': draw = () => drawLanternPickup(d, item.lane, t); break;
            default: continue;
          }
          list.push({ d, draw });
        }
      }
      for (const id of Object.keys(shown)) {
        if (id === meKey) continue;
        const o = shown[id];
        const d = o.y - camY;
        if (d < 8 || d > VIEW) continue; // riders level with you would sit on top of your cart
        const st = players[id] || {};
        list.push({ d, draw: () => drawCartAt(id, o.lane, d, {
          alpha: 0.92, stunned: st.stunned, t, name: names.get(id) || '', lift: jumpHeight(o, now),
          pose: airborne(o, now) ? 1 : o.duckUntil > now ? 2 : 0, lean: (st.lane ?? o.lane) - o.lane, shield: st.shield, magnet: st.magnet > 0, speed,
        }) });
      }
      list.sort((a, b) => b.d - a.d);
      for (const entry of list) entry.draw();

      if (me) {
        const st = players[meKey] || {};
        const lift = jumpHeight(me, now);
        const pose = lift > 0 ? 1 : me.duckUntil > now ? 2 : 0;
        if (Math.abs(lean) > 0.08 && lift === 0 && Math.random() < 0.6) { // sparks off the wheels while switching rails
          const [cx, cy] = cartScreen();
          burst(cx + (lean > 0 ? -40 : 40), cy - 6, 2, ['#ffd27a', '#ff9d3a', '#fff'], 3, 380, 0.25, 3);
        }
        drawCartAt(meKey, me.lane, 0, { alpha: 1, stunned: st.stunned, t, name: '', lift, pose, lean, shield: myShield, magnet: myMagnetEnd > now, speed });
      }
      g.restore();
      drawSpeedLines(t, speed);
      drawEffects(now, dt);
      if (me) drawHud(me, now, t);
      if (!track) outlined('Get ready…', W / 2, H / 2, '800 34px sans-serif', '#fff');

      raf = requestAnimationFrame(render);
    }

    raf = requestAnimationFrame(render);

    function finalReport() {
      const me = players[meKey];
      if (!me) return;
      const dist = track ? Math.min(me.y, track.length) : me.y;
      const score = me.coins + Math.floor(dist / DISTANCE_PER_POINT);
      store.runs++;
      const beat = score > store.best;
      if (beat) store.best = score;
      store.bestDist = Math.max(store.bestDist, Math.floor(dist / 10));
      saveStore();
      updateMission();
      status.textContent = beat ? `New personal best: ${score}! Hang on, the results are coming.` : `Score ${score} (best ${store.best}). Hang on, the results are coming.`;
      if (beat) bannerShow('New best!', '#7dffb0');
    }

    return {
      onMessage(data) {
        const now = performance.now();
        if (data.type === 'track') {
          track = data;
          track.items.sort((a, b) => a.y - b.y);
          itemStart = 0;
          got = new Set();
          maxLives = data.lives || 3;
          myLives = maxLives;
          roundEnd = now + data.roundMs;
          status.textContent = 'Grab the coins. Jump the boulders, duck the beams!';
          bannerShow('GO!', '#ffd23f');
        } else if (data.type === 'state') {
          applyPlayers(data.players);
          updateMission();
        } else if (data.type === 'got') {
          got.add(data.n);
          myCoins = data.coins;
          myStreak = data.streak ?? myStreak;
          const prevMult = myMult;
          myMult = data.mult ?? myMult;
          run.mult = Math.max(run.mult, myMult);
          const item = track && track.items.find((it) => it.n === data.n);
          const [cx, cy] = cartScreen();
          if (data.kind === 'coin' || data.kind === 'gem') {
            if (data.kind === 'gem') run.gems++; else run.coins++;
            if (item) flying.push({ lane: item.lane, d: Math.max(0, item.y - myY()), kind: data.kind, born: now });
            popup(`+${data.worth}`, data.kind === 'gem' ? '#d9a8ff' : '#ffd23f', cx + (Math.random() - 0.5) * 30, cy - 150);
            burst(cx, cy - 90, data.kind === 'gem' ? 14 : 5, data.kind === 'gem' ? ['#d9a8ff', '#fff', '#9b4dff'] : ['#ffd23f', '#fff6c0'], 2.5, 500, 0.08, 3);
            if (myMult > prevMult) bannerShow(`x${myMult} streak!`, '#ffb02f');
          } else if (data.kind === 'magnet') {
            myMagnetEnd = now + (data.ms || 6000);
            bannerShow('Coin magnet!', '#ff8a7a');
          } else if (data.kind === 'shield') {
            myShield = true;
            bannerShow('Lantern shield!', '#ffe08a');
          }
        } else if (data.type === 'hop') {
          myCoins = data.coins;
          if (data.duck) run.ducks++; else run.hops++;
          const [cx, cy] = cartScreen();
          popup(data.duck ? 'Duck! +1' : 'Hop! +1', '#9fe8ff', cx, cy - 170);
        } else if (data.type === 'shield') {
          myShield = false;
          run.saves++;
          const [cx, cy] = cartScreen();
          popup('Shield saved you!', '#ffe08a', cx, cy - 170, true);
          burst(cx, cy - 80, 22, ['#ffe08a', '#fff'], 4, 600, 0.05, 4);
          shake = 6;
        } else if (data.type === 'crash') {
          myCoins = data.coins;
          myLives = data.lives;
          myStreak = 0;
          myMult = 1;
          run.crashes++;
          const [cx, cy] = cartScreen();
          popup(data.kind === 'beam' ? 'Bonk!' : 'Crash!', '#ff6b5b', cx, cy - 170, true);
          burst(cx, cy - 50, 18, ['#8a8079', '#5c5450', '#c9bcb0'], 5, 700, 0.3, 6);
          shake = 16;
          flash = 1;
        } else if (data.type === 'out') {
          out = true;
          status.textContent = 'Out of carts! Watching the rest of the round.';
          bannerShow('Out of carts!', '#ff6b5b');
        } else if (data.type === 'finish') {
          if (data.id === ctx.youId) {
            run.finished = true;
            updateMission();
            status.textContent = `Finished in place ${data.place}!`;
            bannerShow(data.place === 1 ? 'FINISH! 1st!' : `FINISH! #${data.place}`, '#7dffb0');
            const [cx, cy] = cartScreen();
            burst(cx, cy - 120, 40, ['#ffd23f', '#7dffb0', '#9fe8ff', '#ff8a7a'], 6, 1200, 0.15, 5);
          } else {
            const nm = names.get(String(data.id));
            if (nm) popup(`${nm} finished #${data.place}`, '#d8dde6', W / 2, 200);
          }
        } else if (data.type === 'over') {
          applyPlayers(data.players); // the final positions, so the last few metres are not lost
          over = true;
          if (!out && !run.finished) bannerShow("Time's up!", '#ffd23f');
          finalReport();
        }
      },
      onResults() {},
      unmount() {
        unmounted = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
      },
    };
  },
});
