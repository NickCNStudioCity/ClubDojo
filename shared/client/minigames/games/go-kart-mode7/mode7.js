// Mode 7 projection and floor renderer for the Go-Kart Race client. Pure maths plus a pixel
// loop over typed arrays, with no DOM access, so it runs (and is tested) in Node too:
// scripts/check-mode7.js. Loads as CommonJS in Node and as window.ClubDojoMode7 in the clients.
//
// World: x right, y down (the same as the track's top-down coordinates). A heading h points along
// (cos h, sin h). The camera sits `height` world units above the ground and looks along its heading.
// Screen: x right, y down; the horizon is screen row `horizon`, and `focal` is the focal length in pixels.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClubDojoMode7 = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // cam: { x, y, h, height, focal, horizon, width, rows }   (rows = screen height in pixels)
  function camera(opts) {
    const cam = { x: 0, y: 0, h: 0, height: 24, focal: 300, horizon: 80, width: 400, rows: 250, ...opts };
    cam.fx = Math.cos(cam.h); cam.fy = Math.sin(cam.h);   // forward
    cam.rx = -cam.fy; cam.ry = cam.fx;                    // right (90° clockwise on screen)
    return cam;
  }

  // World ground point -> screen. Returns null when the point is behind (or level with) the camera.
  // z is the depth along the view direction; scale = focal / z, the size of 1 world unit there.
  function project(cam, wx, wy) {
    const dx = wx - cam.x;
    const dy = wy - cam.y;
    const z = dx * cam.fx + dy * cam.fy;
    if (z <= 1e-6) return null;
    const side = dx * cam.rx + dy * cam.ry;
    const scale = cam.focal / z;
    return { x: cam.width / 2 + side * scale, y: cam.horizon + cam.height * scale, z, scale };
  }

  // Screen pixel (below the horizon) -> the world ground point it shows. Null at or above the horizon.
  function unproject(cam, sx, sy) {
    const dyRow = sy - cam.horizon;
    if (dyRow <= 0) return null;
    const z = (cam.focal * cam.height) / dyRow;
    const side = ((sx - cam.width / 2) * z) / cam.focal;
    return { x: cam.x + cam.fx * z + cam.rx * side, y: cam.y + cam.fy * z + cam.ry * side, z };
  }

  // Draws the ground into out (Uint32Array, cam.width x cam.rows, packed like ImageData on
  // little-endian machines: 0xAABBGGRR). Only rows below the horizon are written.
  // tex: { data: Uint32Array, w, h, scale, ox, oy }  (scale = texels per world unit; ox, oy = the
  // world point at texel 0,0, so the image can extend past the world edges)
  // outside(wx, wy) -> packed colour for ground off the texture (or a number for a flat colour).
  // Pixel centres are sampled (sx + 0.5, sy + 0.5) so the result matches unproject().
  function renderFloor(cam, out, tex, outside) {
    const W = cam.width;
    const flat = typeof outside === 'number' ? outside : null;
    const td = tex.data, tw = tex.w, th = tex.h, ts = tex.scale;
    const ox = tex.ox || 0, oy = tex.oy || 0; // world point at texel (0, 0)
    const first = Math.max(0, Math.floor(cam.horizon + 0.5));
    for (let sy = first; sy < cam.rows; sy++) {
      const dyRow = sy + 0.5 - cam.horizon;
      if (dyRow <= 0) continue;
      const z = (cam.focal * cam.height) / dyRow;
      const k = z / cam.focal;                 // world units per screen pixel on this row
      // World point at the centre of pixel 0, then step one pixel to the right.
      const side0 = (0.5 - W / 2) * k;
      let wx = cam.x + cam.fx * z + cam.rx * side0;
      let wy = cam.y + cam.fy * z + cam.ry * side0;
      const stepX = cam.rx * k;
      const stepY = cam.ry * k;
      let o = sy * W;
      for (let sx = 0; sx < W; sx++, o++, wx += stepX, wy += stepY) {
        const tx = Math.floor((wx - ox) * ts);
        const ty = Math.floor((wy - oy) * ts);
        if (tx >= 0 && ty >= 0 && tx < tw && ty < th) out[o] = td[ty * tw + tx];
        else out[o] = flat !== null ? flat : outside(wx, wy);
      }
    }
  }

  // Packs r, g, b (0-255) into the 0xAABBGGRR layout ImageData uses on little-endian machines.
  const rgba = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;

  return { camera, project, unproject, renderFloor, rgba };
});
