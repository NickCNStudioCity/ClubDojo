// World map: a full-window illustrated island. Hover (or arrow-key) to a place to preview it,
// click it once to fast travel: your ninja runs the trail, then the map zooms into the
// destination and fades away over the new room, so there is never a black loading screen.
// Places and trails come from the server's room list. Rooms without a spot in PLACES are placed
// next to a room they connect to, so a new room shows up on the map on its own.
(function () {
  const W = 1600, H = 900; // the map is drawn in these units and scaled to fit the window
  const SNAP_RADIUS = 150; // the nearest place within this distance of the pointer is selected
  const OPEN_ZOOM = 2.2, ARRIVE_ZOOM = 2.8, ZOOM_MS = 420;

  const PLACES = {
    plaza: { x: 640, y: 450, art: 'village', scale: 1.2 },
    dojo: { x: 655, y: 225, art: 'dojo', scale: 1.05 },
    ramen: { x: 320, y: 340, art: 'ramen', scale: 0.95 },
    'sports-park': { x: 1140, y: 320, art: 'stadium', scale: 1.15 },
    grotto: { x: 720, y: 715, art: 'grotto', scale: 1 },
    cave: { x: 365, y: 705, art: 'cave', scale: 1 },
    'mountain-town': { x: 1245, y: 715, art: 'town', scale: 1 },
    'mountain-peak': { x: 1362, y: 505, art: 'summit', scale: 0.95 },
    cafe: { x: 1110, y: 770, art: 'cafe', scale: 0.8 },
  };

  const COAST = [[250, 200], [420, 125], [640, 95], [860, 130], [1060, 92], [1290, 130], [1440, 250], [1470, 420], [1440, 600], [1495, 740], [1370, 845], [1120, 822], [900, 862], [660, 838], [430, 852], [230, 818], [135, 680], [180, 520], [118, 400], [150, 280]];
  const RIVER = [[985, 205], [930, 320], [990, 465], [930, 610], [990, 760], [965, 880]];
  const PEAKS = [
    [1040, 628, 125, 112], [1105, 604, 175, 175], [1220, 590, 215, 218], [1335, 608, 185, 182], [1432, 625, 125, 128],
    [240, 625, 150, 150], [340, 604, 192, 192], [448, 628, 130, 120],
    [965, 212, 120, 92], [1040, 198, 150, 118], [1125, 182, 112, 84],
  ];

  // ---------- small helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rng = (seed) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hashText = (s) => { let n = 7; for (const ch of s) n = (n * 31 + ch.charCodeAt(0)) | 0; return n; };
  const tint = (hex, mul) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * parseInt(mul.slice(i, i + 2), 16) / 255).toString(16).padStart(2, '0')).join('');
  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SEA = '#4fb0d6';
  const BANDS = { day: '#ffffff', dusk: '#ffcfae', night: '#4a5a92' };
  const bandOf = (hour) => (hour < 5 || hour >= 20 ? 'night' : hour < 7 || hour >= 17 ? 'dusk' : 'day');

  // Trace a closed loop through the midpoints of its control points (a smooth blob).
  function traceLoop(ctx, pts) {
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let m = mid(pts[pts.length - 1], pts[0]);
    ctx.beginPath();
    ctx.moveTo(m[0], m[1]);
    pts.forEach((p, i) => { m = mid(p, pts[(i + 1) % pts.length]); ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]); });
    ctx.closePath();
  }
  function traceLine(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    const end = pts[pts.length - 1];
    ctx.lineTo(end[0], end[1]);
  }
  const bez = (a, c, b, t) => [(1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y];
  function sampleLoop(pts, n) {
    const out = [];
    const mid = (a, b) => ({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2 });
    pts.forEach((p, i) => {
      const a = mid(pts[(i + pts.length - 1) % pts.length], p), b = mid(p, pts[(i + 1) % pts.length]);
      for (let k = 0; k < n; k++) out.push(bez(a, { x: p[0], y: p[1] }, b, k / n));
    });
    return out;
  }
  function sampleRiver(n) {
    const out = [];
    for (let i = 0; i < RIVER.length - 1; i++) for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([RIVER[i][0] + (RIVER[i + 1][0] - RIVER[i][0]) * t, RIVER[i][1] + (RIVER[i + 1][1] - RIVER[i][1]) * t]);
    }
    return out;
  }
  function inside(poly, x, y) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i][1] > y) !== (poly[j][1] > y) && x < ((poly[j][0] - poly[i][0]) * (y - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c;
    }
    return c;
  }
  const nearAny = (list, x, y, r) => list.some((p) => (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y) < r * r);

  // Each trail bends the same way in both directions.
  function curveOf(a, b) {
    const [p, q] = a.id < b.id ? [a, b] : [b, a];
    const dx = q.x - p.x, dy = q.y - p.y;
    const bend = ((((hashText(p.id + q.id) >>> 0) % 100) / 100) - 0.5) * 0.28 + 0.09;
    return { x: (p.x + q.x) / 2 - dy * bend, y: (p.y + q.y) / 2 + dx * bend };
  }

  // ---------- the painted island ----------
  function paintLand(canvas, places, links, band) {
    const ctx = canvas.getContext('2d');
    const S = canvas.width / W;
    ctx.setTransform(S, 0, 0, S, 0, 0);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const rand = rng(20261108);

    // Sea with little wave marks.
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.34)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 130; i++) {
      const x = rand() * W, y = rand() * H, r = 7 + rand() * 9;
      ctx.beginPath(); ctx.arc(x - r, y, r, -1.1, -0.2); ctx.arc(x + r * 0.7, y, r, Math.PI + 0.2, Math.PI + 1.1); ctx.stroke();
    }

    // Shallows and foam, then sand, then grass.
    traceLoop(ctx, COAST);
    ctx.strokeStyle = 'rgba(146,220,232,.5)'; ctx.lineWidth = 86; ctx.stroke();
    ctx.strokeStyle = 'rgba(190,236,240,.7)'; ctx.lineWidth = 46; ctx.stroke();
    ctx.strokeStyle = '#fbf5dd'; ctx.lineWidth = 16; ctx.stroke();
    ctx.fillStyle = '#8bca69'; ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = '#efdca5'; ctx.lineWidth = 34; ctx.stroke();

    // Meadow light and shade.
    for (let i = 0; i < 90; i++) {
      const x = 140 + rand() * 1340, y = 100 + rand() * 750;
      if (!inside(sampleCoast, x, y)) continue;
      ctx.fillStyle = rand() > 0.5 ? 'rgba(164,216,120,.3)' : 'rgba(92,160,84,.2)';
      ctx.beginPath(); ctx.ellipse(x, y, 40 + rand() * 90, 18 + rand() * 40, rand() * 0.6 - 0.3, 0, Math.PI * 2); ctx.fill();
    }
    softBlob(ctx, 720, 700, 215, 112, '#b9ad93', 0.85); // rocky ground at the Grotto
    softBlob(ctx, 365, 690, 190, 105, '#a79a86', 0.75); // and at the cave
    softBlob(ctx, 1240, 690, 300, 135, '#f4fafd', 0.95); // snow around the Mountain Town
    softBlob(ctx, 1140, 330, 200, 100, '#a5dc7f', 0.7); // playing fields
    ctx.restore();

    // River, running down from the northern hills.
    traceLine(ctx, RIVER);
    ctx.strokeStyle = 'rgba(70,120,70,.5)'; ctx.lineWidth = 26; ctx.stroke();
    ctx.strokeStyle = '#efe0ae'; ctx.lineWidth = 21; ctx.stroke();
    ctx.strokeStyle = '#59b3da'; ctx.lineWidth = 15; ctx.stroke();
    ctx.setLineDash([26, 44]);
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3; ctx.stroke();
    ctx.setLineDash([]);

    // Scenery is scattered, then kept clear of places, trails, water and mountains.
    const river = sampleRiver(14);
    const trails = [];
    for (const [a, b] of links) { const c = curveOf(a, b); for (let t = 0; t <= 1.001; t += 0.03) trails.push(bez(a, c, b, t)); }
    const items = [];
    const peaksHit = (x, y) => PEAKS.some(([px, py, w, h]) => y < py + 14 && y > py - h && Math.abs(x - px) < (w / 2) * (1 - (py - y) / h) + 18);
    const open = (x, y) => inside(sampleCoast, x, y) && !nearAny(sampleCoast, x, y, 42)
      && !places.some((p) => Math.hypot((x - p.x) / 1.15, y - (p.y - 42)) < 122)
      && !nearAny(trails, x, y, 30) && !nearAny(river, x, y, 26) && !peaksHit(x, y);
    for (let y = 110; y < 850; y += 30) for (let x = 130; x < 1480; x += 30) {
      const jx = x + rand() * 24 - 12, jy = y + rand() * 24 - 12;
      const roll = rand();
      const woods = Math.sin(jx * 0.0093 + 1.3) + Math.cos(jy * 0.0127 - 0.4) + Math.sin((jx + jy) * 0.0051 + 2.1) * 0.8;
      const snowy = Math.hypot((jx - 1240) / 300, (jy - 690) / 135) < 1;
      if (open(jx, jy) && (woods > 0.42 ? roll < 0.86 : roll < 0.08)) items.push({ x: jx, y: jy, kind: snowy || jy < 210 ? 'pine' : roll < 0.05 ? 'cherry' : roll < 0.42 ? 'pine' : 'leafy', size: 0.82 + rand() * 0.42, snowy });
      else if (open(jx, jy) && roll < 0.2) items.push({ x: jx, y: jy, kind: 'flower', hue: Math.floor(rand() * 4) });
    }
    for (const [x, y, w, h] of PEAKS) items.push({ x, y: y - 8, kind: 'peak', w, h });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) ({ peak: drawPeak, pine: drawPine, leafy: drawLeafy, cherry: drawLeafy, flower: drawFlower })[it.kind](ctx, it);

    drawCompass(ctx, 86, 800);

    // Evening and night tint the whole painting.
    if (band !== 'day') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = BANDS[band];
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  const sampleCoast = sampleLoop(COAST, 8);

  function softBlob(ctx, x, y, rx, ry, color, alpha) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, rx * 0.45, 0, 0, rx);
    g.addColorStop(0, color); g.addColorStop(1, color + '00');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawPeak(ctx, { x, y, w, h }) {
    const tip = [x, y - h], left = [x - w / 2, y], right = [x + w / 2, y];
    ctx.fillStyle = '#94a3af';
    ctx.beginPath(); ctx.moveTo(...left); ctx.lineTo(...tip); ctx.lineTo(x + w * 0.07, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#6f808f';
    ctx.beginPath(); ctx.moveTo(...tip); ctx.lineTo(...right); ctx.lineTo(x + w * 0.07, y); ctx.closePath(); ctx.fill();
    const cap = 0.42;
    ctx.fillStyle = '#fafdff';
    ctx.beginPath();
    ctx.moveTo(...tip);
    ctx.lineTo(x + (w / 2) * cap, y - h * (1 - cap));
    ctx.lineTo(x + w * 0.1, y - h * (1 - cap) + h * 0.09);
    ctx.lineTo(x + w * 0.015, y - h * (1 - cap) - h * 0.01);
    ctx.lineTo(x - w * 0.09, y - h * (1 - cap) + h * 0.1);
    ctx.lineTo(x - (w / 2) * cap, y - h * (1 - cap));
    ctx.closePath(); ctx.fill();
  }
  function groundShadow(ctx, x, y, r) { ctx.fillStyle = 'rgba(20,60,40,.22)'; ctx.beginPath(); ctx.ellipse(x + 2, y, r, r * 0.34, 0, 0, Math.PI * 2); ctx.fill(); }
  function drawPine(ctx, { x, y, size, snowy }) {
    const s = 15 * size;
    groundShadow(ctx, x, y, s * 0.8);
    ctx.fillStyle = '#6b4a2d'; ctx.fillRect(x - s * 0.1, y - s * 0.5, s * 0.2, s * 0.5);
    [[0.35, 1, '#2f7a52'], [0.95, 0.8, '#378a5d'], [1.5, 0.58, '#42996a']].forEach(([o, w, c]) => {
      ctx.fillStyle = snowy && o > 1 ? '#f4fafd' : c;
      ctx.beginPath(); ctx.moveTo(x - s * w, y - s * o); ctx.lineTo(x, y - s * (o + 1.15)); ctx.lineTo(x + s * w, y - s * o); ctx.closePath(); ctx.fill();
    });
  }
  function drawLeafy(ctx, { x, y, size, kind }) {
    const s = 15 * size, dark = kind === 'cherry' ? '#e989b4' : '#4d9a58', light = kind === 'cherry' ? '#ffb7d4' : '#67b56a';
    groundShadow(ctx, x, y, s * 0.85);
    ctx.fillStyle = '#6b4a2d'; ctx.fillRect(x - s * 0.12, y - s * 0.9, s * 0.24, s * 0.9);
    ctx.fillStyle = dark; ctx.beginPath(); ctx.arc(x, y - s * 1.35, s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = light; ctx.beginPath(); ctx.arc(x - s * 0.25, y - s * 1.6, s * 0.62, 0, Math.PI * 2); ctx.fill();
  }
  function drawFlower(ctx, { x, y, hue }) {
    ctx.fillStyle = ['#ff7eb6', '#ffd23f', '#ffffff', '#b28dff'][hue];
    for (const [dx, dy] of [[0, 0], [7, 4], [-5, 5]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, 2.4, 0, Math.PI * 2); ctx.fill(); }
  }
  function drawCompass(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(255,255,255,.2)';
    ctx.beginPath(); ctx.arc(0, 0, 50, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.fillStyle = i === 3 ? '#e8453c' : '#fff7df';
      ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(10, 0); ctx.lineTo(-10, 0); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = '#fff7df';
    ctx.font = '26px Bangers, Impact, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('N', 0, -42);
    ctx.restore();
  }

  // ---------- landmark art (static markup, 220 x 180, standing on y = 166) ----------
  const groundArt = '<ellipse cx="110" cy="166" rx="98" ry="13" fill="#0b2a20" opacity=".2"/>';
  const roofShape = (cx, y, w, rise, fill) => `<path d="M${cx - w / 2 - 13} ${y}Q${cx - w / 2 + 9} ${y - 3} ${cx - w * 0.3} ${y - rise}L${cx + w * 0.3} ${y - rise}Q${cx + w / 2 - 9} ${y - 3} ${cx + w / 2 + 13} ${y}Z" fill="${fill}"/><path d="M${cx - w / 2 - 13} ${y}H${cx + w / 2 + 13}" stroke="#00000040" stroke-width="4" stroke-linecap="round"/>`;
  const glow = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#ffd77a"/>`;
  function house(cx, base, w, h, wall, roof, snow) {
    return `<rect x="${cx - w / 2}" y="${base - h}" width="${w}" height="${h}" fill="${wall}"/>`
      + `<rect x="${cx - w / 2}" y="${base - h}" width="${w * 0.22}" height="${h}" fill="#00000018"/>`
      + `<rect x="${cx - 7}" y="${base - h * 0.62}" width="14" height="${h * 0.62}" rx="2" fill="#4a3424"/>`
      + glow(cx + w * 0.18, base - h * 0.72, 11, 11)
      + roofShape(cx, base - h + 2, w, h * 0.62, roof)
      + (snow ? `<path d="M${cx - w * 0.42} ${base - h - 5}Q${cx} ${base - h - h * 0.86} ${cx + w * 0.42} ${base - h - 5}Q${cx} ${base - h - h * 0.3} ${cx - w * 0.42} ${base - h - 5}Z" fill="#fafdff"/>` : '');
  }
  const pineArt = (x, y, s, snow) => `<rect x="${x - 3 * s}" y="${y - 12 * s}" width="${6 * s}" height="${12 * s}" fill="#6b4a2d"/>`
    + [[8, 25, '#2f7a52'], [24, 20, '#378a5d'], [40, 14, snow ? '#fafdff' : '#42996a']].map(([o, w, c]) => `<path d="M${x - w * s} ${y - o * s}L${x} ${y - (o + 30) * s}L${x + w * s} ${y - o * s}Z" fill="${c}"/>`).join('');

  const ART = {
    village: groundArt
      + pineArt(30, 162, 0.9) + pineArt(194, 160, 0.95)
      + house(58, 160, 62, 42, '#e9d6b3', '#b8503c')
      + house(166, 160, 62, 42, '#dfc8a2', '#3f7a8c')
      // central pagoda
      + '<rect x="84" y="118" width="52" height="46" fill="#f2e3c6"/><rect x="84" y="118" width="12" height="46" fill="#00000018"/><rect x="102" y="134" width="16" height="30" rx="2" fill="#5b3a22"/>'
      + roofShape(110, 120, 58, 24, '#a63d32')
      + '<rect x="91" y="78" width="38" height="24" fill="#f2e3c6"/>' + glow(105, 84, 10, 12)
      + roofShape(110, 80, 40, 20, '#a63d32')
      + '<rect x="97" y="48" width="26" height="14" fill="#f2e3c6"/>' + roofShape(110, 50, 26, 15, '#c8503f')
      + '<path d="M110 36V14" stroke="#f5b82e" stroke-width="4" stroke-linecap="round"/><circle cx="110" cy="12" r="5" fill="#f5b82e"/>',
    dojo: groundArt
      + '<rect x="24" y="148" width="172" height="16" rx="3" fill="#b9b2a4"/><rect x="24" y="148" width="172" height="5" fill="#d7d1c4"/>'
      + '<rect x="44" y="88" width="132" height="60" fill="#f5ecd7"/><rect x="44" y="88" width="30" height="60" fill="#0000001c"/>'
      + [60, 94, 126, 160].map((x) => `<rect x="${x - 3}" y="88" width="6" height="60" fill="#6b3d26"/>`).join('')
      + '<rect x="92" y="106" width="36" height="42" fill="#2d1c12"/>' + glow(72, 104, 14, 22) + glow(134, 104, 14, 22)
      + roofShape(110, 92, 150, 38, '#b23a2e')
      + '<rect x="76" y="40" width="68" height="20" fill="#f5ecd7"/>'
      + roofShape(110, 44, 78, 26, '#c8453a')
      + '<circle cx="110" cy="74" r="9" fill="#f5b82e"/><path d="M104 74h12M110 68v12" stroke="#7a3b2e" stroke-width="2.5"/>'
      + '<path d="M110 18V4" stroke="#f5b82e" stroke-width="4" stroke-linecap="round"/>',
    cafe: groundArt
      + house(110, 162, 118, 62, '#c89a6a', '#6b3f26')
      + '<rect x="58" y="110" width="104" height="12" fill="#2f6d62"/>'
      + '<path d="M84 44h48v18q0 20-24 20t-24-20z" fill="#fafdff"/><path d="M132 50q18 0 18 12t-20 12" fill="none" stroke="#fafdff" stroke-width="7"/>'
      + '<path d="M90 50h36" stroke="#7a4a2a" stroke-width="7" stroke-linecap="round"/>'
      + '<g class="atlas-steam" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity=".85"><path d="M98 36q-6-8 0-15t0-15"/><path d="M118 36q-6-8 0-15t0-15"/></g>',
    ramen: groundArt
      + house(110, 162, 118, 62, '#e7c79a', '#7a3b2e')
      + '<rect x="58" y="104" width="104" height="19" fill="#c8362d"/>'
      + [66, 88, 110, 132, 154].map((x) => `<path d="M${x - 8} 123h18v14q-9 5-18 0z" fill="#e8453c"/>`).join('')
      + '<circle cx="48" cy="128" r="10" fill="#ffb347"/><circle cx="172" cy="128" r="10" fill="#ffb347"/>'
      // giant bowl on the roof, with rising steam
      + '<path d="M72 60h76q-3 30-30 34h-16q-27-4-30-34z" fill="#fafdff"/><path d="M72 60h76l-1.5 8h-73z" fill="#e8453c"/>'
      + '<ellipse cx="110" cy="60" rx="38" ry="8" fill="#f2b65c"/><path d="M84 59q7-6 14 0t14 0 14 0" stroke="#fff3c2" stroke-width="3" fill="none" stroke-linecap="round"/>'
      + '<path d="M126 58L156 26M134 60L164 32" stroke="#6b3d26" stroke-width="4" stroke-linecap="round"/>'
      + '<g class="atlas-steam" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" opacity=".85"><path d="M92 46q-7-9 0-17t0-17"/><path d="M112 44q-7-9 0-17t0-17"/></g>',
    stadium: '<ellipse cx="110" cy="164" rx="104" ry="15" fill="#0b2a20" opacity=".2"/>'
      + '<path d="M8 104v30c0 20 46 34 102 34s102-14 102-34v-30z" fill="#c9553f"/>'
      + [36, 66, 98, 130, 162, 190].map((x) => `<rect x="${x}" y="${132 + Math.abs(110 - x) * -0.06}" width="11" height="22" rx="2" fill="#ffd77a" opacity=".85"/>`).join('')
      + '<ellipse cx="110" cy="104" rx="102" ry="52" fill="#e0725a"/><ellipse cx="110" cy="104" rx="88" ry="43" fill="#f6e8cf"/>'
      + '<ellipse cx="110" cy="107" rx="74" ry="34" fill="#55ad5b"/>'
      + '<path d="M60 83h100M42 107h136M60 131h100" stroke="#6dc072" stroke-width="10"/>'
      + '<ellipse cx="110" cy="107" rx="16" ry="8" fill="none" stroke="#fff" stroke-width="3"/><path d="M110 74v67" stroke="#fff" stroke-width="3"/>'
      + [[20, 90, '#2f6fd1'], [200, 90, '#f5b82e'], [62, 58, '#e8453c'], [158, 58, '#3fbf7f']].map(([x, y, c]) => `<path d="M${x} ${y}v-46" stroke="#5b3a22" stroke-width="4"/><path class="atlas-flag" d="M${x} ${y - 46}l28 8-28 11z" fill="${c}"/>`).join(''),
    grotto: groundArt
      + '<path d="M14 164L30 78 66 34 124 18 176 46 206 106 212 164z" fill="#7f8b93"/><path d="M124 18L176 46 206 106 212 164H150z" fill="#65727b"/>'
      + '<path d="M60 164V112Q62 66 110 64T160 112V164z" fill="#123a44"/>'
      + '<ellipse class="atlas-pool" cx="110" cy="150" rx="42" ry="11" fill="#54e0d2"/>'
      + '<path d="M52 164l11-44 13 44zM150 164l14-54 14 54zM96 88l8-22 8 22zM128 94l6-20 8 20z" fill="#71ead9"/>'
      + '<path d="M58 164l5-44 5 44zM157 164l7-54 7 54z" fill="#baf8ec"/>'
      + '<path d="M28 90L66 34 124 18 176 46 192 78Q130 44 28 90z" fill="#67a56b" opacity=".85"/>',
    cave: groundArt
      + '<path d="M6 164C16 90 44 34 110 26s96 62 104 138z" fill="#776a5c"/><path d="M110 26c66-8 96 62 104 138h-60C150 100 138 50 110 26z" fill="#5f5448"/>'
      + '<path d="M58 166V112Q60 64 110 64t52 48v54z" fill="#17120e"/>'
      + '<path d="M50 166V104M170 166V104M44 104Q110 42 176 104" stroke="#8a5a35" stroke-width="12" fill="none" stroke-linecap="round"/>'
      + '<circle cx="110" cy="76" r="8" fill="#ffd77a"/>'
      + '<path d="M88 170L100 100M132 170L120 100M84 160h52M90 136h40M96 116h28" stroke="#a7a39b" stroke-width="4" stroke-linecap="round"/>'
      + '<path class="atlas-cart" d="M84 112h52l-7 28H91z" fill="#b5513a"/><circle cx="96" cy="143" r="6" fill="#2b2b2b"/><circle cx="124" cy="143" r="6" fill="#2b2b2b"/><path d="M92 112l10-13 12 7 11-8 8 14z" fill="#f5b82e"/>',
    town: groundArt
      + pineArt(24, 160, 0.95, true) + pineArt(198, 160, 0.95, true)
      + house(70, 162, 66, 48, '#8a6a4f', '#4a3424', true)
      + house(150, 162, 66, 50, '#9a5a3c', '#4f2a1a', true)
      + house(110, 128, 74, 54, '#6d7f8c', '#2d3a43', true)
      + '<path class="atlas-steam" d="M139 50q-8-8 0-16t0-16" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" opacity=".8"/><rect x="132" y="50" width="14" height="24" fill="#4a3424"/>',
    summit: groundArt
      + '<path d="M8 164L78 62 110 22 148 68 214 164z" fill="#e6eff6"/><path d="M110 22L148 68 214 164H120z" fill="#c3d3e0"/>'
      + '<path d="M36 164l26-38 18 38zM150 164l18-30 22 30z" fill="#8a9aa8"/>'
      + '<path d="M110 24V-8" stroke="#5b3a22" stroke-width="5" stroke-linecap="round"/><path class="atlas-flag" d="M110 -8l32 10-32 12z" fill="#e8453c"/>'
      + '<path d="M66 156h66q12 0 16-11" stroke="#7a4a26" stroke-width="6" fill="none" stroke-linecap="round"/><rect x="74" y="132" width="52" height="16" rx="5" fill="#e8453c"/><rect x="74" y="132" width="52" height="6" rx="3" fill="#ff7468"/><path d="M82 148v8M118 148v8" stroke="#7a4a26" stroke-width="5"/>',
    torii: groundArt
      + '<rect x="50" y="62" width="17" height="102" fill="#c8362d"/><rect x="153" y="62" width="17" height="102" fill="#c8362d"/>'
      + '<rect x="36" y="82" width="148" height="13" fill="#b23a2e"/><path d="M20 42Q110 62 200 42L192 66H28z" fill="#d6453a"/><path d="M26 40Q110 58 194 40" stroke="#2a2a2a" stroke-width="7" fill="none" stroke-linecap="round"/>',
  };

  // ---------- the map screen ----------
  function createAtlas({ root, hud, conn, world, h, toast, getMe, staleGame, onOpen }) {
    const World = window.ClubDojoWorld;
    let data = null, fetching = null, signature = '', paintedBand = '';
    let places = [], links = [], placeById = new Map();
    const previews = new Map(), thumbs = new Map();
    let open_ = false, trip = null, hot = null;
    let fit = { k: 1, ox: 0, oy: 0, W: 1600, H: 900 };

    const land = h('canvas', { class: 'atlas-land', width: W * 1.5, height: H * 1.5, 'aria-hidden': 'true' });
    const trails = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    trails.setAttribute('class', 'atlas-trails');
    trails.setAttribute('viewBox', `0 0 ${W} ${H}`);
    trails.setAttribute('aria-hidden', 'true');
    const placesEl = h('div', { class: 'atlas-places' });
    const tokenCanvas = h('canvas', { width: 240, height: 280 });
    const token = h('div', { class: 'atlas-token', 'aria-hidden': 'true' }, h('span', {}, 'You'), h('div', { class: 'atlas-token-bob' }, tokenCanvas));
    const clouds = h('div', { class: 'atlas-clouds', 'aria-hidden': 'true' }, [0, 1, 2, 3].map((i) => h('i', { class: `c${i}` })));
    const thumb = h('canvas', { class: 'atlas-thumb', width: 552, height: 300 });
    const cardName = h('h3');
    const cardWho = h('p', { class: 'atlas-who' });
    const cardGames = h('div', { class: 'atlas-games' });
    const cardGo = h('div', { class: 'atlas-go' });
    const card = h('div', { class: 'atlas-card', hidden: true, 'aria-hidden': 'true' }, thumb, h('div', { class: 'atlas-card-body' }, cardName, cardWho, cardGames, cardGo));
    const cam = h('div', { class: 'atlas-cam' }, land, trails, clouds, placesEl, token, card); // clouds pass under the name plates
    const closeBtn = h('button', { class: 'atlas-close', 'aria-label': 'Close map', onclick: (e) => { e.stopPropagation(); close(); } }, '×');
    const el = h('section', {
      class: 'atlas', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'World map. Choose a place to travel there.', tabindex: '-1', hidden: true,
      onpointermove: (e) => { if (!trip) setHot(placeAt(e)); },
      onpointerleave: () => { if (!trip) setHot(null); },
      onclick: (e) => {
        if (trip) return;
        const p = placeAt(e);
        if (p) go(p.id); else close();
      },
    }, cam,
    h('header', { class: 'atlas-head' }, h('h2', {}, 'World Map'), h('p', {}, 'Pick a place to travel there')),
    closeBtn,
    h('div', { class: 'atlas-keys', 'aria-hidden': 'true' }, h('kbd', {}, 'M'), ' map  ', h('kbd', {}, 'Esc'), ' close'));
    root.append(el);

    new ResizeObserver(() => { if (open_ && !trip) { measure(); applyCam(null, 1, false); } }).observe(el);

    function measure() {
      const w = el.clientWidth || 1600, ht = el.clientHeight || 900;
      const k = Math.min(w / W, ht / H);
      fit = { k, ox: (w - W * k) / 2, oy: (ht - H * k) / 2, W: w, H: ht };
    }
    function applyCam(focus, zoom, animate) {
      const k = fit.k * zoom;
      const x = focus ? fit.W / 2 - focus.x * k : fit.ox, y = focus ? fit.H / 2 - (focus.y - 40) * k : fit.oy;
      cam.style.transition = animate ? '' : 'none';
      cam.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    }
    function placeAt(e) {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left - fit.ox) / fit.k, y = (e.clientY - r.top - fit.oy) / fit.k;
      let best = null, bestD = SNAP_RADIUS;
      for (const p of places) {
        const d = Math.hypot(x - p.x, y - (p.y - 45));
        if (d < bestD) { best = p; bestD = d; }
      }
      return best;
    }

    // ---------- data ----------
    function refresh() {
      if (fetching) return fetching;
      const have = {};
      for (const [id, room] of previews) if (room.version != null) have[id] = room.version;
      fetching = conn.request('map:get', { have }).then((d) => {
        fetching = null;
        for (const r of d.rooms) if (r.preview) { previews.set(r.id, r.preview); thumbs.delete(r.id); }
        data = d;
        rebuild();
        render();
        return d;
      }, (e) => { fetching = null; throw e; });
      return fetching;
    }

    function rebuild() {
      const sig = JSON.stringify(data.rooms.map((r) => [r.id, r.links]));
      const band = bandOf(world.hour());
      if (sig === signature && band === paintedBand) return;
      const shapeChanged = sig !== signature;
      signature = sig; paintedBand = band;
      if (shapeChanged) buildPlaces();
      paintLand(land, places, links, band);
      el.style.setProperty('--atlas-sea', tint(SEA, BANDS[band]));
      el.dataset.time = band;
    }

    function buildPlaces() {
      places = [];
      for (const r of data.rooms) {
        const fixed = PLACES[r.id];
        if (fixed) places.push({ id: r.id, room: r, ...fixed });
      }
      // New rooms: find a free spot near a room they connect to.
      for (const r of data.rooms) {
        if (PLACES[r.id]) continue;
        const anchor = places.find((p) => r.links.includes(p.id)) || places[0] || { x: W / 2, y: H / 2 };
        const start = (hashText(r.id) >>> 0) % 12;
        let spot = { x: W / 2, y: H / 2 };
        search: for (let ring = 190; ring < 900; ring += 60) for (let i = 0; i < 12; i++) {
          const a = ((i + start) / 12) * Math.PI * 2;
          const x = anchor.x + Math.cos(a) * ring, y = anchor.y + Math.sin(a) * ring * 0.8;
          if (inside(sampleCoast, x, y) && y > 200 && !places.some((p) => Math.hypot(p.x - x, (p.y - y) * 1.5) < 250)) { spot = { x, y }; break search; }
        }
        places.push({ id: r.id, room: r, ...spot, art: 'torii', scale: 0.9 });
      }
      placeById = new Map(places.map((p) => [p.id, p]));
      links = [];
      const seen = new Set();
      for (const p of places) for (const to of p.room.links) {
        const q = placeById.get(to);
        const key = [p.id, to].sort().join('|');
        if (q && !seen.has(key)) { seen.add(key); links.push([p, q]); }
      }

      const riverPts = sampleRiver(40);
      const roads = links.map(([a, b]) => { const c = curveOf(a, b); return `M${a.x} ${a.y}Q${c.x} ${c.y} ${b.x} ${b.y}`; }).join('');
      const bridges = [];
      for (const [a, b] of links) {
        const c = curveOf(a, b);
        for (let t = 0.04; t < 0.96; t += 0.01) {
          const [x, y] = bez(a, c, b, t);
          if (nearAny(riverPts, x, y, 5)) {
            const [nx, ny] = bez(a, c, b, t + 0.01);
            const deg = (Math.atan2(ny - y, nx - x) * 180) / Math.PI;
            bridges.push(`<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(1)})"><rect x="-27" y="-13" width="54" height="26" rx="3" fill="#8a5a35"/><path d="M-20 -13v26M-10 -13v26M0 -13v26M10 -13v26M20 -13v26" stroke="#6b4426" stroke-width="3"/><path d="M-29 -14H29M-29 14H29" stroke="#5b3a22" stroke-width="5" stroke-linecap="round"/></g>`);
            break;
          }
        }
      }
      trails.innerHTML = `<path d="${roads}" fill="none" stroke="#a98250" stroke-width="15" stroke-linecap="round" opacity=".55"/>`
        + `<path d="${roads}" fill="none" stroke="#f3e2b6" stroke-width="10" stroke-linecap="round"/>`
        + `<path d="${roads}" fill="none" stroke="#c9a56e" stroke-width="2.5" stroke-dasharray="3 15" stroke-linecap="round"/>`
        + bridges.join('')
        + '<path class="atlas-route" fill="none" stroke-linecap="round"/><path class="atlas-route-run" fill="none" stroke-linecap="round"/>';

      placesEl.replaceChildren(...[...places].sort((a, b) => a.y - b.y).map((p) => {
        const art = h('div', { class: 'atlas-art', style: { width: `${220 * p.scale}px`, height: `${180 * p.scale}px`, left: `${-110 * p.scale}px`, top: `${-166 * p.scale}px` } });
        art.innerHTML = `<svg viewBox="0 0 220 180" width="100%" height="100%">${ART[p.art]}</svg>`;
        p.count = h('span', { class: 'atlas-count' });
        p.plateName = h('b', {}, p.room.name);
        p.btn = h('button', {
          class: 'atlas-place', style: { left: `${p.x}px`, top: `${p.y}px` },
          onfocus: () => { if (!trip) setHot(p); },
          onclick: (e) => { e.stopPropagation(); go(p.id); },
        }, h('i', { class: 'atlas-ring' }), art, h('div', { class: 'atlas-plate' }, p.plateName, p.count));
        return p.btn;
      }));
    }

    // ---------- drawing the live parts ----------
    function render() {
      if (!data) return;
      for (const p of places) {
        const r = data.rooms.find((x) => x.id === p.id);
        if (!r) continue;
        p.room = r;
        const n = r.players.length;
        const here = r.id === data.here;
        p.plateName.textContent = r.name;
        p.count.textContent = n ? String(n) : '';
        p.count.hidden = !n;
        p.btn.classList.toggle('here', here);
        if (here) p.btn.setAttribute('aria-current', 'location'); else p.btn.removeAttribute('aria-current');
        p.btn.setAttribute('aria-label', `${here ? 'You are at' : 'Travel to'} ${r.name}. ${n} ninja${n === 1 ? '' : 's'} here.`);
      }
      if (!trip) {
        placeToken(placeById.get(data.here));
        if (hot) { const again = placeById.get(hot.id); hot = null; setHot(again || null); }
      }
    }

    function drawToken(facing, walking) {
      const me = getMe();
      if (!me) return;
      const c = tokenCanvas.getContext('2d');
      c.setTransform(2, 0, 0, 2, 0, 0);
      c.clearRect(0, 0, 120, 140);
      World.drawNinja(c, { x: 1.5, y: 2.6, color: me.color, headband: me.headband, belt: me.belt, facing, walking }, 40, performance.now());
    }
    function moveToken(x, y) { token.style.transform = `translate(${x - 60}px, ${y - 122}px)`; }
    function placeToken(p) {
      token.hidden = !p;
      if (!p) return;
      moveToken(p.x, p.y + 10);
      drawToken(0, false);
    }

    function routeIds(from, to) {
      const prev = new Map([[from, null]]);
      const queue = [from];
      while (queue.length) {
        const cur = queue.shift();
        if (cur === to) break;
        for (const n of (placeById.get(cur)?.room.links || [])) if (placeById.has(n) && !prev.has(n)) { prev.set(n, cur); queue.push(n); }
      }
      if (!prev.has(to)) return [from, to];
      const out = [];
      for (let c = to; c != null; c = prev.get(c)) out.unshift(c);
      return out;
    }
    function routeD(ids) {
      let d = '';
      ids.forEach((id, i) => {
        const p = placeById.get(id);
        if (i === 0) { d = `M${p.x} ${p.y}`; return; }
        const c = curveOf(placeById.get(ids[i - 1]), p);
        d += `Q${c.x} ${c.y} ${p.x} ${p.y}`;
      });
      return d;
    }

    function setHot(p) {
      if (p === hot) return;
      if (hot) hot.btn.classList.remove('hot');
      hot = p;
      el.classList.toggle('pointing', !!p);
      const route = trails.querySelector('.atlas-route');
      if (!p) { card.hidden = true; if (route) { route.removeAttribute('d'); route.classList.remove('on'); } return; }
      p.btn.classList.add('hot');
      if (route) {
        if (p.id !== data.here && placeById.has(data.here)) { route.setAttribute('d', routeD(routeIds(data.here, p.id))); route.classList.add('on'); }
        else { route.removeAttribute('d'); route.classList.remove('on'); }
      }
      fillCard(p);
    }

    function fillCard(p) {
      const r = p.room;
      const here = r.id === data.here;
      cardName.textContent = r.name;
      const others = r.players.filter((x) => !x.you);
      const shown = others.slice(0, 3).map((x) => x.name);
      const extra = others.length - shown.length;
      cardWho.replaceChildren(
        ...others.slice(0, 5).map((x) => h('i', { style: { background: x.color } })),
        others.length ? `${shown.join(', ')}${extra > 0 ? ` and ${extra} more` : ''}` : (here ? 'Just you here' : 'Nobody here right now'),
      );
      cardGames.replaceChildren(...r.games.map((g) => h('span', { class: 'atlas-game', style: { '--c': g.color } }, h('em', {}, g.icon), g.name, g.count ? h('b', {}, String(g.count)) : null)));
      cardGames.hidden = !r.games.length;
      cardGo.textContent = here ? 'You are here' : 'Click to travel';
      card.classList.toggle('is-here', here);
      drawThumb(r.id);
      // Show the card beside the place, on whichever side covers fewer other places.
      const cw = 320, ch = 176 + 110 + (r.games.length ? 36 * Math.ceil(r.games.length / 2) : 0);
      const top = clamp(p.y - ch / 2 - 50, 84, H - ch - 16);
      // Hiding the place itself is worst, and the side the trail arrives from is next worst.
      const from = placeById.get(data.here);
      const score = (x) => {
        const others = places.filter((o) => o !== p && o.x > x - 90 && o.x < x + cw + 90 && o.y > top - 10 && o.y - 150 < top + ch).length;
        const hidesPlace = p.x > x - 70 && p.x < x + cw + 70 ? 4 : 0;
        const onTrail = from && from !== p && (x + cw / 2 - p.x) * (from.x - p.x) > 0 ? 0.6 : 0;
        return others + hidesPlace + onTrail;
      };
      const left = [p.x + 130, p.x - 130 - cw].map((x) => clamp(x, 16, W - cw - 16)).sort((a, b) => score(a) - score(b))[0];
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      card.hidden = false;
    }

    function drawThumb(id) {
      const c = thumb.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      const room = previews.get(id);
      c.fillStyle = '#20303c';
      c.fillRect(0, 0, thumb.width, thumb.height);
      if (!room) return;
      let img = thumbs.get(id);
      if (!img) {
        img = document.createElement('canvas');
        img.width = thumb.width; img.height = thumb.height;
        const g = img.getContext('2d');
        const T = Math.max(thumb.width / room.width, thumb.height / room.height);
        g.translate((thumb.width - room.width * T) / 2, (thumb.height - room.height * T) / 2);
        World.drawStatic(g, room, T);
        thumbs.set(id, img);
      }
      c.drawImage(img, 0, 0);
    }

    // ---------- opening and closing ----------
    function show() {
      open_ = true;
      el.hidden = false;
      el.classList.remove('leaving', 'trip');
      hud.inert = true;
      measure();
      setHot(null);
      const here = placeById.get(data.here);
      placeToken(here);
      if (reducedMotion() || !here) applyCam(null, 1, false);
      else {
        applyCam(here, OPEN_ZOOM, false);
        el.classList.add('entering');
        el.getBoundingClientRect(); // commit the start of the zoom-out
        el.classList.remove('entering');
        applyCam(null, 1, true);
      }
      el.focus();
    }

    function open() {
      if (open_) return;
      if (onOpen) onOpen();
      if (data) {
        rebuild();
        show();
        refresh().catch(() => {});
      } else {
        refresh().then(() => { if (!open_) show(); }, (e) => toast(e.message, true));
      }
    }

    function hide() {
      open_ = false;
      trip = null;
      el.hidden = true;
      el.classList.remove('leaving', 'trip', 'pointing');
      hud.inert = false;
      for (const p of places) p.btn.classList.remove('dest');
      if (hot) { hot.btn.classList.remove('hot'); hot = null; }
      card.hidden = true;
      if (el.contains(document.activeElement)) document.activeElement.blur();
    }

    function close() {
      if (!open_ || trip) return;
      if (reducedMotion()) { hide(); return; }
      const here = placeById.get(data.here);
      el.classList.add('leaving');
      if (here) applyCam(here, OPEN_ZOOM, true);
      trip = 'closing';
      setTimeout(hide, 240);
    }

    // ---------- fast travel ----------
    function run(ids) {
      const d = routeD(ids);
      const route = trails.querySelector('.atlas-route');
      const runner = trails.querySelector('.atlas-route-run');
      route.setAttribute('d', d); route.classList.add('on');
      runner.setAttribute('d', d);
      const total = runner.getTotalLength();
      runner.style.strokeDasharray = `0 ${total + 1}`;
      const ms = reducedMotion() ? 0 : clamp(280 + total * 0.55, 480, 880);
      const started = performance.now();
      return new Promise((resolve) => {
        let last = runner.getPointAtLength(0), facing = 0, done = false;
        const finish = () => { if (done) return; done = true; clearTimeout(backup); resolve(); };
        const backup = setTimeout(finish, ms + 120); // keeps going if the window is hidden
        const frame = (now) => {
          if (done) return;
          const t = ms ? clamp((now - started) / ms, 0, 1) : 1;
          const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const at = runner.getPointAtLength(total * eased);
          if (Math.abs(at.x - last.x) > 0.2) facing = Math.sign(at.x - last.x);
          last = at;
          moveToken(at.x, at.y + 10);
          runner.style.strokeDasharray = `${total * eased} ${total + 1}`;
          drawToken(facing, true);
          if (t >= 1) finish(); else requestAnimationFrame(frame);
        };
        trip.cancelRun = finish;
        requestAnimationFrame(frame);
      });
    }

    function request(id) {
      return conn.request('travel', { roomId: id }).catch((e) => {
        // The server still has us in a minigame this window already closed: leave it, then go.
        if (e.code === 'busy' && staleGame()) return conn.request('mg:leave').then(() => conn.request('travel', { roomId: id }));
        throw e;
      });
    }

    async function go(id) {
      if (trip || !data) return;
      if (id === data.here) { close(); return; }
      const dest = placeById.get(id);
      trip = { dest };
      setHot(null);
      el.classList.add('trip');
      dest.btn.classList.add('dest');
      const ids = routeIds(data.here, id);
      const sent = request(id);
      const ran = run(ids);
      try {
        await Promise.all([sent, ran]);
      } catch (e) {
        if (trip?.dest !== dest) return; // the map was reset while we ran (for example a disconnect)
        trip.cancelRun?.();
        trip = null;
        el.classList.remove('trip');
        dest.btn.classList.remove('dest');
        trails.querySelector('.atlas-route').classList.remove('on');
        trails.querySelector('.atlas-route-run').style.strokeDasharray = '0 100000';
        placeToken(placeById.get(data.here));
        if (open_) toast(e.message, true);
        return;
      }
      if (trip?.dest !== dest) return; // the map was reset while we ran (for example a disconnect)
      data.here = id;
      world.reveal();
      trails.querySelector('.atlas-route').classList.remove('on');
      trails.querySelector('.atlas-route-run').style.strokeDasharray = '0 100000';
      if (reducedMotion()) { hide(); return; }
      el.classList.add('leaving');
      applyCam(dest, ARRIVE_ZOOM, true);
      setTimeout(hide, ZOOM_MS);
    }

    // Arrow keys hop to the nearest place in that direction.
    function step(dx, dy) {
      const from = hot || placeById.get(data.here) || places[0];
      let best = null, bestScore = Infinity;
      for (const p of places) {
        if (p === from) continue;
        const vx = p.x - from.x, vy = p.y - from.y;
        const along = vx * dx + vy * dy;
        if (along <= 0) continue;
        const score = along + Math.abs(vx * dy - vy * dx) * 2;
        if (score < bestScore) { best = p; bestScore = score; }
      }
      if (best) best.btn.focus();
    }

    function key(e) {
      if (trip) { e.preventDefault(); return; }
      if (e.key === 'Escape' || e.key === 'm' || e.key === 'M') { e.preventDefault(); close(); return; }
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (dir) { e.preventDefault(); step(...dir); return; }
      if (e.key === 'Enter' && hot && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); go(hot.id); }
    }

    return {
      open,
      close,
      isOpen: () => open_,
      traveling: () => !!trip && trip !== 'closing',
      key,
      refresh: () => { if (open_ && !trip) refresh().catch(() => {}); },
      prefetch: () => { refresh().catch(() => {}); },
      roomChanged: (id) => { if (data) { if (!trip) { data.here = id; if (open_) render(); } } },
      reset: () => { if (open_) hide(); trip = null; data = null; signature = ''; paintedBand = ''; },
    };
  }

  window.ClubDojoAtlas = { create: createAtlas };
})();
