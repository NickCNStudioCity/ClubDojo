// Ninja avatar renderer, shared by the world, menus and every minigame.
// Input is a loadout (shared/protocol.js loadoutFromNinja): name, gi color, headband, belt, accessories.
// Accessories draw in slot layers around the base ninja; register them with registerAccessory.
// Design notes: docs/minigames/character-loading.md
(function () {
  const P = window.ClubDojoProtocol;

  // Draw order. 'back' goes behind the body; the rest go on top in this order.
  const LAYERS_BEHIND = ['back'];
  const LAYERS_FRONT = ['body', 'feet', 'face', 'head', 'hand'];
  const accessories = new Map(); // id -> { id, slot, name, draw(ctx, g, loadout), preload?() }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function registerAccessory(def) {
    if (!def || !def.id || !P.ACCESSORY_SLOTS.includes(def.slot) || typeof def.draw !== 'function') {
      throw new Error('registerAccessory needs { id, slot (one of ACCESSORY_SLOTS), draw(ctx, g, loadout) }');
    }
    accessories.set(def.id, def);
  }

  function drawSlots(ctx, slots, loadout, g) {
    const equipped = (loadout && loadout.accessories) || {};
    for (const slot of slots) {
      const acc = accessories.get(equipped[slot]);
      if (!acc) continue; // unknown or not yet installed accessory: skip, never crash a minigame
      ctx.save();
      try { acc.draw(ctx, g, loadout); } catch (e) { console.warn(`Accessory ${acc.id} failed to draw`, e); }
      ctx.restore();
    }
  }

  /**
   * Draw a ninja.
   * @param ctx      2D canvas context
   * @param loadout  { color, headband, belt, accessories }
   * @param o        { x, y: feet position in px; size: scale in px (one world tile);
   *                   facing: -1 | 0 | 1; walking; time (ms); you: highlight ring; shadow (default true) }
   * @returns geometry { cx, top, feet, bw, bh } so callers can place names, bubbles or effects
   */
  function draw(ctx, loadout, o) {
    const T = o.size;
    const time = o.time ?? performance.now();
    const cx = o.x;
    const feet = o.y;
    const bw = T * 0.78, bh = T * 1.15;
    const bob = o.walking ? Math.abs(Math.sin(time / 90)) * T * 0.06 : 0;
    const top = feet - bh - bob;
    const look = o.facing || 0;
    const g = { cx, top, feet, bw, bh, T, facing: look, time };

    if (o.shadow !== false) {
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      ctx.beginPath(); ctx.ellipse(cx, feet, bw * 0.55, T * 0.16, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (o.you) {
      ctx.strokeStyle = 'rgba(47,111,209,.8)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, feet, bw * 0.7, T * 0.22, 0, 0, Math.PI * 2); ctx.stroke();
    }
    drawSlots(ctx, LAYERS_BEHIND, loadout, g);

    // gi
    ctx.fillStyle = loadout.color || '#20262e';
    roundRect(ctx, cx - bw / 2, top, bw, bh, bw * 0.45);
    ctx.fill();
    // face opening and eyes
    ctx.fillStyle = '#f1d3b3';
    roundRect(ctx, cx - bw * 0.36, top + bh * 0.2, bw * 0.72, bh * 0.17, bh * 0.07);
    ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(cx - bw * 0.2 + look * bw * 0.06 - T * 0.04, top + bh * 0.25, T * 0.08, T * 0.08);
    ctx.fillRect(cx + bw * 0.14 + look * bw * 0.06 - T * 0.04, top + bh * 0.25, T * 0.08, T * 0.08);
    // headband with tails
    ctx.fillStyle = loadout.headband || '#e8453c';
    ctx.fillRect(cx - bw / 2 + bw * 0.06, top + bh * 0.1, bw * 0.88, bh * 0.07);
    const tailDir = look >= 0 ? -1 : 1;
    const wave = Math.sin(time / 200) * T * 0.05;
    ctx.beginPath();
    ctx.moveTo(cx + tailDir * bw * 0.42, top + bh * 0.12);
    ctx.lineTo(cx + tailDir * bw * 0.8, top + bh * 0.08 + wave);
    ctx.lineTo(cx + tailDir * bw * 0.78, top + bh * 0.18 + wave);
    ctx.closePath();
    ctx.fill();
    // belt sash
    const belt = P.beltById(loadout.belt);
    ctx.fillStyle = belt.color;
    ctx.fillRect(cx - bw / 2 + 1, top + bh * 0.66, bw - 2, bh * 0.09);
    if (belt.id === 'white') { ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1; ctx.strokeRect(cx - bw / 2 + 1, top + bh * 0.66, bw - 2, bh * 0.09); }
    ctx.fillRect(cx + bw * 0.12, top + bh * 0.72, bw * 0.1, bh * 0.16);

    drawSlots(ctx, LAYERS_FRONT, loadout, g);
    return g;
  }

  // Load any images or other assets the given loadouts need before a minigame starts.
  // Vector accessories need nothing; image-based ones implement preload().
  function preload(loadouts) {
    const jobs = [];
    for (const l of loadouts || []) {
      for (const id of Object.values((l && l.accessories) || {})) {
        const acc = accessories.get(id);
        if (acc && acc.preload) jobs.push(Promise.resolve(acc.preload()).catch(() => {}));
      }
    }
    return Promise.all(jobs);
  }

  // Draw a ninja centered in a small canvas (lobby cards, menus, results).
  function portrait(loadout, size = 64) {
    const c = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr; c.height = size * dpr;
    c.style.width = `${size}px`; c.style.height = `${size}px`;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    draw(ctx, loadout, { x: size / 2, y: size * 0.88, size: size * 0.62, facing: 0, time: 0 });
    return c;
  }

  window.ClubDojoAvatar = { draw, preload, portrait, registerAccessory, accessories, LAYERS_BEHIND, LAYERS_FRONT };
})();
