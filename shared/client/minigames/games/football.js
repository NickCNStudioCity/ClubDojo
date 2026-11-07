// Football (client). Field goals: set the distance, start the aim meter, then lock it in the middle
// of the uprights. Draws your meter and kick from the server's messages. Server rules:
// server/src/minigames/games/football.js
ClubDojoMinigames.register({
  id: 'football',

  mount(ctx) {
    const { h, el } = ctx;
    const CW = 480, CH = 340;
    const POST_L = 190, POST_R = 290, BAR_Y = 70; // uprights and crossbar
    const PX_PER_YD = 10;                         // how far the ball drifts per yard of error
    const kickerX = CW / 2, kickerY = 310;
    let dist = 35;
    let period = 1.4, sweep = 12;
    let attempts = 5;
    let taken = 0;
    let meter = null;        // { start: performance.now(), period } while the aim meter runs
    let anim = null;         // { t0, error, made, points, dist }
    let raf = 0;
    const scores = new Map(ctx.players.map((p) => [p.id, 0]));
    const counts = new Map(ctx.players.map((p) => [p.id, 0]));

    const style = h('style', {}, `
      .fb { display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; padding: 6px; box-sizing: border-box; }
      .fb-hud { display: flex; gap: 14px; font-family: var(--display); font-size: 18px; justify-content: center; flex-wrap: wrap; }
      .fb-status { font-family: var(--display); font-size: 22px; min-height: 30px; text-align: center; }
      .fb-canvas { width: min(560px, 100%); height: auto; aspect-ratio: ${CW} / ${CH}; border-radius: 12px; box-shadow: 0 6px 0 rgba(0,0,0,.35); touch-action: none; }
      .fb-btns { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
      .fb-help { font-size: 12px; opacity: .75; text-align: center; }
    `);
    const hud = h('div', { class: 'fb-hud' });
    const status = h('div', { class: 'fb-status' }, 'Set your distance, then kick.');
    const canvas = h('canvas', { class: 'fb-canvas', width: CW, height: CH });
    const c2 = canvas.getContext('2d');
    const distLabel = h('span', { style: { fontFamily: 'var(--display)', fontSize: '20px' } }, `${dist} yards`);
    const btnLess = h('button', { class: 'btn small', onclick: () => setDist(-1) }, 'Shorter');
    const btnMore = h('button', { class: 'btn small', onclick: () => setDist(1) }, 'Longer');
    const btnKick = h('button', { class: 'btn', onclick: () => press() }, 'Kick (Space)');
    const help = h('div', { class: 'fb-help' }, 'Distance: up and down arrows, or W and S. Press Space to start the meter, then Space again to lock it near the middle. Five kicks each.');
    el.append(style, h('div', { class: 'fb' }, hud, status, canvas, distLabel, h('div', { class: 'fb-btns' }, btnLess, btnMore, btnKick), help));

    function setDist(step) {
      if (meter) return;
      ctx.send({ type: 'dist', step });
    }
    function press() {
      if (taken >= attempts) return;
      ctx.send({ type: meter ? 'lock' : 'kick' });
    }

    const onKeyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'ArrowUp' || e.code === 'KeyW') { if (!e.repeat) setDist(1); }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { if (!e.repeat) setDist(-1); }
      else if (e.code === 'Space' || e.code === 'Enter') { if (!e.repeat) press(); }
    };
    document.addEventListener('keydown', onKeyDown);

    // Triangle wave 0..1 from the meter's client start time.
    function meterPos(now) {
      const u = (((now - meter.start) / 1000) / meter.period) % 1;
      const t = u < 0 ? u + 1 : u;
      return t < 0.5 ? t * 2 : 2 - t * 2;
    }

    function drawField() {
      c2.fillStyle = '#4f9b3f'; c2.fillRect(0, 0, CW, CH);
      for (let i = 0; i < 8; i++) { c2.fillStyle = i % 2 ? '#56a646' : '#4f9b3f'; c2.fillRect(0, 100 + i * 30, CW, 30); }
      c2.strokeStyle = 'rgba(255,255,255,.8)'; c2.lineWidth = 2;
      c2.beginPath(); c2.moveTo(40, 0); c2.lineTo(40, CH); c2.stroke();
      c2.beginPath(); c2.moveTo(CW - 40, 0); c2.lineTo(CW - 40, CH); c2.stroke();
      // Goal posts: two uprights and a crossbar.
      c2.strokeStyle = '#f5d33a'; c2.lineWidth = 6;
      c2.beginPath(); c2.moveTo(POST_L, 250); c2.lineTo(POST_L, 10); c2.stroke();
      c2.beginPath(); c2.moveTo(POST_R, 250); c2.lineTo(POST_R, 10); c2.stroke();
      c2.beginPath(); c2.moveTo(POST_L - 2, BAR_Y); c2.lineTo(POST_R + 2, BAR_Y); c2.stroke();
      // Target line for the middle of the uprights.
      c2.strokeStyle = 'rgba(255,255,255,.35)'; c2.lineWidth = 1; c2.setLineDash([4, 6]);
      c2.beginPath(); c2.moveTo((POST_L + POST_R) / 2, BAR_Y); c2.lineTo((POST_L + POST_R) / 2, kickerY); c2.stroke();
      c2.setLineDash([]);
    }

    function drawMeter(now) {
      const mx = 40, mw = CW - 80, my = CH - 26;
      c2.fillStyle = 'rgba(0,0,0,.4)'; c2.fillRect(mx, my, mw, 12);
      // Green zone: the window the kick must land in at this distance.
      const half = Math.max(1.2, 4 - (dist - 20) * 0.05);
      const gw = (half / sweep) * (mw / 2);
      c2.fillStyle = 'rgba(63,191,127,.7)'; c2.fillRect(mx + mw / 2 - gw, my, gw * 2, 12);
      if (meter) {
        const pos = meterPos(now);
        c2.fillStyle = '#fff'; c2.fillRect(mx + mw * pos - 3, my - 6, 6, 24);
      }
    }

    function draw(now) {
      c2.clearRect(0, 0, CW, CH);
      drawField();
      // Kicker (a simple figure) and the ball on its tee.
      c2.fillStyle = '#222'; c2.fillRect(kickerX - 12, kickerY - 50, 24, 50);
      let bx = kickerX, by = kickerY - 10, size = 8;
      if (anim) {
        const t = Math.min(1, (now - anim.t0) / 700);
        const endX = (POST_L + POST_R) / 2 + anim.error * PX_PER_YD;
        const endY = anim.made ? BAR_Y - 22 : 40;
        bx = kickerX + (endX - kickerX) * t;
        by = (kickerY - 10) + (endY - (kickerY - 10)) * t - Math.sin(t * Math.PI) * 120;
        if (t >= 1 && now - anim.t0 < 1800) {
          c2.font = 'bold 26px sans-serif'; c2.textAlign = 'center';
          c2.fillStyle = anim.made ? '#7dffb0' : '#ff9a9a';
          c2.fillText(anim.made ? `Good! +${anim.points}` : 'No good', CW / 2, 40);
        }
        if (now - anim.t0 > 1800) anim = null;
      }
      c2.fillStyle = '#7a4a2a'; c2.beginPath(); c2.ellipse(bx, by, size * 1.4, size, -0.4, 0, Math.PI * 2); c2.fill();
      c2.strokeStyle = '#fff'; c2.lineWidth = 1; c2.beginPath(); c2.moveTo(bx - 4, by); c2.lineTo(bx + 4, by); c2.stroke();
      drawMeter(now);
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      draw(now);
    }
    raf = requestAnimationFrame(loop);

    function drawHud() {
      hud.replaceChildren();
      for (const p of ctx.players) {
        const k = counts.get(p.id) || 0;
        hud.append(h('span', {}, `${p.id === ctx.youId ? 'You' : p.name}: ${scores.get(p.id) || 0} (${k}/${attempts})`));
      }
    }
    drawHud();

    return {
      onMessage(data) {
        if (data.type === 'begin') {
          attempts = data.attempts;
          period = data.period;
          sweep = data.sweep;
          status.textContent = `Field goals! ${Math.round(data.roundMs / 1000)} seconds`;
        } else if (data.type === 'dist') {
          dist = data.dist;
          distLabel.textContent = `${dist} yards`;
        } else if (data.type === 'meter') {
          // The server's start time, shifted onto this client's clock.
          meter = { start: performance.now() + (data.start - data.t), period: data.period };
          status.textContent = 'Lock it in the middle!';
        } else if (data.type === 'attempt') {
          scores.set(data.id, data.score);
          counts.set(data.id, data.n);
          if (data.id === ctx.youId) {
            meter = null;
            taken = data.n;
            anim = { t0: performance.now(), error: data.error, made: data.made, points: data.points, dist: data.dist };
            status.textContent = data.made ? `Through the uprights! +${data.points}` : 'Wide of the posts.';
          }
          drawHud();
        }
      },
      onResults() {},
      unmount() {
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKeyDown);
      },
    };
  },
});
