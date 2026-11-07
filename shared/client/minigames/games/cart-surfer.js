// Cart Surfer (client). Server rules: server/src/minigames/games/cart-surfer.js
// Left / right arrows (or A / D, or the on-screen buttons) switch rails. The server decides
// coins, crashes and distance; this file only draws the track and sends rail moves.
ClubDojoMinigames.register({
  id: 'cart-surfer',

  mount(ctx) {
    const { h, el } = ctx;
    const W = 800;
    const H = 450;
    const CART_Y = H * 0.8; // screen height where your cart sits
    const PX_PER_UNIT = 1.1; // must feel right with the server's speed (about 140 to 260 units a second)
    const laneX = (lane) => W / 2 + lane * W * 0.2; // lane -1, 0, 1 across the middle of the canvas
    const RAIL_HALF = 30;

    const style = h('style', {}, `
      .cs { display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; padding: 8px; box-sizing: border-box; }
      .cs-hud { display: flex; gap: 18px; font-family: var(--display); font-size: 22px; }
      .cs-hud b { color: var(--gold); }
      .cs-canvas { width: 100%; max-width: 800px; height: auto; aspect-ratio: 800 / 450; border-radius: 14px; user-select: none; }
      .cs-touch { display: flex; gap: 16px; }
      .cs-touch .btn { min-width: 84px; font-size: 22px; }
      .cs-status { font-family: var(--display); font-size: 18px; min-height: 26px; text-align: center; }
    `);

    const coinsEl = h('b', {}, '0');
    const distEl = h('b', {}, '0m');
    const timeEl = h('b', {}, '--');
    const hud = h('div', { class: 'cs-hud' },
      h('span', {}, 'Coins ', coinsEl), h('span', {}, 'Distance ', distEl), h('span', {}, 'Time ', timeEl));
    const canvas = h('canvas', { class: 'cs-canvas', width: W, height: H });
    const status = h('div', { class: 'cs-status' }, 'Switch rails with the arrow keys or the buttons.');
    const left = h('button', { class: 'btn', onclick: () => move(-1) }, '◀');
    const right = h('button', { class: 'btn', onclick: () => move(1) }, '▶');
    el.append(style, h('div', { class: 'cs' }, hud, canvas, status, h('div', { class: 'cs-touch' }, left, right)));
    const g = canvas.getContext('2d');

    const loadouts = new Map(ctx.players.map((p) => [p.id, p.loadout]));
    let track = null; // { length, roundMs, items }
    let roundEnd = 0;
    let players = {}; // id -> { lane, y, finished, stunned, coins } as last sent by the server
    let shown = {}; // id -> { x, y } smoothed for drawing
    let got = new Set(); // coin ids you have picked up
    let popups = []; // { text, color, x, y, born }
    let myCoins = 0;
    let over = false;
    let raf = 0;
    let unmounted = false;

    function move(dir) {
      if (over) return;
      ctx.send({ type: 'move', dir });
    }

    function onKey(e) {
      if (e.repeat) return;
      const k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { e.preventDefault(); move(-1); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { e.preventDefault(); move(1); }
    }
    window.addEventListener('keydown', onKey);

    // Server snapshot: id -> [lane, y, finished, stunned, coins]
    function applyPlayers(snapshot) {
      for (const id of Object.keys(snapshot)) {
        const [lane, y, finished, stunned, coins] = snapshot[id];
        players[id] = { lane, y, finished: !!finished, stunned: !!stunned, coins };
        if (Number(id) === ctx.youId) myCoins = coins; // object keys are strings
      }
      for (const id of Object.keys(players)) if (!snapshot[id]) delete players[id];
    }

    function popup(text, color) {
      const me = shown[ctx.youId];
      if (!me) return;
      popups.push({ text, color, x: me.x, y: CART_Y - 40, born: performance.now() });
    }

    // ---- drawing helpers ----
    function toScreenY(y, camY) { return CART_Y - (y - camY) * PX_PER_UNIT; }

    function drawBackground(camY, t) {
      const sky = g.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#9fd4f5');
      sky.addColorStop(0.55, '#e6f6ff');
      sky.addColorStop(1, '#ffffff');
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H);

      // snowy banks on both sides, scrolling with the cart
      const scroll = (camY * PX_PER_UNIT) % 60;
      g.fillStyle = '#dbe9f5';
      g.fillRect(0, 0, W * 0.12, H);
      g.fillRect(W * 0.88, 0, W * 0.12, H);
      g.fillStyle = '#b9cfe2';
      for (let y = -60; y < H + 60; y += 60) {
        const yy = y + scroll;
        g.beginPath(); g.arc(W * 0.05, yy, 14, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(W * 0.95, yy + 30, 14, 0, Math.PI * 2); g.fill();
      }

      // track bed
      g.fillStyle = '#8a9aa8';
      g.fillRect(laneX(-1) - 60, 0, laneX(1) - laneX(-1) + 120, H);

      // sleepers scroll down toward the cart
      g.fillStyle = '#5c4632';
      for (let y = -40; y < H + 40; y += 40) {
        const yy = y + ((camY * PX_PER_UNIT) % 40);
        g.fillRect(laneX(-1) - 56, yy, laneX(1) - laneX(-1) + 112, 8);
      }

      // rails
      g.strokeStyle = '#4b5561';
      g.lineWidth = 5;
      for (const lane of [-1, 0, 1]) {
        for (const off of [-RAIL_HALF, RAIL_HALF]) {
          g.beginPath();
          g.moveTo(laneX(lane) + off, 0);
          g.lineTo(laneX(lane) + off, H);
          g.stroke();
        }
      }
    }

    function drawFinishLine(camY) {
      if (!track) return;
      const sy = toScreenY(track.length, camY);
      if (sy < -20 || sy > H + 20) return;
      const x0 = laneX(-1) - 60;
      const width = laneX(1) - laneX(-1) + 120;
      for (let i = 0; i < 10; i++) {
        g.fillStyle = i % 2 ? '#222' : '#fff';
        g.fillRect(x0 + (i * width) / 10, sy - 8, width / 10, 16);
      }
    }

    function drawItem(item, camY) {
      if (item.kind === 'coin' && got.has(item.n)) return;
      const sy = toScreenY(item.y, camY);
      if (sy < -30 || sy > H + 30) return;
      const x = laneX(item.lane);
      if (item.kind === 'coin') {
        g.fillStyle = '#ffd700';
        g.beginPath(); g.arc(x, sy, 14, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#b8860b';
        g.lineWidth = 3;
        g.beginPath(); g.arc(x, sy, 9, 0, Math.PI * 2); g.stroke();
      } else {
        // rock, with a shadow so it reads as lying on the rail
        g.fillStyle = 'rgba(0,0,0,.18)';
        g.beginPath(); g.ellipse(x + 4, sy + 6, 30, 12, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#6e6e6e';
        g.beginPath();
        g.moveTo(x - 28, sy + 8);
        g.lineTo(x - 18, sy - 22);
        g.lineTo(x + 6, sy - 30);
        g.lineTo(x + 26, sy - 14);
        g.lineTo(x + 28, sy + 8);
        g.closePath();
        g.fill();
        g.fillStyle = '#8f8f8f';
        g.beginPath(); g.arc(x - 4, sy - 16, 6, 0, Math.PI * 2); g.fill();
      }
    }

    function drawCart(id, p, camY, t) {
      const x = p.x;
      let y = toScreenY(p.y, camY);
      if (p.stunned) y += Math.sin(t / 30) * 3;
      const isMe = Number(id) === ctx.youId;
      g.save();
      g.globalAlpha = isMe ? 1 : 0.75;

      // cart body
      g.fillStyle = isMe ? '#a0703f' : '#7d5a3c';
      g.fillRect(x - 30, y - 6, 60, 30);
      g.fillStyle = '#5c4632';
      g.fillRect(x - 32, y - 10, 64, 6);
      // wheels
      g.fillStyle = '#222';
      g.beginPath(); g.arc(x - 20, y + 26, 7, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + 20, y + 26, 7, 0, Math.PI * 2); g.fill();

      // rider
      const loadout = loadouts.get(id);
      if (loadout) {
        ctx.avatar.draw(g, loadout, { x, y: y + 4, size: 42, facing: 1, walking: false, time: t });
      }

      if (p.stunned) {
        g.fillStyle = 'rgba(255,255,255,.8)';
        for (let i = 0; i < 3; i++) {
          g.beginPath(); g.arc(x - 22 + i * 22, y - 22 - (t / 60 + i * 9) % 14, 4, 0, Math.PI * 2); g.fill();
        }
      }

      if (!isMe) {
        const name = ctx.players.find((pl) => pl.id === id)?.name || '';
        g.fillStyle = '#1b1b1b';
        g.font = '600 14px sans-serif';
        g.textAlign = 'center';
        g.fillText(name, x, y - 36);
      }
      g.restore();
    }

    function drawPopups(now) {
      popups = popups.filter((p) => now - p.born < 900);
      for (const p of popups) {
        const age = (now - p.born) / 900;
        g.globalAlpha = 1 - age;
        g.fillStyle = p.color;
        g.font = '700 22px sans-serif';
        g.textAlign = 'center';
        g.fillText(p.text, p.x, p.y - age * 40);
      }
      g.globalAlpha = 1;
    }

    function render(t) {
      if (unmounted) return;
      // smooth the server's 10 updates a second into motion on screen
      for (const id of Object.keys(players)) {
        const target = players[id];
        const tx = laneX(target.lane);
        const cur = shown[id];
        if (!cur || Math.abs(cur.y - target.y) > 300) shown[id] = { x: tx, y: target.y };
        else {
          cur.x += (tx - cur.x) * 0.25;
          cur.y += (target.y - cur.y) * 0.35;
        }
      }
      for (const id of Object.keys(shown)) if (!players[id]) delete shown[id];

      const me = shown[ctx.youId];
      const camY = me ? me.y : 0;
      g.clearRect(0, 0, W, H);
      drawBackground(camY, t);
      drawFinishLine(camY);
      if (track) for (const item of track.items) drawItem(item, camY);
      for (const id of Object.keys(shown)) {
        if (Number(id) === ctx.youId) continue;
        drawCart(id, { ...shown[id], stunned: players[id] && players[id].stunned }, camY, t);
      }
      if (me) drawCart(ctx.youId, { ...me, stunned: players[ctx.youId] && players[ctx.youId].stunned }, camY, t);
      drawPopups(performance.now());

      if (me) distEl.textContent = `${Math.min(Math.round(me.y), track ? track.length : Infinity)}m`;
      if (roundEnd && !over) timeEl.textContent = `${Math.max(0, Math.ceil((roundEnd - performance.now()) / 1000))}s`;
      coinsEl.textContent = String(myCoins);
      raf = requestAnimationFrame(render);
    }

    raf = requestAnimationFrame(render);

    return {
      onMessage(data) {
        if (data.type === 'track') {
          track = data;
          got = new Set();
          roundEnd = performance.now() + data.roundMs;
          status.textContent = 'Grab the coins. Watch for rockfalls!';
        } else if (data.type === 'state') {
          applyPlayers(data.players);
        } else if (data.type === 'got') {
          got.add(data.n);
          myCoins = data.coins;
          popup('+1', '#b8860b');
        } else if (data.type === 'crash') {
          myCoins = data.coins;
          popup('Crash!', '#c0392b');
        } else if (data.type === 'finish') {
          if (data.id === ctx.youId) status.textContent = `Finished in place ${data.place}!`;
        } else if (data.type === 'over') {
          applyPlayers(data.players); // the final positions, so the last few metres are not lost
          over = true;
          timeEl.textContent = 'Done';
          status.textContent = 'Round over. Hang on, the results are coming.';
        }
      },
      onResults() {},
      unmount() {
        unmounted = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
      },
    };
  },
});
