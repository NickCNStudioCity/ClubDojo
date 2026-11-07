// Tennis (client). Draws the court from the server's ball and player positions and sends
// move and swing inputs. Server rules: server/src/minigames/games/tennis.js
ClubDojoMinigames.register({
  id: 'tennis',

  mount(ctx) {
    const { h, el, avatar } = ctx;
    const W = 20, H = 30, S = 16; // court units and pixels per unit
    const keys = new Set();
    let dirX = 0, dirY = 0;
    let state = null;
    let solo = ctx.players.length === 1;
    let flash = 0;
    let raf = 0;
    const names = new Map(ctx.players.map((p) => [p.id, p.name]));
    const loadouts = new Map(ctx.players.map((p) => [p.id, p.loadout]));

    const style = h('style', {}, `
      .tn { display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; padding: 6px; box-sizing: border-box; }
      .tn-hud { display: flex; gap: 18px; font-family: var(--display); font-size: 20px; justify-content: center; flex-wrap: wrap; }
      .tn-status { font-family: var(--display); font-size: 22px; min-height: 30px; text-align: center; }
      .tn-canvas { height: min(58vh, 560px); max-width: 100%; aspect-ratio: ${W} / ${H}; border-radius: 12px; box-shadow: 0 6px 0 rgba(0,0,0,.35); touch-action: none; cursor: pointer; }
      .tn-help { font-size: 12px; opacity: .75; text-align: center; }
      .tn-btns { display: flex; gap: 8px; }
    `);
    const hud = h('div', { class: 'tn-hud' });
    const status = h('div', { class: 'tn-status' }, 'Get ready...');
    const canvas = h('canvas', { class: 'tn-canvas', width: W * S, height: H * S });
    const c2 = canvas.getContext('2d');
    const swingBtn = h('button', { class: 'btn small', onclick: () => swing() }, 'Swing (Space)');
    const help = h('div', { class: 'tn-help' }, 'Move: arrow keys or WASD. Swing: Space or Enter, or click the court.');
    el.append(style, h('div', { class: 'tn' }, hud, status, canvas, h('div', { class: 'tn-btns' }, swingBtn), help));

    function send(dx, dy) { ctx.send({ type: 'move', dx, dy }); }
    function swing() { ctx.send({ type: 'swing' }); }

    function refreshDir() {
      const x = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
      const y = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
      if (x !== dirX || y !== dirY) { dirX = x; dirY = y; send(x, y); }
    }
    const SWING_KEYS = ['Space', 'Enter'];
    const onKeyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (SWING_KEYS.includes(e.code)) { if (!e.repeat) swing(); return; }
      if (!keys.has(e.code)) { keys.add(e.code); refreshDir(); }
    };
    const onKeyUp = (e) => { if (keys.delete(e.code)) refreshDir(); };
    const onCanvasDown = () => swing();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointerdown', onCanvasDown);

    function drawCourt() {
      const w = W * S, hgt = H * S;
      c2.fillStyle = '#3b7fc4'; c2.fillRect(0, 0, w, hgt);
      c2.fillStyle = '#2f6fb3'; c2.fillRect(S, S, w - 2 * S, hgt - 2 * S);
      c2.strokeStyle = 'rgba(255,255,255,.95)'; c2.lineWidth = 2;
      c2.strokeRect(S * 1.5, S * 1.5, w - S * 3, hgt - S * 3);      // doubles
      c2.strokeRect(S * 2.5, S * 1.5, w - S * 5, hgt - S * 3);      // singles
      c2.beginPath(); c2.moveTo(S * 2.5, S * 6); c2.lineTo(w - S * 2.5, S * 6); c2.stroke();
      c2.beginPath(); c2.moveTo(S * 2.5, hgt - S * 6); c2.lineTo(w - S * 2.5, hgt - S * 6); c2.stroke();
      c2.beginPath(); c2.moveTo(w / 2, S * 6); c2.lineTo(w / 2, hgt - S * 6); c2.stroke();
      // Net across the middle.
      c2.fillStyle = 'rgba(20,20,20,.35)'; c2.fillRect(0, hgt / 2 - 3, w, 6);
      c2.fillStyle = '#ffffff'; c2.fillRect(0, hgt / 2 - 1, w, 2);
    }

    function render(time) {
      raf = requestAnimationFrame(render);
      c2.clearRect(0, 0, canvas.width, canvas.height);
      drawCourt();
      if (!state) return;
      for (const p of state.players) {
        if (!p.a && !solo) continue;
        const px = p.x * S, py = p.y * S;
        avatar.draw(c2, loadouts.get(p.id), { x: px, y: py + 10, size: 30, facing: p.y > H / 2 ? 1 : -1, walking: false, time: time / 1000 });
      }
      const b = state.ball;
      if (b.live) {
        c2.fillStyle = 'rgba(0,0,0,.2)'; c2.beginPath(); c2.ellipse(b.x * S + 3, b.y * S + 4, 6, 3, 0, 0, Math.PI * 2); c2.fill();
        c2.fillStyle = '#e7f04a'; c2.beginPath(); c2.arc(b.x * S, b.y * S, 6, 0, Math.PI * 2); c2.fill();
        c2.strokeStyle = '#7a8a1a'; c2.lineWidth = 1.5; c2.stroke();
      }
      if (flash > 0) {
        flash--;
        c2.fillStyle = `rgba(255,255,255,${flash / 20})`; c2.fillRect(0, 0, canvas.width, canvas.height);
      }
    }

    function drawHud() {
      hud.replaceChildren();
      for (const p of ctx.players) {
        const sc = state ? (state.players.find((x) => x.id === p.id) || {}).s || 0 : 0;
        const label = solo ? '' : `${p.id === ctx.youId ? 'You' : p.name}: `;
        hud.append(h('span', {}, `${label}${sc}${solo ? ' return' + (sc === 1 ? '' : 's') : ''}`));
      }
    }

    raf = requestAnimationFrame(render);

    return {
      onMessage(data) {
        if (data.type === 'begin') {
          solo = !!data.solo;
          status.textContent = `Rally! ${Math.round(data.roundMs / 1000)} seconds`;
        } else if (data.type === 'state') {
          state = data;
          drawHud();
        } else if (data.type === 'hit') {
          flash = 3;
          if (data.id === ctx.youId) status.textContent = 'Nice shot!';
        } else if (data.type === 'point') {
          const who = data.winner ? (data.winner === ctx.youId ? 'You win the point!' : `${names.get(data.winner)} wins the point`) : 'Miss!';
          status.textContent = who;
        }
        drawHud();
      },
      onResults() {},
      unmount() {
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        canvas.removeEventListener('pointerdown', onCanvasDown);
        keys.clear();
        if (dirX || dirY) { dirX = 0; dirY = 0; send(0, 0); }
      },
    };
  },
});
