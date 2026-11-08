// The Cafe: its room, furniture, card tables and the storefront in Mountain Town.
// Adds to the prop set in mountain-art.js, so it must load after that file and before world.js.
(function () {
  const Art = window.ClubDojoMountainArt;
  const TAU = Math.PI * 2;
  const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  function rect(c, x, y, w, h, col) { c.fillStyle = col; c.fillRect(x, y, w, h); }
  function dot(c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
  function oval(c, x, y, rx, ry, col) { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill(); }
  function box(c, x, y, w, h, r, col) { c.fillStyle = col; c.beginPath(); c.roundRect(x, y, w, h, r); c.fill(); }
  function poly(c, pts, col) { c.fillStyle = col; c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill(); }
  function text(c, s, x, y, size, col, font = 'Bangers, Impact, sans-serif') {
    c.font = `${size}px ${font}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = col; c.fillText(s, x, y);
  }
  function glow(c, x, y, r, rgb, a) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function steam(c, x, y, T, time, n = 3) {
    for (let i = 0; i < n; i++) {
      const k = ((time / 1600 + i / n) % 1);
      c.globalAlpha = (1 - k) * 0.5;
      dot(c, x + Math.sin(time / 300 + i * 2) * T * 0.08, y - k * T * 0.8, T * (0.05 + k * 0.08), '#ffffff');
    }
    c.globalAlpha = 1;
  }
  function shadow(c, x, y, rx, ry) { oval(c, x, y, rx, ry, 'rgba(25,12,5,.28)'); }

  // ---------- the room: floor, rugs and walls are painted once, then copied each frame ----------
  let cache = null;
  function paintRoom(c, W, H, T) {
    // Warm plank floor.
    rect(c, 0, 0, W, H, '#6f452a');
    for (let row = 4; row < 24; row += 0.5) {
      const r = row * 2;
      for (let i = -1; i < 16; i++) {
        const px = (i * 3 + (r % 2 ? 1.5 : 0)) * T, n = hash(i, r);
        rect(c, px, row * T, T * 3 - 1, T * 0.5 - 1, ['#8a5a36', '#935f39', '#815431', '#9a663e'][Math.floor(n * 4)]);
        rect(c, px + T * 0.3, row * T + T * (0.12 + n * 0.2), T * (0.6 + n), 1, 'rgba(60,30,12,.25)');
      }
    }
    // Rugs: a round one by the fire, a runner up the middle, and one under each pair of tables.
    function rug(x, y, w, h, base, band, edge) {
      box(c, x, y, w, h, T * 0.25, edge);
      box(c, x + T * 0.18, y + T * 0.18, w - T * 0.36, h - T * 0.36, T * 0.18, base);
      c.strokeStyle = band; c.lineWidth = T * 0.09;
      c.beginPath(); c.roundRect(x + T * 0.45, y + T * 0.45, w - T * 0.9, h - T * 0.9, T * 0.12); c.stroke();
    }
    oval(c, 8 * T, 8.6 * T, T * 3.9, T * 2.6, '#6d2f28'); oval(c, 8 * T, 8.6 * T, T * 3.5, T * 2.25, '#b5533c');
    oval(c, 8 * T, 8.6 * T, T * 2.6, T * 1.6, '#e0a24a'); oval(c, 8 * T, 8.6 * T, T * 2.3, T * 1.35, '#a8402f');
    rug(18 * T, 6.6 * T, 4 * T, 16.4 * T, '#8c2f2a', '#e0b45c', '#4f1a18');
    rug(11.6 * T, 8 * T, 6 * T, 5 * T, '#2c3a78', '#8fa0ea', '#1a2350');
    rug(22.4 * T, 8 * T, 6 * T, 5 * T, '#2c3a78', '#8fa0ea', '#1a2350');
    rug(11.6 * T, 14 * T, 6 * T, 5 * T, '#8a4a22', '#f0c070', '#55290f');
    rug(22.4 * T, 14 * T, 6 * T, 5 * T, '#8a4a22', '#f0c070', '#55290f');
    // Back wall: plaster above dark wainscot, with timber posts.
    const wall = c.createLinearGradient(0, 0, 0, 4 * T);
    wall.addColorStop(0, '#d9b98c'); wall.addColorStop(1, '#c49a6a');
    c.fillStyle = wall; c.fillRect(0, 0, W, 2.9 * T);
    rect(c, 0, 2.9 * T, W, 1.1 * T, '#4d2d1a');
    for (let i = 0; i < 40; i++) rect(c, i * T, 2.9 * T, 1, 1.1 * T, 'rgba(0,0,0,.25)');
    rect(c, 0, 2.82 * T, W, T * 0.14, '#7b4a2a');
    rect(c, 0, 3.95 * T, W, T * 0.14, 'rgba(0,0,0,.35)');
    rect(c, 0, 0, W, T * 0.32, '#4d2d1a');
    for (const x of [1.6, 12.4, 27.4, 38.2]) rect(c, x * T, 0, T * 0.34, 4 * T, '#5b3620');
    // Side walls.
    for (const x of [0, 39]) { rect(c, x * T, 0, T, H, '#4d2d1a'); rect(c, (x === 0 ? 0.82 : 39) * T, 0, T * 0.18, H, 'rgba(0,0,0,.3)'); }
    rect(c, 0, 23 * T, W, T, '#4d2d1a'); rect(c, 19 * T, 23 * T, 2 * T, T, '#3a2214');
    // Doormat.
    box(c, 18.6 * T, 22.1 * T, 2.8 * T, 0.8 * T, T * 0.08, '#3d5a4a');
    text(c, 'WELCOME', 20 * T, 22.5 * T, T * 0.42, '#d7e6c9');
    // Shelf of mugs and tins behind the counter.
    for (const y of [1.0, 2.0]) {
      rect(c, 14.2 * T, y * T + T * 0.56, 11.6 * T, T * 0.12, '#5b3620');
      for (let i = 0; i < 15; i++) {
        const px = (14.6 + i * 0.76) * T, n = hash(i, y * 7);
        if (n < 0.45) { box(c, px, y * T + T * 0.2, T * 0.42, T * 0.36, T * 0.06, ['#e8e0d0', '#c0473a', '#2f8a8c', '#e8b33a'][Math.floor(n * 9) % 4]); }
        else { box(c, px, y * T + T * 0.02, T * 0.4, T * 0.54, T * 0.05, ['#3f4fa8', '#7a4a2a', '#59806a'][Math.floor(n * 11) % 3]); rect(c, px + T * 0.06, y * T + T * 0.2, T * 0.28, T * 0.16, '#f4ead2'); }
      }
    }
    // Chalkboard with today's menu, either side of the shelves.
    for (const [x, lines] of [[28.3, ['COCOA  15', 'HOUSE RULES:', 'NO FLIPPING', 'THE TABLE']], [9, []]]) {
      if (!lines.length) continue;
      box(c, x * T, 0.5 * T, 0 * T, 0, 0, '#000');
    }
    // Vignette, so the edges sit back and the middle glows.
    const v = c.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, W * 0.72);
    v.addColorStop(0, 'rgba(30,12,4,0)'); v.addColorStop(1, 'rgba(30,12,4,.42)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
  }

  function drawWindow(c, x, y, w, h, T, time) {
    box(c, x - T * 0.14, y - T * 0.14, w + T * 0.28, h + T * 0.28, T * 0.06, '#5b3620');
    c.save();
    c.beginPath(); c.rect(x, y, w, h); c.clip();
    const sky = c.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, '#31508a'); sky.addColorStop(1, '#f0b98a');
    c.fillStyle = sky; c.fillRect(x, y, w, h);
    poly(c, [[x, y + h], [x + w * 0.2, y + h * 0.42], [x + w * 0.42, y + h * 0.72], [x + w * 0.66, y + h * 0.3], [x + w, y + h * 0.78], [x + w, y + h]], '#dfe9f4');
    poly(c, [[x + w * 0.66, y + h * 0.3], [x + w * 0.56, y + h * 0.5], [x + w * 0.63, y + h * 0.46], [x + w * 0.68, y + h * 0.53], [x + w * 0.74, y + h * 0.44]], '#ffffff');
    rect(c, x, y + h * 0.86, w, h * 0.14, '#f7fbfe');
    for (let i = 0; i < 26; i++) {
      const sx = x + ((hash(i, 1) * w + Math.sin(time / 900 + i) * T * 0.2 + w) % w);
      const sy = y + ((hash(i, 2) * h + time * (0.012 + hash(i, 3) * 0.012)) % h);
      dot(c, sx, sy, Math.max(0.7, T * 0.035), 'rgba(255,255,255,.9)');
    }
    c.restore();
    rect(c, x + w / 2 - T * 0.04, y, T * 0.08, h, '#5b3620');
    rect(c, x, y + h * 0.48, w, T * 0.08, '#5b3620');
    rect(c, x - T * 0.2, y + h + T * 0.1, w + T * 0.4, T * 0.14, '#7b4a2a');
    for (const px of [x - T * 0.1, x + w - T * 0.5]) { // curtains
      poly(c, [[px, y - T * 0.14], [px + T * 0.6, y - T * 0.14], [px + T * 0.28, y + h * 0.7], [px, y + h * 0.8]], '#9c3b33');
    }
  }

  function stringLights(c, x0, y0, x1, sag, T, time, n) {
    c.strokeStyle = 'rgba(40,22,10,.7)'; c.lineWidth = Math.max(1, T * 0.04);
    c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2, y0 + sag * 2, x1, y0); c.stroke();
    const cols = ['255,214,120', '255,150,110', '150,220,255', '190,255,170'];
    for (let i = 1; i < n; i++) {
      const k = i / n, x = x0 + (x1 - x0) * k, y = y0 + 4 * sag * k * (1 - k);
      const a = 0.72 + Math.sin(time / 420 + i * 1.9) * 0.28, col = cols[i % cols.length];
      c.globalCompositeOperation = 'lighter';
      glow(c, x, y + T * 0.1, T * 0.65, col, 0.32 * a);
      c.globalCompositeOperation = 'source-over';
      dot(c, x, y + T * 0.1, T * 0.09, `rgba(${col},${0.65 + a * 0.35})`);
    }
  }

  function drawRoom(c, p, x, y, w, h, T, time) {
    const scale = c.getTransform().a || 1;
    if (!cache || cache.T !== T || cache.scale !== scale) {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(w * scale); cv.height = Math.ceil(h * scale);
      const cc = cv.getContext('2d');
      cc.scale(scale, scale);
      paintRoom(cc, w, h, T);
      cache = { T, scale, cv };
    }
    c.drawImage(cache.cv, x, y, w, h);
    drawWindow(c, 3.6 * T, 0.7 * T, 7.4 * T, 1.9 * T, T, time);
    drawWindow(c, 28.6 * T, 0.7 * T, 8.2 * T, 1.9 * T, T, time);
    // Neon sign above the counter.
    box(c, 15.6 * T, 0.32 * T, 8.8 * T, 0.68 * T, T * 0.1, '#2a1a12');
    c.save();
    c.shadowColor = '#ffb35c'; c.shadowBlur = T * (0.5 + Math.sin(time / 800) * 0.15);
    text(c, 'THE CAFE', 20 * T, 0.68 * T, T * 0.6, '#ffe6b0');
    c.restore();
    stringLights(c, 1.8 * T, 3.3 * T, 13 * T, T * 0.45, T, time, 13);
    stringLights(c, 27 * T, 3.3 * T, 38.2 * T, T * 0.45, T, time, 13);
    // The fire's light on the floor.
    c.globalCompositeOperation = 'lighter';
    glow(c, 5 * T, 8 * T, T * (7.5 + Math.sin(time / 130) * 0.3), '255,130,50', 0.17);
    glow(c, 20 * T, 7 * T, T * 7, '255,190,110', 0.09);
    c.globalCompositeOperation = 'source-over';
  }

  // ---------- furniture ----------
  function drawHearth(c, p, x, y, w, h, T, time) {
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const n = hash(i, j + 30);
      box(c, x + i * T * 0.5 + (j % 2 ? T * 0.25 : 0) - T * 0.25, y - T + j * T * 0.62, T * 0.48, T * 0.58, T * 0.06, ['#8d8791', '#7d7782', '#9a939c', '#6f6a75'][Math.floor(n * 4)]);
    }
    rect(c, x - T * 0.25, y + T * 0.85, w + T * 0.25, T * 0.3, '#5b3620');
    rect(c, x - T * 0.25, y + T * 1.1, w + T * 0.25, T * 0.08, 'rgba(0,0,0,.4)');
    // Things on the mantel.
    box(c, x + T * 0.4, y + T * 0.42, T * 0.42, T * 0.43, T * 0.06, '#c0473a');
    box(c, x + T * 1.3, y + T * 0.2, T * 0.34, T * 0.65, T * 0.05, '#3f4fa8');
    box(c, x + T * 1.68, y + T * 0.3, T * 0.34, T * 0.55, T * 0.05, '#e8b33a');
    dot(c, x + T * 3.1, y + T * 0.6, T * 0.26, '#3d7a4a');
    // Firebox.
    const fx = x + T * 0.55, fw = w - T * 1.1, fy = y + T * 1.6, fh = h - T * 1.6;
    c.fillStyle = '#17100c';
    c.beginPath(); c.moveTo(fx, fy + fh); c.lineTo(fx, fy + T * 0.5); c.quadraticCurveTo(fx + fw / 2, fy - T * 0.45, fx + fw, fy + T * 0.5); c.lineTo(fx + fw, fy + fh); c.closePath(); c.fill();
    rect(c, fx + T * 0.3, fy + fh - T * 0.28, fw - T * 0.6, T * 0.22, '#4a2e1a');
    rect(c, fx + T * 0.6, fy + fh - T * 0.42, fw - T * 1.2, T * 0.2, '#5d3a20');
    const cx = fx + fw / 2, base = fy + fh - T * 0.3;
    for (const [col, scale] of [['#d9402f', 1], ['#ff9b2e', 0.72], ['#ffe27a', 0.42]]) {
      for (let i = -2; i <= 2; i++) {
        const wob = Math.sin(time / 110 + i * 2) * T * 0.1, tall = T * scale * (1.25 - Math.abs(i) * 0.26 + Math.sin(time / 170 + i) * 0.14);
        const bx = cx + i * T * 0.3 * (0.6 + scale * 0.4);
        c.fillStyle = col; c.beginPath(); c.moveTo(bx - T * 0.24 * scale, base);
        c.quadraticCurveTo(bx - T * 0.24 * scale, base - tall * 0.5, bx + wob, base - tall);
        c.quadraticCurveTo(bx + T * 0.24 * scale, base - tall * 0.5, bx + T * 0.24 * scale, base); c.closePath(); c.fill();
      }
    }
    for (let i = 0; i < 6; i++) { // sparks
      const k = (time / 900 + hash(i, 9)) % 1;
      c.globalAlpha = 1 - k; dot(c, cx + Math.sin(time / 200 + i * 3) * T * 0.5, base - T * 0.4 - k * T * 1.3, T * 0.035, '#ffcf70'); c.globalAlpha = 1;
    }
  }

  function drawCounter(c, p, x, y, w, h, T, time) {
    shadow(c, x + w / 2, y + T * 1.05, w * 0.52, T * 0.2);
    box(c, x, y - T * 0.05, w, T * 1.05, T * 0.08, '#6a3d22');
    for (let i = 0; i < 12; i++) rect(c, x + i * T + T * 0.46, y + T * 0.15, T * 0.08, T * 0.8, 'rgba(0,0,0,.2)');
    box(c, x - T * 0.15, y - T * 0.28, w + T * 0.3, T * 0.32, T * 0.06, '#c8955a');
    rect(c, x - T * 0.15, y - T * 0.28, w + T * 0.3, T * 0.08, '#e2b37a');
    // Espresso machine.
    const mx = x + T * 1.2;
    box(c, mx, y - T * 1.12, T * 1.7, T * 0.86, T * 0.1, '#c9ccd3'); rect(c, mx, y - T * 0.7, T * 1.7, T * 0.12, '#8d3b2f');
    dot(c, mx + T * 0.45, y - T * 0.92, T * 0.12, '#f5b82e'); dot(c, mx + T * 1.2, y - T * 0.92, T * 0.12, '#f5b82e');
    steam(c, mx + T * 0.4, y - T * 1.15, T, time, 4);
    // Cake dome.
    const dx = x + T * 8.6;
    box(c, dx - T * 0.55, y - T * 0.36, T * 1.1, T * 0.08, T * 0.03, '#e8e0d0');
    box(c, dx - T * 0.4, y - T * 0.68, T * 0.8, T * 0.34, T * 0.08, '#a65a3a'); rect(c, dx - T * 0.4, y - T * 0.68, T * 0.8, T * 0.1, '#fff4e6');
    dot(c, dx, y - T * 0.75, T * 0.07, '#d9402f');
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = Math.max(1, T * 0.04); c.beginPath(); c.arc(dx, y - T * 0.42, T * 0.56, Math.PI, 0); c.stroke();
    // Mugs waiting.
    for (const [i, col] of [[3.6, '#e8e0d0'], [6, '#2f8a8c'], [10.3, '#c0473a']]) {
      box(c, x + i * T, y - T * 0.6, T * 0.36, T * 0.34, T * 0.05, col); steam(c, x + i * T + T * 0.18, y - T * 0.62, T, time + i * 300, 2);
    }
    // Stools on the customers' side.
    for (const i of [1.5, 3.8, 8.2, 10.5]) { rect(c, x + i * T - T * 0.05, y + T * 1.2, T * 0.1, T * 0.36, '#3a2517'); oval(c, x + i * T, y + T * 1.2, T * 0.3, T * 0.12, '#a8532f'); }
  }

  function drawBooth(c, p, x, y, w, h, T, time) {
    shadow(c, x + w / 2, y + h, w * 0.52, T * 0.22);
    box(c, x + T * 0.1, y - T * 0.5, w - T * 0.2, h + T * 0.5, T * 0.08, '#2a2350');
    // Rows of pack boxes.
    for (let j = 0; j < 2; j++) for (let i = 0; i < 9; i++) {
      const n = hash(i, j + 40);
      box(c, x + T * 0.4 + i * T * 0.58, y - T * 0.3 + j * T * 0.7, T * 0.48, T * 0.6, T * 0.05, ['#3f8fd1', '#c9862a', '#7a55c7', '#e8532c'][Math.floor(n * 4)]);
      dot(c, x + T * 0.64 + i * T * 0.58, y - T * 0.02 + j * T * 0.7, T * 0.09, 'rgba(255,255,255,.8)');
    }
    box(c, x - T * 0.05, y + h - T * 0.62, w + T * 0.1, T * 0.62, T * 0.06, '#6a3d22');
    box(c, x - T * 0.15, y + h - T * 0.74, w + T * 0.3, T * 0.18, T * 0.04, '#c8955a');
    // Striped awning.
    const stripes = 8, sw = (w + T * 0.5) / stripes;
    for (let i = 0; i < stripes; i++) {
      const sx = x - T * 0.25 + i * sw;
      poly(c, [[sx + T * 0.1, y - T * 1.1], [sx + sw + T * 0.1, y - T * 1.1], [sx + sw, y - T * 0.55], [sx, y - T * 0.55]], i % 2 ? '#fff4dd' : '#3f4fa8');
      c.fillStyle = i % 2 ? '#fff4dd' : '#3f4fa8'; c.beginPath(); c.arc(sx + sw / 2, y - T * 0.55, sw / 2, 0, Math.PI); c.fill();
    }
    box(c, x + w / 2 - T * 1.2, y - T * 1.75, T * 2.4, T * 0.62, T * 0.1, '#2a1a12');
    c.save(); c.shadowColor = '#7f9bff'; c.shadowBlur = T * 0.5 * (0.8 + Math.sin(time / 500) * 0.2);
    text(c, 'CARDS', x + w / 2, y - T * 1.42, T * 0.5, '#dfe6ff'); c.restore();
  }

  function drawBoard(c, p, x, y, w, h, T, time) {
    shadow(c, x + w / 2, y + h, w * 0.5, T * 0.16);
    rect(c, x + T * 0.3, y + T * 0.6, T * 0.14, h - T * 0.6, '#3a2517'); rect(c, x + w - T * 0.44, y + T * 0.6, T * 0.14, h - T * 0.6, '#3a2517');
    box(c, x, y - T * 0.9, w, T * 2.2, T * 0.08, '#6a3d22');
    box(c, x + T * 0.12, y - T * 0.78, w - T * 0.24, T * 1.96, T * 0.05, '#b98a5c');
    text(c, 'HALL OF FAME', x + w / 2, y - T * 0.5, T * 0.34, '#3a2517');
    for (let i = 0; i < 5; i++) {
      const px = x + T * (0.28 + (i % 3) * 0.86), py = y + T * (-0.22 + Math.floor(i / 3) * 0.7);
      c.save(); c.translate(px + T * 0.33, py + T * 0.3); c.rotate((hash(i, 5) - 0.5) * 0.24);
      rect(c, -T * 0.33, -T * 0.3, T * 0.66, T * 0.6, i === 0 ? '#ffe9a8' : '#f4ead2');
      rect(c, -T * 0.22, -T * 0.12, T * 0.44, T * 0.04, 'rgba(60,40,20,.5)'); rect(c, -T * 0.22, 0, T * 0.32, T * 0.04, 'rgba(60,40,20,.5)');
      dot(c, 0, -T * 0.26, T * 0.06, '#d9402f'); c.restore();
    }
  }

  function drawSofa(c, p, x, y, w, h, T) {
    const col = p.color || '#2f6d62';
    shadow(c, x + w / 2, y + T * 1, w * 0.52, T * 0.18);
    box(c, x, y - T * 0.5, w, T * 1, T * 0.22, col);
    rect(c, x + T * 0.2, y - T * 0.34, w - T * 0.4, T * 0.04, 'rgba(255,255,255,.14)');
    const n = Math.round(w / T / 2);
    for (let i = 0; i < n; i++) { box(c, x + T * 0.3 + i * ((w - T * 0.6) / n), y + T * 0.05, (w - T * 0.6) / n - T * 0.05, T * 0.55, T * 0.12, '#ffffff22'); box(c, x + T * 0.3 + i * ((w - T * 0.6) / n), y + T * 0.05, (w - T * 0.6) / n - T * 0.05, T * 0.55, T * 0.12, col); }
    box(c, x - T * 0.12, y - T * 0.1, T * 0.5, T * 1, T * 0.16, col); box(c, x + w - T * 0.38, y - T * 0.1, T * 0.5, T * 1, T * 0.16, col);
    box(c, x + T * 0.8, y - T * 0.28, T * 0.6, T * 0.5, T * 0.1, '#e8b33a');
  }
  function drawChair(c, p, x, y, w, h, T) {
    const col = p.color || '#a8532f';
    shadow(c, x + T / 2, y + T * 1, T * 0.55, T * 0.16);
    box(c, x - T * 0.05, y - T * 0.5, T * 1.1, T * 1, T * 0.22, col);
    box(c, x + T * 0.08, y + T * 0.08, T * 0.84, T * 0.55, T * 0.12, 'rgba(255,255,255,.14)');
    box(c, x - T * 0.16, y + T * 0.0, T * 0.34, T * 0.85, T * 0.12, col); box(c, x + T * 0.82, y + T * 0.0, T * 0.34, T * 0.85, T * 0.12, col);
  }
  function drawPlant(c, p, x, y, w, h, T, time) {
    shadow(c, x + T / 2, y + T * 0.95, T * 0.34, T * 0.12);
    poly(c, [[x + T * 0.18, y + T * 0.42], [x + T * 0.82, y + T * 0.42], [x + T * 0.7, y + T * 0.95], [x + T * 0.3, y + T * 0.95]], '#b5603a');
    rect(c, x + T * 0.14, y + T * 0.38, T * 0.72, T * 0.1, '#c9794e');
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i - 3) * 0.42 + Math.sin(time / 1400 + i) * 0.03, len = T * (0.8 + (i % 2) * 0.28);
      const tx = x + T / 2 + Math.cos(a) * len, ty = y + T * 0.42 + Math.sin(a) * len;
      c.fillStyle = i % 2 ? '#3d7a4a' : '#559a5f';
      c.beginPath(); c.moveTo(x + T / 2, y + T * 0.42); c.quadraticCurveTo(tx - T * 0.26, (y + T * 0.42 + ty) / 2, tx, ty); c.quadraticCurveTo(tx + T * 0.26, (y + T * 0.42 + ty) / 2, x + T / 2, y + T * 0.42); c.fill();
    }
  }
  function drawShelf(c, p, x, y, w, h, T) {
    box(c, x, y - T * 0.8, w, h + T * 0.8, T * 0.05, '#4d2d1a');
    for (let j = 0; j < 5; j++) {
      const sy = y - T * 0.7 + j * ((h + T * 0.7) / 5);
      rect(c, x + T * 0.06, sy + T * 0.82, w - T * 0.12, T * 0.08, '#7b4a2a');
      for (let i = 0; i < 4; i++) {
        const n = hash(i + x, j);
        rect(c, x + T * 0.1 + i * T * 0.2, sy + T * (0.3 + n * 0.14), T * 0.17, T * (0.52 - n * 0.14), ['#c0473a', '#3f4fa8', '#2f8a8c', '#e8b33a', '#8e44ad'][Math.floor(n * 5)]);
      }
    }
  }
  function drawCat(c, p, x, y, w, h, T, time) {
    shadow(c, x + T / 2, y + T * 0.8, T * 0.44, T * 0.12);
    const breathe = 1 + Math.sin(time / 800) * 0.04;
    oval(c, x + T * 0.5, y + T * 0.58, T * 0.42, T * 0.26 * breathe, '#e08a3c');
    oval(c, x + T * 0.5, y + T * 0.52, T * 0.26, T * 0.1, '#f2a860');
    dot(c, x + T * 0.84, y + T * 0.56, T * 0.17, '#e08a3c');
    poly(c, [[x + T * 0.73, y + T * 0.48], [x + T * 0.76, y + T * 0.32], [x + T * 0.86, y + T * 0.42]], '#e08a3c');
    poly(c, [[x + T * 0.86, y + T * 0.42], [x + T * 0.96, y + T * 0.33], [x + T * 0.97, y + T * 0.5]], '#e08a3c');
    c.strokeStyle = '#3a2517'; c.lineWidth = Math.max(1, T * 0.03);
    c.beginPath(); c.arc(x + T * 0.8, y + T * 0.56, T * 0.03, 0, Math.PI); c.moveTo(x + T * 0.93, y + T * 0.56); c.arc(x + T * 0.9, y + T * 0.56, T * 0.03, 0, Math.PI); c.stroke();
    c.strokeStyle = '#c56f28'; c.lineWidth = T * 0.09; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x + T * 0.16, y + T * 0.68); c.quadraticCurveTo(x - T * 0.1, y + T * (0.72 + Math.sin(time / 900) * 0.05), x + T * 0.1, y + T * 0.82); c.stroke(); c.lineCap = 'butt';
    const k = (time / 2200) % 1;
    c.globalAlpha = (1 - k) * 0.7; text(c, 'z', x + T * (0.85 + k * 0.25), y + T * (0.3 - k * 0.6), T * (0.2 + k * 0.14), '#fff4dd', 'sans-serif'); c.globalAlpha = 1;
  }
  function drawPiano(c, p, x, y, w, h, T) {
    shadow(c, x + w / 2, y + h, w * 0.52, T * 0.18);
    box(c, x, y - T * 0.6, w, h + T * 0.45, T * 0.1, '#2a1c16');
    rect(c, x + T * 0.1, y - T * 0.5, w - T * 0.2, T * 0.06, 'rgba(255,255,255,.2)');
    rect(c, x + T * 0.2, y + T * 0.52, w - T * 0.4, T * 0.5, '#f7f3ea');
    for (let i = 0; i < 18; i++) { const kx = x + T * 0.2 + (i * (w - T * 0.4)) / 18; rect(c, kx, y + T * 0.52, 1, T * 0.5, 'rgba(0,0,0,.4)'); if (i % 7 !== 2 && i % 7 !== 6) rect(c, kx + T * 0.1, y + T * 0.52, T * 0.1, T * 0.3, '#17100c'); }
    box(c, x + w * 0.3, y - T * 0.28, T * 1.3, T * 0.62, T * 0.03, '#f4ead2');
    rect(c, x + w * 0.3 + T * 0.14, y - T * 0.14, T * 1, 1, 'rgba(50,30,10,.6)'); rect(c, x + w * 0.3 + T * 0.14, y + T * 0.02, T * 1, 1, 'rgba(50,30,10,.6)');
    box(c, x + w / 2 - T * 0.7, y + h - T * 0.1, T * 1.4, T * 0.4, T * 0.1, '#6a3d22');
  }

  // ---------- card tables ----------
  function tableBase(c, x, y, W, H, T, felt, rim) {
    shadow(c, x + W / 2, y + H * 0.96, W * 0.56, T * 0.32);
    for (const [sx, sy] of [[x - T * 0.28, y + T * 1.1], [x + W + T * 0.28, y + T * 1.1]]) { // stools
      rect(c, sx - T * 0.05, sy, T * 0.1, T * 0.42, '#3a2517');
      oval(c, sx, sy, T * 0.32, T * 0.14, '#8d5a37'); oval(c, sx, sy - T * 0.04, T * 0.3, T * 0.12, '#b98a5c');
    }
    rect(c, x + W / 2 - T * 0.16, y + T * 1.1, T * 0.32, T * 0.7, '#3a2517');
    oval(c, x + W / 2, y + T * 1.86, T * 0.7, T * 0.16, '#2a1a12');
    oval(c, x + W / 2, y + T * 1.0, W * 0.52, T * 0.78, '#3a2214');
    oval(c, x + W / 2, y + T * 0.9, W * 0.52, T * 0.78, rim);
    oval(c, x + W / 2, y + T * 0.88, W * 0.45, T * 0.62, felt);
  }
  function tableSign(c, name, x, y, W, T, col) {
    box(c, x + W / 2 - T * 1.15, y - T * 0.5, T * 2.3, T * 0.54, T * 0.1, 'rgba(20,12,8,.85)');
    text(c, name, x + W / 2, y - T * 0.22, T * 0.36, col);
  }
  function miniCard(c, cx, cy, T, col, flip) {
    const sx = Math.max(0.12, Math.abs(flip));
    c.fillStyle = col; c.beginPath(); c.roundRect(cx - T * 0.17 * sx, cy - T * 0.22, T * 0.34 * sx, T * 0.44, T * 0.04); c.fill();
  }
  const spots = {
    turncoat(c, sp, x, y, W, H, T, time, status) {
      tableBase(c, x, y, W, H, T, '#27356f', '#a97a4e');
      const live = status && status.phase === 'playing';
      for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) {
        const cycle = live ? Math.cos(time / 600 + i * 1.3 + j * 2.1) : 1;
        miniCard(c, x + W / 2 + (i - 1) * T * 0.46, y + T * 0.62 + j * T * 0.54, T, cycle > 0 ? '#6f8bff' : '#ff6b5e', cycle);
      }
      tableSign(c, 'TURNCOAT', x, y, W, T, '#c7d2ff');
    },
    'ring-out'(c, sp, x, y, W, H, T, time, status) {
      tableBase(c, x, y, W, H, T, '#c98f52', '#a97a4e');
      const live = status && status.phase === 'playing';
      c.strokeStyle = '#f4ead2'; c.lineWidth = Math.max(1.5, T * 0.07);
      c.beginPath(); c.ellipse(x + W / 2, y + T * 0.88, W * 0.32, T * 0.42, 0, 0, TAU); c.stroke();
      const shove = live ? Math.sin(time / 300) * T * 0.16 : 0;
      miniCard(c, x + W / 2 - T * 0.28 + shove, y + T * 0.86, T, '#6f8bff', 1);
      miniCard(c, x + W / 2 + T * 0.28 + shove, y + T * 0.86, T, '#ff6b5e', 1);
      tableSign(c, 'RING OUT', x, y, W, T, '#ffd9a8');
    },
  };

  // ---------- the storefront in Mountain Town ----------
  function drawFront(c, p, x, y, w, h, T, time) {
    const cx = x + w / 2;
    rect(c, x + T * 0.1, y + h - T * 0.15, w, T * 0.35, 'rgba(30,50,80,.2)');
    // Timber walls.
    rect(c, x + T * 0.2, y + T * 1.5, w - T * 0.4, h - T * 1.5, '#a06a41');
    for (let i = 0; i < 9; i++) rect(c, x + T * 0.2, y + T * 1.5 + i * T * 0.4, w - T * 0.4, T * 0.04, 'rgba(60,30,10,.3)');
    for (const px of [x + T * 0.2, x + w - T * 0.5]) rect(c, px, y + T * 1.5, T * 0.3, h - T * 1.5, '#6a3d22');
    // Pitched roof under snow.
    poly(c, [[x - T * 0.5, y + T * 1.9], [cx, y - T * 0.9], [x + w + T * 0.5, y + T * 1.9]], '#4b2e1c');
    poly(c, [[x + T * 0.1, y + T * 1.6], [cx, y - T * 0.5], [x + w - T * 0.1, y + T * 1.6]], '#2f6d62');
    for (const dir of [-1, 1]) poly(c, [[cx, y - T * 1.02], [cx + dir * (w / 2 + T * 0.62), y + T * 1.86], [cx + dir * (w / 2 - T * 0.3), y + T * 1.86], [cx, y - T * 0.32]], '#f7fbfe');
    // Chimney with smoke.
    const chX = x + w - T * 1.5;
    rect(c, chX, y - T * 0.6, T * 0.6, T * 1.3, '#7d7f88');
    box(c, chX - T * 0.08, y - T * 0.72, T * 0.76, T * 0.18, T * 0.06, '#ffffff');
    steam(c, chX + T * 0.3, y - T * 0.8, T * 2, time, 4);
    // Round window with a cup in it.
    dot(c, cx, y + T * 0.78, T * 0.52, '#3a2517'); dot(c, cx, y + T * 0.78, T * 0.42, '#ffd27a');
    box(c, cx - T * 0.18, y + T * 0.64, T * 0.36, T * 0.32, T * 0.07, '#7a4a2a');
    // Big warm windows.
    for (const wx of [x + T * 0.65, x + w - T * 2.05]) {
      box(c, wx - T * 0.08, y + h - T * 2.7, T * 1.56, T * 1.6, T * 0.08, '#3a2517');
      rect(c, wx, y + h - T * 2.62, T * 1.4, T * 1.44, '#ffd27a');
      rect(c, wx + T * 0.67, y + h - T * 2.62, T * 0.06, T * 1.44, '#3a2517'); rect(c, wx, y + h - T * 1.98, T * 1.4, T * 0.06, '#3a2517');
      // Little card silhouettes in the panes.
      for (let i = 0; i < 2; i++) box(c, wx + T * (0.2 + i * 0.72), y + h - T * 1.72, T * 0.3, T * 0.42, T * 0.04, 'rgba(90,50,20,.55)');
      box(c, wx - T * 0.14, y + h - T * 1.14, T * 1.68, T * 0.26, T * 0.05, '#6a3d22');
      for (let i = 0; i < 5; i++) dot(c, wx + T * (0.05 + i * 0.32), y + h - T * 1.2, T * 0.13, i % 2 ? '#d9402f' : '#3d7a4a');
    }
    // Door, on the south side above the step.
    box(c, cx - T * 0.72, y + h - T * 2.05, T * 1.44, T * 2.05, T * 0.5, '#3a2517');
    box(c, cx - T * 0.58, y + h - T * 1.92, T * 1.16, T * 1.92, T * 0.42, '#2f6d62');
    rect(c, cx - T * 0.4, y + h - T * 1.62, T * 0.8, T * 0.5, '#ffd27a');
    dot(c, cx + T * 0.4, y + h - T * 0.82, T * 0.07, '#f5b82e');
    // Striped awning and sign.
    const n = 10, sw = (w + T * 0.4) / n;
    for (let i = 0; i < n; i++) {
      const sx = x - T * 0.2 + i * sw, col = i % 2 ? '#fff4dd' : '#2f6d62';
      poly(c, [[sx + T * 0.08, y + T * 1.6], [sx + sw + T * 0.08, y + T * 1.6], [sx + sw, y + T * 2.1], [sx, y + T * 2.1]], col);
      c.fillStyle = col; c.beginPath(); c.arc(sx + sw / 2, y + T * 2.1, sw / 2, 0, Math.PI); c.fill();
    }
    box(c, cx - T * 1.5, y + T * 1.22, T * 3, T * 0.66, T * 0.12, '#3a2517');
    box(c, cx - T * 1.4, y + T * 1.3, T * 2.8, T * 0.5, T * 0.1, '#c58a4e');
    text(c, p.label || 'CAFE', cx, y + T * 1.56, T * 0.46, '#fff4dd');
    // String lights along the eaves.
    stringLights(c, x + T * 0.1, y + T * 2.5, x + w - T * 0.1, T * 0.22, T, time, 9);
  }

  const added = {
    'cafe-room': drawRoom, 'cafe-hearth': drawHearth, 'cafe-counter': drawCounter, 'cafe-booth': drawBooth, 'cafe-board': drawBoard,
    'cafe-sofa': drawSofa, 'cafe-chair': drawChair, 'cafe-plant': drawPlant, 'cafe-shelf': drawShelf, 'cafe-cat': drawCat,
    'cafe-piano': drawPiano, 'cafe-front': drawFront,
  };
  Object.assign(Art.props, added);
  Art.flat.add('cafe-room');
  Art.covering.push(...Object.keys(added));
  Art.spots = spots;
})();
