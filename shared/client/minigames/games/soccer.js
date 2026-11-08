// Soccer (client). 2v2 on a stadium pitch, drawn with each player's own ninja.
// Move with WASD or the arrow keys, Space shoots the way you are running, Shift dashes.
// Draws what the server sends and adds the show: crowd, ball spin and trails, goal confetti,
// net ripples, power-up glows. Server rules: server/src/minigames/games/soccer.js
ClubDojoMinigames.register({
  id: 'soccer',
  ownEnding: true,
  guide: {
    summary: '2v2 on a stadium pitch, with bots on any open spots. Score more than the other team before full time. Level at full time means Golden Goal: the next goal wins.',
    controls: [['WASD or arrows', 'Run'], ['Space', 'Shoot the way you are running'], ['Shift', 'Dash and shove (short cooldown)']],
    tips: ['Blue attacks the right goal and red attacks the left. Every ninja has a team-colored outline.', 'Grab Speed Boots and Fire Shots when they appear in midfield.', 'Your ring under your ninja is gold, so you can always find yourself.'],
  },

  mount(ctx) {
    const { h, el, avatar } = ctx;
    let CW = 760, CH = 484;            // logical canvas size: resized to fill the screen
    let PX = 50, PY = 58;              // pitch origin
    const U = 5.5;                     // pixels per field unit
    let scale = 1;
    const TEAM = [
      { name: 'Blue', main: '#3b82f6', light: '#93c5fd', dark: '#1d4ed8', css: 'blue' },
      { name: 'Red', main: '#ef4444', light: '#fca5a5', dark: '#b91c1c', css: 'red' },
    ];
    const DASH_COOLDOWN_MS = 2000;
    let field = { w: 120, h: 70, goalHalf: 9 };
    let roster = [];
    let loadouts = [];
    let target = null;   // latest server state { b, p, pu, sc }
    let shown = null;    // smoothed positions for drawing
    let running = false;
    let endsAt = 0;
    let golden = false;
    let goldenEndsAt = 0;
    let pausedUntil = 0;
    let banner = null;   // { text, sub, color, at, until }
    let pops = [];       // floating text { text, x, y, color, at }
    let particles = [];
    let shake = 0;
    let nets = [0, 0];   // ripple start time per goal (0 = left)
    let fulltime = null;
    let frame = 0;
    let lastFrame = performance.now();
    let mySlot = -1;
    let myDashAt = -1e9;
    const kickAnim = [];     // per slot: time of last shot
    const ballTrail = [];
    let ballSpin = 0;
    let lastBall = null;
    let netBall = null;  // keeps the ball in the net while the goal is celebrated
    let snapNext = false;
    const keys = { up: false, down: false, left: false, right: false };
    let lastSent = '';

    const style = h('style', {}, `
      .sc3 { position: absolute; inset: 0; overflow: hidden; background: #1b2230; }
      .sc3-top { position: absolute; top: 4px; left: 0; right: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; pointer-events: none; z-index: 1; }
      .sc3-board { display: flex; align-items: stretch; justify-content: center; gap: 0; font-family: var(--display); border-radius: 12px; overflow: hidden; box-shadow: 0 4px 0 rgba(0,0,0,.35); }
      .sc3-team { display: flex; align-items: center; gap: 8px; padding: 4px 12px; color: #fff; font-size: 18px; }
      .sc3-team.blue { background: linear-gradient(90deg, #1d4ed8, #3b82f6); }
      .sc3-team.red { background: linear-gradient(90deg, #ef4444, #b91c1c); flex-direction: row-reverse; }
      .sc3-team .goals { font-size: 30px; min-width: 26px; text-align: center; text-shadow: 0 2px 0 rgba(0,0,0,.3); }
      .sc3-team canvas { background: rgba(255,255,255,.18); border-radius: 50%; }
      .sc3-team .mates { display: flex; gap: 2px; }
      .sc3-clock { background: #13151b; color: #fff; padding: 4px 14px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 78px; font-size: 22px; }
      .sc3-clock small { font-size: 11px; letter-spacing: 1px; opacity: .75; }
      .sc3-clock.golden { background: linear-gradient(180deg, #f7c948, #d99a00); color: #2b1d00; }
      .sc3-status { font-size: 14px; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.9); min-height: 18px; text-align: center; }
    `);
    const board = h('div', { class: 'sc3-board' }, h('div', { class: 'sc3-clock' }, 'Get ready…'));
    const status = h('div', { class: 'sc3-status' }, '');
    const canvas = h('canvas', { class: 'sc3-canvas' });
    el.append(style, h('div', { class: 'sc3' }, canvas, h('div', { class: 'sc3-top' }, board, status)));
    const g = canvas.getContext('2d');

    const X = (x) => PX + x * U;
    const Y = (y) => PY + y * U;
    const rand = (a, b) => a + Math.random() * (b - a);

    // ---------- input ----------
    const KEYMAP = {
      ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    };
    function vector() {
      return { x: (keys.right ? 1 : 0) - (keys.left ? 1 : 0), y: (keys.down ? 1 : 0) - (keys.up ? 1 : 0) };
    }
    function sendMove(force) {
      if (!running) return;
      const v = vector();
      const diag = v.x && v.y ? Math.SQRT1_2 : 1;
      const sig = `${v.x}|${v.y}`;
      if (!force && sig === lastSent) return;
      lastSent = sig;
      ctx.send({ type: 'move', x: v.x * diag, y: v.y * diag });
    }
    function onKeyDown(e) {
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat && running) {
          ctx.send({ type: 'kick' });
          if (mySlot >= 0) kickAnim[mySlot] = performance.now();
        }
        return;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        e.preventDefault();
        const now = performance.now();
        if (!e.repeat && running && now >= pausedUntil && now - myDashAt >= DASH_COOLDOWN_MS) {
          myDashAt = now;
          ctx.send({ type: 'dash' });
        }
        return;
      }
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault();
      if (!keys[k]) { keys[k] = true; sendMove(); }
    }
    function onKeyUp(e) {
      const k = KEYMAP[e.code];
      if (!k) return;
      keys[k] = false;
      sendMove();
    }
    function onBlur() {
      keys.up = keys.down = keys.left = keys.right = false;
      sendMove();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    // ---------- static background: stands, boards and the pitch ----------
    const bg = document.createElement('canvas');
    function paintBackground() {
      bg.width = canvas.width; bg.height = canvas.height;
      const b = bg.getContext('2d');
      b.setTransform(scale, 0, 0, scale, 0, 0);
      const W = field.w * U, H = field.h * U;
      // stadium bowl
      const bowl = b.createLinearGradient(0, 0, 0, CH);
      bowl.addColorStop(0, '#1b2230'); bowl.addColorStop(0.5, '#262e3d'); bowl.addColorStop(1, '#1b2230');
      b.fillStyle = bowl; b.fillRect(0, 0, CW, CH);
      // tiered seating rows
      b.fillStyle = 'rgba(255,255,255,.04)';
      for (let y = 4; y < PY - 12; y += 9) b.fillRect(0, y, CW, 4);
      for (let y = PY + H + 14; y < CH; y += 9) b.fillRect(0, y, CW, 4);
      // End stands fill any room left beside the pitch. These fans are painted once.
      const sideGap = PX - 36;
      if (sideGap > 8) {
        let n = 7;
        for (const [x0, x1, side] of [[2, sideGap, 0], [CW - sideGap, CW - 2, 1]]) {
          b.fillStyle = 'rgba(255,255,255,.04)';
          for (let x = x0; x < x1; x += 11) b.fillRect(x, PY - 16, 5, H + 32);
          for (let y = PY - 12; y < PY + H + 14; y += 9) {
            for (let x = x0 + 4 + (Math.round(y) % 2) * 4; x < x1 - 2; x += 10.5) {
              n = (n * 16807) % 2147483647;
              if (n % 6 === 0) continue;
              b.fillStyle = n % 10 < 7 ? SHIRTS[side * 3 + (n % 3)] : SHIRTS[6 + (n % 4)];
              b.beginPath(); b.ellipse(x, y + 4, 3.4, 2.8, 0, Math.PI, 0); b.fill();
              b.fillStyle = SKIN[n % SKIN.length];
              b.beginPath(); b.arc(x, y, 2.3, 0, Math.PI * 2); b.fill();
            }
          }
        }
      }
      // track around the pitch
      b.fillStyle = '#2f6b3a';
      b.fillRect(PX - 30, PY - 12, W + 60, H + 24);
      // advertising boards
      const boards = [[PX - 30, PY - 20, W + 60, 8], [PX - 30, PY + H + 12, W + 60, 8]];
      for (const [x, y, w, hh] of boards) {
        const grad = b.createLinearGradient(x, 0, x + w, 0);
        grad.addColorStop(0, TEAM[0].dark); grad.addColorStop(0.5, '#13151b'); grad.addColorStop(1, TEAM[1].dark);
        b.fillStyle = grad; b.fillRect(x, y, w, hh);
        b.fillStyle = 'rgba(255,255,255,.85)'; b.font = 'bold 7px sans-serif'; b.textAlign = 'center'; b.textBaseline = 'middle';
        for (let i = 0; i < 6; i++) b.fillText(i % 2 ? '⚽ SPORTS PARK' : 'CLUB DOJO ★', x + w * (i + 0.5) / 6, y + hh / 2 + 0.5);
      }
      // grass with mown stripes and a little texture
      b.fillStyle = '#4f9e3f'; b.fillRect(PX, PY, W, H);
      const stripes = 12;
      for (let i = 0; i < stripes; i += 2) { b.fillStyle = '#5bab4a'; b.fillRect(PX + (W / stripes) * i, PY, W / stripes, H); }
      for (let i = 0; i < 1400; i++) {
        b.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.05)';
        b.fillRect(PX + Math.random() * W, PY + Math.random() * H, 1.5, 1.5);
      }
      // floodlight pools
      for (const [cx, cy] of [[PX, PY], [PX + W, PY], [PX, PY + H], [PX + W, PY + H]]) {
        const rg = b.createRadialGradient(cx, cy, 0, cx, cy, 260);
        rg.addColorStop(0, 'rgba(255,255,230,.14)'); rg.addColorStop(1, 'rgba(255,255,230,0)');
        b.fillStyle = rg; b.fillRect(PX, PY, W, H);
      }
      // markings
      b.strokeStyle = 'rgba(255,255,255,.9)'; b.lineWidth = 2;
      b.strokeRect(PX, PY, W, H);
      b.beginPath(); b.moveTo(PX + W / 2, PY); b.lineTo(PX + W / 2, PY + H); b.stroke();
      b.beginPath(); b.arc(PX + W / 2, PY + H / 2, 9.15 * U, 0, Math.PI * 2); b.stroke();
      b.fillStyle = '#fff';
      b.beginPath(); b.arc(PX + W / 2, PY + H / 2, 3, 0, Math.PI * 2); b.fill();
      for (const side of [0, 1]) {
        const dir = side === 0 ? 1 : -1;
        const gx = side === 0 ? PX : PX + W;
        const boxD = 16 * U, boxH = 36 * U, smallD = 5.5 * U, smallH = 22 * U;
        b.strokeRect(side === 0 ? gx : gx - boxD, PY + H / 2 - boxH / 2, boxD, boxH);
        b.strokeRect(side === 0 ? gx : gx - smallD, PY + H / 2 - smallH / 2, smallD, smallH);
        const spot = gx + dir * 11 * U;
        b.beginPath(); b.arc(spot, PY + H / 2, 2.5, 0, Math.PI * 2); b.fill();
        b.beginPath();
        const a = Math.acos((16 - 11) / 9.15);
        if (side === 0) b.arc(spot, PY + H / 2, 9.15 * U, -a, a); else b.arc(spot, PY + H / 2, 9.15 * U, Math.PI - a, Math.PI + a);
        b.stroke();
        // corner arcs and flags
        for (const cy of [PY, PY + H]) {
          b.beginPath();
          const start = side === 0 ? (cy === PY ? 0 : -Math.PI / 2) : (cy === PY ? Math.PI / 2 : Math.PI);
          b.arc(gx, cy, 1.6 * U, start, start + Math.PI / 2); b.stroke();
          b.fillStyle = TEAM[side].main;
          b.fillRect(gx - 1, cy - 12, 2, 12);
          b.beginPath(); b.moveTo(gx + 1, cy - 12); b.lineTo(gx + 1 + 7 * dir, cy - 9); b.lineTo(gx + 1, cy - 6); b.fill();
          b.fillStyle = '#fff';
        }
      }
      // inner shadow so the pitch sits in the bowl
      const vg = b.createRadialGradient(PX + W / 2, PY + H / 2, H * 0.4, PX + W / 2, PY + H / 2, W * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.22)');
      b.fillStyle = vg; b.fillRect(PX, PY, W, H);
    }

    // ---------- crowd ----------
    const SHIRTS = ['#3b82f6', '#60a5fa', '#1d4ed8', '#ef4444', '#f87171', '#b91c1c', '#f5c542', '#ffffff', '#22c55e', '#a855f7'];
    const SKIN = ['#f1d3b3', '#e0b48c', '#c68b5e', '#8d5a3b', '#f5dcc4'];
    const fans = [];
    function buildCrowd() {
      fans.length = 0;
      const add = (x, y, side) => {
        const teamish = Math.random() < 0.7;
        const shirt = teamish ? (side === 0 ? SHIRTS[Math.floor(Math.random() * 3)] : SHIRTS[3 + Math.floor(Math.random() * 3)]) : SHIRTS[6 + Math.floor(Math.random() * 4)];
        fans.push({ x, y, side, shirt, skin: SKIN[Math.floor(Math.random() * SKIN.length)], ph: Math.random() * 6.28, sc: rand(0.85, 1.1), flag: Math.random() < 0.06 });
      };
      for (let row = 0; row < 4; row++) for (let x = 8 + (row % 2) * 5; x < CW - 4; x += 10.5) add(x + rand(-1.5, 1.5), 9 + row * 9, x < CW / 2 ? 0 : 1);
      const bottomTop = PY + field.h * U + 26;
      for (let row = 0; row < 2; row++) for (let x = 8 + (row % 2) * 5; x < CW - 4; x += 10.5) add(x + rand(-1.5, 1.5), bottomTop + row * 9, x < CW / 2 ? 0 : 1);
      fans.sort((a, b) => a.y - b.y);
    }
    let crowdHype = [0, 0]; // time each side's fans started celebrating
    function drawCrowd(now) {
      for (const f of fans) {
        const hype = now - crowdHype[f.side] < 3000;
        const amp = hype ? 5 : 0.8;
        const speed = hype ? 120 : 600;
        const jump = Math.max(0, Math.sin(now / speed + f.ph)) * amp;
        const y = f.y - jump;
        g.fillStyle = f.shirt;
        g.beginPath(); g.ellipse(f.x, y + 4, 3.6 * f.sc, 3 * f.sc, 0, Math.PI, 0); g.fill();
        g.fillStyle = f.skin;
        g.beginPath(); g.arc(f.x, y, 2.4 * f.sc, 0, Math.PI * 2); g.fill();
        if (hype || f.flag) {
          g.strokeStyle = f.skin; g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(f.x - 3, y + 2); g.lineTo(f.x - 4.5, y - 3); g.moveTo(f.x + 3, y + 2); g.lineTo(f.x + 4.5, y - 3); g.stroke();
        }
        if (f.flag) {
          g.fillStyle = TEAM[f.side].main;
          const wave = Math.sin(now / 160 + f.ph) * 1.5;
          g.fillRect(f.x + 4.5, y - 9 + wave, 7, 4.5);
        }
      }
    }

    // ---------- goals ----------
    function drawGoal(side, now) {
      const top = Y(field.h / 2 - field.goalHalf), bot = Y(field.h / 2 + field.goalHalf);
      const line = side === 0 ? X(0) : X(field.w);
      const dir = side === 0 ? -1 : 1;
      const depth = 4 * U;
      const t = (now - nets[side]) / 1000;
      const bulge = nets[side] && t < 1.4 ? Math.sin(t * 14) * Math.exp(-t * 3) * 10 : 0;
      const back = line + dir * (depth + Math.abs(bulge));
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.beginPath(); g.moveTo(line, top); g.lineTo(back, top + 3); g.lineTo(back, bot - 3); g.lineTo(line, bot); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 0.8;
      for (let y = top + 6; y < bot; y += 6) {
        const k = (y - top) / (bot - top);
        const sag = Math.sin(k * Math.PI) * Math.abs(bulge);
        const end = line + dir * (depth + sag);
        g.beginPath(); g.moveTo(line, y); g.quadraticCurveTo(line + dir * (depth * 0.5 + sag), y, end, y); g.stroke();
      }
      for (let i = 1; i <= 3; i++) {
        const x = line + dir * (depth * i / 4 + Math.abs(bulge) * (i / 4));
        g.beginPath(); g.moveTo(x, top + (i / 4) * 3); g.lineTo(x, bot - (i / 4) * 3); g.stroke();
      }
      // frame
      g.strokeStyle = '#fff'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(line, top); g.lineTo(back, top + 3); g.lineTo(back, bot - 3); g.lineTo(line, bot); g.stroke();
      g.fillStyle = '#fff';
      for (const py of [top, bot]) {
        g.beginPath(); g.arc(line, py, 0.8 * U, 0, Math.PI * 2); g.fill();
        g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.stroke();
      }
      // a team-colored strip on the line, so you know whose goal it is
      g.fillStyle = TEAM[side].main; g.globalAlpha = 0.85;
      g.fillRect(line - 1.5, top + 4, 3, bot - top - 8);
      g.globalAlpha = 1;
    }

    // ---------- particles ----------
    function emit(p) { if (particles.length < 600) particles.push(p); }
    function confetti(x, y, team, n = 140) {
      const colors = [TEAM[team].main, TEAM[team].light, '#ffffff', '#f5c542'];
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2), sp = rand(80, 330);
        emit({ kind: 'confetti', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, life: 0, max: rand(1.4, 2.6), color: colors[i % colors.length], size: rand(3, 6), rot: rand(0, 6), vr: rand(-12, 12) });
      }
    }
    function sparks(x, y, color, n = 14, sp = 160) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, Math.PI * 2), s = rand(sp * 0.3, sp);
        emit({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: rand(0.25, 0.5), color, size: rand(1.5, 3) });
      }
    }
    function dust(x, y, n = 3) {
      for (let i = 0; i < n; i++) emit({ kind: 'smoke', x: x + rand(-4, 4), y: y + rand(-1, 2), vx: rand(-20, 20), vy: rand(-25, -5), life: 0, max: rand(0.35, 0.6), color: 'rgba(225,215,180,', size: rand(2.5, 4.5) });
    }
    function flame(x, y, n = 2, spread = 4) {
      for (let i = 0; i < n; i++) emit({ kind: 'flame', x: x + rand(-spread, spread), y: y + rand(-spread, spread), vx: rand(-15, 15), vy: rand(-55, -20), life: 0, max: rand(0.25, 0.5), size: rand(2.5, 5) });
    }
    function stepParticles(dt) {
      for (const p of particles) {
        p.life += dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.kind === 'confetti') { p.vy += 260 * dt; p.vx *= 0.985; p.vy *= 0.985; p.rot += p.vr * dt; }
        else if (p.kind === 'spark') { p.vx *= 0.9; p.vy *= 0.9; }
        else { p.vx *= 0.95; }
      }
      particles = particles.filter((p) => p.life < p.max);
    }
    function drawParticles() {
      for (const p of particles) {
        const k = 1 - p.life / p.max;
        if (p.kind === 'confetti') {
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.min(1, k * 2);
          g.fillStyle = p.color; g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2 * (0.5 + Math.abs(Math.sin(p.rot))));
          g.restore();
        } else if (p.kind === 'spark') {
          g.globalAlpha = k; g.fillStyle = p.color;
          g.beginPath(); g.arc(p.x, p.y, p.size * k + 0.5, 0, Math.PI * 2); g.fill();
        } else if (p.kind === 'smoke') {
          g.fillStyle = `${p.color}${(0.5 * k).toFixed(3)})`;
          g.beginPath(); g.arc(p.x, p.y, p.size * (1.6 - k * 0.6), 0, Math.PI * 2); g.fill();
        } else if (p.kind === 'flame') {
          g.globalAlpha = k;
          g.fillStyle = k > 0.6 ? '#fff3a0' : (k > 0.3 ? '#ffae2b' : '#e8452c');
          g.beginPath(); g.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
      }
    }

    function pop(text, x, y, color = '#fff') { pops.push({ text, x, y, color, at: performance.now() }); }

    // ---------- the ball ----------
    function drawBall(now, dt) {
      const bx = X(shown.b[0]), by = Y(shown.b[1]);
      const fire = target && target.b[2] === 1;
      let speed = 0;
      if (lastBall) {
        const dx = bx - lastBall.x, dy = by - lastBall.y;
        speed = Math.hypot(dx, dy) / Math.max(dt, 1e-3);
        ballSpin += Math.hypot(dx, dy) / 7 * (dx >= 0 ? 1 : -1);
      }
      lastBall = { x: bx, y: by };
      ballTrail.push({ x: bx, y: by });
      if (ballTrail.length > 12) ballTrail.shift();
      // trail
      if (speed > 140 || fire) {
        for (let i = 1; i < ballTrail.length; i++) {
          const a = ballTrail[i - 1], b = ballTrail[i];
          const k = i / ballTrail.length;
          g.strokeStyle = fire ? `rgba(255,${Math.round(120 + 100 * k)},40,${0.7 * k})` : `rgba(255,255,255,${0.35 * k})`;
          g.lineWidth = (fire ? 11 : 7) * k;
          g.lineCap = 'round';
          g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
        }
      }
      if (fire) flame(bx, by, 3, 4);
      const r = 7;
      g.fillStyle = 'rgba(0,0,0,.28)';
      g.beginPath(); g.ellipse(bx + 2.5, by + 4, r, r * 0.55, 0, 0, Math.PI * 2); g.fill();
      if (fire) {
        const glow = g.createRadialGradient(bx, by, 2, bx, by, 18);
        glow.addColorStop(0, 'rgba(255,200,80,.8)'); glow.addColorStop(1, 'rgba(255,80,20,0)');
        g.fillStyle = glow; g.beginPath(); g.arc(bx, by, 18, 0, Math.PI * 2); g.fill();
      }
      g.save();
      g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2); g.clip();
      g.fillStyle = fire ? '#ffe9b0' : '#fbfbfb'; g.fillRect(bx - r, by - r, r * 2, r * 2);
      g.fillStyle = '#1d1d1d';
      const pent = (cx, cy, s, rot) => {
        g.beginPath();
        for (let i = 0; i < 5; i++) { const a = rot + i * (Math.PI * 2 / 5); g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * s, cy + Math.sin(a) * s); }
        g.closePath(); g.fill();
      };
      const roll = (ballSpin % (r * 2.4)) - r * 1.2;
      pent(bx + roll * 0.6, by, r * 0.38, ballSpin);
      for (let i = 0; i < 5; i++) {
        const a = ballSpin + i * (Math.PI * 2 / 5);
        pent(bx + roll * 0.6 + Math.cos(a) * r * 0.95, by + Math.sin(a) * r * 0.95, r * 0.3, a);
      }
      const shine = g.createRadialGradient(bx - r * 0.4, by - r * 0.4, 0, bx, by, r);
      shine.addColorStop(0, 'rgba(255,255,255,.65)'); shine.addColorStop(0.5, 'rgba(255,255,255,0)'); shine.addColorStop(1, 'rgba(0,0,0,.28)');
      g.fillStyle = shine; g.fillRect(bx - r, by - r, r * 2, r * 2);
      g.restore();
      g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1;
      g.beginPath(); g.arc(bx, by, r, 0, Math.PI * 2); g.stroke();
    }

    // ---------- power-ups ----------
    function drawBolt(x, y, s) {
      g.beginPath();
      g.moveTo(x + s * 0.15, y - s); g.lineTo(x - s * 0.5, y + s * 0.1); g.lineTo(x - s * 0.02, y + s * 0.1);
      g.lineTo(x - s * 0.2, y + s); g.lineTo(x + s * 0.5, y - s * 0.15); g.lineTo(x + s * 0.02, y - s * 0.15); g.closePath(); g.fill();
    }
    function drawFlameIcon(x, y, s) {
      g.beginPath();
      g.moveTo(x, y - s);
      g.bezierCurveTo(x + s * 0.9, y - s * 0.2, x + s * 0.8, y + s, x, y + s);
      g.bezierCurveTo(x - s * 0.8, y + s, x - s * 0.9, y - s * 0.1, x - s * 0.15, y - s * 0.35);
      g.bezierCurveTo(x - s * 0.1, y, x + s * 0.2, y - s * 0.4, x, y - s); g.fill();
    }
    function drawPickups(now) {
      if (!target || !target.pu) return;
      for (const [id, wx, wy, kind] of target.pu) {
        const x = X(wx), y = Y(wy) - 6 - Math.sin(now / 260 + id) * 3;
        const col = kind === 0 ? '#ffd23f' : '#ff7a2b';
        g.fillStyle = 'rgba(0,0,0,.22)';
        g.beginPath(); g.ellipse(X(wx), Y(wy) + 4, 9, 4, 0, 0, Math.PI * 2); g.fill();
        const glow = g.createRadialGradient(x, y, 2, x, y, 20);
        glow.addColorStop(0, kind === 0 ? 'rgba(255,230,90,.75)' : 'rgba(255,140,50,.75)'); glow.addColorStop(1, 'rgba(255,200,50,0)');
        g.fillStyle = glow; g.beginPath(); g.arc(x, y, 20, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#1b1f2a'; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.fill();
        g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, 13 + Math.sin(now / 200) * 1.5, now / 400, now / 400 + 1.2); g.stroke();
        g.fillStyle = col;
        if (kind === 0) drawBolt(x, y, 6.5); else drawFlameIcon(x, y, 6.5);
        if (Math.random() < 0.15) sparks(x + rand(-8, 8), y + rand(-8, 8), col, 1, 30);
      }
    }

    // ---------- players ----------
    const prevPos = [];
    function roundRect(x, y, w, hh, r) {
      g.beginPath();
      g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r);
      g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
    }
    // Each ninja gets an outline in their team's color: draw them once off-screen, make a solid
    // silhouette of that, and stamp the silhouette around the ninja before drawing them on top.
    const CELL = 92, CELL_FEET = 78, OUTLINE = 2;
    const OFFSETS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    const spriteCv = document.createElement('canvas'), tintCv = document.createElement('canvas');
    const spriteG = spriteCv.getContext('2d'), tintG = tintCv.getContext('2d');
    function sizeOutlineCanvases() { spriteCv.width = tintCv.width = spriteCv.height = tintCv.height = Math.ceil(CELL * scale); }
    function drawOutlined(i, x, feet, facing, walking, now, color) {
      spriteG.setTransform(scale, 0, 0, scale, 0, 0);
      spriteG.clearRect(0, 0, CELL, CELL);
      const geo = avatar.draw(spriteG, loadouts[i], { x: CELL / 2, y: CELL_FEET, size: 30, facing, walking, time: now, shadow: false });
      tintG.setTransform(1, 0, 0, 1, 0, 0);
      tintG.globalCompositeOperation = 'copy';
      tintG.drawImage(spriteCv, 0, 0);
      tintG.globalCompositeOperation = 'source-in';
      tintG.fillStyle = color;
      tintG.fillRect(0, 0, tintCv.width, tintCv.height);
      const dx = x - CELL / 2, dy = feet - CELL_FEET;
      for (const [ox, oy] of OFFSETS) g.drawImage(tintCv, dx + ox * OUTLINE, dy + oy * OUTLINE, CELL, CELL);
      g.drawImage(spriteCv, dx, dy, CELL, CELL);
      return { ...geo, cx: geo.cx + dx, top: geo.top + dy, feet: geo.feet + dy };
    }

    function drawPlayer(i, now, dt) {
      const slot = roster[i];
      const p = shown.p[i];
      if (!slot || !p) return;
      const [wx, wy, fx, fy, flags] = p;
      const team = TEAM[slot.team];
      const mine = i === mySlot;
      const prev = prevPos[i] || [wx, wy];
      const moving = Math.hypot(wx - prev[0], wy - prev[1]) / Math.max(dt, 1e-3) > 2.5;
      prevPos[i] = [wx, wy];
      const boots = flags & 1, dashing = flags & 2, fire = flags & 4;
      const kickT = (now - (kickAnim[i] || -1e9)) / 1000;
      const lunge = kickT < 0.16 ? Math.sin((kickT / 0.16) * Math.PI) * 5 : 0;
      const x = X(wx) + fx * lunge, feet = Y(wy) + 5 + fy * lunge;

      // ground ring in team colors (and a gold one for you)
      g.fillStyle = 'rgba(0,0,0,.22)';
      g.beginPath(); g.ellipse(x, feet, 15, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = team.main; g.globalAlpha = 0.45;
      g.beginPath(); g.ellipse(x, feet, 14, 5.5, 0, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = mine ? '#ffd23f' : team.light; g.lineWidth = mine ? 2.5 : 1.5;
      g.beginPath(); g.ellipse(x, feet, 14 + (mine ? Math.sin(now / 180) * 1.2 : 0), 5, 0, 0, Math.PI * 2); g.stroke();
      // facing pointer on the ring
      const fl = Math.hypot(fx, fy) || 1;
      const ax = x + (fx / fl) * 15, ay = feet + (fy / fl) * 6.5;
      g.fillStyle = mine ? '#ffd23f' : team.light;
      g.save(); g.translate(ax, ay); g.rotate(Math.atan2((fy / fl) * 6.5, (fx / fl) * 15));
      g.beginPath(); g.moveTo(4, 0); g.lineTo(-2.5, -3.5); g.lineTo(-2.5, 3.5); g.closePath(); g.fill();
      g.restore();
      // dash recharge arc under your ninja
      if (mine) {
        const k = Math.min(1, (now - myDashAt) / DASH_COOLDOWN_MS);
        if (k < 1) {
          g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2;
          g.beginPath(); g.ellipse(x, feet, 16, 7, 0, Math.PI * 0.5, Math.PI * 0.5 + Math.PI * 2 * k); g.stroke();
        }
      }
      if (boots) {
        g.fillStyle = 'rgba(255,215,60,.35)';
        g.beginPath(); g.ellipse(x, feet, 15, 6.5, 0, 0, Math.PI * 2); g.fill();
        if (moving && Math.random() < 0.6) sparks(x + rand(-6, 6), feet, '#ffd23f', 1, 40);
      }
      if (dashing) {
        dust(x, feet, 2);
        g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2;
        for (let s = -1; s <= 1; s++) {
          g.beginPath(); g.moveTo(x - fx * 10 + fy * s * 6, feet - 12 - fx * s * 6); g.lineTo(x - fx * 26 + fy * s * 6, feet - 12 - fx * s * 6); g.stroke();
        }
      } else if (moving && Math.random() < 0.08) dust(x, feet, 1);
      if (fire) {
        flame(x + rand(-8, 8), feet - rand(0, 26), 1, 2);
        const glow = g.createRadialGradient(x, feet - 12, 4, x, feet - 12, 22);
        glow.addColorStop(0, 'rgba(255,140,40,.35)'); glow.addColorStop(1, 'rgba(255,80,20,0)');
        g.fillStyle = glow; g.beginPath(); g.arc(x, feet - 12, 22, 0, Math.PI * 2); g.fill();
      }

      const facing = fx > 0.3 ? 1 : (fx < -0.3 ? -1 : 0);
      const geo = drawOutlined(i, x, feet, facing, moving, now, team.main);

      // kick swoosh
      if (kickT < 0.2) {
        const k = kickT / 0.2;
        const ang = Math.atan2(fy, fx);
        g.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`; g.lineWidth = 3;
        g.beginPath(); g.arc(x, feet - 3, 12 + k * 6, ang - 0.9, ang + 0.9); g.stroke();
      }

      // name tag
      const label = mine ? 'You' : slot.name;
      g.font = 'bold 10px sans-serif';
      const tw = g.measureText(label).width + 10;
      const ty = geo.top - (mine ? 22 : 8);
      g.fillStyle = mine ? '#ffd23f' : team.dark;
      roundRect(x - tw / 2, ty - 12, tw, 13, 6.5); g.fill();
      g.fillStyle = mine ? '#2b1d00' : '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, x, ty - 5.5);
      if (mine) {
        const bob = Math.sin(now / 200) * 2.5;
        g.fillStyle = '#ffd23f';
        g.beginPath(); g.moveTo(x - 5, geo.top - 8 + bob); g.lineTo(x + 5, geo.top - 8 + bob); g.lineTo(x, geo.top - 2 + bob); g.closePath(); g.fill();
      }
    }

    // ---------- overlays ----------
    function drawBanner(now) {
      if (banner && now < banner.until) {
        const t = (now - banner.at) / 1000;
        const scale = t < 0.25 ? 0.4 + (t / 0.25) * 0.8 : (t < 0.4 ? 1.2 - ((t - 0.25) / 0.15) * 0.2 : 1);
        g.save();
        g.translate(CW / 2, CH / 2 - 10);
        g.scale(scale, scale);
        g.fillStyle = 'rgba(10,12,18,.55)';
        roundRect(-200, -42, 400, banner.sub ? 92 : 70, 16); g.fill();
        g.font = 'bold 48px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 7; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(banner.text, 0, -6);
        g.fillStyle = banner.color || '#fff'; g.fillText(banner.text, 0, -6);
        if (banner.sub) {
          g.font = 'bold 15px sans-serif'; g.fillStyle = '#fff';
          g.fillText(banner.sub, 0, 32);
        }
        g.restore();
      } else if (running && now < pausedUntil && !fulltime) {
        const left = Math.ceil((pausedUntil - now) / 1000);
        g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.6)';
        const txt = left > 1 ? 'Ready…' : 'Kick off!';
        g.strokeText(txt, CW / 2, CH / 2 - 60); g.fillStyle = '#fff'; g.fillText(txt, CW / 2, CH / 2 - 60);
      }
      // floating pop texts
      pops = pops.filter((p) => now - p.at < 900);
      for (const p of pops) {
        const k = (now - p.at) / 900;
        g.globalAlpha = 1 - k;
        g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(p.text, p.x, p.y - k * 26);
        g.fillStyle = p.color; g.fillText(p.text, p.x, p.y - k * 26);
        g.globalAlpha = 1;
      }
    }

    function drawFulltime() {
      if (!fulltime) return;
      g.fillStyle = 'rgba(8,10,16,.6)'; g.fillRect(0, 0, CW, CH);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 40px sans-serif'; g.fillStyle = '#fff';
      g.fillText('FULL TIME', CW / 2, CH / 2 - 70);
      g.font = 'bold 54px sans-serif';
      g.fillStyle = TEAM[0].light; g.fillText(String(fulltime.sc[0]), CW / 2 - 60, CH / 2 - 10);
      g.fillStyle = '#fff'; g.fillText('–', CW / 2, CH / 2 - 10);
      g.fillStyle = TEAM[1].light; g.fillText(String(fulltime.sc[1]), CW / 2 + 60, CH / 2 - 10);
      const myTeam = mySlot >= 0 ? roster[mySlot].team : -2;
      const verdict = fulltime.winner === -1 ? 'A draw!' : (fulltime.winner === myTeam ? 'Your team wins!' : `${TEAM[fulltime.winner].name} wins`);
      g.font = 'bold 22px sans-serif'; g.fillStyle = fulltime.winner === myTeam ? '#ffd23f' : '#fff';
      g.fillText(verdict, CW / 2, CH / 2 + 40);
      const mine = fulltime.stats.find((st) => st.id === ctx.youId);
      if (mine) {
        g.font = '15px sans-serif'; g.fillStyle = '#e5e7eb';
        g.fillText(`You: ${mine.goals || 0} goals · ${mine.assists || 0} assists · ${mine.shots || 0} shots`, CW / 2, CH / 2 + 74);
      }
    }

    function drawFrame(now, dt) {
      g.setTransform(scale, 0, 0, scale, 0, 0);
      g.clearRect(0, 0, CW, CH);
      if (shake > 0.2) g.translate(rand(-shake, shake), rand(-shake, shake));
      shake *= Math.exp(-dt * 6);
      g.drawImage(bg, 0, 0, CW, CH);
      drawCrowd(now);
      drawGoal(0, now); drawGoal(1, now);
      drawPickups(now);
      if (shown) {
        // draw back to front so nearer ninjas overlap farther ones, with the ball in its place
        const order = roster.map((_, i) => i).sort((a, b) => (shown.p[a] ? shown.p[a][1] : 0) - (shown.p[b] ? shown.p[b][1] : 0));
        let ballDrawn = false;
        for (const i of order) {
          if (!ballDrawn && shown.p[i] && shown.b[1] < shown.p[i][1]) { drawBall(now, dt); ballDrawn = true; }
          drawPlayer(i, now, dt);
        }
        if (!ballDrawn) drawBall(now, dt);
      }
      drawParticles();
      drawBanner(now);
      drawFulltime();
    }

    function smooth(dt) {
      if (!target) return;
      if (!shown) shown = JSON.parse(JSON.stringify(target));
      const k = 1 - Math.exp(-dt * 22);
      shown.b = [shown.b[0] + (target.b[0] - shown.b[0]) * k, shown.b[1] + (target.b[1] - shown.b[1]) * k];
      if (netBall && performance.now() < netBall.until) shown.b = [netBall.x, netBall.y];
      shown.p = target.p.map((pt, i) => {
        const cur = shown.p[i] || pt;
        return [cur[0] + (pt[0] - cur[0]) * k, cur[1] + (pt[1] - cur[1]) * k, pt[2], pt[3], pt[4]];
      });
    }

    // ---------- HUD ----------
    const goalsEl = [h('span', { class: 'goals' }, '0'), h('span', { class: 'goals' }, '0')];
    const clockEl = h('div', { class: 'sc3-clock' }, '2:00');
    function buildBoard() {
      const side = (t) => {
        const mates = h('div', { class: 'mates' });
        roster.forEach((sl, i) => { if (sl.team === t) mates.append(avatar.portrait(loadouts[i], 30)); });
        return h('div', { class: `sc3-team ${TEAM[t].css}` }, mates, h('span', {}, TEAM[t].name), goalsEl[t]);
      };
      board.replaceChildren(side(0), clockEl, side(1));
    }
    function drawHud() {
      if (!target) return;
      goalsEl[0].textContent = String(target.sc[0]);
      goalsEl[1].textContent = String(target.sc[1]);
      const now = performance.now();
      const left = Math.max(0, Math.ceil(((golden ? goldenEndsAt : endsAt) - now) / 1000));
      const m = Math.floor(left / 60), s = String(left % 60).padStart(2, '0');
      const over = !running && (fulltime || endsAt);
      clockEl.classList.toggle('golden', golden && !over);
      if (over) clockEl.replaceChildren(h('small', {}, 'FULL TIME'), `${target.sc[0]}–${target.sc[1]}`);
      else clockEl.replaceChildren(h('small', {}, golden ? 'GOLDEN GOAL' : 'TIME'), `${m}:${s}`);
    }

    function botLoadout(team, i) {
      const gis = team === 0 ? ['#1e3a8a', '#2563eb'] : ['#7f1d1d', '#dc2626'];
      const bands = ['#f5f5f5', '#f5c542', '#22c55e', '#111827'];
      return { v: 1, id: 0, name: 'Bot', color: gis[i % 2], headband: bands[i % bands.length], belt: ['yellow', 'green', 'orange', 'blue'][i % 4], accessories: {} };
    }

    function loop(now) {
      frame = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      smooth(dt);
      stepParticles(dt);
      drawFrame(now, dt);
    }
    ctx.fit(canvas, 760, 484, (f) => {
      CW = f.w; CH = f.h; scale = f.scale;
      PX = 50 + (CW - 760) / 2; PY = 58 + (CH - 484) / 2;
      sizeOutlineCanvases();
      paintBackground();
      buildCrowd();
    });
    frame = requestAnimationFrame(loop);
    const hudTimer = setInterval(drawHud, 250);

    function slotPos(i) {
      const p = shown && shown.p[i];
      return p ? { x: X(p[0]), y: Y(p[1]) } : { x: CW / 2, y: CH / 2 };
    }

    return {
      onMessage(data) {
        const now = performance.now();
        if (data.type === 'begin') {
          field = data.field;
          roster = data.roster;
          const byId = new Map(ctx.players.map((p) => [p.id, p.loadout]));
          loadouts = roster.map((sl, i) => (sl.id != null && byId.get(sl.id)) || botLoadout(sl.team, i));
          mySlot = roster.findIndex((sl) => sl.id != null && sl.id === ctx.youId);
          running = true;
          endsAt = now + data.roundMs;
          pausedUntil = now + (data.kickoffMs || 0);
          paintBackground();
          buildCrowd();
          buildBoard();
          status.textContent = mySlot >= 0 ? `You play for ${TEAM[roster[mySlot].team].name}: attack the ${roster[mySlot].team === 0 ? 'right' : 'left'} goal.` : 'Kick off!';
          sendMove(true);
        } else if (data.type === 'state') {
          target = { b: data.b, p: data.p, pu: data.pu || [], sc: data.sc };
          if (!shown || snapNext) { shown = JSON.parse(JSON.stringify(target)); snapNext = false; }
        } else if (data.type === 'kick') {
          kickAnim[data.s] = now;
          const p = slotPos(data.s);
          if (shown) sparks(X(shown.b[0]), Y(shown.b[1]), data.fire ? '#ffae2b' : '#ffffff', data.fire ? 26 : 8, data.fire ? 220 : 120);
          if (data.fire) { shake = Math.max(shake, 6); pop('FIRE SHOT!', p.x, p.y - 34, '#ffae2b'); }
        } else if (data.type === 'shove') {
          const p = slotPos(data.t);
          dust(p.x, p.y + 5, 8);
          pop('Shoved!', p.x, p.y - 30, '#fff');
          shake = Math.max(shake, 2.5);
        } else if (data.type === 'post') {
          const x = X(data.x), y = Y(data.y);
          sparks(x, y, '#ffffff', 18, 200);
          pop('CLANG!', x + (data.x > field.w / 2 ? -26 : 26), y, '#e5e7eb');
          shake = Math.max(shake, 5);
        } else if (data.type === 'pickup') {
          const p = slotPos(data.s);
          const col = data.kind === 'boots' ? '#ffd23f' : '#ff7a2b';
          sparks(p.x, p.y, col, 22, 160);
          pop(data.kind === 'boots' ? '⚡ Speed Boots!' : '🔥 Fire Shot ready!', p.x, p.y - 36, col);
          const who = data.s === mySlot ? 'You' : roster[data.s].name;
          status.textContent = data.kind === 'boots' ? `${who} grabbed Speed Boots!` : `${who} has a Fire Shot. Next shot is a rocket!`;
        } else if (data.type === 'golden') {
          golden = true;
          goldenEndsAt = now + data.ms + 2200;
          pausedUntil = now + 2200;
          banner = { text: 'GOLDEN GOAL', sub: 'Level at full time. Next goal wins!', color: '#ffd23f', at: now, until: now + 2000 };
          status.textContent = 'Golden Goal: the next goal wins the match!';
          snapNext = true;
        } else if (data.type === 'goal') {
          // The goal the ball went into: team 0 scores in the right goal (side 1).
          const side = data.team === 0 ? 1 : 0;
          nets[side] = now;
          crowdHype[data.team] = now;
          shake = data.fire ? 14 : 10;
          confetti(side === 0 ? X(0) : X(field.w), Y(field.h / 2), data.team);
          const scorerName = data.scorerSlot === mySlot && mySlot >= 0 ? 'You' : data.scorer;
          let sub;
          if (data.own) sub = `Own goal by ${data.own}!`;
          else if (scorerName) {
            const how = data.fire ? ' with a fireball!' : (data.speed > 55 ? '. What a strike!' : '!');
            sub = `${scorerName} scored${how}${data.assist ? ` Assist: ${data.assist}` : ''}`;
          }
          else sub = `${TEAM[data.team].name} scores!`;
          banner = { text: data.golden ? 'GOLDEN GOAL!' : 'GOAL!', sub, color: data.golden ? '#ffd23f' : TEAM[data.team].light, at: now, until: now + 1900 };
          pausedUntil = now + 2200;
          status.textContent = sub;
          if (target) target.sc = data.sc;
          if (shown) netBall = { x: side === 0 ? -2.2 : field.w + 2.2, y: Math.max(field.h / 2 - field.goalHalf + 1.5, Math.min(field.h / 2 + field.goalHalf - 1.5, shown.b[1])), until: now + 1900 };
          snapNext = true;
          ballTrail.length = 0;
          lastBall = null;
          drawHud();
        } else if (data.type === 'fulltime') {
          fulltime = data;
          running = false;
          if (target) target.sc = data.sc;
          if (data.winner >= 0) { crowdHype[data.winner] = now; confetti(CW / 2, CH / 2, data.winner, 180); }
          drawHud();
        }
      },
      onResults() {
        running = false;
        keys.up = keys.down = keys.left = keys.right = false;
        status.textContent = 'Full time.';
        drawHud();
      },
      unmount() {
        running = false;
        cancelAnimationFrame(frame);
        clearInterval(hudTimer);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
      },
    };
  },
});
