// Go-Kart Race (client). Draws the track and karts from the server's snapshots and sends steering/pedal states.
// Server rules: server/src/minigames/games/go-kart-race.js
ClubDojoMinigames.register({
  id: 'go-kart-race',

  mount(ctx) {
    const { h, el, avatar } = ctx;
    const timers = new Set();
    const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

    const style = h('style', {}, `
      .gk { display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; padding: 6px; box-sizing: border-box; }
      .gk-players { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
      .gk-p { display: flex; flex-direction: column; align-items: center; background: rgba(255,255,255,.08); border-radius: 10px; padding: 4px 8px; min-width: 80px; transition: opacity .3s; }
      .gk-p.out { opacity: .45; }
      .gk-p b { font-size: 12px; } .gk-p small { opacity: .85; }
      .gk-hud { display: flex; gap: 18px; font-family: var(--display); font-size: 20px; letter-spacing: .04em; justify-content: center; }
      .gk-status { font-family: var(--display); font-size: 26px; min-height: 32px; text-align: center; }
      .gk-stage { position: relative; width: min(900px, 100%); flex: 1 1 auto; min-height: 0; display: flex; justify-content: center; align-items: center; }
      .gk-canvas { max-width: 100%; max-height: 100%; width: auto; height: auto; aspect-ratio: 1000 / 640; border-radius: 12px; box-shadow: 0 6px 0 rgba(0,0,0,.35); background: #2f5d2a; }
      .gk-help { font-size: 12px; opacity: .75; text-align: center; }
    `);

    const status = h('div', { class: 'gk-status' }, 'Get ready...');
    const hud = h('div', { class: 'gk-hud' });
    const canvas = h('canvas', { class: 'gk-canvas', width: 1000, height: 640 });
    const ctx2d = canvas.getContext('2d');
    const playersRow = h('div', { class: 'gk-players' });
    const help = h('div', { class: 'gk-help' }, 'Drive: Arrow keys or WASD. Up / W gas, Down / S brake, Left and Right to steer.');
    el.append(style, h('div', { class: 'gk' }, playersRow, hud, status, h('div', { class: 'gk-stage' }, canvas), help));

    // Player cards with portraits from each ninja's loadout.
    const cards = new Map();
    for (const p of ctx.players) {
      const place = h('small', {}, '—');
      const card = h('div', { class: 'gk-p' }, avatar.portrait(p.loadout, 48), h('b', {}, p.id === ctx.youId ? `${p.name} (you)` : p.name), place);
      cards.set(p.id, { card, place });
      playersRow.append(card);
    }

    let track = null;     // centerline points from the server
    let halfWidth = 52;
    let laps = 3;
    let length = 1;
    let world = { w: 1000, h: 640 };
    let trackLayer = null; // pre-drawn background (grass, road, lines)
    let karts = new Map(); // id -> { color, target: {x,y,h}, shown: {x,y,h}, lap, f, o, active, v }
    let colorById = new Map();
    let raceEndsAt = 0;
    let running = false;
    let finishedMe = false;
    let frame = 0;

    // Keyboard state
    const keys = { up: false, down: false, left: false, right: false };
    let lastSent = '';

    function sendControls() {
      const c = {
        steer: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
        gas: keys.up,
        brake: keys.down,
      };
      const sig = `${c.steer}|${c.gas}|${c.brake}`;
      if (sig === lastSent) return;
      lastSent = sig;
      ctx.send({ type: 'ctl', ...c });
    }

    const KEYMAP = {
      ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    };
    function onKeyDown(e) {
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault();
      if (!keys[k]) { keys[k] = true; if (running && !finishedMe) sendControls(); }
    }
    function onKeyUp(e) {
      const k = KEYMAP[e.code];
      if (!k) return;
      keys[k] = false;
      if (running) sendControls();
    }
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    function buildTrackLayer() {
      const c = document.createElement('canvas');
      c.width = world.w; c.height = world.h;
      const g = c.getContext('2d');
      g.fillStyle = '#2f5d2a';
      g.fillRect(0, 0, c.width, c.height);
      // Road: stroke the closed centerline with a thick line; then add the edge line and dashed center line.
      const path = () => {
        g.beginPath();
        track.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.closePath();
      };
      path();
      g.lineJoin = 'round';
      g.strokeStyle = '#5b5f68'; g.lineWidth = halfWidth * 2; g.stroke();
      path(); g.strokeStyle = '#f3efe2'; g.lineWidth = halfWidth * 2 + 6; g.globalCompositeOperation = 'destination-over'; g.stroke();
      g.globalCompositeOperation = 'source-over';
      path(); g.strokeStyle = '#5b5f68'; g.lineWidth = halfWidth * 2; g.stroke();
      path(); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 3; g.setLineDash([18, 14]); g.stroke(); g.setLineDash([]);
      // Start/finish line across the road at point 0.
      const a = track[0], b = track[1];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len;
      g.strokeStyle = '#ffffff'; g.lineWidth = 6;
      g.beginPath();
      g.moveTo(a.x + nx * halfWidth, a.y + ny * halfWidth);
      g.lineTo(a.x - nx * halfWidth, a.y - ny * halfWidth);
      g.stroke();
      trackLayer = c;
    }

    function drawKart(k, id) {
      const { x, y, h: heading } = k.shown;
      const player = ctx.players.find((p) => p.id === id);
      ctx2d.save();
      ctx2d.translate(x, y);
      ctx2d.rotate(heading);
      // Shadow
      ctx2d.fillStyle = 'rgba(0,0,0,.3)';
      ctx2d.beginPath(); ctx2d.ellipse(2, 3, 16, 11, 0, 0, Math.PI * 2); ctx2d.fill();
      // Body
      ctx2d.fillStyle = k.color;
      ctx2d.beginPath(); ctx2d.roundRect(-14, -10, 28, 20, 6); ctx2d.fill();
      ctx2d.strokeStyle = 'rgba(0,0,0,.5)'; ctx2d.lineWidth = 2; ctx2d.stroke();
      // Wheels
      ctx2d.fillStyle = '#111';
      ctx2d.fillRect(-10, -13, 6, 4); ctx2d.fillRect(-10, 9, 6, 4); ctx2d.fillRect(6, -13, 6, 4); ctx2d.fillRect(6, 9, 6, 4);
      // Driver's head (ninja-black with the headband color of their look, if available)
      ctx2d.fillStyle = '#20262e';
      ctx2d.beginPath(); ctx2d.arc(-1, 0, 6, 0, Math.PI * 2); ctx2d.fill();
      const band = (player && player.loadout && player.loadout.headband) || '#e8453c';
      ctx2d.fillStyle = band;
      ctx2d.fillRect(-7, -2, 13, 3);
      ctx2d.restore();

      // Name tag above the kart, upright.
      ctx2d.save();
      ctx2d.font = '600 13px system-ui, sans-serif';
      ctx2d.textAlign = 'center';
      const label = player ? player.name : '';
      const w = ctx2d.measureText(label).width + 10;
      ctx2d.fillStyle = 'rgba(0,0,0,.55)';
      ctx2d.beginPath(); ctx2d.roundRect(x - w / 2, y - 34, w, 18, 6); ctx2d.fill();
      ctx2d.fillStyle = '#fff';
      ctx2d.fillText(label, x, y - 21);
      ctx2d.restore();
    }

    function render() {
      frame = requestAnimationFrame(render);
      if (!trackLayer) return;
      ctx2d.clearRect(0, 0, world.w, world.h);
      ctx2d.drawImage(trackLayer, 0, 0);
      // Ease each kart toward the latest server position so 20 Hz updates look smooth.
      for (const [id, k] of karts) {
        k.shown.x += (k.target.x - k.shown.x) * 0.35;
        k.shown.y += (k.target.y - k.shown.y) * 0.35;
        let dh = k.target.h - k.shown.h;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        k.shown.h += dh * 0.35;
        if (k.active) drawKart(k, id);
      }
    }
    frame = requestAnimationFrame(render);

    function updateHud() {
      const left = Math.max(0, Math.ceil((raceEndsAt - Date.now()) / 1000));
      const me = karts.get(ctx.youId);
      const ordered = [...karts.values()].filter((k) => k.active).sort((a, b) => b.progress - a.progress);
      const pos = me ? ordered.indexOf(me) + 1 : 0;
      hud.textContent = '';
      hud.append(
        h('span', {}, me ? `Lap ${Math.min(me.lap + 1, laps)}/${laps}` : ''),
        h('span', {}, pos ? `Place ${pos}/${ordered.length}` : ''),
        h('span', {}, running ? `${left}s` : ''),
      );
    }

    const hudTimer = setInterval(() => { if (running) updateHud(); }, 250);

    function updateSnapshot(list) {
      for (const s of list) {
        let k = karts.get(s.id);
        if (!k) continue;
        k.target = { x: s.x, y: s.y, h: s.h };
        if (!k.inited) { k.shown = { x: s.x, y: s.y, h: s.h }; k.inited = true; }
        k.lap = s.lap;
        k.progress = s.p; // distance along the track (unwrapped), used for place ordering
        k.v = s.v;
        k.f = s.f;
        k.o = s.o;
        k.active = !!s.active;
        const c = cards.get(s.id);
        if (c) {
          c.card.classList.toggle('out', !k.active);
          c.place.textContent = k.f ? 'Finished' : (s.o ? 'Off road' : `Lap ${Math.min(s.lap + 1, laps)}/${laps}`);
        }
      }
    }

    return {
      onMessage(m) {
        switch (m.type) {
          case 'go': {
            track = m.track;
            halfWidth = m.halfWidth;
            laps = m.laps;
            length = m.length;
            world = m.world;
            canvas.width = world.w; canvas.height = world.h;
            buildTrackLayer();
            colorById = new Map(m.karts.map((k) => [k.id, k.color]));
            karts = new Map(ctx.players.map((p) => [p.id, { color: colorById.get(p.id) || '#999', active: true, lap: 0, progress: 0, shown: { x: 0, y: 0, h: 0 }, target: { x: 0, y: 0, h: 0 } }]));
            running = true;
            raceEndsAt = Date.now() + m.timeMs;
            status.textContent = 'GO!';
            later(1200, () => { if (running) status.textContent = ''; });
            updateHud();
            break;
          }
          case 'state':
            if (!trackLayer) break;
            updateSnapshot(m.karts);
            break;
          case 'finish':
            if (m.id === ctx.youId) {
              finishedMe = true;
              status.textContent = `Finished! Place ${m.place}`;
              sendControls();
            } else {
              const c = cards.get(m.id);
              if (c) c.place.textContent = `Finished #${m.place}`;
            }
            break;
          default:
        }
      },
      onResults(results) {
        running = false;
      },
      unmount() {
        running = false;
        cancelAnimationFrame(frame);
        clearInterval(hudTimer);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        for (const t of timers) clearTimeout(t);
        timers.clear();
      },
    };
  },
});
