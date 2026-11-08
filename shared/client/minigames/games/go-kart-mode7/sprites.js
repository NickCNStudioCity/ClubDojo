// Placeholder kart sprites for the Go-Kart Race Mode 7 view. Each kart gets a sheet of FRAMES
// pre-drawn angles (frame 0 = seen from behind, then turning clockwise). Real art can replace
// makeKartSheet() with an image of the same layout without touching the renderer.
// Loads as CommonJS in Node (frameFor only; drawing needs a canvas) and as window.ClubDojoKartSprites.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClubDojoKartSprites = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const FRAMES = 8;
  const PPU = 2;           // sheet pixels per world unit
  const FW = 64, FH = 48;  // frame size in sheet pixels
  const AX = FW / 2;       // anchor: the kart's contact point (centre of its footprint) in the frame
  const AY = 34;

  // Which frame shows a kart whose heading is `rel` radians clockwise from the view direction.
  function frameFor(rel) {
    const step = (Math.PI * 2) / FRAMES;
    const i = Math.round(rel / step);
    return ((i % FRAMES) + FRAMES) % FRAMES;
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }

  // Draws a simple low kart (body, nose, four wheels, driver with headband) for each angle, in a
  // slightly top-down oblique view so the shape reads at every angle.
  function makeKartSheet(color, band) {
    const c = document.createElement('canvas');
    c.width = FW * FRAMES; c.height = FH;
    const g = c.getContext('2d');
    const TILT = 0.38;  // how much depth shows as height (camera looks slightly down)
    const UP = 0.92;
    for (let f = 0; f < FRAMES; f++) {
      const a = (f * Math.PI * 2) / FRAMES;
      const sin = Math.sin(a), cos = Math.cos(a);
      // Kart-local (fwd, right, up) in world units -> sheet pixels.
      const P = (fwd, right, up) => {
        const side = fwd * sin + right * cos;
        const depth = fwd * cos - right * sin;
        return { x: f * FW + AX + side * PPU, y: AY - (up * UP + depth * TILT) * PPU, depth };
      };
      const poly = (pts, fill) => {
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.closePath(); g.fillStyle = fill; g.fill();
      };
      const box = (f0, f1, r0, r1, u) => [P(f1, r0, u), P(f1, r1, u), P(f0, r1, u), P(f0, r0, u)];

      poly(box(-12, 12, -10, 10, 0), 'rgba(0,0,0,.28)'); // shadow

      const wheels = [[-7, -9], [-7, 9], [7, -9], [7, 9]].map(([fw, rt]) => ({ fw, rt, d: P(fw, rt, 0).depth }));
      const drawWheel = (w) => {
        poly(box(w.fw - 3, w.fw + 3, w.rt - 2, w.rt + 2, 0), '#111');
        poly(box(w.fw - 3, w.fw + 3, w.rt - 2, w.rt + 2, 4), '#2a2a2a');
      };
      // Far wheels first, then the body, then near wheels, so the body hides the far ones.
      wheels.sort((p, q) => q.d - p.d);
      wheels.slice(0, 2).forEach(drawWheel);
      // Body: a dark lower slab, then the coloured top, then a lighter nose wedge.
      poly(box(-10, 11, -7, 7, 2), shade(color, 0.55));
      poly(box(-10, 11, -7, 7, 5), color);
      poly([P(11, -5, 5.2), P(15, 0, 4), P(11, 5, 5.2)], shade(color, 1.25));
      wheels.slice(2).forEach(drawWheel);
      // Driver: head sits a little behind the middle.
      const head = P(-2, 0, 11);
      g.fillStyle = '#20262e';
      g.beginPath(); g.arc(head.x, head.y, 4.2 * PPU, 0, Math.PI * 2); g.fill();
      g.fillStyle = band;
      g.fillRect(head.x - 4.2 * PPU, head.y - 1.4 * PPU, 8.4 * PPU, 1.6 * PPU);
      // Eyes show only from the front half, so facing direction is obvious.
      if (Math.cos(a) < -0.2) {
        const eye = P(2, 0, 11.5);
        g.fillStyle = '#f3efe2';
        g.fillRect(eye.x - 2.6 * PPU, eye.y, 5.2 * PPU, 1.1 * PPU);
      }
    }
    return { canvas: c, frames: FRAMES, fw: FW, fh: FH, ax: AX, ay: AY, ppu: PPU };
  }

  return { FRAMES, frameFor, makeKartSheet };
});
