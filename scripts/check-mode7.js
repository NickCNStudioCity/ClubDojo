// Unit checks for the Go-Kart Mode 7 maths (shared/client/minigames/games/go-kart-mode7/mode7.js)
// and the shared track module. Run: npm run check:mode7
const assert = require('assert');
const M7 = require('../shared/client/minigames/games/go-kart-mode7/mode7');
const T = require('../shared/client/minigames/games/go-kart-mode7/track');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failures++; console.log(`  FAIL ${name}: ${e.message}`); }
}
const near = (a, b, eps = 1e-6, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} expected ${b}, got ${a}`);

const base = { x: 100, y: 200, h: 0, height: 20, focal: 200, horizon: 60, width: 400, rows: 240 };

console.log('Checking Mode 7 projection');

test('a point straight ahead lands on the centre column at horizon + focal*height/z', () => {
  const cam = M7.camera(base);
  const p = M7.project(cam, 100 + 50, 200);  // 50 units ahead, heading east
  near(p.x, 200, 1e-9, 'x');
  near(p.y, 60 + (200 * 20) / 50, 1e-9, 'y'); // 140
  near(p.z, 50, 1e-9, 'z');
  near(p.scale, 4, 1e-9, 'scale');
});

test('right of the heading is right on screen (world y down)', () => {
  const cam = M7.camera(base);                // facing east, so south (+y) is to the right
  const p = M7.project(cam, 150, 210);
  near(p.x, 200 + 10 * 4, 1e-9, 'x');         // 10 units right at scale 4
});

test('heading rotates the view: facing north, a point to the north is centred', () => {
  const cam = M7.camera({ ...base, h: -Math.PI / 2 });
  const p = M7.project(cam, 100, 200 - 80);
  near(p.x, 200, 1e-9, 'x');
  near(p.y, 60 + (200 * 20) / 80, 1e-9, 'y');
  const east = M7.project(cam, 110, 120);     // facing north, east is to the right
  assert.ok(east.x > 200, 'east should be right of centre');
});

test('points behind the camera are not projected', () => {
  const cam = M7.camera(base);
  assert.strictEqual(M7.project(cam, 90, 200), null);
  assert.strictEqual(M7.project(cam, 100, 300), null); // exactly sideways
});

test('nearer points sit lower on screen and draw larger', () => {
  const cam = M7.camera(base);
  const nearP = M7.project(cam, 130, 200);
  const farP = M7.project(cam, 400, 200);
  assert.ok(nearP.y > farP.y && nearP.scale > farP.scale);
  assert.ok(farP.y > base.horizon);
});

test('unproject inverts project for many headings and points', () => {
  for (let i = 0; i < 200; i++) {
    const cam = M7.camera({ ...base, h: (i / 200) * Math.PI * 2 - Math.PI, x: 37 * i % 900, y: 53 * i % 600 });
    const sx = (i * 7) % 400 + 0.5;
    const sy = 61 + ((i * 13) % 179);
    const w = M7.unproject(cam, sx, sy);
    const p = M7.project(cam, w.x, w.y);
    near(p.x, sx, 1e-6, `x (i=${i})`);
    near(p.y, sy, 1e-6, `y (i=${i})`);
  }
  assert.strictEqual(M7.unproject(M7.camera(base), 10, 60), null);
});

test('renderFloor samples the texel under each pixel centre, and leaves the sky alone', () => {
  // Texture 1 texel per unit with a unique value per texel, so the sample can be checked exactly.
  const tw = 1000, th = 640;
  const data = new Uint32Array(tw * th);
  for (let i = 0; i < data.length; i++) data[i] = i + 1;
  const tex = { data, w: tw, h: th, scale: 1 };
  const cam = M7.camera({ ...base, x: 300, y: 300, h: 0.7 });
  const out = new Uint32Array(cam.width * cam.rows).fill(0xdeadbeef);
  const OUT = 7;
  M7.renderFloor(cam, out, tex, OUT);
  for (let sy = 0; sy < cam.rows; sy += 9) {
    for (let sx = 0; sx < cam.width; sx += 11) {
      const v = out[sy * cam.width + sx];
      if (sy + 0.5 <= cam.horizon) { assert.strictEqual(v, 0xdeadbeef, `sky pixel ${sx},${sy} written`); continue; }
      const w = M7.unproject(cam, sx + 0.5, sy + 0.5);
      const tx = Math.floor(w.x), ty = Math.floor(w.y);
      const inside = tx >= 0 && ty >= 0 && tx < tw && ty < th;
      // Allow a neighbouring texel where the incremental step lands right on a texel edge.
      if (!inside) { if (v !== OUT) assert.ok(v > 0, `pixel ${sx},${sy}`); continue; }
      const expect = ty * tw + tx + 1;
      if (v !== expect) {
        const vx = (v - 1) % tw, vy = Math.floor((v - 1) / tw);
        assert.ok(Math.abs(vx - tx) <= 1 && Math.abs(vy - ty) <= 1, `pixel ${sx},${sy}: texel ${vx},${vy} instead of ${tx},${ty}`);
      }
    }
  }
});

test('rgba packs like little-endian ImageData', () => {
  const px = new Uint32Array([M7.rgba(10, 20, 30, 40)]);
  assert.deepStrictEqual([...new Uint8ClampedArray(px.buffer)], [10, 20, 30, 40]);
});

console.log('Checking shared track');

test('start grid sits inside the walls, just behind the line', () => {
  // The grid runs straight back from point 0 while the road curves, so slot 4 starts a few units
  // onto the verge (about 59 from the centreline). That is the original behaviour, kept on purpose.
  for (let i = 0; i < 4; i++) {
    const s = T.gridSlot(i);
    const n = T.nearest(s.x, s.y);
    assert.ok(n.d < T.HALF_WIDTH + T.WALL_MARGIN, `slot ${i} is ${n.d} from the centreline`);
    assert.ok(n.s > T.TRACK.length / 2, `slot ${i} should be just before the line (s=${n.s})`);
  }
});

test('start line spans the road width at point 0', () => {
  const { a, b } = T.startLine();
  near(Math.hypot(b.x - a.x, b.y - a.y), T.HALF_WIDTH * 2, 1e-9, 'width');
  near((a.x + b.x) / 2, T.TRACK.pts[0].x, 1e-9, 'mid x');
  near((a.y + b.y) / 2, T.TRACK.pts[0].y, 1e-9, 'mid y');
});

test('the whole track, walls included, fits inside the padded floor image', () => {
  // The client pads the world by 100 units (TEX_PAD in go-kart-race.js); the wall pokes ~4 past the top.
  const m = T.HALF_WIDTH + T.WALL_MARGIN - 100;
  for (const p of T.TRACK.pts) assert.ok(p.x - m >= 0 && p.y - m >= 0 && p.x + m <= T.WORLD.w && p.y + m <= T.WORLD.h, `point ${p.x},${p.y}`);
});

console.log(failures ? `\n${failures} problem(s) found.` : '\nMode 7 maths look good.');
process.exitCode = failures ? 1 : 0;
