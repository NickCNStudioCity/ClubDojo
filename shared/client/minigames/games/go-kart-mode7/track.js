// Go-Kart Race track geometry, shared by the server rules and the client renderer so both use
// identical numbers. Loads as a CommonJS module in Node and as a plain <script>
// (window.ClubDojoKartTrack) in the clients, like shared/protocol.js.
// Server: server/src/minigames/games/go-kart-race.js   Client: ../go-kart-race.js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClubDojoKartTrack = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const TRACK_SAMPLES = 36;
  const HALF_WIDTH = 52;   // road half-width in world pixels
  const WALL_MARGIN = 30;  // how far past the road edge a kart can drift before it is pushed back
  const KART_RADIUS = 12;
  const GRID_GAP = 34;     // spacing of the starting grid
  const WORLD = { w: 1000, h: 640 };

  // Closed loop built from a radius function. Points are generated once, in order.
  function build() {
    const pts = [];
    for (let k = 0; k < TRACK_SAMPLES; k++) {
      const a = (Math.PI * 2 * k) / TRACK_SAMPLES;
      const r = 200 + 55 * Math.sin(2 * a) + 25 * Math.cos(3 * a);
      pts.push({ x: Math.round(500 + 1.35 * r * Math.cos(a)), y: Math.round(320 + r * Math.sin(a)) });
    }
    const seg = [];
    const cum = [0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      seg.push({ dx, dy, len, len2: len * len });
      cum.push(cum[i] + len);
    }
    return { pts, seg, length: cum[pts.length], cum };
  }

  const TRACK = build();

  // Nearest point on the centerline: distance, track position s (0..length), and the outward normal.
  function nearest(x, y) {
    let best = null;
    for (let i = 0; i < TRACK.pts.length; i++) {
      const a = TRACK.pts[i];
      const sg = TRACK.seg[i];
      const t = Math.max(0, Math.min(1, ((x - a.x) * sg.dx + (y - a.y) * sg.dy) / sg.len2));
      const px = a.x + sg.dx * t;
      const py = a.y + sg.dy * t;
      const d2 = (x - px) ** 2 + (y - py) ** 2;
      if (!best || d2 < best.d2) best = { d2, i, t, px, py };
    }
    const d = Math.sqrt(best.d2);
    const nx = d > 1e-6 ? (x - best.px) / d : 0;
    const ny = d > 1e-6 ? (y - best.py) / d : -1;
    return { d, s: TRACK.cum[best.i] + best.t * TRACK.seg[best.i].len, px: best.px, py: best.py, nx, ny };
  }

  // Start grid slot i: staggered just behind the start line, facing along the first segment.
  function gridSlot(i) {
    const back = i * GRID_GAP + 12;
    const dir = TRACK.seg[0];
    const x = TRACK.pts[0].x - (dir.dx / dir.len) * back;
    const y = TRACK.pts[0].y - (dir.dy / dir.len) * back;
    return { x, y, h: Math.atan2(dir.dy, dir.dx), back };
  }

  // Start/finish line endpoints across the road at point 0.
  function startLine() {
    const a = TRACK.pts[0];
    const sg = TRACK.seg[0];
    const nx = -sg.dy / sg.len;
    const ny = sg.dx / sg.len;
    return { a: { x: a.x + nx * HALF_WIDTH, y: a.y + ny * HALF_WIDTH }, b: { x: a.x - nx * HALF_WIDTH, y: a.y - ny * HALF_WIDTH } };
  }

  return { TRACK, HALF_WIDTH, WALL_MARGIN, KART_RADIUS, GRID_GAP, WORLD, nearest, gridSlot, startLine };
});
