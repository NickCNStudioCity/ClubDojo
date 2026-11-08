// Basketball (client). Four courts, one per ninja; bots fill the empty courts. The shot meter runs
// on the client clock, lined up with the server's start time. Server rules:
// server/src/minigames/games/basketball.js
// Keyboard: A/D or the arrow keys move, Space or Enter shoots. Touch: drag your court to move (or
// use the hold buttons), tap the court to shoot.
ClubDojoMinigames.register({
  id: 'basketball',
  guide: {
    summary: 'Four courts, one for each ninja, with bots on any empty ones. Score the most before time runs out.',
    controls: [['A / D or ← →', 'Move along your court'], ['Space or Enter', 'Shoot when the marker is on the meter'], ['Touch', 'Drag your court to move, tap to shoot']],
    tips: ['Green on the meter is a good shot. Gold is perfect.', 'Shots from far away are worth three.', 'Streaks set you on fire, and the final 10 seconds count double.'],
  },

  mount(ctx) {
    const { h, el, avatar } = ctx;
    const COURTS = 4;
    let W = 720, LH = 132, H = LH * COURTS, HX = W * 0.9, scale = 1;   // resized to fill the screen; HX is the hoop centre x
    const HY = 34;                      // hoop height inside a court
    const GREEN = 0.12, PERFECT = 0.04, PERIOD = 1.1;
    const MARGIN = 0.05;
    const BOT_NAMES = ['Ace', 'Blaze', 'Dunk', 'Swish'];
    const BOT_LOADOUT = { v: 1, id: '__bot', name: 'Bot', color: '#2b2f3a', headband: '#e8453c', belt: 'white', accessories: {} };
    const PALETTE = ['#ffd23f', '#ff8a3d', '#7dffb0', '#ffffff', '#6fb8ff'];

    // Courts: humans first, then bots. The server builds the same list; begin{} corrects names.
    const loadouts = new Map(ctx.players.map((p) => [p.id, p.loadout]));
    const lanes = ctx.players.slice(0, COURTS).map((p) => ({ id: p.id, name: p.name, bot: false, loadout: p.loadout }));
    let botNo = 0;
    while (lanes.length < COURTS) {
      const nm = `Bot ${BOT_NAMES[botNo % BOT_NAMES.length]}`;
      lanes.push({ id: `__bot${botNo}`, name: nm, bot: true, loadout: BOT_LOADOUT });
      botNo++;
    }
    const laneOf = (id) => lanes.find((l) => l.id === id);
    lanes.forEach((l, i) => { l.index = i; });

    const meters = new Map();   // id -> performance.now() time the meter started
    const anims = new Map();    // id -> { from, made, perfect, t0, text, color, three }
    const rimFlash = new Map(); // id -> performance.now() time of the last make
    const particles = [];
    let state = null;
    let finalOn = false;
    let shake = 0;
    let raf = 0;
    let last = 0;

    // ---- controls -----------------------------------------------------------------------------
    const keys = new Set();     // held key codes
    const held = new Set();     // held on-screen buttons: 'L', 'R'
    let drag = 0;               // touch drag direction: -1, 0, 1
    let dir = 0;                // the direction last sent to the server

    const style = h('style', {}, `
      .bb { position: absolute; inset: 0; overflow: hidden; }
      .bb-status { position: absolute; top: 8px; left: 50%; transform: translateX(-50%); font-family: var(--display); font-size: 20px; color: #fff; text-align: center; white-space: nowrap;
        background: rgba(0,0,0,.45); border-radius: 12px; padding: 2px 14px; pointer-events: none; z-index: 1; }
      .bb-canvas { touch-action: none; user-select: none; }
      .bb-final::after { content: ''; position: absolute; inset: 0; pointer-events: none; animation: bb-pulse .6s ease-in-out infinite alternate; }
      @keyframes bb-pulse { from { box-shadow: inset 0 0 0 0 rgba(255,210,63,0); } to { box-shadow: inset 0 0 44px 8px rgba(255,210,63,.75); } }
      .bb-btns { position: absolute; left: 0; right: 0; bottom: 34px; display: flex; gap: 10px; align-items: center; justify-content: center; z-index: 1; }
      .bb-pad { min-width: 84px; touch-action: none; user-select: none; -webkit-user-select: none; }
      .bb-shoot { min-width: 130px; font-size: 18px; }
      @media (hover: hover) and (pointer: fine) { .bb-btns { display: none; } }
      @media (max-width: 600px) { .bb-status { font-size: 16px; } }
    `);
    const status = h('div', { class: 'bb-status' }, 'Get ready...');
    const canvas = h('canvas', { class: 'bb-canvas', width: W, height: H });
    const c2 = canvas.getContext('2d');
    const holdBtn = (label, key, cls) => h('button', {
      class: `btn small bb-pad ${cls || ''}`,
      tabindex: '-1',
      onpointerdown: (e) => { e.preventDefault(); held.add(key); refreshDir(); },
    }, label);
    const btnLeft = holdBtn('◀ Left', 'L');
    const btnShoot = h('button', { class: 'btn small bb-shoot', tabindex: '-1', onpointerdown: (e) => { e.preventDefault(); shoot(); } }, 'Shoot');
    const btnRight = holdBtn('Right ▶', 'R');
    el.append(style, h('div', { class: 'bb' }, canvas, status, h('div', { class: 'bb-btns' }, btnLeft, btnShoot, btnRight)));
    ctx.fit(canvas, 720, 528, (f) => { W = f.w; H = f.h; LH = H / COURTS; HX = W * 0.9; scale = f.scale; });

    function shoot() { ctx.send({ type: 'shoot' }); }

    function refreshDir() {
      const right = keys.has('ArrowRight') || keys.has('KeyD') || held.has('R');
      const left = keys.has('ArrowLeft') || keys.has('KeyA') || held.has('L');
      let d = (right ? 1 : 0) - (left ? 1 : 0);
      if (d === 0) d = drag;
      if (d !== dir) { dir = d; ctx.send({ type: 'move', dir: d }); }
    }

    const onKeyDown = (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'Space' || e.code === 'Enter') { if (!e.repeat) shoot(); return; }
      if (!keys.has(e.code)) { keys.add(e.code); refreshDir(); }
    };
    const onKeyUp = (e) => { if (keys.delete(e.code)) refreshDir(); };
    const onWindowUp = () => {
      let changed = held.size > 0;
      held.clear();
      if (drag) { drag = 0; changed = true; }
      if (changed) refreshDir();
    };

    // Canvas pointer: touch drags move your court toward the finger; a tap shoots.
    // Mouse clicks shoot, as before.
    let touch = null;   // { x0, moved, t0 }
    const toLogical = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
    };
    const onCanvasDown = (e) => {
      if (e.pointerType === 'mouse') { shoot(); return; }
      const p = toLogical(e);
      touch = { x0: p.x, moved: false, t0: performance.now(), id: e.pointerId };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* not supported */ }
    };
    const onCanvasMove = (e) => {
      if (!touch || touch.id !== e.pointerId) return;
      const p = toLogical(e);
      const me = laneOf(ctx.youId);
      const s = me && state ? state.lanes.find((l) => l.id === me.id) : null;
      const myPx = s ? pxOf(s.x) : W / 2;
      if (Math.abs(p.x - touch.x0) > 8) touch.moved = true;
      drag = Math.abs(p.x - myPx) > 14 ? (p.x > myPx ? 1 : -1) : 0;
      refreshDir();
    };
    const onCanvasUp = (e) => {
      if (!touch || touch.id !== e.pointerId) return;
      const quick = performance.now() - touch.t0 < 450;
      if (!touch.moved && quick) shoot();
      touch = null;
      drag = 0;
      refreshDir();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('pointercancel', onWindowUp);
    canvas.addEventListener('pointerdown', onCanvasDown);
    canvas.addEventListener('pointermove', onCanvasMove);
    canvas.addEventListener('pointerup', onCanvasUp);
    canvas.addEventListener('pointercancel', onCanvasUp);

    // ---- drawing helpers ----------------------------------------------------------------------
    // Meter position 0..1 from its client start time (same triangle wave as the server).
    function meterPos(start, now) {
      const u = (((now - start) / 1000) / PERIOD) % 1;
      const t = u < 0 ? u + 1 : u;
      return t < 0.5 ? t * 2 : 2 - t * 2;
    }
    const pxOf = (x) => x * W * 0.9 + W * MARGIN;

    function drawCourt(y, mine, time) {
      // Wood floor with planks and a soft light from the top.
      const g = c2.createLinearGradient(0, y, 0, y + LH);
      g.addColorStop(0, '#e2a467');
      g.addColorStop(1, '#b56a33');
      c2.fillStyle = g;
      c2.fillRect(0, y, W, LH);
      for (let x = 0; x < W; x += 60) {
        c2.fillStyle = (x / 60) % 2 ? 'rgba(90,40,10,.07)' : 'rgba(255,255,255,.04)';
        c2.fillRect(x, y, 60, LH);
      }
      if (mine) { c2.fillStyle = 'rgba(255,230,120,.12)'; c2.fillRect(0, y, W, LH); }

      // Court lines: edges, the key under the hoop, and the three-point arc.
      c2.strokeStyle = 'rgba(255,255,255,.85)';
      c2.lineWidth = 2;
      c2.strokeRect(6, y + 6, W - 12, LH - 12);
      c2.fillStyle = 'rgba(255,255,255,.12)';
      c2.fillRect(HX - 100, y + 16, 112, LH - 32);
      c2.strokeRect(HX - 100, y + 16, 112, LH - 32);
      c2.save();
      c2.beginPath(); c2.rect(0, y, W, LH); c2.clip();
      c2.beginPath(); c2.arc(HX, y + HY, 190, Math.PI * 0.5, Math.PI * 1.5); c2.stroke();
      c2.restore();
    }

    function drawHoop(y, id, time, now) {
      const hx = HX, hy = y + HY;
      // Backboard with a red square.
      c2.fillStyle = '#f4f7fb';
      c2.fillRect(hx + 20, hy - 26, 7, 56);
      c2.strokeStyle = '#e8453c'; c2.lineWidth = 2;
      c2.strokeRect(hx + 20.5, hy - 12, 7, 26);
      // Rim, glowing briefly after a make.
      const flash = rimFlash.has(id) ? Math.max(0, 1 - (now - rimFlash.get(id)) / 450) : 0;
      if (flash > 0) {
        c2.shadowColor = '#ffd23f'; c2.shadowBlur = 18 * flash;
      }
      c2.strokeStyle = flash > 0 ? '#ffe27a' : '#ff6a2a';
      c2.lineWidth = 4;
      c2.beginPath(); c2.ellipse(hx, hy, 20, 5.5, 0, 0, Math.PI * 2); c2.stroke();
      c2.shadowBlur = 0; c2.shadowColor = 'transparent';
      // Net sways a little.
      const sway = Math.sin(time * 4) * 1.2;
      c2.strokeStyle = 'rgba(255,255,255,.9)'; c2.lineWidth = 1.2;
      for (let i = -3; i <= 3; i++) {
        c2.beginPath();
        c2.moveTo(hx + i * 5, hy + 3);
        c2.quadraticCurveTo(hx + i * 4 + sway, hy + 12, hx + i * 2.4 + sway * 1.4, hy + 24);
        c2.stroke();
      }
      c2.beginPath(); c2.moveTo(hx - 17, hy + 12); c2.quadraticCurveTo(hx + sway, hy + 16, hx + 17, hy + 12); c2.stroke();
    }

    function drawMeter(y, start, mine) {
      const mx = 40, mw = W - 80, my = y + LH - 16, mh = 8;
      c2.fillStyle = 'rgba(0,0,0,.4)';
      roundRect(mx, my, mw, mh, 4); c2.fill();
      c2.fillStyle = mine ? '#3fbf7f' : 'rgba(63,191,127,.45)';
      c2.fillRect(mx + mw * (0.5 - GREEN), my, mw * GREEN * 2, mh);
      c2.fillStyle = mine ? '#ffd23f' : 'rgba(255,210,63,.5)';
      c2.fillRect(mx + mw * (0.5 - PERFECT), my, mw * PERFECT * 2, mh);
      const pos = start === null ? 0.5 : meterPos(start, performance.now());
      c2.fillStyle = '#fff';
      c2.beginPath(); c2.arc(mx + mw * pos, my + mh / 2, 7, 0, Math.PI * 2); c2.fill();
      c2.strokeStyle = 'rgba(0,0,0,.4)'; c2.lineWidth = 2; c2.stroke();
    }

    function roundRect(x, y, w, hh, r) {
      c2.beginPath();
      c2.moveTo(x + r, y);
      c2.arcTo(x + w, y, x + w, y + hh, r);
      c2.arcTo(x + w, y + hh, x, y + hh, r);
      c2.arcTo(x, y + hh, x, y, r);
      c2.arcTo(x, y, x + w, y, r);
      c2.closePath();
    }

    // Ball position mid-flight (t 0..1): an arc from the shooter toward the hoop.
    function ballAt(a, t, baseY) {
      const endX = a.made ? HX : HX + 18 + (a.idx % 2) * 6;
      const hi = 80 + Math.abs(HX - a.from) * 0.1;
      return { x: a.from + (endX - a.from) * t, y: baseY - Math.sin(t * Math.PI) * hi };
    }

    function drawBall(x, y, rot, scale) {
      c2.save();
      c2.translate(x, y);
      c2.rotate(rot);
      c2.scale(scale, scale);
      c2.fillStyle = '#ff8a3d';
      c2.beginPath(); c2.arc(0, 0, 8, 0, Math.PI * 2); c2.fill();
      c2.strokeStyle = '#3a1a06'; c2.lineWidth = 1.2;
      c2.beginPath(); c2.moveTo(-8, 0); c2.lineTo(8, 0); c2.moveTo(0, -8); c2.lineTo(0, 8); c2.stroke();
      c2.beginPath(); c2.arc(-4, 0, 8, -0.9, 0.9); c2.stroke();
      c2.restore();
    }

    function burst(x, y, perfect) {
      const n = perfect ? 34 : 22;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 90 + Math.random() * (perfect ? 260 : 170);
        particles.push({
          x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
          life: 0.7 + Math.random() * 0.6, max: 1.3,
          color: PALETTE[i % PALETTE.length], r: 2 + Math.random() * 3,
        });
      }
    }

    function render(ts) {
      raf = requestAnimationFrame(render);
      const dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
      last = ts;
      const now = performance.now();
      const time = ts / 1000;
      shake = Math.max(0, shake - dt * 40);

      c2.setTransform(scale, 0, 0, scale, 0, 0);
      c2.fillStyle = '#1b1426';
      c2.fillRect(0, 0, W, H);
      c2.save();
      if (shake > 0) c2.translate((Math.random() - 0.5) * shake * 10, (Math.random() - 0.5) * shake * 10);

      lanes.forEach((lane) => {
        const y = lane.index * LH;
        const mine = lane.id === ctx.youId;
        drawCourt(y, mine, time);
        drawHoop(y, lane.id, time, now);

        const s = state ? state.lanes.find((l) => l.id === lane.id) : null;
        const sx = pxOf(s ? s.x : 0.5);
        const feet = y + LH - 14;
        const walking = !!(mine && dir);
        const a = anims.get(lane.id);
        c2.save();
        c2.beginPath(); c2.rect(0, y, W, LH); c2.clip();
        avatar.draw(c2, lane.loadout || BOT_LOADOUT, { x: sx, y: feet, size: 46, facing: 1, walking, time });

        // Ball in flight (drawn above the ninja): up in an arc, then through the net or off the rim.
        if (a) {
          const age = now - a.t0;
          const t = Math.min(1, age / 720);
          if (t < 1) {
            const p = ballAt(a, t, feet - 52);
            drawBall(p.x, p.y, age / 80, 1);
          } else if (a.made && age < 900) {
            drawBall(HX, y + HY + 18 + (age / 900) * 14, 0, Math.max(0.2, 1 - age / 900));
          } else if (!a.made && age < 1000) {
            const bounce = Math.abs(Math.sin((age - 720) / 280 * Math.PI)) * 12;
            drawBall(HX + 18 + (a.idx % 2) * 6, y + HY + 4 - bounce, age / 60, 1);
          }
          if (t >= 1 && age < 1900) {
            const pop = Math.min(1, (age - 720) / 180);
            const fade = age > 1500 ? (1900 - age) / 400 : 1;
            c2.globalAlpha = Math.max(0, fade);
            c2.font = `bold ${Math.round(24 + 6 * pop)}px sans-serif`;
            c2.textAlign = 'center';
            c2.lineWidth = 5;
            c2.strokeStyle = 'rgba(0,0,0,.55)';
            c2.fillStyle = a.color;
            c2.strokeText(a.text, HX - 28, y + 58);
            c2.fillText(a.text, HX - 28, y + 58);
            c2.globalAlpha = 1;
          }
          if (age > 1900) anims.delete(lane.id);
        }
        c2.restore();

        // Name chip, score and streak.
        c2.fillStyle = 'rgba(0,0,0,.45)';
        roundRect(8, y + 8, 196, 26, 8); c2.fill();
        c2.fillStyle = mine ? '#ffd23f' : '#fff';
        c2.font = 'bold 15px sans-serif';
        c2.textAlign = 'left';
        const tag = lane.bot ? 'BOT' : mine ? 'YOU' : '';
        c2.fillText(`${lane.name}`.slice(0, 18), 16, y + 26);
        if (tag) {
          c2.fillStyle = mine ? '#3a2400' : '#8fd3ff';
          c2.font = 'bold 11px sans-serif';
          c2.textAlign = 'right';
          c2.fillText(tag, 196, y + 25);
        }
        const pts = s ? s.s : 0;
        const streak = s ? s.st || 0 : 0;
        c2.fillStyle = '#fff';
        c2.font = 'bold 20px sans-serif';
        c2.textAlign = 'right';
        c2.fillText(`${pts}`, W - 14, y + 27);
        if (streak >= 2) {
          c2.fillStyle = streak >= 3 ? '#ff8a3d' : '#ffd23f';
          c2.font = 'bold 13px sans-serif';
          c2.fillText(`${streak >= 3 ? 'ON FIRE' : 'STREAK'} x${streak}`, W - 14, y + 46);
        }

        drawMeter(y, meters.has(lane.id) ? meters.get(lane.id) : null, mine);
        // Court divider.
        c2.fillStyle = 'rgba(0,0,0,.45)';
        c2.fillRect(0, y + LH - 2, W, 4);
      });

      // Confetti and sparks.
      for (let i = particles.length - 1; i >= 0; i--) {
        const q = particles[i];
        q.life -= dt;
        if (q.life <= 0) { particles.splice(i, 1); continue; }
        q.vy += 620 * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        c2.globalAlpha = Math.max(0, Math.min(1, q.life / q.max));
        c2.fillStyle = q.color;
        c2.fillRect(q.x, q.y, q.r, q.r);
      }
      c2.globalAlpha = 1;
      c2.restore();
    }

    raf = requestAnimationFrame(render);

    return {
      onMessage(data) {
        if (data.type === 'begin') {
          status.textContent = `Shoot! ${Math.round(data.roundMs / 1000)} seconds`;
          const now = performance.now();
          for (const l of data.lanes) {
            const lane = laneOf(l.id);
            if (lane) { lane.name = l.name; lane.bot = l.bot; }
            meters.set(l.id, now + (l.start - data.t));
          }
        } else if (data.type === 'state') {
          state = data;
        } else if (data.type === 'shot') {
          const lane = laneOf(data.id);
          if (!lane) return;
          const now = performance.now();
          meters.set(data.id, now + (data.start - data.t));
          const from = pxOf(data.x);
          const text = data.made ? `+${data.points}` : 'Miss';
          const color = data.made ? (data.perfect ? '#ffd23f' : '#7dffb0') : '#ff9a9a';
          anims.set(data.id, { from, made: data.made, t0: now, text, color, three: data.three, idx: lane.index });
          if (data.made) {
            rimFlash.set(data.id, now);
            burst(HX, lane.index * LH + HY, data.perfect);
            if (data.id === ctx.youId || data.streak >= 3) shake = Math.max(shake, data.streak >= 3 ? 1 : 0.5);
          }
          if (state) {
            const s = state.lanes.find((l) => l.id === data.id);
            if (s) { s.s = data.score; s.st = data.streak; }
          }
          if (data.id === ctx.youId) {
            const bits = [];
            if (data.made) {
              bits.push(data.perfect ? 'Perfect!' : data.green ? 'Good timing!' : 'Nice shot!');
              bits.push(`+${data.points}`);
              if (data.three) bits.push('from downtown');
              if (data.streak >= 3) bits.push(`${data.streak} in a row`);
            } else {
              bits.push(data.green ? 'Missed, even with good timing' : 'Missed. Aim for the green zone');
            }
            status.textContent = bits.join(' · ');
          }
        } else if (data.type === 'final') {
          finalOn = true;
          el.querySelector('.bb')?.classList.add('bb-final');
          status.textContent = 'Final 10 seconds: every point counts double!';
        } else if (data.type === 'takeover') {
          const lane = laneOf(data.id);
          if (lane) lane.bot = true;
          if (data.id !== ctx.youId) status.textContent = `${data.name} left. A bot is playing their court.`;
        }
      },
      onResults() {},
      unmount() {
        cancelAnimationFrame(raf);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('pointerup', onWindowUp);
        window.removeEventListener('pointercancel', onWindowUp);
        canvas.removeEventListener('pointerdown', onCanvasDown);
        canvas.removeEventListener('pointermove', onCanvasMove);
        canvas.removeEventListener('pointerup', onCanvasUp);
        canvas.removeEventListener('pointercancel', onCanvasUp);
        keys.clear();
        held.clear();
        drag = 0;
        if (dir) { dir = 0; ctx.send({ type: 'move', dir: 0 }); }
      },
    };
  },
});
