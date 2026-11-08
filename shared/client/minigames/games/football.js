// Football (client). Field goals, taken in turns. On your turn: set the distance, start the aim meter,
// then lock it. The green zone on the meter already allows for the wind, so aim into it. Everyone
// else watches the kick. Server rules: server/src/minigames/games/football.js
ClubDojoMinigames.register({
  id: 'football',

  mount(ctx) {
    const { h } = ctx;
    const el = ctx.el;
    const CW = 480, CH = 340;
    const POST_L = 190, POST_R = 290, BAR_Y = 70; // uprights and crossbar
    const CENTRE = (POST_L + POST_R) / 2;
    const PX_PER_YD = 10;                         // how far the ball drifts per yard of error
    const kickerX = CW / 2, kickerY = 310;
    const WIND_YD = 1.2;                          // must match the server
    let dist = 35;
    let period = 1.4, sweep = 12, attempts = 5;
    let roster = [];                              // [{ id, name, bot }]
    let turnId = null, turnName = '', turnN = 0, wind = 0;
    let deadline = 0;                             // performance.now() when the turn times out
    let myTurn = false;
    let meter = null;                             // { start, period } while the kicker's meter runs
    let anim = null;                              // { t0, landing, made, points, dist }
    let raf = 0;
    const scores = new Map();
    const counts = new Map();

    const style = h('style', {}, `
      .fb { display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; padding: 6px; box-sizing: border-box; }
      .fb-hud { display: flex; gap: 8px; font-family: var(--display); font-size: 15px; justify-content: center; flex-wrap: wrap; }
      .fb-chip { padding: 4px 10px; border-radius: 999px; background: rgba(0,0,0,.25); }
      .fb-chip.on { background: #f5d33a; color: #222; }
      .fb-status { font-family: var(--display); font-size: 20px; min-height: 28px; text-align: center; }
      .fb-canvas { width: min(560px, 100%); height: auto; aspect-ratio: ${CW} / ${CH}; border-radius: 12px; box-shadow: 0 6px 0 rgba(0,0,0,.35); touch-action: none; }
      .fb-btns { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
      .fb-help { font-size: 12px; opacity: .75; text-align: center; }
      .fb-dist { font-family: var(--display); font-size: 20px; }
    `);
    const hud = h('div', { class: 'fb-hud' });
    const status = h('div', { class: 'fb-status' }, 'Waiting for the first kick...');
    const canvas = h('canvas', { class: 'fb-canvas', width: CW, height: CH });
    const c2 = canvas.getContext('2d');
    const distLabel = h('span', { class: 'fb-dist' }, `${dist} yards`);
    const btnLess = h('button', { class: 'btn small', onclick: () => setDist(-1) }, 'Shorter');
    const btnMore = h('button', { class: 'btn small', onclick: () => setDist(1) }, 'Longer');
    const btnKick = h('button', { class: 'btn', onclick: () => press() }, 'Kick (Space)');
    const help = h('div', { class: 'fb-help' }, 'On your turn: up and down (or W and S) set the distance. Space starts the meter, Space again locks it. Aim in the green zone, which already allows for the wind.');
    el.append(style, h('div', { class: 'fb' }, hud, status, canvas, distLabel, h('div', { class: 'fb-btns' }, btnLess, btnMore, btnKick), help));

    function setButtons() {
      btnLess.disabled = btnMore.disabled = btnKick.disabled = !myTurn;
      btnKick.textContent = meter ? 'Lock it! (Space)' : 'Kick (Space)';
    }
    function setDist(step) {
      if (!myTurn || meter) return;
      ctx.send({ type: 'dist', step });
    }
    function press() {
      if (!myTurn) return;
      ctx.send({ type: meter ? 'lock' : 'kick' });
    }

    const onKeyDown = (e) => {
      if (['ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      if (!myTurn) return;
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
    const halfWidth = (d) => Math.max(1.2, 4 - (d - 20) * 0.05);

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
      c2.strokeStyle = 'rgba(255,255,255,.35)'; c2.lineWidth = 1; c2.setLineDash([4, 6]);
      c2.beginPath(); c2.moveTo(CENTRE, BAR_Y); c2.lineTo(CENTRE, kickerY); c2.stroke();
      c2.setLineDash([]);
    }

    // Wind flag: an arrow in the top corner, longer for stronger wind.
    function drawWind() {
      c2.fillStyle = 'rgba(0,0,0,.35)'; c2.fillRect(CW - 118, 6, 112, 30);
      c2.fillStyle = '#fff'; c2.font = 'bold 13px sans-serif'; c2.textAlign = 'left';
      c2.fillText('Wind', CW - 112, 26);
      const dir = Math.sign(wind);
      const len = Math.abs(wind) * 8;
      const x0 = CW - 40, y0 = 21;
      c2.strokeStyle = wind === 0 ? '#ccc' : '#7dd3ff'; c2.lineWidth = 3;
      c2.beginPath(); c2.moveTo(x0 - dir * len, y0); c2.lineTo(x0 + dir * (len || 0), y0); c2.stroke();
      if (dir !== 0) {
        c2.fillStyle = '#7dd3ff';
        c2.beginPath(); c2.moveTo(x0 + dir * (len + 2), y0); c2.lineTo(x0 + dir * (len - 4), y0 - 4); c2.lineTo(x0 + dir * (len - 4), y0 + 4); c2.fill();
      } else {
        c2.fillStyle = '#ccc'; c2.textAlign = 'center'; c2.font = '12px sans-serif'; c2.fillText('calm', x0, y0 + 4);
      }
    }

    function drawMeter() {
      const mx = 40, mw = CW - 80, my = CH - 26;
      c2.fillStyle = 'rgba(0,0,0,.4)'; c2.fillRect(mx, my, mw, 12);
      // Green zone: where the lock must land, already shifted for the wind.
      const aimCentre = -wind * WIND_YD;
      const gw = (halfWidth(dist) / sweep) * (mw / 2);
      const gx = mx + mw / 2 + (aimCentre / sweep) * (mw / 2);
      c2.fillStyle = 'rgba(63,191,127,.75)'; c2.fillRect(gx - gw, my, gw * 2, 12);
      if (meter) {
        c2.fillStyle = '#fff'; c2.fillRect(mx + mw * meterPos(performance.now()) - 3, my - 6, 6, 24);
      }
    }

    function drawKicker(name) {
      c2.fillStyle = '#222'; c2.fillRect(kickerX - 12, kickerY - 50, 24, 50);
      if (name) {
        c2.font = 'bold 13px sans-serif'; c2.textAlign = 'center'; c2.fillStyle = '#fff';
        c2.fillText(name, kickerX, kickerY + 16);
      }
    }

    function draw(now) {
      c2.clearRect(0, 0, CW, CH);
      drawField();
      drawWind();
      drawKicker(turnId ? turnName : '');
      let bx = kickerX, by = kickerY - 10, size = 8;
      if (anim) {
        const t = Math.min(1, (now - anim.t0) / 700);
        const endX = CENTRE + (anim.landing ?? 0) * PX_PER_YD;
        const endY = anim.made ? BAR_Y - 22 : 40;
        bx = kickerX + (endX - kickerX) * t;
        by = (kickerY - 10) + (endY - (kickerY - 10)) * t - Math.sin(t * Math.PI) * 120;
        if (t >= 1 && now - anim.t0 < 2000) {
          c2.font = 'bold 26px sans-serif'; c2.textAlign = 'center';
          c2.fillStyle = anim.made ? '#7dffb0' : '#ff9a9a';
          c2.fillText(anim.made ? `Good! +${anim.points}` : (anim.timedOut ? 'Out of time' : 'No good'), CW / 2, 40);
        }
        if (now - anim.t0 > 2000) anim = null;
      }
      c2.fillStyle = '#7a4a2a'; c2.beginPath(); c2.ellipse(bx, by, size * 1.4, size, -0.4, 0, Math.PI * 2); c2.fill();
      c2.strokeStyle = '#fff'; c2.lineWidth = 1; c2.beginPath(); c2.moveTo(bx - 4, by); c2.lineTo(bx + 4, by); c2.stroke();
      if (turnId && deadline && !anim) {
        const secs = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
        c2.font = 'bold 16px sans-serif'; c2.textAlign = 'left'; c2.fillStyle = secs <= 5 ? '#ff9a9a' : '#fff';
        c2.fillText(`${secs}s`, 10, 24);
      }
      if (turnId) drawMeter();
    }

    function loop(now) {
      raf = requestAnimationFrame(loop);
      draw(now);
    }
    raf = requestAnimationFrame(loop);

    function drawHud() {
      hud.replaceChildren();
      for (const p of roster) {
        const k = counts.get(p.id) || 0;
        const label = p.id === ctx.youId ? 'You' : p.name;
        hud.append(h('span', { class: `fb-chip${p.id === turnId ? ' on' : ''}` }, `${label}: ${scores.get(p.id) || 0} (${k}/${attempts})`));
      }
    }
    drawHud();
    setButtons();

    return {
      onMessage(data) {
        if (data.type === 'begin') {
          attempts = data.attempts;
          period = data.period;
          sweep = data.sweep;
          roster = data.roster || [];
          for (const p of roster) { scores.set(p.id, 0); counts.set(p.id, 0); }
          status.textContent = `Field goals! ${Math.round(data.roundMs / 1000)} seconds. Take turns.`;
          drawHud();
        } else if (data.type === 'turn') {
          turnId = data.id;
          turnName = data.name;
          turnN = data.n;
          wind = data.wind;
          dist = data.dist;
          meter = null;
          myTurn = data.id === ctx.youId;
          deadline = performance.now() + data.ms;
          distLabel.textContent = `${dist} yards`;
          status.textContent = myTurn
            ? `Your kick (${turnN}/${data.of})! ${wind === 0 ? 'Calm air.' : `Wind ${Math.abs(wind)} blowing ${wind > 0 ? 'right' : 'left'}: aim into the green.`}`
            : `${turnName} is kicking (${turnN}/${data.of}).`;
          setButtons();
          drawHud();
        } else if (data.type === 'dist') {
          if (data.id === turnId) { dist = data.dist; distLabel.textContent = `${dist} yards`; }
        } else if (data.type === 'meter') {
          if (data.id === turnId) {
            // The server's start time, shifted onto this client's clock.
            meter = { start: performance.now() + (data.start - data.t), period: data.period };
            status.textContent = myTurn ? 'Lock it in the green!' : `${turnName} is lining up...`;
            setButtons();
          }
        } else if (data.type === 'attempt') {
          scores.set(data.id, data.score);
          counts.set(data.id, data.n);
          meter = null;
          myTurn = false;
          deadline = 0;
          anim = { t0: performance.now(), landing: data.error, made: data.made, points: data.points, dist: data.dist, timedOut: data.timedOut };
          const who = data.id === ctx.youId ? 'You' : (roster.find((p) => p.id === data.id)?.name || 'Kicker');
          status.textContent = data.timedOut
            ? `${who} ran out of time.`
            : data.made ? `${who}: through the uprights! +${data.points}` : `${who}: wide of the posts.`;
          setButtons();
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
