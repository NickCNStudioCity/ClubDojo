// Art for Mountain Town and Mountain Peak: alpine tiles, buildings, the gondola, the hot spring,
// the Summit Bell and everything else that makes the mountains look like nowhere else in the world.
// Vector shapes like the rest of the v1 art. world.js looks props up by type in `props`.
// Every prop draws as fn(ctx, p, x, y, w, h, T, time, env); x/y/w/h are pixels, T is one tile, and
// env is { night, warm, weather, beacon, beaconRings, beaconGoal, bellAt, bellRung } (all optional).
(function () {
  const TAU = Math.PI * 2;

  function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function box(ctx, x, y, w, h, r, fill) { ctx.fillStyle = fill; rr(ctx, x, y, w, h, r); ctx.fill(); }
  function rect(ctx, x, y, w, h, fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  function poly(ctx, pts, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    pts.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
    ctx.closePath();
    ctx.fill();
  }
  function dot(ctx, x, y, r, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  function oval(ctx, x, y, rx, ry, fill) { ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill(); }
  function shadow(ctx, x, y, rx, ry) { oval(ctx, x, y, rx, ry, 'rgba(30,50,80,.2)'); }
  function rgb(c) { // '#rrggbb', or the 'rgb(r,g,b)' that mix() returns so mixes can be nested
    if (c[0] !== '#') return c.slice(4, -1).split(',').map(Number);
    const n = parseInt(c.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, k) {
    const A = rgb(a), B = rgb(b);
    return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`;
  }
  function label(ctx, text, cx, cy, size, fill) {
    ctx.font = `${size}px Bangers, Impact, "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = fill;
    ctx.fillText(text, cx, cy);
  }
  // A curling plume of smoke or steam rising from (x, y).
  function plume(ctx, x, y, T, time, n, tone, seed = 0, rise = 1.7) {
    for (let i = 0; i < n; i++) {
      const k = ((time / 2600 + i / n + seed * 0.37) % 1);
      const a = (1 - k) * Math.min(1, k * 6) * 0.55;
      ctx.fillStyle = `rgba(${tone},${a})`;
      ctx.beginPath();
      ctx.arc(x + Math.sin(k * 5 + seed + i) * T * 0.22 + k * T * 0.3, y - k * T * rise, T * (0.12 + k * 0.3), 0, TAU);
      ctx.fill();
    }
  }
  function flame(ctx, cx, base, s, time, seed = 0) {
    const f = (t, m) => 1 + Math.sin(time / t + seed) * m;
    const leaf = (x, h, w, c) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x - w, base);
      ctx.quadraticCurveTo(x - w * 1.1, base - h * 0.5, x + Math.sin(time / 120 + seed) * w * 0.3, base - h);
      ctx.quadraticCurveTo(x + w * 1.1, base - h * 0.5, x + w, base);
      ctx.closePath(); ctx.fill();
    };
    leaf(cx, s * f(90, 0.12), s * 0.42, '#e8532c');
    leaf(cx - s * 0.2, s * 0.66 * f(70, 0.18), s * 0.24, '#f58a2c');
    leaf(cx + s * 0.2, s * 0.72 * f(80, 0.16), s * 0.24, '#f58a2c');
    leaf(cx, s * 0.55 * f(60, 0.15), s * 0.22, '#ffd54f');
  }

  // ---------- Tiles ----------
  // The two mountain themes repaint the ordinary tile characters. Returns true if it drew the tile.
  function tile(ctx, c, x, y, T, time, theme) {
    const px = x * T, py = y * T, n = hash(x, y), S = T + 0.5;
    if (theme === 'alpine') {
      if (c === 'g' || c === 'f') {
        const frost = hash(x >> 2, y >> 2);
        rect(ctx, px, py, S, S, n > 0.8 ? '#a6bd86' : '#9fb780');
        if (frost > 0.62) { ctx.fillStyle = `rgba(245,250,255,${(frost - 0.62) * 1.5})`; ctx.fillRect(px, py, S, S); }
        if (n < 0.14) {
          ctx.strokeStyle = 'rgba(70,100,60,.5)'; ctx.lineWidth = Math.max(1, T * 0.05);
          ctx.beginPath();
          ctx.moveTo(px + T * 0.3, py + T * 0.75); ctx.lineTo(px + T * 0.33, py + T * 0.55);
          ctx.moveTo(px + T * 0.42, py + T * 0.75); ctx.lineTo(px + T * 0.47, py + T * 0.5);
          ctx.stroke();
        } else if (n > 0.93) dot(ctx, px + T * 0.6, py + T * 0.5, T * 0.13, 'rgba(255,255,255,.75)');
        if (c === 'f') {
          const petals = ['#7a6ee0', '#ffffff', '#58a9e8', '#d58be0'];
          for (let i = 0; i < 3; i++) {
            const fx = px + T * (0.2 + hash(x + i, y) * 0.6), fy = py + T * (0.2 + hash(x, y + i) * 0.6);
            dot(ctx, fx, fy, T * 0.085, petals[Math.floor(hash(x * 3 + i, y) * petals.length)]);
            dot(ctx, fx, fy, T * 0.03, '#ffd54f');
          }
        }
        return true;
      }
      if (c === ':') { // cobbles
        rect(ctx, px, py, S, S, '#8e8578');
        const tones = ['#b5aa99', '#a89d8c', '#bfb4a3', '#9f9586'];
        for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
          const off = j % 2 ? T * 0.1 : -T * 0.05;
          box(ctx, px + i * T * 0.5 + off + T * 0.03, py + j * T * 0.5 + T * 0.03, T * 0.44, T * 0.42, T * 0.13, tones[Math.floor(hash(x * 2 + i, y * 2 + j) * 4)]);
        }
        if (n > 0.86) oval(ctx, px + T * 0.5, py + T * 0.55, T * 0.3, T * 0.14, 'rgba(255,255,255,.75)');
        return true;
      }
      if (c === '#') { rock(ctx, px, py, T, n); return true; }
    }
    if (theme === 'summit') {
      if (c === '.') {
        const drift = hash(x >> 1, y >> 1);
        rect(ctx, px, py, S, S, drift > 0.55 ? '#f6fbfe' : '#edf5fa');
        if (n < 0.12) { ctx.strokeStyle = 'rgba(160,190,215,.55)'; ctx.lineWidth = Math.max(1, T * 0.05); ctx.beginPath(); ctx.moveTo(px + T * 0.15, py + T * 0.6); ctx.quadraticCurveTo(px + T * 0.5, py + T * 0.42, px + T * 0.85, py + T * 0.62); ctx.stroke(); }
        if (n > 0.95) dot(ctx, px + T * 0.4, py + T * 0.35, T * 0.04, '#ffffff');
        return true;
      }
      if (c === ':') { // a trodden path with footprints and bits of stone showing through
        rect(ctx, px, py, S, S, '#cfdbe6');
        oval(ctx, px + T * (0.3 + n * 0.1), py + T * 0.32, T * 0.09, T * 0.13, 'rgba(120,145,175,.45)');
        oval(ctx, px + T * (0.62 - n * 0.1), py + T * 0.72, T * 0.09, T * 0.13, 'rgba(120,145,175,.45)');
        if (n > 0.7) box(ctx, px + T * 0.55, py + T * 0.2, T * 0.3, T * 0.16, T * 0.07, 'rgba(120,125,135,.55)');
        return true;
      }
      if (c === '*') { // the frozen lake
        rect(ctx, px, py, S, S, n > 0.6 ? '#a8ddef' : '#a0d8ec');
        const shine = (Math.sin(time / 900 + x * 0.7 + y * 0.4) + 1) / 2;
        ctx.strokeStyle = `rgba(255,255,255,${0.35 + shine * 0.5})`; ctx.lineWidth = Math.max(1, T * 0.05);
        ctx.beginPath(); ctx.moveTo(px + T * (0.15 + n * 0.3), py + T * 0.35); ctx.lineTo(px + T * (0.45 + n * 0.3), py + T * 0.18); ctx.stroke();
        if (n < 0.16) { // a crack
          ctx.strokeStyle = 'rgba(60,120,160,.4)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(px, py + T * 0.7); ctx.lineTo(px + T * 0.4, py + T * 0.55); ctx.lineTo(px + T * 0.55, py + T * 0.9); ctx.moveTo(px + T * 0.4, py + T * 0.55); ctx.lineTo(px + T, py + T * 0.4); ctx.stroke();
        }
        return true;
      }
      if (c === '#') { rect(ctx, px, py, S, S, '#f0f6fa'); rock(ctx, px, py, T, n); return true; }
    }
    return false;
  }
  function rock(ctx, px, py, T, n) {
    box(ctx, px + T * 0.04, py + T * 0.18, T * 0.92, T * 0.8, T * 0.24, '#6f7786');
    box(ctx, px + T * 0.1, py + T * 0.24, T * 0.5, T * 0.5, T * 0.16, '#848d9c');
    box(ctx, px + T * (0.08 + n * 0.1), py + T * 0.08, T * 0.7, T * 0.3, T * 0.14, '#ffffff');
  }

  const SURROUND = {
    alpine: { base: '#7f9a78', dark: '#3f6655', mid: '#4b7a63', light: '#f4f8fb' },
    summit: { base: '#e6f0f6', dark: '#7c8796', mid: '#98a3b1', light: '#ffffff' },
  };
  // One tile of the scenery past the room's edge: snowy pines, or rock and drifts up top.
  function surroundTile(ctx, theme, x, y, T, n) {
    const px = x * T, py = y * T, c = SURROUND[theme];
    if (n > 0.55) return;
    if (theme === 'alpine') {
      const cx = px + T / 2;
      poly(ctx, [[cx, py - T * 0.6], [cx + T * 0.62, py + T * 0.9], [cx - T * 0.62, py + T * 0.9]], n < 0.28 ? c.dark : c.mid);
      poly(ctx, [[cx, py - T * 0.6], [cx + T * 0.26, py], [cx - T * 0.26, py]], c.light);
    } else {
      poly(ctx, [[px + T * 0.05, py + T * 0.95], [px + T * (0.3 + n * 0.6), py + T * 0.1], [px + T * 0.98, py + T * 0.95]], n < 0.25 ? c.dark : c.mid);
      poly(ctx, [[px + T * (0.1 + n * 0.5), py + T * 0.42], [px + T * (0.3 + n * 0.6), py + T * 0.1], [px + T * (0.5 + n * 0.6), py + T * 0.42]], c.light);
    }
  }

  // ---------- The big backdrop ----------
  function peak(ctx, cx, base, top, half, rockC, shade, snowC, seed, snowK = 0.42) {
    poly(ctx, [[cx - half, base], [cx, top], [cx + half, base]], rockC);
    const H = base - top, zig = [[cx, top]];
    for (let i = 1; i <= 5; i++) zig.push([cx + half * 0.12 * (i % 2 ? 1 : -0.3) + hash(seed, i) * half * 0.1, top + (H * i) / 5]);
    poly(ctx, [...zig, [cx + half, base]], shade);
    const line = top + H * snowK, w = half * snowK, cap = [[cx - w, line], [cx, top], [cx + w, line]];
    const n = 7;
    for (let i = 1; i < n; i++) cap.push([cx + w - (2 * w * i) / n, line + (i % 2 ? H * 0.11 : -H * 0.02) * (0.6 + hash(seed, i + 9) * 0.8)]);
    poly(ctx, cap, snowC);
    const lit = [[cx, top], [cx + w * 0.1, line + H * 0.03], [cx + w, line], ];
    poly(ctx, lit, 'rgba(150,185,220,.35)');
  }
  function cloud(ctx, x, y, s, fill) {
    for (const [dx, dy, r] of [[0, 0, 0.5], [0.55, 0.06, 0.38], [-0.55, 0.08, 0.36], [1, 0.14, 0.24], [-1, 0.16, 0.22]]) dot(ctx, x + dx * s, y + dy * s, r * s, fill);
  }
  function drawBackdrop(ctx, p, x, y, w, h, T, time, env) {
    const night = env.night || 0, warm = env.warm || 0;
    const X0 = x - T * 40, X1 = x + w + T * 40, base = y + h;
    const sky = ctx.createLinearGradient(0, y - T * 8, 0, base);
    sky.addColorStop(0, mix(mix('#4d9ad6', '#7a6fb0', warm * 0.7), '#0b1234', night));
    sky.addColorStop(1, mix(mix('#d6eef9', '#ffc08a', warm), '#2e3b77', night));
    ctx.fillStyle = sky;
    ctx.fillRect(X0, y - T * 30, X1 - X0, h + T * 30);

    // Sun by day, moon by night: both cross the sky with the host clock.
    const hour = env.hour ?? 12;
    const dayK = Math.max(0, Math.min(1, (hour - 6) / 13));
    const sx = x + w * (0.1 + dayK * 0.8), sy = y + T * (2.3 - Math.sin(dayK * Math.PI) * 2.1);
    if (night < 0.8) {
      const g = ctx.createRadialGradient(sx, sy, 1, sx, sy, T * 3);
      g.addColorStop(0, `rgba(255,240,190,${0.9 - night})`); g.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, T * 3, 0, TAU); ctx.fill();
      dot(ctx, sx, sy, T * 0.6, mix('#fff6cf', '#ffb36b', warm));
    }
    if (night > 0.35) {
      const mh = hour >= 12 ? (hour - 17) / 12 : (hour + 7) / 12, mx = x + w * (0.12 + mh * 0.76), my = y + T * (2 - Math.sin(mh * Math.PI) * 1.7);
      ctx.globalAlpha = Math.min(1, (night - 0.35) * 2.5);
      dot(ctx, mx, my, T * 0.55, '#f2f1da');
      dot(ctx, mx - T * 0.2, my - T * 0.12, T * 0.45, mix('#2e3b77', '#0b1234', 0.5));
      ctx.globalAlpha = 1;
    }

    // Far blue range, wide enough to carry on behind the margins beside the room.
    const farRock = mix(mix('#92adc9', '#b48b9e', warm * 0.6), '#232c5c', night), farShade = mix('#7f9cbb', '#1c2450', night), farSnow = mix(mix('#f4f9fd', '#ffd9bb', warm), '#6f7bb0', night);
    const lift = p.high ? T * 1.6 : 0; // from the summit the far range sits low on the horizon
    for (let i = -6; i <= 13; i++) {
      const px = x + i * T * 6 + hash(i, 3) * T * 2;
      peak(ctx, px, base + lift * 0.2, y + T * (0.5 + hash(i, 5) * 1.3) + lift, T * (3.8 + hash(i, 8) * 1.6), farRock, farShade, farSnow, i + 40);
    }
    const midRock = mix('#70819a', '#1b2146', night), midShade = mix('#5b6b84', '#151a3a', night), midSnow = mix(mix('#ffffff', '#ffe0c4', warm), '#8a95c4', night);
    if (!p.high) {
      // The great mountain the town sits under, with the trail gate at its foot.
      const cx = x + T * 13, top = y - T * 0.2;
      peak(ctx, cx + T * 13, base, y + T * 0.5, T * 6.5, midRock, midShade, midSnow, 21, 0.4);
      peak(ctx, cx - T * 9, base, y + T * 0.8, T * 5.5, midRock, midShade, midSnow, 17, 0.38);
      peak(ctx, cx, base + T * 0.3, top, T * 7.5, midRock, midShade, midSnow, 8, 0.46);
      if (env.beacon) {
        const pulse = 0.75 + Math.sin(time / 160) * 0.2;
        const g = ctx.createRadialGradient(cx, top, 1, cx, top, T * 2.2);
        g.addColorStop(0, `rgba(255,170,70,${pulse})`); g.addColorStop(1, 'rgba(255,170,70,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, top, T * 2.2, 0, TAU); ctx.fill();
        flame(ctx, cx, top + T * 0.12, T * 0.42, time, 3);
      }
      for (let i = -14; i <= 56; i += 1) { // a dark band of forest at the mountain's foot
        const tx = x + i * T + hash(i, 1) * T * 0.4, s = T * (0.45 + hash(i, 2) * 0.3);
        poly(ctx, [[tx, base - s * 2], [tx + s * 0.75, base + 1], [tx - s * 0.75, base + 1]], mix(i % 2 ? '#3f6655' : '#355a4b', '#10203a', night));
        poly(ctx, [[tx, base - s * 2], [tx + s * 0.28, base - s * 1.3], [tx - s * 0.28, base - s * 1.3]], mix('#f4f8fb', '#7c88b6', night));
      }
    } else {
      // At the summit the only thing lower than you is the weather: a sea of clouds.
      const seaY = base - T * 0.9;
      const sea = mix(mix('#ffffff', '#ffd9bb', warm), '#5a659c', night);
      rect(ctx, X0, seaY, X1 - X0, base - seaY + 1, sea);
      for (let i = -16; i <= 56; i++) {
        const drift = ((time / 900 + i * 2.1) % 80) - 8;
        cloud(ctx, x + drift * T, seaY - T * (0.02 + hash(i, 4) * 0.35), T * (0.7 + hash(i, 6) * 0.5), sea);
      }
      peak(ctx, x + T * 6, base, y + T * 1.2, T * 5.5, midRock, midShade, midSnow, 31, 0.5);
      peak(ctx, x + T * 28, base, y + T * 0.9, T * 7, midRock, midShade, midSnow, 37, 0.5);
    }
    // Drifting high clouds.
    const cl = `rgba(${night > 0.5 ? '130,140,190' : '255,255,255'},.85)`;
    for (let i = 0; i < 5; i++) {
      const cx = ((time / (5200 + i * 1400) + i * 0.27) % 1.3 - 0.15) * w + x;
      cloud(ctx, cx, y + T * (0.45 + (i % 3) * 0.55), T * (0.55 + (i % 2) * 0.3), cl);
    }
    // Snow bank where the mountain meets the town.
    ctx.fillStyle = mix('#f6fbfe', '#aeb8dc', night * 0.6);
    ctx.beginPath(); ctx.moveTo(X0, base + 1);
    for (let i = -40; i <= (p.w || 40) + 40; i++) ctx.lineTo(x + i * T, base - T * 0.2 - hash(i, 7) * T * 0.28);
    ctx.lineTo(X1, base + 1); ctx.closePath(); ctx.fill();
  }

  // ---------- Buildings ----------
  function warmWindow(ctx, x, y, w, h, T, env) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#ffe29a'); g.addColorStop(1, '#ffb65c');
    box(ctx, x - T * 0.07, y - T * 0.07, w + T * 0.14, h + T * 0.14, T * 0.06, '#3a2517');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    rect(ctx, x + w / 2 - T * 0.03, y, T * 0.06, h, '#3a2517');
    rect(ctx, x, y + h / 2 - T * 0.03, w, T * 0.06, '#3a2517');
    box(ctx, x - T * 0.12, y + h, w + T * 0.24, T * 0.12, T * 0.03, '#ffffff'); // snow on the sill
  }
  function drawLodge(ctx, p, x, y, w, h, T, time, env) {
    rect(ctx, x + T * 0.1, y + h - T * 0.15, w - T * 0.1, T * 0.35, 'rgba(30,50,80,.2)');
    if (p.style === 'trailpost') return trailPost(ctx, p, x, y, w, h, T, time, env);
    if (p.style === 'bathhouse') return bathhouse(ctx, p, x, y, w, h, T, time, env);
    const cx = x + w / 2, wallTop = y + T * 2.4;
    // Log walls with round log ends at the corners.
    rect(ctx, x + T * 0.3, wallTop, w - T * 0.6, h - T * 2.4, '#7b4a2c');
    for (let i = 0, row = wallTop; row < y + h - 1; i++, row += T * 0.42) {
      rect(ctx, x + T * 0.3, row, w - T * 0.6, T * 0.38, i % 2 ? '#8d5a37' : '#96623d');
      rect(ctx, x + T * 0.3, row + T * 0.33, w - T * 0.6, T * 0.05, 'rgba(50,25,10,.35)');
      for (const ex of [x + T * 0.3, x + w - T * 0.3]) { dot(ctx, ex, row + T * 0.19, T * 0.2, '#b98a5c'); dot(ctx, ex, row + T * 0.19, T * 0.1, '#946a42'); }
    }
    // Chimney with smoke.
    const chX = x + w * 0.76;
    rect(ctx, chX, y + T * 0.1, T * 0.8, T * 2, '#7d7f88');
    for (let i = 0; i < 4; i++) rect(ctx, chX + (i % 2 ? 0 : T * 0.2), y + T * (0.3 + i * 0.4), T * 0.6, T * 0.05, 'rgba(40,40,50,.4)');
    box(ctx, chX - T * 0.1, y, T, T * 0.22, T * 0.08, '#ffffff');
    plume(ctx, chX + T * 0.4, y, T, time, 6, '225,228,235', 1, 2.3);
    // A-frame roof under a thick blanket of snow.
    poly(ctx, [[x - T * 0.5, y + T * 2.7], [cx, y - T * 0.5], [x + w + T * 0.5, y + T * 2.7]], '#4b2e1c');
    poly(ctx, [[x + T * 1.1, y + T * 2.5], [cx, y + T * 0.45], [x + w - T * 1.1, y + T * 2.5]], '#a06a41');
    for (let i = 1; i < 5; i++) { const k = i / 5, yy = y + T * (0.45 + 2.05 * k), half = (w / 2 - T * 1.1) * k; rect(ctx, cx - half, yy, half * 2, T * 0.05, 'rgba(60,30,10,.35)'); }
    // Snow along both roof slopes, with a scalloped edge.
    for (const dir of [-1, 1]) {
      ctx.fillStyle = '#f7fbfe';
      ctx.beginPath();
      ctx.moveTo(cx, y - T * 0.62);
      ctx.lineTo(cx + dir * (w / 2 + T * 0.62), y + T * 2.55);
      const n = 7;
      for (let i = n; i >= 0; i--) {
        const k = i / n, ax = cx + dir * ((w / 2 + T * 0.1) * k), ay = y + T * (0.02 + 2.5 * k);
        ctx.quadraticCurveTo(ax + dir * T * 0.3, ay + T * 0.42, ax, ay + T * 0.14);
      }
      ctx.closePath(); ctx.fill();
    }
    // Round gable window, door, windows, hanging sign.
    dot(ctx, cx, y + T * 1.5, T * 0.42, '#3a2517');
    dot(ctx, cx, y + T * 1.5, T * 0.33, '#ffd27a');
    rect(ctx, cx - T * 0.03, y + T * 1.17, T * 0.06, T * 0.66, '#3a2517'); rect(ctx, cx - T * 0.33, y + T * 1.47, T * 0.66, T * 0.06, '#3a2517');
    box(ctx, cx - T * 0.8, y + h - T * 1.9, T * 1.6, T * 1.9, T * 0.5, '#3a2517');
    box(ctx, cx - T * 0.65, y + h - T * 1.76, T * 1.3, T * 1.76, T * 0.42, '#6a3d22');
    rect(ctx, cx - T * 0.03, y + h - T * 1.76, T * 0.06, T * 1.76, '#3a2517');
    ctx.strokeStyle = '#3d7a4a'; ctx.lineWidth = T * 0.12; ctx.beginPath(); ctx.arc(cx, y + h - T * 1.1, T * 0.24, 0, TAU); ctx.stroke(); // wreath
    dot(ctx, cx, y + h - T * 0.88, T * 0.08, '#d9402f');
    for (const wx of [x + T * 1.3, x + w - T * 2.8]) warmWindow(ctx, wx, y + T * 3.25, T * 1.5, T * 1.05, T, env);
    box(ctx, cx - T * 2.5, y + T * 2.35, T * 5, T * 0.75, T * 0.12, '#3a2517');
    box(ctx, cx - T * 2.4, y + T * 2.43, T * 4.8, T * 0.59, T * 0.1, '#c58a4e');
    label(ctx, p.label || '', cx, y + T * 2.74, Math.max(11, T * 0.56), '#fff4dd');
  }
  function trailPost(ctx, p, x, y, w, h, T, time, env) {
    const cx = x + w / 2, wallTop = y + T * 1.9;
    // Fieldstone base, timber upper floor.
    rect(ctx, x + T * 0.2, wallTop, w - T * 0.4, h - T * 1.9, '#a98a63');
    for (let i = 0; i <= 8; i++) rect(ctx, x + T * 0.2 + (i * (w - T * 0.4)) / 8, wallTop, T * 0.07, T * 1.05, '#7a5d3e');
    rect(ctx, x + T * 0.2, wallTop + T * 1.0, w - T * 0.4, T * 0.14, '#6a4e33');
    rect(ctx, x + T * 0.2, y + h - T * 2, w - T * 0.4, T * 2, '#8f939c');
    for (let j = 0; j < 4; j++) for (let i = 0; i < 9; i++) {
      const sx = x + T * 0.28 + i * (w - T * 0.5) / 9 + (j % 2 ? T * 0.28 : 0);
      if (sx > x + w - T * 0.9) continue;
      box(ctx, sx, y + h - T * 1.95 + j * T * 0.49, (w - T * 0.5) / 9 - T * 0.05, T * 0.44, T * 0.1, ['#a3a7b0', '#989ca6', '#adb1ba', '#8d919b'][Math.floor(hash(i, j) * 4)]);
    }
    // Low gabled roof with a snow blanket and an icicle fringe.
    poly(ctx, [[x - T * 0.4, y + T * 2.1], [x + T * 0.6, y + T * 0.2], [x + w - T * 0.6, y + T * 0.2], [x + w + T * 0.4, y + T * 2.1]], '#37566b');
    for (let i = 1; i < 4; i++) rect(ctx, x + T * (0.6 - i * 0.26), y + T * (0.2 + i * 0.47), w - T * (1.2 - i * 0.52), T * 0.05, 'rgba(10,20,40,.3)');
    poly(ctx, [[x + T * 0.5, y + T * 0.05], [x + w - T * 0.5, y + T * 0.05], [x + w - T * 0.05, y + T * 1.2], [x + T * 0.05, y + T * 1.2]], '#f7fbfe');
    for (let i = 0; i < 12; i++) { const ix = x + T * 0.1 + (i * (w - T * 0.2)) / 11; poly(ctx, [[ix - T * 0.08, y + T * 2.08], [ix + T * 0.08, y + T * 2.08], [ix, y + T * (2.2 + hash(i, 2) * 0.3)]], '#cdeaf7'); }
    // Compass-rose emblem, sign, door and a map window.
    box(ctx, cx - T * 2.6, y + T * 0.62, T * 5.2, T * 0.82, T * 0.14, '#2c4556');
    label(ctx, p.label || '', cx, y + T * 1.06, Math.max(11, T * 0.58), '#ffe9b0');
    box(ctx, cx - T * 0.7, y + h - T * 1.8, T * 1.4, T * 1.8, T * 0.14, '#2f4a5c');
    rect(ctx, cx - T * 0.54, y + h - T * 1.64, T * 1.08, T * 0.5, '#ffd27a');
    dot(ctx, cx + T * 0.42, y + h - T * 0.8, T * 0.07, '#f5b82e');
    for (const wx of [x + T * 0.9, x + w - T * 2.3]) warmWindow(ctx, wx, y + h - T * 1.65, T * 1.4, T * 0.95, T, env);
    for (const wx of [x + T * 1.2, x + w - T * 2.2]) warmWindow(ctx, wx, wallTop + T * 0.2, T, T * 0.6, T, env);
  }
  function bathhouse(ctx, p, x, y, w, h, T, time, env) {
    const cx = x + w / 2, wallTop = y + T * 1.8;
    rect(ctx, x + T * 0.2, wallTop, w - T * 0.4, h - T * 1.8, '#f0e6d2');
    for (const bx of [x + T * 0.2, cx - T * 0.1, x + w - T * 0.4, x + w * 0.27, x + w * 0.73]) rect(ctx, bx, wallTop, T * 0.2, h - T * 1.8, '#5b3a22');
    rect(ctx, x + T * 0.2, wallTop + T * 0.2, w - T * 0.4, T * 0.14, '#5b3a22');
    rect(ctx, x + T * 0.2, y + h - T * 0.5, w - T * 0.4, T * 0.5, '#8d8f98');
    // Sweeping tiled roof.
    ctx.fillStyle = '#2f4d58';
    ctx.beginPath();
    ctx.moveTo(x - T * 0.7, y + T * 2.2);
    ctx.quadraticCurveTo(x + T * 0.6, y + T * 1.5, x + T * 1.2, y + T * 0.35);
    ctx.lineTo(x + w - T * 1.2, y + T * 0.35);
    ctx.quadraticCurveTo(x + w - T * 0.6, y + T * 1.5, x + w + T * 0.7, y + T * 2.2);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(10,25,35,.35)'; ctx.lineWidth = Math.max(1, T * 0.05);
    for (let i = 1; i < 9; i++) { const k = i / 9, top = x + T * 1.2 + (w - T * 2.4) * k, bot = x - T * 0.5 + (w + T) * k; ctx.beginPath(); ctx.moveTo(top, y + T * 0.4); ctx.quadraticCurveTo((top + bot) / 2, y + T * 1.6, bot, y + T * 2.1); ctx.stroke(); }
    box(ctx, x + T * 0.9, y + T * 0.05, w - T * 1.8, T * 0.46, T * 0.2, '#f7fbfe'); // snow along the ridge
    for (const sx of [x - T * 0.15, x + w - T * 1.35]) box(ctx, sx, y + T * 1.72, T * 1.5, T * 0.2, T * 0.1, '#f7fbfe');
    // Steam vent on the ridge, and the noren curtains over the door with the hot-spring mark.
    rect(ctx, cx - T * 0.5, y - T * 0.35, T, T * 0.45, '#5b3a22');
    box(ctx, cx - T * 0.7, y - T * 0.55, T * 1.4, T * 0.24, T * 0.1, '#f7fbfe');
    plume(ctx, cx, y - T * 0.5, T, time, 7, '255,255,255', 2, 2.4);
    rect(ctx, cx - T * 1.1, y + h - T * 2.1, T * 2.2, T * 2.1, '#2b1b12');
    for (let i = 0; i < 3; i++) {
      const sway = Math.sin(time / 800 + i) * T * 0.03;
      poly(ctx, [[cx - T * 1.1 + i * T * 0.74, y + h - T * 2.1], [cx - T * 0.38 + i * T * 0.74, y + h - T * 2.1], [cx - T * 0.38 + i * T * 0.74 + sway, y + h - T * 1.05], [cx - T * 1.1 + i * T * 0.74 + sway, y + h - T * 1.05]], i === 1 ? '#c8473b' : '#a7372d');
    }
    ctx.strokeStyle = '#fff4dd'; ctx.lineWidth = Math.max(1.5, T * 0.07); ctx.lineCap = 'round';
    for (const d of [-0.28, 0, 0.28]) { ctx.beginPath(); ctx.moveTo(cx + d * T, y + h - T * 1.72); ctx.bezierCurveTo(cx + (d - 0.14) * T, y + h - T * 1.86, cx + (d + 0.14) * T, y + h - T * 1.98, cx + d * T, y + h - T * 2.07); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(cx, y + h - T * 1.72, T * 0.42, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.lineCap = 'butt';
    for (const wx of [x + T * 0.65, x + w - T * 1.75]) warmWindow(ctx, wx, y + h - T * 2.3, T * 1.1, T * 0.9, T, env);
    box(ctx, cx - T * 1.7, y + T * 1.1, T * 3.4, T * 0.66, T * 0.1, '#5b3a22');
    label(ctx, p.label || '', cx, y + T * 1.44, Math.max(10, T * 0.48), '#ffe9b0');
  }

  // ---------- Set pieces ----------
  function drawGondola(ctx, p, x, y, w, h, T, time) {
    const ax = x + w / 2, ay = y + T * 0.75, bx = p.toX * T, by = p.toY * T, cableA = 'rgba(40,45,60,.9)';
    // Two cables, up and down, then cabins riding each.
    const cabin = (cx, cy, c) => {
      ctx.strokeStyle = '#2e3442'; ctx.lineWidth = Math.max(1.5, T * 0.07);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + T * 0.5); ctx.stroke();
      box(ctx, cx - T * 0.48, cy + T * 0.5, T * 0.96, T * 0.74, T * 0.18, c);
      box(ctx, cx - T * 0.38, cy + T * 0.6, T * 0.76, T * 0.3, T * 0.07, '#d9f1fb');
      rect(ctx, cx - T * 0.04, cy + T * 0.6, T * 0.08, T * 0.3, c);
      box(ctx, cx - T * 0.42, cy + T * 0.44, T * 0.84, T * 0.14, T * 0.07, '#ffffff');
    };
    for (const [off, dir, c] of [[-T * 0.28, 1, '#d9402f'], [T * 0.28, -1, '#2f8a8c']]) {
      ctx.strokeStyle = cableA; ctx.lineWidth = Math.max(1, T * 0.05);
      ctx.beginPath(); ctx.moveTo(ax, ay + off); ctx.lineTo(bx, by + off); ctx.stroke();
      for (let i = 0; i < 3; i++) {
        let k = ((time / 16000) * dir + i / 3) % 1; if (k < 0) k += 1;
        cabin(ax + (bx - ax) * k, ay + off + (by - ay) * k, c);
      }
    }
    // The station: a timber shed with a turning bullwheel.
    rect(ctx, x + T * 0.1, y + h - T * 0.15, w, T * 0.3, 'rgba(30,50,80,.2)');
    rect(ctx, x + T * 0.3, y + T * 1.2, w - T * 0.6, h - T * 1.2, '#7a5535');
    for (let i = 0; i < 6; i++) rect(ctx, x + T * 0.3 + (i * (w - T * 0.6)) / 6, y + T * 1.2, T * 0.05, h - T * 1.2, 'rgba(40,20,10,.35)');
    box(ctx, x + T * 1.05, y + h - T * 1.25, T * 1.9, T * 1.25, T * 0.1, '#2a1c12');
    const wx = x + w / 2, wy = y + h - T * 0.72, a = time / 400;
    dot(ctx, wx, wy, T * 0.5, '#a9adb7'); dot(ctx, wx, wy, T * 0.38, '#2a1c12');
    ctx.strokeStyle = '#d0d3da'; ctx.lineWidth = Math.max(1.5, T * 0.07);
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(wx - Math.cos(a + i * 1.05) * T * 0.42, wy - Math.sin(a + i * 1.05) * T * 0.42); ctx.lineTo(wx + Math.cos(a + i * 1.05) * T * 0.42, wy + Math.sin(a + i * 1.05) * T * 0.42); ctx.stroke(); }
    poly(ctx, [[x - T * 0.25, y + T * 1.35], [x + T * 0.5, y + T * 0.15], [x + w - T * 0.5, y + T * 0.15], [x + w + T * 0.25, y + T * 1.35]], '#54392a');
    poly(ctx, [[x + T * 0.4, y], [x + w - T * 0.4, y], [x + w - T * 0.05, y + T * 0.85], [x + T * 0.05, y + T * 0.85]], '#f7fbfe');
    box(ctx, wx - T * 1.1, y + T * 0.5, T * 2.2, T * 0.54, T * 0.08, '#2c4556');
    label(ctx, 'GONDOLA', wx, y + T * 0.78, Math.max(9, T * 0.4), '#ffe9b0');
  }

  function drawHotspring(ctx, p, x, y, w, h, T, time) {
    const water = ctx.createLinearGradient(0, y, 0, y + h);
    water.addColorStop(0, '#7fd9d3'); water.addColorStop(1, '#4fb8c4');
    const inset = T * 0.25;
    ctx.fillStyle = '#8a8d97';
    rr(ctx, x - T * 0.1, y - T * 0.05, w + T * 0.2, h + T * 0.15, T * 1.5); ctx.fill();
    ctx.fillStyle = water;
    rr(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, T * 1.25); ctx.fill();
    // Ripples and shimmer.
    ctx.strokeStyle = 'rgba(255,255,255,.42)'; ctx.lineWidth = Math.max(1, T * 0.05);
    const W = p.w || 1, H = p.h || 1;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const n = hash(i + 50, j + 60);
      if (n > 0.55 || i === 0 || i === W - 1 || j === 0 || j === H - 1) continue;
      const ph = time / 650 + n * 20, cx = x + (i + 0.5) * T, cy = y + (j + 0.5) * T;
      ctx.beginPath(); ctx.moveTo(cx - T * 0.32, cy + Math.sin(ph) * T * 0.05); ctx.quadraticCurveTo(cx, cy - T * 0.14 + Math.sin(ph + 1) * T * 0.05, cx + T * 0.32, cy + Math.sin(ph + 2) * T * 0.05); ctx.stroke();
    }
    // A ring of snow-capped stones.
    const perim = 2 * (W + H), R = (a, b) => hash(a * 3 + 1, b * 5 + 2);
    for (let i = 0; i < perim; i++) {
      const k = i / perim * perim;
      let sx, sy;
      if (k < W) { sx = x + k * T; sy = y; } else if (k < W + H) { sx = x + w; sy = y + (k - W) * T; } else if (k < 2 * W + H) { sx = x + w - (k - W - H) * T; sy = y + h; } else { sx = x; sy = y + h - (k - 2 * W - H) * T; }
      // Keep the corners rounded, and leave a gap at the top for the steps.
      const nx = Math.min(sx - x, x + w - sx) / T, ny = Math.min(sy - y, y + h - sy) / T;
      if (nx < 1 && ny < 1) { const pull = (1 - Math.max(nx, ny)) * T * 0.55; sx += sx < x + w / 2 ? pull : -pull; sy += sy < y + h / 2 ? pull : -pull; }
      if (sy === y && sx > x + T * 2 && sx < x + T * 4) continue;
      const r = T * (0.3 + R(i, 1) * 0.16);
      oval(ctx, sx, sy + T * 0.05, r, r * 0.8, ['#7a7e89', '#8c909b', '#6f737e'][Math.floor(R(i, 2) * 3)]);
      oval(ctx, sx - r * 0.1, sy - r * 0.32, r * 0.72, r * 0.42, '#ffffff');
    }
    box(ctx, x + T * 2.1, y - T * 0.1, T * 1.8, T * 0.42, T * 0.08, '#9a8f7e'); // stone step in
  }

  // Rounds off the frozen lake's tile edge: drifted snow outside, pale shallow ice inside.
  function drawLakeShore(ctx, p, x, y, w, h, T) {
    const cx = x + w / 2, cy = y + h / 2, rx = w / 2 - T, ry = h / 2 - T * 0.6;
    const ring = (dr, width, color) => { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.ellipse(cx, cy, rx + dr, ry + dr, 0, 0, TAU); ctx.stroke(); };
    ring(T * 0.8, T * 1.5, '#f2f8fc');
    ring(-T * 0.08, T * 0.6, '#c3e8f5');
    ring(T * 0.26, T * 0.14, '#ffffff');
  }

  function drawCampfire(ctx, p, x, y, w, h, T, time) {
    const cx = x + T / 2, cy = y + T * 0.72;
    oval(ctx, cx, cy, T * 1.15, T * 0.55, 'rgba(120,100,80,.35)'); // melted patch
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU, sx = cx + Math.cos(a) * T * 0.6, sy = cy + Math.sin(a) * T * 0.32;
      oval(ctx, sx, sy, T * 0.17, T * 0.13, i % 2 ? '#7a7e89' : '#8c909b');
    }
    ctx.strokeStyle = '#4a2e1a'; ctx.lineWidth = T * 0.16; ctx.lineCap = 'round';
    for (const [a, b, c, d] of [[-0.38, 0.1, 0.38, -0.08], [-0.38, -0.08, 0.38, 0.1]]) { ctx.beginPath(); ctx.moveTo(cx + a * T, cy + b * T); ctx.lineTo(cx + c * T, cy + d * T); ctx.stroke(); }
    ctx.lineCap = 'butt';
    const g = ctx.createRadialGradient(cx, cy - T * 0.3, 1, cx, cy - T * 0.3, T * 2.4);
    g.addColorStop(0, 'rgba(255,190,90,.35)'); g.addColorStop(1, 'rgba(255,190,90,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy - T * 0.3, T * 2.4, 0, TAU); ctx.fill();
    flame(ctx, cx, cy, T * 1, time, p.x);
    for (let i = 0; i < 5; i++) { // sparks
      const k = (time / 1100 + i / 5) % 1;
      dot(ctx, cx + Math.sin(k * 9 + i) * T * 0.3, cy - T * 0.5 - k * T * 1.6, T * 0.04 * (1 - k) + 0.5, `rgba(255,${180 - k * 80},80,${1 - k})`);
    }
  }

  function drawBell(ctx, p, x, y, w, h, T, time, env) {
    const cx = x + w / 2, age = env.bellAt ? time - env.bellAt : 1e9;
    const swing = age < 2600 ? Math.sin(age / 130) * 0.42 * (1 - age / 2600) : Math.sin(time / 1500) * 0.015;
    shadow(ctx, cx, y + h - T * 0.1, w * 0.55, T * 0.4);
    // Stone steps.
    for (let i = 0; i < 3; i++) box(ctx, x + T * (i * 0.3), y + h - T * (0.3 + i * 0.36) - T * 0.05, w - T * (i * 0.6), T * 0.42, T * 0.06, ['#a2a6b1', '#b3b7c1', '#c2c6cf'][i]);
    // Posts.
    for (const px of [x + T * 0.75, x + w - T * 1.05]) { rect(ctx, px, y + T * 0.4, T * 0.3, h - T * 1.3, '#7a2f26'); rect(ctx, px, y + T * 0.4, T * 0.09, h - T * 1.3, '#9c4034'); }
    // The great bell, swung from the top of the frame.
    ctx.save();
    ctx.translate(cx, y + T * 0.5);
    ctx.rotate(swing);
    rect(ctx, -T * 0.06, 0, T * 0.12, T * 0.32, '#34302a');
    const gr = ctx.createLinearGradient(-T, 0, T, 0);
    gr.addColorStop(0, '#6d4f23'); gr.addColorStop(0.4, '#d6a84e'); gr.addColorStop(0.65, '#b98a3a'); gr.addColorStop(1, '#5e431f');
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.moveTo(-T * 0.32, T * 0.3);
    ctx.quadraticCurveTo(-T * 0.44, T * 1.05, -T * 0.82, T * 1.72);
    ctx.lineTo(T * 0.82, T * 1.72);
    ctx.quadraticCurveTo(T * 0.44, T * 1.05, T * 0.32, T * 0.3);
    ctx.quadraticCurveTo(0, T * 0.14, -T * 0.32, T * 0.3);
    ctx.closePath(); ctx.fill();
    rect(ctx, -T * 0.71, T * 1.5, T * 1.42, T * 0.08, 'rgba(60,40,10,.55)');
    rect(ctx, -T * 0.52, T * 1.02, T * 1.04, T * 0.05, 'rgba(60,40,10,.4)');
    dot(ctx, 0, T * 1.82, T * 0.14, '#4a3a22');
    ctx.restore();
    if (env.bellRung) { // a golden ribbon: you have rung today
      ctx.strokeStyle = '#f5b82e'; ctx.lineWidth = T * 0.09;
      ctx.beginPath(); ctx.moveTo(x + T * 0.9, y + T * 1.3); ctx.quadraticCurveTo(x + T * 1.3, y + T * 1.65, x + T * 0.95, y + T * 2.1); ctx.stroke();
    }
    // Curved roof, thick with snow.
    ctx.fillStyle = '#9c3a2e';
    ctx.beginPath();
    ctx.moveTo(x - T * 0.5, y + T * 0.75);
    ctx.quadraticCurveTo(cx, y - T * 1.25, x + w + T * 0.5, y + T * 0.75);
    ctx.lineTo(x + w - T * 0.2, y + T * 0.5);
    ctx.quadraticCurveTo(cx, y - T * 0.7, x + T * 0.2, y + T * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f7fbfe';
    ctx.beginPath();
    ctx.moveTo(x - T * 0.1, y + T * 0.42);
    ctx.quadraticCurveTo(cx, y - T * 1.55, x + w + T * 0.1, y + T * 0.42);
    ctx.quadraticCurveTo(cx, y - T * 0.8, x - T * 0.1, y + T * 0.42);
    ctx.closePath(); ctx.fill();
    rect(ctx, x + T * 0.4, y + T * 0.44, w - T * 0.8, T * 0.14, '#5b1f19');
    if (age < 1800) {
      ctx.strokeStyle = `rgba(245,184,46,${0.75 * (1 - age / 1800)})`; ctx.lineWidth = Math.max(2, T * 0.1);
      for (let i = 0; i < 3; i++) { const r = T * (1 + (age / 1800) * 6) * (1 - i * 0.22); ctx.beginPath(); ctx.ellipse(cx, y + T * 1.5, r, r * 0.55, 0, 0, TAU); ctx.stroke(); }
    }
  }

  function drawBeacon(ctx, p, x, y, w, h, T, time, env) {
    const cx = x + w / 2;
    shadow(ctx, cx, y + h - T * 0.1, w * 0.45, T * 0.25);
    box(ctx, cx - T * 0.7, y + h - T * 0.55, T * 1.4, T * 0.5, T * 0.08, '#9a9ea9');
    box(ctx, cx - T * 0.4, y + T * 0.75, T * 0.8, T * 0.85, T * 0.05, '#868a95');
    ctx.fillStyle = '#34363f';
    ctx.beginPath(); ctx.moveTo(cx - T * 0.82, y + T * 0.05); ctx.lineTo(cx + T * 0.82, y + T * 0.05); ctx.lineTo(cx + T * 0.45, y + T * 0.82); ctx.lineTo(cx - T * 0.45, y + T * 0.82); ctx.closePath(); ctx.fill();
    if (env.beacon) {
      const g = ctx.createRadialGradient(cx, y, 2, cx, y, T * 3.4);
      g.addColorStop(0, 'rgba(255,170,70,.55)'); g.addColorStop(1, 'rgba(255,170,70,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, y, T * 3.4, 0, TAU); ctx.fill();
      flame(ctx, cx, y + T * 0.25, T * 1.9, time, 2);
      flame(ctx, cx - T * 0.35, y + T * 0.25, T * 1.1, time, 5);
      flame(ctx, cx + T * 0.35, y + T * 0.25, T * 1.1, time, 8);
    } else {
      oval(ctx, cx, y + T * 0.1, T * 0.7, T * 0.28, '#f7fbfe');
      for (let i = 0; i < 2; i++) rect(ctx, cx - T * (0.4 - i * 0.5), y - T * 0.06 + i * T * 0.03, T * 0.3, T * 0.08, '#4a2e1a');
      if (env.beaconGoal) { // how close the village is to lighting it
        for (let i = 0; i < env.beaconGoal; i++) dot(ctx, cx - (env.beaconGoal - 1) * T * 0.15 + i * T * 0.3, y + T * 1.15, T * 0.1, i < (env.beaconRings || 0) ? '#f5b82e' : '#585b66');
      }
    }
  }

  function drawFlags(ctx, p, x, y, w, h, T, time) {
    const x2 = p.x2 * T, y2 = p.y2 * T, n = Math.max(5, Math.round(Math.hypot(x2 - x, y2 - y) / (T * 0.62)));
    const sag = T * 0.55, colors = ['#2f6fd1', '#ffffff', '#e8453c', '#3fbf7f', '#f5d33b'];
    const at = (k) => [x + (x2 - x) * k, y + (y2 - y) * k + Math.sin(k * Math.PI) * sag];
    ctx.strokeStyle = 'rgba(60,50,40,.75)'; ctx.lineWidth = Math.max(1, T * 0.035);
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) { const [a, b] = at(i / 24); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); }
    ctx.stroke();
    for (let i = 1; i < n; i++) {
      const [a, b] = at(i / n), sway = Math.sin(time / 300 + i * 0.8) * T * 0.09;
      poly(ctx, [[a - T * 0.17, b], [a + T * 0.17, b], [a + T * 0.17 + sway, b + T * 0.42], [a - T * 0.17 + sway, b + T * 0.42]], colors[i % 5]);
    }
  }

  function drawPine(ctx, p, x, y, w, h, T) {
    const cx = x + T / 2;
    shadow(ctx, cx, y + T * 0.9, T * 0.62, T * 0.18);
    rect(ctx, cx - T * 0.1, y + T * 0.5, T * 0.2, T * 0.45, '#5b3a22');
    for (let i = 0; i < 3; i++) {
      const top = y - T * (1.5 - i * 0.6), base = y + T * (0.1 + i * 0.28), half = T * (0.42 + i * 0.2);
      poly(ctx, [[cx, top], [cx + half, base], [cx - half, base]], ['#2b5d4a', '#2f6650', '#347056'][i]);
      poly(ctx, [[cx, top], [cx + half * 0.7, top + (base - top) * 0.72], [cx + half * 0.28, top + (base - top) * 0.6], [cx, top + (base - top) * 0.76], [cx - half * 0.3, top + (base - top) * 0.6], [cx - half * 0.7, top + (base - top) * 0.72]], '#f7fbfe');
    }
  }
  function drawLarch(ctx, p, x, y, w, h, T, time) {
    // The town's signature: golden larches, a colour found nowhere else in the world.
    const cx = x + T / 2, sway = Math.sin(time / 1100 + p.x) * T * 0.05;
    shadow(ctx, cx, y + T * 0.9, T * 0.62, T * 0.18);
    rect(ctx, cx - T * 0.09, y + T * 0.2, T * 0.18, T * 0.75, '#6b4630');
    const tones = ['#c98b1f', '#dd9f2a', '#efb83b'];
    for (let i = 0; i < 3; i++) {
      const top = y - T * (1.45 - i * 0.55), base = y + T * (0.05 + i * 0.22), half = T * (0.4 + i * 0.2);
      poly(ctx, [[cx + sway, top], [cx + half, base], [cx - half, base]], tones[i]);
    }
    for (let i = 0; i < 9; i++) dot(ctx, cx + (hash(p.x, i) - 0.5) * T * 0.9 + sway, y - T * 0.9 + hash(p.y, i) * T * 1.2, T * 0.05, '#ffe27a');
    dot(ctx, cx + sway, y - T * 1.45, T * 0.09, '#ffffff');
  }

  function drawFountain(ctx, p, x, y, w, h, T, time) {
    const cx = x + w / 2, base = y + h - T * 0.4;
    shadow(ctx, cx, base + T * 0.15, w * 0.52, T * 0.55);
    oval(ctx, cx, base - T * 0.15, w * 0.5, T * 0.8, '#8c909b');
    oval(ctx, cx, base - T * 0.3, w * 0.44, T * 0.62, '#b6e4f3');
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(1, T * 0.05);
    ctx.beginPath(); ctx.moveTo(cx - T * 0.8, base - T * 0.3); ctx.lineTo(cx - T * 0.1, base - T * 0.6); ctx.moveTo(cx + T * 0.2, base); ctx.lineTo(cx + T * 0.8, base - T * 0.22); ctx.stroke();
    rect(ctx, cx - T * 0.17, y + T * 0.75, T * 0.34, h - T * 1.5, '#9a9ea9');
    oval(ctx, cx, y + T * 0.85, T * 0.78, T * 0.27, '#8c909b');
    oval(ctx, cx, y + T * 0.78, T * 0.62, T * 0.18, '#b6e4f3');
    // Frozen mid-splash: icicles hanging off the upper bowl.
    for (let i = 0; i < 7; i++) { const ix = cx - T * 0.6 + i * T * 0.2; poly(ctx, [[ix - T * 0.07, y + T * 0.95], [ix + T * 0.07, y + T * 0.95], [ix, y + T * (1.25 + hash(i, 1) * 0.5)]], '#d4f0fa'); }
    dot(ctx, cx, y + T * 0.42, T * 0.2, '#d4f0fa'); poly(ctx, [[cx - T * 0.18, y + T * 0.52], [cx + T * 0.18, y + T * 0.52], [cx, y - T * 0.25]], '#d4f0fa');
    oval(ctx, cx - T * 0.7, base - T * 0.82, T * 0.3, T * 0.1, '#ffffff');
    const k = (Math.sin(time / 500) + 1) / 2;
    ctx.globalAlpha = k; dot(ctx, cx + T * 0.08, y + T * 0.1, T * 0.05, '#ffffff'); ctx.globalAlpha = 1;
  }

  function drawCocoaCart(ctx, p, x, y, w, h, T, time) {
    shadow(ctx, x + w / 2, y + T * 0.95, w * 0.52, T * 0.22);
    for (const wx of [x + T * 0.55, x + w - T * 0.55]) { dot(ctx, wx, y + T * 0.72, T * 0.27, '#4a2e1a'); dot(ctx, wx, y + T * 0.72, T * 0.13, '#b98a5c'); }
    box(ctx, x + T * 0.1, y - T * 0.15, w - T * 0.2, T * 0.75, T * 0.08, '#a8532f');
    rect(ctx, x + T * 0.1, y - T * 0.15, w - T * 0.2, T * 0.12, '#c97245');
    label(ctx, 'COCOA', x + w / 2, y + T * 0.26, Math.max(9, T * 0.46), '#fff1d6');
    // A copper pot, steaming, and mugs on the counter.
    box(ctx, x + T * 0.35, y - T * 0.55, T * 0.75, T * 0.42, T * 0.1, '#c9793f');
    rect(ctx, x + T * 0.3, y - T * 0.58, T * 0.85, T * 0.08, '#8a4e27');
    plume(ctx, x + T * 0.72, y - T * 0.6, T, time, 4, '255,255,255', 4, 1.1);
    for (const i of [0, 1, 2]) { box(ctx, x + T * (1.45 + i * 0.42), y - T * 0.42, T * 0.3, T * 0.3, T * 0.05, ['#ffffff', '#e8453c', '#2f8a8c'][i]); dot(ctx, x + T * (1.6 + i * 0.42), y - T * 0.4, T * 0.09, '#6b3f22'); }
    // Striped canopy on two poles.
    for (const px of [x + T * 0.15, x + w - T * 0.25]) rect(ctx, px, y - T * 1.5, T * 0.09, T * 1.4, '#5b3a22');
    for (let i = 0; i < 6; i++) poly(ctx, [[x - T * 0.1 + (i * (w + T * 0.2)) / 6, y - T * 1.75], [x - T * 0.1 + ((i + 1) * (w + T * 0.2)) / 6, y - T * 1.75], [x - T * 0.2 + ((i + 1) * (w + T * 0.4)) / 6, y - T * 1.25], [x - T * 0.2 + (i * (w + T * 0.4)) / 6, y - T * 1.25]], i % 2 ? '#fff1d6' : '#c0473a');
    box(ctx, x - T * 0.05, y - T * 1.88, w + T * 0.1, T * 0.2, T * 0.09, '#ffffff');
  }
  function drawStall(ctx, p, x, y, w, h, T) {
    shadow(ctx, x + w / 2, y + T * 0.95, w * 0.52, T * 0.2);
    box(ctx, x + T * 0.1, y + T * 0.05, w - T * 0.2, T * 0.85, T * 0.06, '#7a5535');
    rect(ctx, x, y - T * 0.05, w, T * 0.2, '#a97a4e');
    const goods = ['#e8453c', '#f5d33b', '#3fbf7f', '#7a6ee0', '#ff9b58', '#58a9e8'];
    for (let i = 0; i < 5; i++) { const gx = x + T * 0.4 + i * (w - T * 0.8) / 4; dot(ctx, gx, y - T * 0.17, T * 0.17, goods[(p.x + i) % goods.length]); }
    for (const px of [x + T * 0.1, x + w - T * 0.2]) rect(ctx, px, y - T * 1.4, T * 0.09, T * 1.4, '#5b3a22');
    for (let i = 0; i < 5; i++) poly(ctx, [[x - T * 0.1 + (i * (w + T * 0.2)) / 5, y - T * 1.65], [x - T * 0.1 + ((i + 1) * (w + T * 0.2)) / 5, y - T * 1.65], [x - T * 0.3 + ((i + 1) * (w + T * 0.6)) / 5, y - T * 1.05], [x - T * 0.3 + (i * (w + T * 0.6)) / 5, y - T * 1.05]], i % 2 ? '#fff1d6' : (p.awning || '#c0473a'));
    box(ctx, x, y - T * 1.78, w, T * 0.2, T * 0.09, '#ffffff');
  }
  function drawNoticeboard(ctx, p, x, y, w, h, T, time, env) {
    shadow(ctx, x + w / 2, y + T * 0.9, w * 0.5, T * 0.18);
    for (const px of [x + T * 0.2, x + w - T * 0.32]) rect(ctx, px, y - T * 0.9, T * 0.13, T * 1.8, '#5b3a22');
    box(ctx, x, y - T * 1.05, w, T * 1.35, T * 0.08, '#8a5e38');
    box(ctx, x + T * 0.1, y - T * 0.95, w - T * 0.2, T * 1.15, T * 0.05, '#c9a26e');
    const notes = [[0.25, -0.85, '#fff8e8'], [1.05, -0.9, '#ffe9b0'], [0.3, -0.25, '#d9f1fb'], [1.1, -0.28, '#fff8e8']];
    notes.forEach(([a, b, c], i) => { rect(ctx, x + a * T, y + b * T, T * 0.62, T * 0.5, c); dot(ctx, x + (a + 0.31) * T, y + (b + 0.03) * T, T * 0.05, ['#e8453c', '#2f6fd1'][i % 2]); });
    box(ctx, x - T * 0.1, y - T * 1.2, w + T * 0.2, T * 0.2, T * 0.09, '#ffffff');
  }
  function drawBench(ctx, p, x, y, w, h, T) {
    shadow(ctx, x + w / 2, y + T * 0.82, w * 0.5, T * 0.16);
    for (const px of [x + T * 0.3, x + w - T * 0.5]) rect(ctx, px, y + T * 0.5, T * 0.2, T * 0.34, '#4a2e1a');
    box(ctx, x + T * 0.05, y + T * 0.28, w - T * 0.1, T * 0.32, T * 0.14, '#8d5a37');
    dot(ctx, x + T * 0.2, y + T * 0.44, T * 0.13, '#b98a5c');
    oval(ctx, x + w * 0.65, y + T * 0.27, w * 0.2, T * 0.09, '#ffffff');
  }
  function drawSnowman(ctx, p, x, y, w, h, T, time) {
    const cx = x + T / 2, v = p.variant;
    shadow(ctx, cx, y + T * 0.88, T * 0.55, T * 0.17);
    dot(ctx, cx, y + T * 0.48, T * 0.46, '#f7fbfe'); dot(ctx, cx, y - T * 0.15, T * 0.34, '#ffffff'); dot(ctx, cx, y - T * 0.65, T * 0.25, '#ffffff');
    for (const b of [0.3, 0.55]) dot(ctx, cx, y + T * b, T * 0.04, '#2a2a2a');
    dot(ctx, cx - T * 0.09, y - T * 0.72, T * 0.03, '#222'); dot(ctx, cx + T * 0.09, y - T * 0.72, T * 0.03, '#222');
    poly(ctx, [[cx, y - T * 0.66], [cx + T * 0.28, y - T * 0.6], [cx, y - T * 0.58]], '#f58a2c');
    rect(ctx, cx - T * 0.27, y - T * 0.38, T * 0.54, T * 0.11, v ? '#2f8a8c' : '#d9402f');
    rect(ctx, cx + T * 0.05, y - T * 0.32, T * 0.13, T * 0.4, v ? '#2f8a8c' : '#d9402f');
    if (v) { box(ctx, cx - T * 0.2, y - T * 1.05, T * 0.4, T * 0.22, T * 0.06, '#2a2f3a'); rect(ctx, cx - T * 0.3, y - T * 0.86, T * 0.6, T * 0.06, '#2a2f3a'); }
    else { dot(ctx, cx, y - T * 0.92, T * 0.12, '#d9402f'); rect(ctx, cx - T * 0.22, y - T * 0.88, T * 0.44, T * 0.08, '#f5d33b'); }
  }
  function drawWoodpile(ctx, p, x, y, w, h, T) {
    shadow(ctx, x + w / 2, y + h - T * 0.1, w * 0.52, T * 0.2);
    const rows = Math.max(2, (p.h || 1) * 2 + 1), base = y + h - T * 0.28, n = Math.floor(w / (T * 0.42));
    for (let j = 0; j < rows; j++) for (let i = 0; i < n - j; i++) {
      const lx = x + T * 0.28 + i * T * 0.42 + j * T * 0.21, ly = base - j * T * 0.34;
      dot(ctx, lx, ly, T * 0.2, hash(i, j) > 0.5 ? '#a9764a' : '#94643c');
      dot(ctx, lx, ly, T * 0.09, '#d8ab78');
    }
    box(ctx, x + T * 0.3, base - rows * T * 0.32, w - T * 0.8, T * 0.22, T * 0.1, '#ffffff');
  }
  function drawSkirack(ctx, p, x, y, w, h, T) {
    rect(ctx, x, y + T * 0.05, T, T * 0.1, '#5b3a22');
    rect(ctx, x + T * 0.05, y - T * 0.3, T * 0.1, T * 1.2, '#5b3a22'); rect(ctx, x + T * 0.85, y - T * 0.3, T * 0.1, T * 1.2, '#5b3a22');
    ['#e8453c', '#2f6fd1', '#f5d33b'].forEach((c, i) => { box(ctx, x + T * (0.2 + i * 0.25), y - T * 0.9, T * 0.11, T * 1.8, T * 0.05, c); });
  }
  function drawBuckets(ctx, p, x, y, w, h, T) {
    const cx = x + T / 2;
    shadow(ctx, cx, y + T * 0.88, T * 0.46, T * 0.14);
    for (const [dx, dy] of [[-0.24, 0.5], [0.24, 0.5], [0, 0.08]]) {
      poly(ctx, [[cx + (dx - 0.22) * T, y + dy * T], [cx + (dx + 0.22) * T, y + dy * T], [cx + (dx + 0.17) * T, y + (dy + 0.4) * T], [cx + (dx - 0.17) * T, y + (dy + 0.4) * T]], '#b98a5c');
      rect(ctx, cx + (dx - 0.2) * T, y + (dy + 0.12) * T, T * 0.4, T * 0.05, '#5b3a22');
    }
  }
  function drawBoulder(ctx, p, x, y, w, h, T) {
    shadow(ctx, x + w / 2, y + h - T * 0.1, w * 0.52, T * 0.22);
    box(ctx, x + T * 0.05, y + T * 0.1, w - T * 0.1, h - T * 0.15, T * 0.34, '#747a87');
    box(ctx, x + T * 0.15, y + T * 0.2, w * 0.5, h * 0.55, T * 0.24, '#8b92a0');
    box(ctx, x + T * 0.12, y - T * 0.1, w - T * 0.3, Math.min(h * 0.55, T * 0.62), T * 0.26, '#ffffff');
  }
  function drawCairn(ctx, p, x, y, w, h, T) {
    const cx = x + T / 2;
    shadow(ctx, cx, y + T * 0.85, T * 0.5, T * 0.16);
    [[0.42, 0.68, 0.24], [0.33, 0.34, 0.2], [0.24, 0.06, 0.16], [0.14, -0.18, 0.12]].forEach(([rx, dy, ry], i) => oval(ctx, cx + (i % 2 ? T * 0.04 : -T * 0.03), y + dy * T, rx * T, ry * T, ['#7a7e89', '#8c909b', '#9ca0ab', '#b1b5c0'][i]));
    oval(ctx, cx, y - T * 0.26, T * 0.13, T * 0.06, '#ffffff');
    ctx.strokeStyle = '#e8453c'; ctx.lineWidth = T * 0.06; ctx.beginPath(); ctx.moveTo(cx - T * 0.3, y + T * 0.34); ctx.lineTo(cx + T * 0.3, y + T * 0.34); ctx.stroke();
  }
  function drawCrystals(ctx, p, x, y, w, h, T, time, env) {
    const shards = [[0.2, 1.0, 0.16], [0.42, 1.55, 0.2], [0.62, 1.2, 0.17], [0.82, 0.8, 0.12]];
    const pulse = 0.6 + Math.sin(time / 700 + p.x) * 0.4;
    const glow = ctx.createRadialGradient(x + w / 2, y + h / 2, 1, x + w / 2, y + h / 2, w * 0.9);
    glow.addColorStop(0, `rgba(120,210,255,${0.2 + pulse * 0.25})`); glow.addColorStop(1, 'rgba(120,210,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, w * 0.9, 0, TAU); ctx.fill();
    for (const [k, H, half] of shards) {
      const sx = x + k * w, base = y + h - T * 0.05, s = T * H, hw = T * half * (w / T > 1.5 ? 1.5 : 1);
      poly(ctx, [[sx - hw, base], [sx - hw * 0.8, base - s * 0.75], [sx, base - s], [sx + hw * 0.8, base - s * 0.75], [sx + hw, base]], '#66bff0');
      poly(ctx, [[sx - hw, base], [sx - hw * 0.8, base - s * 0.75], [sx, base - s], [sx, base]], '#a6e2ff');
    }
  }
  function drawSlalom(ctx, p, x, y, w, h, T, time) {
    const cx = x + T / 2, sway = Math.sin(time / 240 + p.x) * T * 0.1;
    rect(ctx, cx - T * 0.04, y - T * 0.9, T * 0.08, T * 1.8, '#2e3442');
    poly(ctx, [[cx, y - T * 0.95], [cx + T * 0.75 + sway, y - T * 0.65], [cx, y - T * 0.35]], p.color || '#e8453c');
    oval(ctx, cx, y + T * 0.88, T * 0.2, T * 0.08, 'rgba(120,145,175,.5)');
  }
  function drawLamp(ctx, p, x, y, w, h, T, time, env) {
    const cx = x + T / 2, f = 0.85 + Math.sin(time / 180 + p.x * 1.3) * 0.08;
    rect(ctx, cx - T * 0.05, y - T * 0.75, T * 0.1, T * 1.55, '#34363f');
    box(ctx, cx - T * 0.16, y + T * 0.7, T * 0.32, T * 0.14, T * 0.05, '#34363f');
    const g = ctx.createRadialGradient(cx, y - T * 1, 1, cx, y - T * 1, T * 1.3);
    g.addColorStop(0, `rgba(255,214,130,${(0.35 + (env.night || 0) * 0.35) * f})`); g.addColorStop(1, 'rgba(255,214,130,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, y - T, T * 1.3, 0, TAU); ctx.fill();
    box(ctx, cx - T * 0.2, y - T * 1.25, T * 0.4, T * 0.5, T * 0.06, '#ffd98a');
    ctx.strokeStyle = '#34363f'; ctx.lineWidth = Math.max(1, T * 0.05); ctx.strokeRect(cx - T * 0.2, y - T * 1.25, T * 0.4, T * 0.5);
    poly(ctx, [[cx - T * 0.3, y - T * 1.25], [cx, y - T * 1.6], [cx + T * 0.3, y - T * 1.25]], '#34363f');
    oval(ctx, cx, y - T * 1.46, T * 0.18, T * 0.09, '#ffffff');
  }
  function drawMineGate(ctx, p, x, y, w, h, T, time) {
    // A timbered gate in the rock where the trail starts up the mountain.
    const cx = x + w / 2, base = y + h + T * 0.05;
    ctx.fillStyle = '#6e7686';
    ctx.beginPath();
    ctx.moveTo(x - T * 0.7, base);
    ctx.quadraticCurveTo(x - T * 0.6, y - T * 0.2, cx, y - T * 0.5);
    ctx.quadraticCurveTo(x + w + T * 0.6, y - T * 0.2, x + w + T * 0.7, base);
    ctx.closePath(); ctx.fill();
    const dark = ctx.createLinearGradient(0, y, 0, base);
    dark.addColorStop(0, '#0f1420'); dark.addColorStop(1, '#2a3244');
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(x + T * 0.55, base);
    ctx.lineTo(x + T * 0.55, y + T * 1.15);
    ctx.quadraticCurveTo(cx, y - T * 0.05, x + w - T * 0.55, y + T * 1.15);
    ctx.lineTo(x + w - T * 0.55, base);
    ctx.closePath(); ctx.fill();
    // Timber frame and hanging lanterns.
    for (const px of [x + T * 0.35, x + w - T * 0.65]) rect(ctx, px, y + T * 0.8, T * 0.3, base - y - T * 0.8, '#6b4630');
    box(ctx, x + T * 0.05, y + T * 0.42, w - T * 0.1, T * 0.5, T * 0.08, '#6b4630');
    label(ctx, 'TO THE SUMMIT', cx, y + T * 0.68, Math.max(8, T * 0.38), '#ffe9b0');
    box(ctx, x - T * 0.15, y + T * 0.26, w + T * 0.3, T * 0.22, T * 0.1, '#ffffff');
    for (const lx of [x + T * 0.5, x + w - T * 0.5]) {
      const f = 0.8 + Math.sin(time / 170 + lx) * 0.1;
      const g = ctx.createRadialGradient(lx, y + T * 1.4, 1, lx, y + T * 1.4, T);
      g.addColorStop(0, `rgba(255,190,90,${0.65 * f})`); g.addColorStop(1, 'rgba(255,190,90,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(lx, y + T * 1.4, T, 0, TAU); ctx.fill();
      box(ctx, lx - T * 0.13, y + T * 1.2, T * 0.26, T * 0.38, T * 0.05, '#ffcf73');
    }
  }

  const props = {
    alpine: drawBackdrop, lodge: drawLodge, gondola: drawGondola, hotspring: drawHotspring, campfire: drawCampfire,
    bell: drawBell, beacon: drawBeacon, flags: drawFlags, pine: drawPine, larch: drawLarch, fountain: drawFountain,
    cocoacart: drawCocoaCart, stall: drawStall, noticeboard: drawNoticeboard, bench: drawBench, snowman: drawSnowman,
    woodpile: drawWoodpile, skirack: drawSkirack, buckets: drawBuckets, boulder: drawBoulder, cairn: drawCairn,
    crystals: drawCrystals, slalom: drawSlalom, lamp: drawLamp, minegate: drawMineGate, lakeshore: drawLakeShore,
  };
  // Props lying flat on the ground (or far behind it), under everything that stands up.
  const flat = new Set(['alpine', 'hotspring', 'minegate', 'lakeshore']);
  // Props that hide the blocked tile they stand on.
  const covering = Object.keys(props).filter((t) => t !== 'flags' && t !== 'lamp');

  // Warm pools of light at dusk and night. glow(x, y, radius, alpha, rgb)
  function glows(p, T, glow, k, time, env) {
    const x = p.x * T, y = p.y * T, w = (p.w || 1) * T, h = (p.h || 1) * T;
    switch (p.type) {
      case 'lamp': glow(x + T / 2, y - T, T * 3, 0.34 * k * (0.9 + Math.sin(time / 180 + p.x) * 0.08)); break;
      case 'lodge':
        glow(x + T * 2, y + h - T * 1.3, T * 2, 0.3 * k);
        glow(x + w - T * 2, y + h - T * 1.3, T * 2, 0.3 * k);
        glow(x + w / 2, y + h, T * 2.6, 0.26 * k);
        break;
      case 'campfire': glow(x + T / 2, y + T * 0.2, T * 5.5, 0.48 * k * (0.9 + Math.sin(time / 90) * 0.1)); break;
      case 'beacon': if (env.beacon) glow(x + w / 2, y, T * 9, 0.6 * k * (0.9 + Math.sin(time / 110) * 0.1)); break;
      case 'crystals': glow(x + w / 2, y + h / 2, T * 3, 0.32 * k * (0.75 + Math.sin(time / 700 + p.x) * 0.25), '120,210,255'); break;
      case 'hotspring': glow(x + w / 2, y + h / 2, w * 0.62, 0.2 * k, '120,235,225'); break;
      case 'cocoacart': glow(x + w / 2, y - T * 0.5, T * 3, 0.3 * k); break;
      case 'minegate': glow(x + w / 2, y + h, T * 2.4, 0.3 * k); break;
      case 'gondola': glow(x + w / 2, y + h - T * 0.5, T * 2.2, 0.22 * k); break;
      default:
    }
  }

  // ---------- Sky and weather, drawn over the lit scene ----------
  function overlay(ctx, room, T, time, view, env, fx) {
    const X = view.x0 * T, W = (view.x1 - view.x0) * T, top = view.y0 * T;
    const night = env.night || 0;
    if (night > 0.25) {
      // Stars in the sky above the ridge.
      const skyH = T * (room.theme === 'summit' ? 3.2 : 2.6) - top;
      for (let i = 0; i < 90; i++) {
        const tw = 0.45 + Math.sin(time / 520 + i * 1.7) * 0.55;
        ctx.globalAlpha = Math.max(0, Math.min(1, (night - 0.25) * 2)) * tw;
        dot(ctx, X + hash(i, 11) * W, top + hash(i, 12) * skyH * hash(i, 13), Math.max(0.7, T * 0.035 * (hash(i, 14) + 0.4)), '#ffffff');
      }
      ctx.globalAlpha = 1;
    }
    if (env.weather === 'aurora' && night > 0.2) {
      // Curtains of green and violet light across the top of the room.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const a = Math.min(1, (night - 0.2) * 2);
      for (let band = 0; band < 3; band++) {
        const color = ['90,255,170', '120,200,255', '200,120,255'][band], yb = T * (0.5 + band * 0.75);
        for (let i = 0; i < 70; i++) {
          const k = i / 70, bx = X + k * W;
          const wave = Math.sin(k * 11 + time / 1500 + band * 2) * T * 0.8 + Math.sin(k * 27 - time / 900 + band) * T * 0.3;
          const hgt = T * (2.2 + Math.sin(k * 17 + time / 700 + band) * 0.8);
          const g = ctx.createLinearGradient(0, yb + wave - hgt, 0, yb + wave + T * 0.3);
          g.addColorStop(0, `rgba(${color},0)`); g.addColorStop(0.75, `rgba(${color},${0.2 * a})`); g.addColorStop(1, `rgba(${color},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(bx, yb + wave - hgt, W / 70 + 1, hgt + T * 0.3);
        }
      }
      ctx.restore();
    }
    // Steam off the hot spring drifts over the bathers.
    for (const p of fx) {
      if (p.type !== 'hotspring') continue;
      const W2 = p.w || 1, H2 = p.h || 1;
      for (let i = 0; i < 12; i++) {
        const sx = (p.x + 0.8 + hash(i, 21) * (W2 - 1.6)) * T, sy = (p.y + 0.9 + hash(i, 22) * (H2 - 1.4)) * T;
        plume(ctx, sx, sy, T, time, 3, '255,255,255', i, 1.6);
      }
    }
    // A low cloud bank rolling across the summit on Sea of Clouds days.
    if (env.weather === 'clouds' && room.theme === 'summit') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      for (let i = 0; i < 10; i++) {
        const cx = ((time / (9000 + i * 900) + i * 0.13) % 1.4 - 0.2) * room.width * T;
        cloud(ctx, cx, T * (9 + (i % 5) * 3), T * (1.3 + (i % 3) * 0.5), '#ffffff');
      }
      ctx.restore();
    }
  }

  // The bottom of a ninja wading in the hot spring: water up to the waist, and a ripple.
  function drawSoak(ctx, feetX, feetY, T, time) {
    const ripple = Math.sin(time / 400) * T * 0.04;
    ctx.fillStyle = 'rgba(95,200,205,.86)';
    ctx.beginPath(); ctx.ellipse(feetX, feetY - T * 0.05, T * 0.58, T * 0.36, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(1, T * 0.05);
    ctx.beginPath(); ctx.ellipse(feetX, feetY - T * 0.05, T * 0.6 + ripple, T * 0.37 + ripple / 2, 0, 0, TAU); ctx.stroke();
  }

  // ---------- Finds ----------
  // The eight things a ninja can collect in the Mountain Journal. s is about half the icon's width.
  function drawFind(ctx, kind, cx, cy, s, time = 0) {
    switch (kind) {
      case 'edelweiss':
        for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ctx.fillStyle = i % 2 ? '#f4f6f0' : '#ffffff'; ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * s * 0.55, cy + Math.sin(a) * s * 0.55, s * 0.5, s * 0.22, a, 0, TAU); ctx.fill(); }
        dot(ctx, cx, cy, s * 0.3, '#e8c53b');
        break;
      case 'pinecone':
        oval(ctx, cx, cy, s * 0.62, s * 0.95, '#7a4f2a');
        ctx.fillStyle = '#b07a43';
        for (let j = -2; j <= 2; j++) for (let i = -1; i <= 1; i++) if (Math.abs(i) + Math.abs(j) < 3) { ctx.beginPath(); ctx.ellipse(cx + i * s * 0.32 + (j % 2 ? s * 0.16 : 0), cy + j * s * 0.34, s * 0.16, s * 0.11, 0, 0, TAU); ctx.fill(); }
        break;
      case 'feather': {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.55);
        ctx.fillStyle = '#e9e2d2'; ctx.beginPath(); ctx.ellipse(0, -s * 0.15, s * 0.42, s * 0.92, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#6d5540'; ctx.beginPath(); ctx.ellipse(0, -s * 0.72, s * 0.3, s * 0.32, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#6d5540'; ctx.lineWidth = Math.max(1, s * 0.1); ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(0, s * 1.05); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'oldcoin':
        dot(ctx, cx, cy, s * 0.92, '#a9791f'); dot(ctx, cx, cy, s * 0.76, '#e4ba4e');
        rect(ctx, cx - s * 0.26, cy - s * 0.26, s * 0.52, s * 0.52, '#7a5618');
        break;
      case 'frost':
        ctx.strokeStyle = '#7fd2f5'; ctx.lineWidth = Math.max(1.5, s * 0.17); ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI + Math.PI / 6; ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * s, cy - Math.sin(a) * s); ctx.lineTo(cx + Math.cos(a) * s, cy + Math.sin(a) * s); ctx.stroke(); }
        ctx.lineCap = 'butt'; dot(ctx, cx, cy, s * 0.24, '#ffffff');
        break;
      case 'amethyst':
        poly(ctx, [[cx, cy - s], [cx + s * 0.72, cy - s * 0.25], [cx + s * 0.5, cy + s * 0.9], [cx - s * 0.5, cy + s * 0.9], [cx - s * 0.72, cy - s * 0.25]], '#8e4fd1');
        poly(ctx, [[cx, cy - s], [cx - s * 0.72, cy - s * 0.25], [cx - s * 0.5, cy + s * 0.9], [cx, cy + s * 0.4]], '#b583e8');
        break;
      case 'lotus':
        for (const [a, c, r] of [[-1.05, '#f6c6da', 1], [1.05, '#f6c6da', 1], [-0.5, '#fbdfe9', 1.1], [0.5, '#fbdfe9', 1.1], [0, '#ffffff', 1.15]]) {
          ctx.save(); ctx.translate(cx, cy + s * 0.6); ctx.rotate(a);
          ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, -s * 0.72 * r, s * 0.3, s * 0.72 * r, 0, 0, TAU); ctx.fill();
          ctx.restore();
        }
        break;
      case 'starstone': {
        const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, s * 1.5);
        g.addColorStop(0, 'rgba(255,240,170,.85)'); g.addColorStop(1, 'rgba(255,240,170,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, s * 1.5, 0, TAU); ctx.fill();
        const pts = [];
        for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2 + time / 2000, r = i % 2 ? s * 0.42 : s; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
        poly(ctx, pts, '#ffe27a');
        dot(ctx, cx, cy, s * 0.26, '#4a4fb0');
        break;
      }
      default: dot(ctx, cx, cy, s * 0.6, '#ffffff');
    }
  }
  // A find lying in the world: a soft pulse on the ground, the item bobbing, and a sparkle.
  function drawWorldFind(ctx, f, T, time) {
    const cx = (f.x + 0.5) * T, base = (f.y + 0.7) * T;
    const seed = f.x * 3 + f.y, bob = Math.sin(time / 420 + seed) * T * 0.07;
    const pulse = (time / 1500 + seed * 0.1) % 1;
    ctx.strokeStyle = `rgba(255,226,122,${0.8 * (1 - pulse)})`; ctx.lineWidth = Math.max(1.5, T * 0.06);
    ctx.beginPath(); ctx.ellipse(cx, base, T * (0.25 + pulse * 0.45), T * (0.1 + pulse * 0.2), 0, 0, TAU); ctx.stroke();
    oval(ctx, cx, base, T * 0.22, T * 0.08, 'rgba(30,50,80,.25)');
    drawFind(ctx, f.kind, cx, base - T * 0.42 + bob, T * 0.26, time);
    for (let i = 0; i < 3; i++) {
      const k = (time / 900 + i / 3 + seed * 0.07) % 1;
      ctx.globalAlpha = Math.sin(k * Math.PI);
      const sx = cx + Math.cos(i * 2.1 + seed) * T * 0.42, sy = base - T * 0.42 + Math.sin(i * 2.1 + seed) * T * 0.34, r = T * 0.1;
      poly(ctx, [[sx, sy - r], [sx + r * 0.25, sy - r * 0.25], [sx + r, sy], [sx + r * 0.25, sy + r * 0.25], [sx, sy + r], [sx - r * 0.25, sy + r * 0.25], [sx - r, sy], [sx - r * 0.25, sy - r * 0.25]], '#ffffff');
    }
    ctx.globalAlpha = 1;
  }

  // Worn by ninjas who fill the Mountain Journal.
  function registerAccessories(avatar) {
    avatar.registerAccessory({
      id: 'summit-scarf', slot: 'body', name: 'Summit Scarf',
      draw(ctx, g) {
        const wave = Math.sin(g.time / 170) * g.T * 0.06, dir = g.facing > 0 ? -1 : 1, y = g.top + g.bh * 0.42;
        box(ctx, g.cx - g.bw * 0.54, y - g.bh * 0.03, g.bw * 1.08, g.bh * 0.16, g.bh * 0.07, '#d9402f');
        for (let i = 0; i < 4; i++) rect(ctx, g.cx - g.bw * 0.42 + i * g.bw * 0.26, y - g.bh * 0.03, g.bw * 0.11, g.bh * 0.16, '#fff4dd');
        const tx = g.cx + dir * g.bw * 0.34;
        poly(ctx, [[tx - g.T * 0.1, y + g.bh * 0.09], [tx + g.T * 0.1, y + g.bh * 0.09], [tx + g.T * 0.13 + dir * g.T * 0.1 + wave, y + g.bh * 0.42], [tx - g.T * 0.11 + dir * g.T * 0.1 + wave, y + g.bh * 0.42]], '#d9402f');
        rect(ctx, tx - g.T * 0.1 + dir * g.T * 0.07 + wave * 0.7, y + g.bh * 0.28, g.T * 0.22, g.bh * 0.05, '#fff4dd');
      },
    });
    avatar.registerAccessory({
      id: 'fur-hat', slot: 'head', name: 'Fur Hat',
      draw(ctx, g) {
        box(ctx, g.cx - g.bw * 0.5, g.top - g.bh * 0.1, g.bw, g.bh * 0.28, g.bh * 0.12, '#6d4a2c');
        box(ctx, g.cx - g.bw * 0.56, g.top + g.bh * 0.06, g.bw * 1.12, g.bh * 0.12, g.bh * 0.05, '#fff4dd');
      },
    });
  }

  window.ClubDojoMountainArt = { props, flat, covering, tile, surroundTile, SURROUND, glows, overlay, drawSoak, drawFind, drawWorldFind, registerAccessories };
})();
