// Sled Race (client). Draws the slope and the sleds; the server decides every position.
// Keys: Left/Right arrows or A/D. On a touch screen, use the big buttons at the bottom.
// Server rules: server/src/minigames/games/sled-race.js
ClubDojoMinigames.register({
  id: 'sled-race',

  mount(ctx) {
    const { h, el, avatar } = ctx;
    const canvas = h('canvas', { class: 'sr-canvas' });
    const hud = h('div', { class: 'sr-hud' });
    const banner = h('div', { class: 'sr-banner', hidden: true });
    const btnLeft = h('button', { class: 'sr-steer', 'aria-label': 'Steer left' }, '◀');
    const btnRight = h('button', { class: 'sr-steer', 'aria-label': 'Steer right' }, '▶');
    const style = h('style', {}, `
      .sr { position: absolute; inset: 0; overflow: hidden; background: #0e1a2b; }
      .sr-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
      .sr-hud { position: absolute; top: 10px; left: 12px; right: 12px; display: flex; justify-content: space-between; gap: 10px;
        font-family: var(--display); font-size: 20px; color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,.6); pointer-events: none; }
      .sr-banner { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-family: var(--display); font-size: 40px;
        color: #ffd96b; text-shadow: 0 3px 8px rgba(0,0,0,.7); pointer-events: none; }
      .sr-steer { position: absolute; bottom: 14px; width: 84px; height: 64px; font-size: 28px; border-radius: 16px; border: 0;
        background: rgba(255,255,255,.22); color: #fff; touch-action: none; user-select: none; }
      .sr-steer.left { left: 14px; } .sr-steer.right { right: 14px; }
      .sr-steer.on { background: rgba(255,255,255,.5); }
    `);
    btnLeft.classList.add('left');
    btnRight.classList.add('right');
    const root = h('div', { class: 'sr' }, canvas, hud, banner, btnLeft, btnRight);
    el.append(style, root);

    const g = canvas.getContext('2d');
    const byId = new Map(ctx.players.map((p) => [p.id, p]));
    const sleds = new Map(); // id -> { x, y, finished, stunned, boosted, rx, ry, flash }
    for (const p of ctx.players) sleds.set(p.id, { x: 0, y: 0, rx: 0, ry: 0, finished: false, stunned: false, boosted: false, flash: 0, place: null });

    let track = { length: 2400, obstacles: [], roundMs: 75000 };
    let startAt = null; // performance time when the round started (for the clock)
    let over = false;
    let raf = 0;
    let last = performance.now();
    let cam = 0;
    let dir = 0; // what we're currently holding
    const held = { left: false, right: false };
    const timers = new Set();
    const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
    const notice = (text, ms = 1400) => { banner.textContent = text; banner.hidden = false; later(ms, () => { banner.hidden = true; }); };

    function setDir(d) {
      if (d === dir) return;
      dir = d;
      ctx.send({ type: 'steer', dir: d });
    }
    function syncDir() { setDir((held.right ? 1 : 0) - (held.left ? 1 : 0)); }
    const KEY = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
    function onKey(e, down) {
      const k = KEY[e.key];
      if (!k || over) return;
      held[k] = down;
      syncDir();
      e.preventDefault();
    }
    const kd = (e) => onKey(e, true);
    const ku = (e) => onKey(e, false);
    document.addEventListener('keydown', kd);
    document.addEventListener('keyup', ku);
    const bindHold = (btn, k) => {
      const down = (e) => { e.preventDefault(); if (over) return; held[k] = true; syncDir(); };
      const up = () => { held[k] = false; syncDir(); };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointerleave', up);
      btn.addEventListener('pointercancel', up);
    };
    bindHold(btnLeft, 'left');
    bindHold(btnRight, 'right');

    // Screen layout: lanes span most of the width; the camera follows the local sled.
    function project(x, y, w, hgt) {
      const scale = hgt / 520;
      return { sx: w / 2 + x * (w * 0.36), sy: hgt * 0.72 - (y - cam) * scale, scale };
    }

    function drawScene(now) {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, root.clientWidth), hgt = Math.max(1, root.clientHeight);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr);
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Snow and trees on both sides
      const bg = g.createLinearGradient(0, 0, 0, hgt);
      bg.addColorStop(0, '#dfeffa'); bg.addColorStop(1, '#f7fbff');
      g.fillStyle = bg; g.fillRect(0, 0, w, hgt);
      const edge = w * 0.16;
      g.fillStyle = '#cfe3f3'; g.fillRect(0, 0, edge, hgt); g.fillRect(w - edge, 0, edge, hgt);
      g.fillStyle = '#2f6b4f';
      const step = 90 * (hgt / 520);
      const offset = ((cam * (hgt / 520)) % step + step) % step;
      for (let i = -1; i < hgt / step + 2; i++) {
        const yy = i * step + offset;
        treeAt(edge * 0.35, yy, edge * 0.32);
        treeAt(w - edge * 0.35, yy + step / 2, edge * 0.32);
      }
      // Lane dashes
      g.strokeStyle = 'rgba(40,90,130,.18)'; g.setLineDash([18, 18]); g.lineWidth = 2;
      for (const lx of [-0.5, 0, 0.5]) {
        g.beginPath(); g.moveTo(w / 2 + lx * w * 0.36, 0); g.lineTo(w / 2 + lx * w * 0.36, hgt); g.stroke();
      }
      g.setLineDash([]);

      // Finish line
      const fin = project(0, track.length, w, hgt);
      if (fin.sy > -20 && fin.sy < hgt + 20) {
        g.fillStyle = '#222'; g.fillRect(w * 0.14, fin.sy - 6, w * 0.72, 12);
        g.fillStyle = '#fff'; for (let i = 0; i < 12; i++) if (i % 2) g.fillRect(w * 0.14 + i * (w * 0.06), fin.sy - 6, w * 0.06, 6);
      }

      // Obstacles
      for (const ob of track.obstacles) {
        const p = project(ob.x, ob.y, w, hgt);
        if (p.sy < -30 || p.sy > hgt + 30) continue;
        const r = 16 * p.scale * 1.8;
        if (ob.kind === 'rock') {
          g.fillStyle = '#6d7785'; g.beginPath(); g.ellipse(p.sx, p.sy, r, r * 0.7, 0, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#fff'; g.beginPath(); g.ellipse(p.sx - r * 0.2, p.sy - r * 0.3, r * 0.5, r * 0.2, 0, 0, Math.PI * 2); g.fill();
        } else {
          g.fillStyle = 'rgba(70,170,255,.55)';
          g.beginPath(); g.moveTo(p.sx - r, p.sy + r * 0.2); g.lineTo(p.sx, p.sy - r * 0.8); g.lineTo(p.sx + r, p.sy + r * 0.2);
          g.lineTo(p.sx + r, p.sy + r * 0.6); g.lineTo(p.sx, p.sy - r * 0.2); g.lineTo(p.sx - r, p.sy + r * 0.6); g.closePath(); g.fill();
        }
      }

      // Sleds: draw far ones first so near ones overlap them
      const order = [...sleds.entries()].sort((a, b) => a[1].ry - b[1].ry);
      for (const [id, sl] of order) {
        const p = byId.get(id);
        if (!p) continue;
        const pos = project(sl.rx, sl.ry, w, hgt);
        if (pos.sy < -60 || pos.sy > hgt + 60) continue;
        const size = Math.max(26, 44 * pos.scale * 2.2);
        // Sled runner
        g.strokeStyle = sl.flash > 0 && Math.floor(now / 90) % 2 ? '#e8453c' : '#5a3a22'; g.lineWidth = 4;
        g.beginPath(); g.moveTo(pos.sx - size * 0.45, pos.sy + 4); g.lineTo(pos.sx + size * 0.45, pos.sy + 4); g.stroke();
        if (sl.boosted) { g.fillStyle = 'rgba(120,200,255,.6)'; g.beginPath(); g.ellipse(pos.sx, pos.sy + size * 0.5, size * 0.3, size * 0.12, 0, 0, Math.PI * 2); g.fill(); }
        avatar.draw(g, p.loadout, { x: pos.sx, y: pos.sy + 2, size, facing: 0, walking: !sl.finished, time: now, you: id === ctx.youId, shadow: true });
        g.font = '600 12px system-ui, sans-serif'; g.textAlign = 'center';
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.55)';
        const label = id === ctx.youId ? `${p.name} (you)` : p.name;
        g.strokeText(label, pos.sx, pos.sy - size * 1.05);
        g.fillStyle = '#fff'; g.fillText(label, pos.sx, pos.sy - size * 1.05);
      }
    }

    function treeAt(x, y, r) {
      g.beginPath(); g.moveTo(x, y - r * 1.6); g.lineTo(x + r, y); g.lineTo(x - r, y); g.closePath(); g.fill();
    }

    function updateHud() {
      const me = sleds.get(ctx.youId);
      const mine = me ? Math.round(Math.min(1, me.y / track.length) * 100) : 0;
      const left = startAt === null ? track.roundMs : Math.max(0, track.roundMs - (performance.now() - startAt));
      const order = [...sleds.entries()].filter(([id]) => byId.has(id))
        .sort((a, b) => (b[1].finished - a[1].finished) || (b[1].y - a[1].y));
      const pos = order.findIndex(([id]) => id === ctx.youId) + 1;
      hud.replaceChildren(
        h('span', {}, `Place ${pos || '-'} / ${order.length}`),
        h('span', {}, `${mine}%`),
        h('span', {}, `${Math.ceil(left / 1000)}s`));
    }

    function step(now) {
      raf = requestAnimationFrame(step);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Smooth the drawn positions toward the server's positions
      const k = 1 - Math.exp(-dt * 14);
      for (const sl of sleds.values()) {
        sl.rx += (sl.x - sl.rx) * k;
        sl.ry += (sl.y - sl.ry) * k;
        if (sl.flash > 0) sl.flash -= dt;
      }
      const me = sleds.get(ctx.youId);
      const target = me ? me.ry : track.length / 2;
      cam += (target - cam) * (1 - Math.exp(-dt * 6));
      drawScene(now);
      updateHud();
    }

    raf = requestAnimationFrame(step);

    return {
      onMessage(data) {
        if (data.type === 'track') {
          track = { length: data.length, roundMs: data.roundMs, obstacles: data.obstacles };
          startAt = performance.now();
          notice('Go!');
        } else if (data.type === 'state') {
          for (const [id, v] of Object.entries(data.players)) {
            const sl = sleds.get(Number(id)); // JSON object keys arrive as strings
            if (!sl) continue;
            sl.x = v[0]; sl.y = v[1]; sl.finished = !!v[2]; sl.stunned = !!v[3]; sl.boosted = !!v[4];
          }
        } else if (data.type === 'hit') {
          const sl = sleds.get(data.id);
          if (sl && data.kind === 'rock') sl.flash = 0.6;
          if (data.id === ctx.youId) notice(data.kind === 'rock' ? 'Ouch!' : 'Boost!', 700);
        } else if (data.type === 'finish') {
          const p = byId.get(data.id);
          if (data.id === ctx.youId) notice(data.place === 1 ? '🏆 First!' : `Finished #${data.place}!`, 2200);
          else if (p) notice(`${p.name} finished #${data.place}`, 1600);
        } else if (data.type === 'over') {
          over = true;
          held.left = held.right = false;
          setDir(0);
          for (const [id, v] of Object.entries(data.players || {})) {
            const sl = sleds.get(Number(id));
            if (sl) { sl.x = v[0]; sl.y = v[1]; }
          }
        }
      },
      unmount() {
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', kd);
        document.removeEventListener('keyup', ku);
        for (const t of timers) clearTimeout(t);
        timers.clear();
      },
    };
  },
});
