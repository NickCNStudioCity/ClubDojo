// Placeholder scenery for the Go-Kart Race Mode 7 view: a 360° sky panorama behind the horizon,
// trackside props (trees, bushes, tyre stacks) and a start gantry. Prop placement is pure and
// seeded, so every client sees the same trees in the same places, and runs in Node for the checks
// (scripts/check-mode7.js). Drawing needs a canvas and only runs in the clients.
// Loads as CommonJS in Node and as window.ClubDojoKartScenery in the clients.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClubDojoKartScenery = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Small seeded PRNG (mulberry32), so placement is the same on every client.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Clearance from the centreline that props must keep: the wall is drawn 4 units past the
  // furthest a kart can drift (HALF_WIDTH + WALL_MARGIN), so props start a little beyond that.
  function wallEdge(T) { return T.HALF_WIDTH + T.WALL_MARGIN + 4; }

  // Props as { x, y, kind, size }. kind: 'tree' | 'pine' | 'bush' | 'tyres'.
  // pad: how far outside the world props may go (keep it inside the floor image's grass margin).
  function placeProps(T, { seed = 7, pad = 80, step = 64 } = {}) {
    const rand = rng(seed);
    const props = [];
    const edge = wallEdge(T);
    // Trees and bushes on a jittered grid over the grass, clear of the wall.
    for (let y = -pad; y <= T.WORLD.h + pad; y += step) {
      for (let x = -pad; x <= T.WORLD.w + pad; x += step) {
        const px = x + (rand() - 0.5) * step * 0.8;
        const py = y + (rand() - 0.5) * step * 0.8;
        const roll = rand();
        const size = 0.8 + rand() * 0.45;
        if (px < -pad || py < -pad || px > T.WORLD.w + pad || py > T.WORLD.h + pad) continue;
        const d = T.nearest(px, py).d;
        if (d < edge + 26) continue;
        if (roll < 0.3) continue; // leave some open grass
        const kind = roll < 0.6 ? 'tree' : roll < 0.85 ? 'pine' : 'bush';
        props.push({ x: px, y: py, kind, size });
      }
    }
    // Tyre stacks against the wall on the outside of each bend.
    const n = T.TRACK.pts.length;
    for (let i = 0; i < n; i++) {
      const a = T.TRACK.seg[(i - 1 + n) % n];
      const b = T.TRACK.seg[i];
      const turn = Math.atan2(a.dx * b.dy - a.dy * b.dx, a.dx * b.dx + a.dy * b.dy);
      if (Math.abs(turn) < 0.16) continue;
      // The outside of a bend is to the left of the direction of travel for a right turn (turn > 0).
      const nx = -b.dy / b.len, ny = b.dx / b.len; // right-hand normal (world y down)
      const side = turn > 0 ? -1 : 1;
      const p = T.TRACK.pts[i];
      props.push({ x: p.x + nx * side * (edge + 7), y: p.y + ny * side * (edge + 7), kind: 'tyres', size: 1 });
    }
    return props;
  }

  // Start gantry: two posts just outside the walls and a banner between them. It stands `ahead`
  // units past the start line, so the whole banner is in view from the starting grid.
  function gantry(T, ahead = 70) {
    // The centreline point `ahead` units along the track, and the road's direction there.
    let i = 0;
    while (i < T.TRACK.seg.length - 1 && T.TRACK.cum[i + 1] <= ahead) i++;
    const sg = T.TRACK.seg[i];
    const t = (ahead - T.TRACK.cum[i]) / sg.len;
    const cx = T.TRACK.pts[i].x + sg.dx * t, cy = T.TRACK.pts[i].y + sg.dy * t;
    const nx = -sg.dy / sg.len, ny = sg.dx / sg.len; // across the road
    const half = T.HALF_WIDTH + T.WALL_MARGIN + 10;
    return {
      a: { x: cx + nx * half, y: cy + ny * half },
      b: { x: cx - nx * half, y: cy - ny * half },
      low: 30, high: 44, // banner bottom and top, in world units above the ground
    };
  }

  // ---- Drawing (browser only) ----

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // One-frame billboard sheets in the same shape as the kart sheets: anchor (ax, ay) is the point
  // that touches the ground, ppu = sheet pixels per world unit.
  function makePropSheets() {
    const PPU = 2;
    const sheets = {};

    {
      const c = canvas(56, 84), g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(28, 80, 20, 4, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#6b4a2b'; g.fillRect(24, 50, 8, 30);
      g.fillStyle = '#4f3620'; g.fillRect(24, 50, 3, 30);
      const blob = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
      blob(28, 36, 22, '#2e6b2a'); blob(17, 44, 13, '#2e6b2a'); blob(39, 44, 13, '#2e6b2a');
      blob(25, 30, 15, '#3f8a37'); blob(36, 36, 11, '#3f8a37'); blob(22, 24, 8, '#58a84b');
      sheets.tree = { canvas: c, fw: 56, fh: 84, ax: 28, ay: 80, ppu: PPU };
    }
    {
      const c = canvas(44, 96), g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(22, 92, 15, 3.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5a3d22'; g.fillRect(19, 76, 6, 16);
      const tier = (top, bottom, half, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(22, top); g.lineTo(22 + half, bottom); g.lineTo(22 - half, bottom); g.closePath(); g.fill(); };
      tier(30, 80, 21, '#1f5a3a'); tier(14, 60, 16, '#26704a'); tier(2, 38, 11, '#2f855a');
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.beginPath(); g.moveTo(22, 2); g.lineTo(22, 80); g.lineTo(5, 80); g.closePath(); g.fill();
      sheets.pine = { canvas: c, fw: 44, fh: 96, ax: 22, ay: 92, ppu: PPU };
    }
    {
      const c = canvas(44, 28), g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(22, 25, 18, 3, 0, 0, Math.PI * 2); g.fill();
      const blob = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
      blob(13, 17, 9, '#356f2c'); blob(31, 17, 9, '#356f2c'); blob(22, 13, 11, '#448a39'); blob(18, 10, 4, '#6fb35a');
      g.fillStyle = '#e8453c'; g.fillRect(27, 11, 3, 3); g.fillRect(12, 15, 3, 3);
      sheets.bush = { canvas: c, fw: 44, fh: 28, ax: 22, ay: 25, ppu: PPU };
    }
    {
      // Three stacked tyres with a red and white band, like a corner barrier.
      const c = canvas(40, 34), g = c.getContext('2d');
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(4, 30, 32, 4);
      for (let r = 0; r < 3; r++) {
        const y = 24 - r * 9;
        g.fillStyle = '#16181b'; g.fillRect(4, y, 32, 8);
        g.fillStyle = '#2b2f35'; g.fillRect(4, y, 32, 2);
        g.fillStyle = r === 1 ? '#f3efe2' : '#e8453c'; g.fillRect(6, y + 3, 28, 3);
      }
      sheets.tyres = { canvas: c, fw: 40, fh: 34, ax: 20, ay: 31, ppu: 3 }; // about 13 units wide
    }
    return sheets;
  }

  // A seamless 360° panorama: width = 2π × pxPerRad, horizon on the bottom row.
  // Layers from back to front: sky gradient, sun, clouds, far mountains, hills, a tree line.
  // Every shape is periodic over the width, so the strip tiles without a seam as you turn.
  function makeSkyStrip(pxPerRad, height, colors) {
    const W = Math.round(Math.PI * 2 * pxPerRad);
    const H = Math.ceil(height);
    const c = canvas(W, H), g = c.getContext('2d');
    const rand = rng(11);
    const TAU = Math.PI * 2;

    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, colors.sky1);
    sky.addColorStop(1, colors.sky2);
    g.fillStyle = sky; g.fillRect(0, 0, W, H);

    // Sun with a soft glow.
    const sunX = W * 0.62, sunY = H * 0.28;
    const glow = g.createRadialGradient(sunX, sunY, 2, sunX, sunY, 40);
    glow.addColorStop(0, 'rgba(255,250,220,.9)'); glow.addColorStop(1, 'rgba(255,250,220,0)');
    g.fillStyle = glow; g.fillRect(sunX - 40, sunY - 40, 80, 80);
    g.fillStyle = '#fff6cf'; g.beginPath(); g.arc(sunX, sunY, 9, 0, TAU); g.fill();

    // Draws fn at x and at x ± W, so anything near an edge wraps round.
    const wrapped = (fn) => { fn(0); fn(-W); fn(W); };

    // Puffy pixel clouds.
    for (let i = 0; i < 9; i++) {
      const cx = rand() * W, cy = H * (0.12 + rand() * 0.38), s = 0.6 + rand() * 0.8;
      wrapped((o) => {
        g.fillStyle = 'rgba(255,255,255,.92)';
        for (const [dx, dy, r] of [[0, 0, 9], [10, -4, 11], [22, 0, 9], [11, 3, 9], [-8, 3, 6], [30, 4, 6]]) {
          g.beginPath(); g.arc(cx + o + dx * s, cy + dy * s, r * s, 0, TAU); g.fill();
        }
        g.fillStyle = 'rgba(160,190,215,.35)';
        g.fillRect(cx + o - 12 * s, cy + 6 * s, 48 * s, 3 * s);
      });
    }

    // A ridge: a height profile from sines with whole-number periods, so it matches at both ends.
    const ridge = (base, amp, waves, fill, rough = 0) => {
      g.fillStyle = fill;
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 2) {
        const t = (x / W) * TAU;
        let y = 0;
        for (const [k, a, ph] of waves) y += a * Math.sin(k * t + ph);
        if (rough) y += rough * Math.sin(37 * t) * Math.sin(53 * t + 1);
        g.lineTo(x, H - base - amp * y);
      }
      g.lineTo(W, H); g.closePath(); g.fill();
    };
    const peaks = [[3, 0.8, 0.3], [7, 0.45, 1.7], [13, 0.25, 0.4]];
    ridge(26, 14, peaks, '#8fa9c4', 0.25); // far mountains
    // Snow caps: the same ridge clipped to its top band.
    g.save();
    g.beginPath(); g.rect(0, 0, W, H - 36); g.clip();
    ridge(26, 14, peaks, '#eef3f8', 0.25);
    g.restore();
    ridge(14, 8, [[5, 0.7, 2.1], [9, 0.4, 0.2], [2, 0.5, 1.1]], '#5f9a5a');           // hills
    ridge(5, 3, [[61, 0.5, 0], [97, 0.4, 1.3], [23, 0.4, 0.6]], '#2f6b34');           // tree line
    // Haze where the land meets the floor, so the seam to the Mode 7 ground is soft.
    const haze = g.createLinearGradient(0, H - 10, 0, H);
    haze.addColorStop(0, 'rgba(191,227,247,0)'); haze.addColorStop(1, 'rgba(191,227,247,.55)');
    g.fillStyle = haze; g.fillRect(0, H - 10, W, 10);
    return { canvas: c, w: W, h: H, pxPerRad };
  }

  // Draws the panorama for a camera heading h. scale stretches it when the camera's focal length
  // differs from the one the strip was made for (the speed FOV kick).
  function drawSky(g, strip, h, viewW, horizon, scale = 1) {
    const top = Math.ceil(horizon);
    const w = strip.w * scale;
    let x = viewW / 2 - (((h * strip.pxPerRad) % strip.w + strip.w) % strip.w) * scale;
    while (x > 0) x -= w;
    for (; x < viewW; x += w) g.drawImage(strip.canvas, 0, strip.h - top, strip.w, top, x, 0, w, top);
  }

  // Banner for the start gantry: chequered edges and a title.
  function makeBanner(text) {
    const c = canvas(256, 32), g = c.getContext('2d');
    g.fillStyle = '#20262e'; g.fillRect(0, 0, 256, 32);
    for (let i = 0; i < 32; i++) {
      g.fillStyle = i % 2 ? '#fff' : '#111';
      g.fillRect(i * 8, 0, 8, 4); g.fillRect(i * 8, 28, 8, 4);
    }
    g.fillStyle = '#f5b82e';
    g.font = 'bold 18px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 17);
    return c;
  }

  return { rng, placeProps, gantry, makePropSheets, makeSkyStrip, drawSky, makeBanner };
});
