// Basketball (client). One lane per player, drawn from the server's positions and shot results.
// The shot meter runs on the client clock, lined up with the server's start time. Server rules:
// server/src/minigames/games/basketball.js
ClubDojoMinigames.register({
  id: 'basketball',

  mount(ctx) {
    const { h, el, avatar } = ctx;
    const LANE_W = 800, LANE_H = 96, PERIOD = 1.1, GREEN = 0.1;
    const HOOP_X = 0.9;
    const keys = new Set();
    let dir = 0;
    let state = null;
    let raf = 0;
    const meters = new Map();   // id -> performance.now() time the meter started
    const anims = new Map();    // id -> { from, made, t0, text }
    const lanes = ctx.players.map((p, i) => ({ id: p.id, name: p.name, loadout: p.loadout, index: i }));
    const laneOf = (id) => lanes.find((l) => l.id === id);

    const style = h('style', {}, `
      .bb { display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; padding: 6px; box-sizing: border-box; }
      .bb-hud { display: flex; gap: 14px; font-family: var(--display); font-size: 18px; justify-content: center; flex-wrap: wrap; }
      .bb-status { font-family: var(--display); font-size: 22px; min-height: 30px; text-align: center; }
      .bb-canvas { width: min(900px, 100%); height: auto; border-radius: 12px; box-shadow: 0 6px 0 rgba(0,0,0,.35); touch-action: none; }
      .bb-btns { display: flex; gap: 8px; }
      .bb-help { font-size: 12px; opacity: .75; text-align: center; }
    `);
    const hud = h('div', { class: 'bb-hud' });
    const status = h('div', { class: 'bb-status' }, 'Get ready...');
    const canvas = h('canvas', { class: 'bb-canvas', width: LANE_W, height: LANE_H * Math.max(1, lanes.length) });
    const c2 = canvas.getContext('2d');
    const btnLeft = h('button', { class: 'btn small', onclick: () => ctx.send({ type: 'move', dir: -1 }) }, 'Left');
    const btnShoot = h('button', { class: 'btn small', onclick: () => shoot() }, 'Shoot');
    const btnRight = h('button', { class: 'btn small', onclick: () => ctx.send({ type: 'move', dir: 1 }) }, 'Right');
    const help = h('div', { class: 'bb-help' }, 'Move: left and right arrows or A and D. Shoot: Space, or click your lane. Shots from far away are worth three.');
    el.append(style, h('div', { class: 'bb' }, hud, status, canvas, h('div', { class: 'bb-btns' }, btnLeft, btnShoot, btnRight), help));

    function shoot() { ctx.send({ type: 'shoot' }); }

    function setDir(d) { if (d !== dir) { dir = d; ctx.send({ type: 'move', dir: d }); } }
    function refreshDir() {
      setDir((keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0));
    }
    const onKeyDown = (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'Space' || e.code === 'Enter') { if (!e.repeat) shoot(); return; }
      if (!keys.has(e.code)) { keys.add(e.code); refreshDir(); }
    };
    const onKeyUp = (e) => { if (keys.delete(e.code)) refreshDir(); };
    const onCanvasDown = () => shoot();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointerdown', onCanvasDown);

    // Meter position 0..1 from its client start time (same triangle wave as the server).
    function meterPos(start, now) {
      const u = (((now - start) / 1000) / PERIOD) % 1;
      const t = u < 0 ? u + 1 : u;
      return t < 0.5 ? t * 2 : 2 - t * 2;
    }

    function drawFloor(y) {
      c2.fillStyle = '#c98b52'; c2.fillRect(0, y, LANE_W, LANE_H);
      c2.strokeStyle = 'rgba(255,255,255,.8)'; c2.lineWidth = 2;
      c2.strokeRect(10, y + 8, LANE_W - 20, LANE_H - 30);
      // Three-point arc in front of the hoop.
      c2.beginPath(); c2.arc(LANE_W * HOOP_X, y + LANE_H - 22, LANE_W * 0.28, Math.PI * 0.75, Math.PI * 1.25); c2.stroke();
    }

    function drawHoop(y) {
      const hx = LANE_W * HOOP_X, hy = y + 26;
      c2.fillStyle = '#ffffff'; c2.fillRect(hx + 18, hy - 22, 6, 46);
      c2.strokeStyle = '#ff5a1f'; c2.lineWidth = 3;
      c2.beginPath(); c2.ellipse(hx, hy, 18, 5, 0, 0, Math.PI * 2); c2.stroke();
      c2.strokeStyle = 'rgba(255,255,255,.85)'; c2.lineWidth = 1;
      for (let i = -2; i <= 2; i++) { c2.beginPath(); c2.moveTo(hx + i * 4, hy); c2.lineTo(hx + i * 2.2, hy + 14); c2.stroke(); }
    }

    function drawMeter(y, start, mine) {
      const mx = 40, mw = LANE_W - 80, my = y + LANE_H - 12;
      c2.fillStyle = 'rgba(0,0,0,.35)'; c2.fillRect(mx, my, mw, 7);
      c2.fillStyle = mine ? '#3fbf7f' : 'rgba(63,191,127,.45)';
      c2.fillRect(mx + mw * (0.5 - GREEN), my, mw * GREEN * 2, 7);
      const pos = start === null ? 0.5 : meterPos(start, performance.now());
      c2.fillStyle = '#fff'; c2.fillRect(mx + mw * pos - 2, my - 4, 4, 15);
    }

    function render(time) {
      raf = requestAnimationFrame(render);
      c2.clearRect(0, 0, LANE_W, canvas.height);
      const now = performance.now();
      lanes.forEach((lane) => {
        const y = lane.index * LANE_H;
        const mine = lane.id === ctx.youId;
        drawFloor(y);
        drawHoop(y);
        if (mine) { c2.fillStyle = 'rgba(255,255,255,.15)'; c2.fillRect(0, y, LANE_W, LANE_H); }
        const s = state ? state.lanes.find((l) => l.id === lane.id) : null;
        const sx = (s ? s.x : 0.5) * LANE_W * 0.9 + LANE_W * 0.05;
        avatar.draw(c2, lane.loadout, { x: sx, y: y + LANE_H - 8, size: 40, facing: 1, walking: !!(mine && dir), time: time / 1000 });
        c2.fillStyle = '#fff'; c2.font = '14px sans-serif'; c2.textAlign = 'left';
        c2.fillText(mine ? `${lane.name} (you)` : lane.name, 10, y + 16);
        drawMeter(y, meters.has(lane.id) ? meters.get(lane.id) : null, mine);
        const a = anims.get(lane.id);
        if (a) {
          const age = now - a.t0;
          const t = Math.min(1, age / 700);
          const hx = LANE_W * HOOP_X, hy = y + 26;
          const bx = a.from + (hx - a.from) * t, by = y + LANE_H - 30 - Math.sin(t * Math.PI) * 70;
          c2.fillStyle = '#ff8a3d'; c2.beginPath(); c2.arc(bx, by, 7, 0, Math.PI * 2); c2.fill();
          if (t >= 1 && age < 1800) {
            c2.fillStyle = a.made ? '#7dffb0' : '#ff9a9a'; c2.font = 'bold 26px sans-serif'; c2.textAlign = 'center';
            c2.fillText(a.text, hx - 20, hy - 30);
          }
          if (age > 1800) anims.delete(lane.id);
        }
      });
    }

    function drawHud() {
      hud.replaceChildren();
      for (const p of ctx.players) {
        const sc = state ? (state.lanes.find((l) => l.id === p.id) || {}).s || 0 : 0;
        hud.append(h('span', {}, `${p.id === ctx.youId ? 'You' : p.name}: ${sc}`));
      }
    }

    raf = requestAnimationFrame(render);

    return {
      onMessage(data) {
        if (data.type === 'begin') {
          status.textContent = `Shoot! ${Math.round(data.roundMs / 1000)} seconds`;
          for (const l of data.lanes) meters.set(l.id, performance.now() + (l.start - data.t));
        } else if (data.type === 'state') {
          state = data;
          drawHud();
        } else if (data.type === 'shot') {
          const lane = laneOf(data.id);
          if (!lane) return;
          meters.set(data.id, performance.now() + (data.start - data.t));
          const from = data.x * LANE_W * 0.9 + LANE_W * 0.05;
          anims.set(data.id, { from, made: data.made, t0: performance.now(), text: data.made ? `+${data.points}` : 'Miss' });
          if (state) {
            const s = state.lanes.find((l) => l.id === data.id);
            if (s) s.s = data.score;
          }
          if (data.id === ctx.youId) {
            status.textContent = data.made
              ? `${data.green ? 'Perfect timing!' : 'Good shot'} +${data.points}`
              : (data.green ? 'Missed, even with good timing' : 'Missed. Aim for the green zone');
          }
          drawHud();
        }
      },
      onResults() {},
      unmount() {
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        canvas.removeEventListener('pointerdown', onCanvasDown);
        keys.clear();
        if (dir) { dir = 0; ctx.send({ type: 'move', dir: 0 }); }
      },
    };
  },
});
