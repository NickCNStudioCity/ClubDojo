// Tennis (client). Draws the court from the server's ball and player positions and sends inputs.
// Solo (vs a bot): call your shot (Left / Centre / Right, or keys 1-3), then click the bot's half
// where the ball should land. Space or a click serves. Duel: move, then swing with Space or a click.
// Server rules: server/src/minigames/games/tennis.js
ClubDojoMinigames.register({
  id: 'tennis',

  mount(ctx) {
    const { h, el, avatar } = ctx;
    const W = 20, H = 30, S = 16; // court units and pixels per unit
    const BOT_ID = '__bot';
    const ZONES = { L: [2.5, 7.5], C: [7.5, 12.5], R: [12.5, 17.5] };
    const CALL_KEYS = { Digit1: 'L', Digit2: 'C', Digit3: 'R' };
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
      .tn-hint { font-family: var(--display); font-size: 16px; min-height: 20px; text-align: center; color: var(--gold, #f5c542); }
      .tn-canvas { height: min(54vh, 540px); max-width: 100%; aspect-ratio: ${W} / ${H}; border-radius: 12px; box-shadow: 0 6px 0 rgba(0,0,0,.35); touch-action: none; cursor: pointer; }
      .tn-canvas.solo { cursor: crosshair; }
      .tn-help { font-size: 12px; opacity: .75; text-align: center; }
      .tn-btns { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
      .tn-btns .btn.on { outline: 3px solid #fff; }
    `);
    const hud = h('div', { class: 'tn-hud' });
    const status = h('div', { class: 'tn-status' }, 'Get ready...');
    const hint = h('div', { class: 'tn-hint' });
    const canvas = h('canvas', { class: 'tn-canvas', width: W * S, height: H * S });
    const c2 = canvas.getContext('2d');
    const callBtns = {
      L: h('button', { class: 'btn small', onclick: () => call('L') }, 'Left (1)'),
      C: h('button', { class: 'btn small', onclick: () => call('C') }, 'Centre (2)'),
      R: h('button', { class: 'btn small', onclick: () => call('R') }, 'Right (3)'),
    };
    const callRow = h('div', { class: 'tn-btns' }, callBtns.L, callBtns.C, callBtns.R);
    const actionBtn = h('button', { class: 'btn small', onclick: () => action() }, 'Swing (Space)');
    const help = h('div', { class: 'tn-help' });
    el.append(style, h('div', { class: 'tn' }, hud, status, hint, canvas, callRow, h('div', { class: 'tn-btns' }, actionBtn), help));

    function send(dx, dy) { ctx.send({ type: 'move', dx, dy }); }
    function call(zone) { if (solo) ctx.send({ type: 'call', zone }); }
    function action() { ctx.send({ type: solo ? 'serve' : 'swing' }); }

    function applyMode() {
      canvas.classList.toggle('solo', solo);
      callRow.style.display = solo ? '' : 'none';
      actionBtn.textContent = solo ? 'Serve (Space)' : 'Swing (Space)';
      help.textContent = solo
        ? 'Move: arrows or WASD. Call your shot with 1 / 2 / 3 (or the buttons), then click the bot\'s half where it should land. Land it outside your call or outside the lines and it is out.'
        : 'Move: arrow keys or WASD. Swing: Space or Enter, or click the court.';
    }
    applyMode();

    function refreshDir() {
      const x = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
      const y = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
      if (x !== dirX || y !== dirY) { dirX = x; dirY = y; send(x, y); }
    }
    const SWING_KEYS = ['Space', 'Enter'];
    const onKeyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (solo && CALL_KEYS[e.code]) { if (!e.repeat) call(CALL_KEYS[e.code]); return; }
      if (SWING_KEYS.includes(e.code)) { if (!e.repeat) action(); return; }
      if (!keys.has(e.code)) { keys.add(e.code); refreshDir(); }
    };
    const onKeyUp = (e) => { if (keys.delete(e.code)) refreshDir(); };
    const onCanvasDown = (e) => {
      if (!solo) { action(); return; }
      // Solo: a click on the bot's half sets where the next shot lands. Clicks on your own half do nothing.
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * W;
      const y = (e.clientY - r.top) / r.height * H;
      if (y < H / 2) ctx.send({ type: 'aim', x, y });
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointerdown', onCanvasDown);

    function drawCourt() {
      const w = W * S, hgt = H * S;
      c2.fillStyle = '#3b7fc4'; c2.fillRect(0, 0, w, hgt);
      c2.fillStyle = '#2f6fb3'; c2.fillRect(S, S, w - 2 * S, hgt - 2 * S);
      // The called third of the bot's court.
      const call = solo && state && state.tgt ? state.tgt.call : null;
      if (call) {
        const [lo, hi] = ZONES[call];
        c2.fillStyle = 'rgba(255,255,255,.12)';
        c2.fillRect(lo * S, S * 1.5, (hi - lo) * S, hgt / 2 - S * 1.5);
      }
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

    function drawBot(b, time) {
      const bx = b.x * S, by = b.y * S + 10;
      c2.fillStyle = 'rgba(0,0,0,.2)'; c2.beginPath(); c2.ellipse(bx + 3, by + 14, 10, 4, 0, 0, Math.PI * 2); c2.fill();
      c2.fillStyle = '#c0392b'; c2.beginPath(); c2.arc(bx, by, 12, 0, Math.PI * 2); c2.fill();
      c2.fillStyle = '#ffffff'; c2.font = 'bold 9px sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillText('BOT', bx, by);
    }

    function render(time) {
      raf = requestAnimationFrame(render);
      c2.clearRect(0, 0, canvas.width, canvas.height);
      drawCourt();
      if (!state) return;
      // The landing marker for the next solo shot.
      if (solo && state.tgt) {
        const t = state.tgt;
        c2.strokeStyle = t.out ? 'rgba(255,90,90,.95)' : 'rgba(255,255,255,.95)';
        c2.lineWidth = 2;
        c2.beginPath(); c2.arc(t.x * S, t.y * S, 7, 0, Math.PI * 2); c2.stroke();
        c2.beginPath(); c2.moveTo(t.x * S - 4, t.y * S); c2.lineTo(t.x * S + 4, t.y * S); c2.stroke();
        c2.beginPath(); c2.moveTo(t.x * S, t.y * S - 4); c2.lineTo(t.x * S, t.y * S + 4); c2.stroke();
      }
      for (const p of state.players) {
        if (p.id === BOT_ID) { drawBot(p, time); continue; }
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
      const rows = solo
        ? [[ctx.youId, 'You'], [BOT_ID, 'Bot']]
        : ctx.players.map((p) => [p.id, p.id === ctx.youId ? 'You' : p.name]);
      for (const [id, label] of rows) {
        const sc = state ? ((state.players.find((x) => x.id === id) || {}).s || 0) : 0;
        hud.append(h('span', {}, `${label}: ${sc}`));
      }
    }

    raf = requestAnimationFrame(render);

    return {
      onMessage(data) {
        if (data.type === 'begin') {
          solo = !!data.solo;
          applyMode();
          status.textContent = solo ? 'Rally! Call your shot and click the bot\'s court' : `Rally! ${Math.round(data.roundMs / 1000)} seconds`;
        } else if (data.type === 'state') {
          state = data;
          if (solo) {
            hint.textContent = data.serve ? 'Your serve: click the bot\'s court, or press Space' : '';
            for (const k of Object.keys(callBtns)) callBtns[k].classList.toggle('on', !!data.tgt && data.tgt.call === k);
          }
          drawHud();
        } else if (data.type === 'hit') {
          flash = 3;
          if (data.id === ctx.youId) status.textContent = 'Nice shot!';
        } else if (data.type === 'point') {
          if (solo) {
            const why = data.why === 'out' ? ' (out)' : data.why === 'reach' ? ' (couldn\'t reach it)' : '';
            status.textContent = `${data.winner === ctx.youId ? 'You win' : 'Bot wins'} the point${why}`;
          } else {
            const who = data.winner === ctx.youId ? 'You win the point!' : `${names.get(data.winner)} wins the point`;
            status.textContent = data.why === 'out' ? `${who} (out)` : who;
          }
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
