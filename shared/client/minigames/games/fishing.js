// Fishing (client). Server rules: server/src/minigames/games/fishing.js
// Hold left click to lower the line, release to reel in. When the hook is out of the water,
// left click a fish on the hook to take it off.
ClubDojoMinigames.register({
  id: 'fishing',

  mount(ctx) {
    const { h, el } = ctx;
    // Must match the kinds in the server file (colors and sizes are client-only).
    const FISH_STYLE = {
      minnow: { color: '#9ad0ec', len: 0.07 },
      perch: { color: '#f5b82e', len: 0.1 },
      snapper: { color: '#e8453c', len: 0.13 },
      golden: { color: '#ffd700', len: 0.16 },
    };
    // Depth 0..1 maps to the height of the canvas. Depth 0 is out of the water.
    const WATER = 0.12; // depth where the surface is (same as the server)
    const hookY = (d) => 0.1 + d * 0.85;

    const style = h('style', {}, `
      .fi { display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; padding: 8px; box-sizing: border-box; }
      .fi-hud { display: flex; gap: 18px; font-family: var(--display); font-size: 22px; }
      .fi-hud b { color: var(--gold); }
      .fi-canvas { width: 100%; max-width: 800px; height: auto; aspect-ratio: 800 / 450; border-radius: 14px; touch-action: none; cursor: pointer; user-select: none; }
      .fi-status { font-family: var(--display); font-size: 20px; min-height: 28px; text-align: center; }
    `);
    const coinsEl = h('b', {}, '0');
    const timeEl = h('b', {}, '--');
    const hud = h('div', { class: 'fi-hud' }, h('span', {}, 'Coins ', coinsEl), h('span', {}, 'Time ', timeEl));
    const status = h('div', { class: 'fi-status' }, 'Hold left click to lower the line...');
    const canvas = h('canvas', { class: 'fi-canvas', width: 800, height: 450 });
    el.append(style, h('div', { class: 'fi' }, hud, canvas, status));
    const g = canvas.getContext('2d');

    const timers = new Set();
    const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

    let state = null;
    let holding = false;
    let lastMove = 0;
    let raf = 0;
    let unmounted = false;

    // Where each hooked fish is drawn, as fractions of the canvas. Used for drawing and clicks.
    function hookedLayout() {
      if (!state) return [];
      const hooked = state.fish.filter((f) => f.hooked);
      return hooked.map((f, k) => ({ f, x: state.line.x, y: hookY(state.line.depth) + 0.035 + k * 0.05 }));
    }

    function fromEvent(e) {
      const r = canvas.getBoundingClientRect();
      return { fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height };
    }

    function onDown(e) {
      if (e.button !== 0 || !state) return;
      e.preventDefault();
      const { fx, fy } = fromEvent(e);
      const outOfWater = state.line.depth <= 0;
      if (outOfWater && hookedLayout().length > 0) {
        // Take a fish off the hook: the one clicked, or the first one if the click missed.
        let pick = null;
        let best = 0.06;
        for (const item of hookedLayout()) {
          const dist = Math.hypot((fx - item.x) * (canvas.width / canvas.height), fy - item.y);
          if (dist < best) { best = dist; pick = item; }
        }
        ctx.send({ type: 'unhook', id: pick ? pick.f.id : hookedLayout()[0].f.id });
        return;
      }
      holding = true;
      ctx.send({ type: 'hold', on: true });
    }

    function onUp(e) {
      if (e.button !== 0 || !holding) return;
      holding = false;
      ctx.send({ type: 'hold', on: false });
    }

    function onMove(e) {
      const now = performance.now();
      if (now - lastMove < 30) return;
      lastMove = now;
      ctx.send({ type: 'move', x: fromEvent(e).fx });
    }

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // ---- drawing ----
    function drawFish(x, y, kind, dir, t, hooked) {
      const st = FISH_STYLE[kind] || FISH_STYLE.minnow;
      const W = canvas.width;
      const H = canvas.height;
      const len = st.len * W;
      const cx = x * W;
      const cy = y * H + Math.sin(t / 180 + x * 10) * (hooked ? 0 : 3);
      g.save();
      g.translate(cx, cy);
      g.scale(dir, 1);
      g.fillStyle = st.color;
      g.beginPath();
      g.ellipse(0, 0, len / 2, len / 4, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath(); // tail
      g.moveTo(-len / 2 + 2, 0);
      g.lineTo(-len / 2 - len / 3, -len / 4);
      g.lineTo(-len / 2 - len / 3, len / 4);
      g.closePath();
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(len / 5, -len / 12, len / 12, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#222';
      g.beginPath(); g.arc(len / 5 + 1, -len / 12, len / 24, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    function render(t) {
      const W = canvas.width;
      const H = canvas.height;
      const surfaceY = hookY(WATER) * H;
      g.clearRect(0, 0, W, H);

      // sky
      const sky = g.createLinearGradient(0, 0, 0, surfaceY);
      sky.addColorStop(0, '#bfe6ff');
      sky.addColorStop(1, '#e6f7ff');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, surfaceY);

      // water
      const water = g.createLinearGradient(0, surfaceY, 0, H);
      water.addColorStop(0, '#3a9ad9');
      water.addColorStop(1, '#0d3b66');
      g.fillStyle = water;
      g.fillRect(0, surfaceY, W, H - surfaceY);

      // waves
      g.strokeStyle = 'rgba(255,255,255,.6)';
      g.lineWidth = 3;
      g.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = surfaceY + Math.sin(x / 26 + t / 400) * 3;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();

      if (!state) return;

      // fish that are free in the pond
      for (const f of state.fish) {
        if (f.hooked) continue;
        drawFish(f.x, hookY(f.depth), f.kind, f.dir, t, false);
      }

      // line and hook
      const lx = state.line.x * W;
      const hy = hookY(state.line.depth) * H;
      g.strokeStyle = '#f0f0f0';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(lx, 0);
      g.lineTo(lx, hy);
      g.stroke();
      g.strokeStyle = '#c0c0c0';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(lx, hy + 8, 10, Math.PI * 0.1, Math.PI * 1.3);
      g.stroke();

      // hooked fish, dangling from the hook
      for (const item of hookedLayout()) {
        drawFish(item.x, item.y, item.f.kind, item.f.dir, t, true);
      }
    }

    function frame(t) {
      if (unmounted) return;
      render(t);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    function updateHud() {
      if (!state) return;
      coinsEl.textContent = String(state.score);
      timeEl.textContent = `${Math.ceil(state.timeLeft / 1000)}s`;
    }

    function updateStatus() {
      if (!state || status.dataset.flash) return;
      const onHook = hookedLayout().length > 0;
      if (state.line.depth <= 0 && onHook) status.textContent = 'Out of the water! Click the fish to take them off the hook.';
      else if (onHook) status.textContent = 'Got one! Release to reel it in.';
      else if (state.line.hold) status.textContent = 'Lowering the line...';
      else status.textContent = 'Hold left click to lower the line...';
    }

    return {
      onMessage(m) {
        switch (m.type) {
          case 'state':
            state = m;
            updateHud();
            updateStatus();
            break;
          case 'landed':
            coinsEl.textContent = String(m.score);
            status.dataset.flash = '1';
            status.textContent = `Landed a ${m.kind}! +${m.value} coins`;
            later(1200, () => { delete status.dataset.flash; });
            break;
          default:
        }
      },
      unmount() {
        unmounted = true;
        cancelAnimationFrame(raf);
        canvas.removeEventListener('mousedown', onDown);
        canvas.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        for (const t of timers) clearTimeout(t);
        timers.clear();
      },
    };
  },
});
