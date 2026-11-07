// Soccer (client). A penalty shootout: pick a side of the goal, then kick. Draws your kick and
// the keeper's dive from the server's results. Server rules: server/src/minigames/games/soccer.js
ClubDojoMinigames.register({
  id: 'soccer',

  mount(ctx) {
    const { h, el } = ctx;
    const CW = 480, CH = 330;
    const GOAL = { x: 80, y: 40, w: 320, h: 160 };
    const ZONE_W = GOAL.w / 3;
    const zoneX = (z) => GOAL.x + ZONE_W * z + ZONE_W / 2;
    const SPOT = { x: CW / 2, y: 290 };
    let aim = 1;
    let kicks = 5;
    let kicksTaken = 0;
    let anim = null;   // { t0, zone, dive, goal }
    let raf = 0;
    const names = new Map(ctx.players.map((p) => [p.id, p.name]));
    const scores = new Map(ctx.players.map((p) => [p.id, 0]));
    const counts = new Map(ctx.players.map((p) => [p.id, 0]));

    const style = h('style', {}, `
      .sc { display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; padding: 6px; box-sizing: border-box; }
      .sc-hud { display: flex; gap: 14px; font-family: var(--display); font-size: 18px; justify-content: center; flex-wrap: wrap; }
      .sc-status { font-family: var(--display); font-size: 22px; min-height: 30px; text-align: center; }
      .sc-canvas { width: min(560px, 100%); height: auto; aspect-ratio: ${CW} / ${CH}; border-radius: 12px; box-shadow: 0 6px 0 rgba(0,0,0,.35); }
      .sc-zones, .sc-btns { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
      .sc-zone.on { outline: 3px solid #f5b82e; }
      .sc-help { font-size: 12px; opacity: .75; text-align: center; }
    `);
    const hud = h('div', { class: 'sc-hud' });
    const status = h('div', { class: 'sc-status' }, 'Pick a side and kick.');
    const canvas = h('canvas', { class: 'sc-canvas', width: CW, height: CH });
    const c2 = canvas.getContext('2d');
    const zoneNames = ['Left', 'Centre', 'Right'];
    const zoneBtns = zoneNames.map((name, z) => h('button', { class: 'btn small sc-zone', onclick: () => setAim(z) }, name));
    const kickBtn = h('button', { class: 'btn', onclick: () => kick() }, 'Kick (Space)');
    const help = h('div', { class: 'sc-help' }, 'Aim: left and right arrows, A and D, or the buttons. Kick: Space or Enter. Five kicks each.');
    el.append(style, h('div', { class: 'sc' }, hud, status, canvas, h('div', { class: 'sc-zones' }, ...zoneBtns), h('div', { class: 'sc-btns' }, kickBtn), help));

    function setAim(z) {
      aim = z;
      zoneBtns.forEach((b, i) => b.classList.toggle('on', i === z));
      ctx.send({ type: 'aim', zone: z });
      draw(performance.now());
    }
    function kick() {
      if (kicksTaken >= kicks) return;
      ctx.send({ type: 'kick' });
    }

    const onKeyDown = (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { if (!e.repeat) setAim(Math.max(0, aim - 1)); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { if (!e.repeat) setAim(Math.min(2, aim + 1)); }
      else if (e.code === 'Space' || e.code === 'Enter') { if (!e.repeat) kick(); }
    };
    document.addEventListener('keydown', onKeyDown);
    setAim(1);

    function drawPitch() {
      c2.fillStyle = '#5aa948'; c2.fillRect(0, 0, CW, CH);
      c2.fillStyle = '#66b653';
      for (let i = 0; i < 6; i++) c2.fillRect(i * (CW / 6), 0, CW / 12, CH);
      // Penalty box and spot.
      c2.strokeStyle = 'rgba(255,255,255,.9)'; c2.lineWidth = 2;
      c2.strokeRect(GOAL.x - 60, GOAL.y, GOAL.w + 120, 200);
      c2.beginPath(); c2.arc(SPOT.x, SPOT.y, 3, 0, Math.PI * 2); c2.fillStyle = '#fff'; c2.fill();
      // Goal frame and net.
      c2.fillStyle = 'rgba(255,255,255,.12)'; c2.fillRect(GOAL.x, GOAL.y, GOAL.w, GOAL.h);
      c2.strokeStyle = 'rgba(255,255,255,.35)'; c2.lineWidth = 1;
      for (let x = GOAL.x; x <= GOAL.x + GOAL.w; x += 16) { c2.beginPath(); c2.moveTo(x, GOAL.y); c2.lineTo(x, GOAL.y + GOAL.h); c2.stroke(); }
      for (let y = GOAL.y; y <= GOAL.y + GOAL.h; y += 16) { c2.beginPath(); c2.moveTo(GOAL.x, y); c2.lineTo(GOAL.x + GOAL.w, y); c2.stroke(); }
      c2.strokeStyle = '#ffffff'; c2.lineWidth = 6;
      c2.beginPath(); c2.moveTo(GOAL.x, GOAL.y + GOAL.h); c2.lineTo(GOAL.x, GOAL.y); c2.lineTo(GOAL.x + GOAL.w, GOAL.y); c2.lineTo(GOAL.x + GOAL.w, GOAL.y + GOAL.h); c2.stroke();
      // Aim marker over the chosen zone.
      c2.fillStyle = 'rgba(245,184,46,.35)';
      c2.fillRect(GOAL.x + ZONE_W * aim, GOAL.y, ZONE_W, GOAL.h);
    }

    function draw(now) {
      c2.clearRect(0, 0, CW, CH);
      drawPitch();
      // Keeper: a simple figure that dives to a side after the kick.
      let dive = 1, diveT = 0;
      if (anim) { dive = anim.dive; diveT = Math.min(1, (now - anim.t0) / 350); }
      const kx = zoneX(dive) * diveT + zoneX(1) * (1 - diveT);
      c2.fillStyle = '#f5b82e'; c2.beginPath(); c2.roundRect ? c2.roundRect(kx - 14, GOAL.y + GOAL.h - 56, 28, 56, 8) : c2.rect(kx - 14, GOAL.y + GOAL.h - 56, 28, 56); c2.fill();
      c2.fillStyle = '#ffd98a'; c2.beginPath(); c2.arc(kx, GOAL.y + GOAL.h - 64, 9, 0, Math.PI * 2); c2.fill();
      // Ball: at the spot, or flying to its target after a kick.
      let bx = SPOT.x, by = SPOT.y, size = 9;
      if (anim) {
        const t = Math.min(1, (now - anim.t0) / 450);
        const tx = zoneX(anim.zone), ty = GOAL.y + GOAL.h * 0.55;
        bx = SPOT.x + (tx - SPOT.x) * t;
        by = SPOT.y + (ty - SPOT.y) * t - Math.sin(t * Math.PI) * 30;
        size = 9 - t * 3;
        if (t >= 1 && now - anim.t0 < 1800) {
          c2.font = 'bold 30px sans-serif'; c2.textAlign = 'center';
          c2.fillStyle = anim.goal ? '#7dffb0' : '#ff9a9a';
          c2.fillText(anim.goal ? 'GOAL!' : 'Saved!', CW / 2, 26);
        }
        if (now - anim.t0 > 1800) anim = null;
      }
      c2.fillStyle = '#ffffff'; c2.beginPath(); c2.arc(bx, by, size, 0, Math.PI * 2); c2.fill();
      c2.strokeStyle = '#222'; c2.lineWidth = 1.5; c2.stroke();
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
        hud.append(h('span', {}, `${p.id === ctx.youId ? 'You' : p.name}: ${scores.get(p.id) || 0} (${k}/${kicks})`));
      }
    }
    drawHud();

    return {
      onMessage(data) {
        if (data.type === 'begin') {
          kicks = data.kicks;
          status.textContent = `Penalties! ${Math.round(data.roundMs / 1000)} seconds`;
        } else if (data.type === 'kick') {
          scores.set(data.id, data.score);
          counts.set(data.id, data.n);
          if (data.id === ctx.youId) {
            kicksTaken = data.n;
            anim = { t0: performance.now(), zone: data.aim, dive: data.dive, goal: data.goal };
            status.textContent = data.goal ? 'Goal! Nice finish.' : 'Saved by the keeper.';
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
