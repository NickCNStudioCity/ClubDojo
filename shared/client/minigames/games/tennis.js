// Tennis (client). Keyboard first. Draws the court from the server's ball and player positions and sends inputs.
// Move: arrows or WASD. Space (or Enter) is the swing: tap to volley, hold and release for a power shot.
// Release as the ball lands: early sends it left, late sends it right. While the ball is coming to you,
// your reach radius is drawn. Server rules: server/src/minigames/games/tennis.js
ClubDojoMinigames.register({
  id: 'tennis',

  mount(ctx) {
    const { h, el, avatar } = ctx;
    const W = 20, H = 30, S = 16; // court units and pixels per unit
    const NET = H / 2;
    const BOT_ID = '__bot';
    const SWING_KEYS = ['Space', 'Enter'];
    const keys = new Set();
    let dirX = 0, dirY = 0;
    let state = null;
    let stateAt = 0;       // local time (ms) the last state arrived
    let tune = { reach: 2.6, early: 350, late: 250, spread: 4.5, tapMs: 200, chargeMs: 1000 };
    let solo = ctx.players.length === 1;
    let flash = 0;
    let pressAt = null;    // local time (ms) the swing went down; null when not holding
    let raf = 0;
    const names = new Map(ctx.players.map((p) => [p.id, p.name]));
    const loadouts = new Map(ctx.players.map((p) => [p.id, p.loadout]));

    const style = h('style', {}, `
      .tn { display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; padding: 6px; box-sizing: border-box; }
      .tn-hud { display: flex; gap: 18px; font-family: var(--display); font-size: 20px; justify-content: center; flex-wrap: wrap; }
      .tn-status { font-family: var(--display); font-size: 22px; min-height: 30px; text-align: center; }
      .tn-hint { font-family: var(--display); font-size: 16px; min-height: 20px; text-align: center; color: var(--gold, #f5c542); }
      .tn-canvas { height: min(54vh, 540px); max-width: 100%; aspect-ratio: ${W} / ${H}; border-radius: 12px; box-shadow: 0 6px 0 rgba(0,0,0,.35); touch-action: none; }
      .tn-help { font-size: 12px; opacity: .75; text-align: center; max-width: 620px; }
      .tn-btns { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
      .tn-btns .btn.held { outline: 3px solid #f5c542; }
    `);
    const hud = h('div', { class: 'tn-hud' });
    const status = h('div', { class: 'tn-status' }, 'Get ready...');
    const hint = h('div', { class: 'tn-hint' });
    const canvas = h('canvas', { class: 'tn-canvas', width: W * S, height: H * S });
    const c2 = canvas.getContext('2d');
    const actionBtn = h('button', { class: 'btn small', tabindex: '-1', onpointerdown: (e) => { e.preventDefault(); press(); } }, 'Swing (Space)');
    const help = h('div', { class: 'tn-help' });
    el.append(style, h('div', { class: 'tn' }, hud, status, hint, canvas, h('div', { class: 'tn-btns' }, actionBtn), help));

    function send(dx, dy) { ctx.send({ type: 'move', dx, dy }); }
    function press() {
      if (pressAt !== null) return;
      pressAt = performance.now();
      ctx.send({ type: 'press' });
      actionBtn.classList.add('held');
    }
    function release() {
      if (pressAt === null) return;
      pressAt = null;
      ctx.send({ type: 'release' });
      actionBtn.classList.remove('held');
    }

    // Mirrors the server's shot rules so the preview matches what the server will do.
    const chargeFor = (ms) => (ms < tune.tapMs ? 0 : 0.15 + 0.85 * Math.min(1, (ms - tune.tapMs) / tune.chargeMs));
    const shiftFor = (d) => (d < 0 ? -tune.spread * Math.min(1, -d / tune.early) : tune.spread * Math.min(1, d / tune.late));
    const depthFor = (c, fromBottom) => (fromBottom
      ? (NET - 4) - c * ((NET - 4) - 3)
      : (NET + 4) + c * ((H - 3) - (NET + 4)));
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    function applyMode() {
      help.textContent = solo
        ? 'Move: arrows or WASD. Tap Space to volley. Hold Space to charge a power shot, then release. Release as the ball lands: early sends it left, late sends it right. Land it outside the lines and it is out.'
        : 'Move: arrows or WASD. Tap Space to volley. Hold Space to charge a power shot, then release. Release as the ball lands: early sends it left, late sends it right.';
    }
    applyMode();

    function refreshDir() {
      const x = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
      const y = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
      if (x !== dirX || y !== dirY) { dirX = x; dirY = y; send(x, y); }
    }
    const onKeyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (SWING_KEYS.includes(e.code)) { if (!e.repeat) press(); return; }
      if (!keys.has(e.code)) { keys.add(e.code); refreshDir(); }
    };
    const onKeyUp = (e) => {
      if (SWING_KEYS.includes(e.code)) { e.preventDefault(); release(); return; }
      if (keys.delete(e.code)) refreshDir();
    };
    const onBlur = () => { keys.clear(); refreshDir(); release(); };
    const onPointerUp = () => release();
    const onCanvasDown = (e) => { e.preventDefault(); press(); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerdown', onCanvasDown);

    // The incoming ball, if it is coming to this player.
    const incoming = () => (state && state.flight && state.flight.from !== ctx.youId ? state.flight : null);
    const meState = () => (state ? state.players.find((p) => p.id === ctx.youId) : null);
    // Local ms until the ball lands (negative once it has landed).
    const etaNow = (f) => f.eta - (performance.now() - stateAt);

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
      c2.fillStyle = 'rgba(20,20,20,.35)'; c2.fillRect(0, hgt / 2 - 3, w, 6);
      c2.fillStyle = '#ffffff'; c2.fillRect(0, hgt / 2 - 1, w, 2);
    }

    function cross(x, y, color, size) {
      c2.strokeStyle = color; c2.lineWidth = 2.5;
      c2.beginPath(); c2.moveTo(x - size, y - size); c2.lineTo(x + size, y + size); c2.stroke();
      c2.beginPath(); c2.moveTo(x + size, y - size); c2.lineTo(x - size, y + size); c2.stroke();
    }

    function drawBot(b) {
      const bx = b.x * S, by = b.y * S + 10;
      c2.fillStyle = 'rgba(0,0,0,.2)'; c2.beginPath(); c2.ellipse(bx + 3, by + 14, 10, 4, 0, 0, Math.PI * 2); c2.fill();
      c2.fillStyle = '#c0392b'; c2.beginPath(); c2.arc(bx, by, 12, 0, Math.PI * 2); c2.fill();
      c2.fillStyle = '#ffffff'; c2.font = 'bold 9px sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillText('BOT', bx, by);
    }

    // Reach radius around this player while the ball is coming to them. Green when the landing spot is in reach.
    function drawReach(me, f) {
      const r = tune.reach * S;
      const inReach = Math.hypot(me.x - f.tx, me.y - f.ty) <= tune.reach;
      c2.save();
      c2.fillStyle = inReach ? 'rgba(124,252,138,.14)' : 'rgba(255,255,255,.08)';
      c2.strokeStyle = inReach ? 'rgba(124,252,138,.95)' : 'rgba(255,255,255,.7)';
      c2.lineWidth = 2; c2.setLineDash([7, 5]);
      c2.beginPath(); c2.arc(me.x * S, me.y * S, r, 0, Math.PI * 2); c2.fill(); c2.stroke();
      c2.restore();
    }

    // Where the ball is going: a dotted line from the ball to its landing spot, a marker there, and a
    // ring that closes in on the landing. The ring turns green inside the swing window.
    function drawLanding(f, ball) {
      const eta = etaNow(f);
      const inWindow = eta <= tune.early && eta >= -tune.late;
      c2.save();
      c2.setLineDash([3, 6]); c2.strokeStyle = 'rgba(255,255,255,.85)'; c2.lineWidth = 2;
      c2.beginPath(); c2.moveTo(ball.x * S, ball.y * S); c2.lineTo(f.tx * S, f.ty * S); c2.stroke();
      c2.restore();
      if (f.out) cross(f.tx * S, f.ty * S, 'rgba(255,90,90,.95)', 6);
      else {
        c2.strokeStyle = 'rgba(255,255,255,.95)'; c2.lineWidth = 2;
        c2.beginPath(); c2.arc(f.tx * S, f.ty * S, 4, 0, Math.PI * 2); c2.stroke();
      }
      const ring = 7 + Math.min(50, Math.max(0, -eta) * 0.05);
      c2.strokeStyle = inWindow ? 'rgba(124,252,138,.95)' : 'rgba(255,255,255,.6)';
      c2.lineWidth = inWindow ? 3 : 1.5;
      c2.beginPath(); c2.arc(f.tx * S, f.ty * S, ring, 0, Math.PI * 2); c2.stroke();
    }

    // The shot you would hit if you released now: a gold line and cross, from your player to the landing spot.
    function drawPreview(me, c, incomingFlight) {
      const shift = incomingFlight ? shiftFor(-etaNow(incomingFlight)) : 0;
      const tx = clamp(me.x + shift, 0, W);
      const ty = depthFor(c, me.y > NET);
      c2.save();
      c2.setLineDash([6, 5]); c2.strokeStyle = 'rgba(245,197,66,.95)'; c2.lineWidth = 2;
      c2.beginPath(); c2.moveTo(me.x * S, me.y * S); c2.lineTo(tx * S, ty * S); c2.stroke();
      c2.restore();
      cross(tx * S, ty * S, 'rgba(245,197,66,.95)', 6);
    }

    function drawBall(b, f) {
      let lift = 0;
      if (f) {
        const p = clamp(1 - etaNow(f) / f.dur, 0, 1);
        lift = Math.sin(Math.PI * p) * 14;
      }
      c2.fillStyle = 'rgba(0,0,0,.2)'; c2.beginPath(); c2.ellipse(b.x * S + 3, b.y * S + 4, 6, 3, 0, 0, Math.PI * 2); c2.fill();
      const by = b.y * S - lift;
      c2.fillStyle = '#e7f04a'; c2.beginPath(); c2.arc(b.x * S, by, 6, 0, Math.PI * 2); c2.fill();
      c2.strokeStyle = '#7a8a1a'; c2.lineWidth = 1.5; c2.stroke();
    }

    // Charge meter along the bottom of the court while the swing is held.
    function drawCharge(holdMs, c) {
      const x = 12, y = H * S - 22, w = W * S - 24, hh = 8;
      c2.fillStyle = 'rgba(0,0,0,.35)'; c2.fillRect(x, y, w, hh);
      c2.fillStyle = holdMs < tune.tapMs ? 'rgba(255,255,255,.7)' : '#f5c542';
      c2.fillRect(x, y, w * (holdMs < tune.tapMs ? holdMs / tune.tapMs : c), hh);
      c2.fillStyle = '#ffffff'; c2.font = 'bold 11px sans-serif'; c2.textAlign = 'left'; c2.textBaseline = 'bottom';
      c2.fillText(holdMs < tune.tapMs ? 'Volley' : 'Power', x, y - 3);
    }

    function render(time) {
      raf = requestAnimationFrame(render);
      c2.clearRect(0, 0, canvas.width, canvas.height);
      drawCourt();
      if (!state) return;
      const me = meState();
      const f = state.flight;
      const inc = incoming();
      if (inc && me) drawReach(me, inc);
      if (f) drawLanding(f, state.ball);
      if (pressAt !== null && me) {
        const holdMs = performance.now() - pressAt;
        const c = chargeFor(holdMs);
        drawPreview(me, c, inc);
        drawCharge(holdMs, c);
      }
      for (const p of state.players) {
        if (p.id === BOT_ID) { drawBot(p); continue; }
        if (!p.a && !solo) continue;
        avatar.draw(c2, loadouts.get(p.id), { x: p.x * S, y: p.y * S + 10, size: 30, facing: p.y > NET ? 1 : -1, walking: false, time: time / 1000 });
      }
      drawBall(state.ball, f);
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

    // A short description of the shot the server just hit: kind and direction.
    function describe(data) {
      const kind = data.c === 0 ? 'Volley' : data.c > 0.6 ? 'Power shot' : 'Drive';
      const dir = data.shift <= -1 ? ', left' : data.shift >= 1 ? ', right' : ', down the middle';
      return kind + dir;
    }

    raf = requestAnimationFrame(render);

    return {
      onMessage(data) {
        if (data.type === 'begin') {
          solo = !!data.solo;
          if (data.tune) tune = data.tune;
          applyMode();
          status.textContent = solo ? 'Rally! Hold Space to charge, release to swing' : `Rally! ${Math.round(data.roundMs / 1000)} seconds`;
        } else if (data.type === 'state') {
          state = data;
          stateAt = performance.now();
          if (data.serve === ctx.youId) hint.textContent = 'Your serve: tap Space, or hold for power and release';
          else if (incoming()) hint.textContent = 'Release Space as the ball lands. Early = left, late = right';
          else hint.textContent = '';
        } else if (data.type === 'hit') {
          flash = 3;
          if (data.id === ctx.youId) status.textContent = data.c === undefined ? 'Serve!' : describe(data);
        } else if (data.type === 'point') {
          if (solo) {
            const why = data.why === 'out' ? ' (out)' : data.why === 'reach' ? ' (couldn\'t reach it)' : '';
            status.textContent = `${data.winner === ctx.youId ? 'You win' : 'Bot wins'} the point${why}`;
          } else {
            const who = data.winner === ctx.youId ? 'You win the point!' : `${names.get(data.winner)} wins the point`;
            status.textContent = data.why === 'out' ? `${who} (out)` : data.why === 'reach' ? `${who} (couldn't reach it)` : who;
          }
        }
        drawHud();
      },
      onResults() {},
      unmount() {
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        window.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointerdown', onCanvasDown);
        release();
        keys.clear();
        if (dirX || dirY) { dirX = 0; dirY = 0; send(0, 0); }
      },
    };
  },
});
