// The match screen for Turncoat and Ring Out. The server runs the match and sends a script of events
// for each move; this file plays that script as animation, then settles on the server's board.
(function () {
  const D = window.ClubDojoCardData;
  const R = window.ClubDojoCardRules;
  const REACTIONS = ['👍', '😮', '😂', '😤', '🙇', '🔥'];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const VEC = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  const ARROW = { n: '▲', e: '▶', s: '▼', w: '◀' };

  function mount(ctx, modeId) {
    const { h, el: stage, avatar: Avatar, toast } = ctx;
    const render = window.ClubDojoCards.renderCard;
    const mode = D.MODES[modeId];
    const isPush = modeId === 'ring-out';

    let view = null, you = 1, seats = null;
    let selected = null, armed = false, hoverCell = -1, busy = true, ended = false, deadlineAt = null, turnMs = 40000;
    const pieces = new Map(); // uid -> element on the board
    const queue = [];
    let draining = false, disposed = false;

    // ---------- sound ----------
    let actx = null, muted = false;
    try { muted = localStorage.getItem('clubdojo:cards:mute') === '1'; } catch {}
    function tone(freq, dur, vol, type = 'triangle', delay = 0, slide = 0) {
      if (muted) return;
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === 'suspended') actx.resume().catch(() => {});
        const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t);
        if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.05);
      } catch {}
    }
    const sfx = {
      place() { tone(isPush ? 90 : 240, 0.16, isPush ? 0.2 : 0.09, isPush ? 'sine' : 'triangle', 0, isPush ? -50 : -60); },
      flip(depth = 0) { const f = 440 * Math.pow(1.19, depth); tone(f, 0.12, 0.08, 'triangle', 0, f * 0.5); tone(f * 1.5, 0.2, 0.05, 'triangle', 0.08); },
      shove() { tone(70, 0.24, 0.26, 'sine', 0, -35); tone(150, 0.08, 0.08, 'square', 0, -80); },
      ko() { tone(196, 0.8, 0.12, 'triangle', 0, -120); tone(98, 0.5, 0.2, 'sine'); tone(523, 0.3, 0.06, 'square', 0.1, 260); },
      hold() { tone(180, 0.08, 0.05, 'square'); },
      ward() { tone(900, 0.3, 0.04, 'sawtooth', 0, -700); },
      whirl() { tone(300, 0.25, 0.06, 'sine', 0, 500); },
      rally() { tone(523, 0.12, 0.06); tone(784, 0.2, 0.06, 'triangle', 0.08); },
      burst() { tone(220, 0.5, 0.1, 'sawtooth', 0, 880); },
      turn() { tone(660, 0.12, 0.05); tone(880, 0.14, 0.05, 'triangle', 0.08); },
      tick() { tone(1000, 0.04, 0.04, 'square'); },
      win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.4, 0.09, 'triangle', i * 0.13)); },
      lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.5, 0.08, 'triangle', i * 0.2)); },
    };

    // ---------- layout ----------
    const ui = {};
    const seatPanel = (cls) => {
      const p = {};
      p.root = h('div', { class: `dl-seat ${cls}` },
        p.face = h('div', { class: 'dl-face' }),
        h('div', { class: 'dl-who' }, p.name = h('b'), p.sub = h('small')),
        p.hand = h('div', { class: 'dl-backs' }),
        p.ki = h('span', { class: 'dl-ki', title: 'Ki Burst' }, '気'),
        p.bubble = h('div', { class: 'dl-bubble', hidden: true }));
      return p;
    };
    ui.opp = seatPanel('opp');
    ui.me = seatPanel('you');
    ui.score = { you: h('b', { class: 'dl-num' }, '0'), opp: h('b', { class: 'dl-num' }, '0') };
    ui.turn = h('div', { class: 'dl-turn' });
    ui.clock = h('i');
    ui.detail = h('small', { class: 'dl-detail' });
    ui.board = h('div', { class: 'dl-board' });
    ui.layer = h('div', { class: 'dl-layer' });
    ui.fx = h('div', { class: 'dl-fx' });
    ui.boardWrap = h('div', { class: 'dl-boardwrap' }, ui.board, ui.layer, ui.fx);
    ui.hand = h('div', { class: 'dl-hand' });
    ui.info = h('div', { class: 'dl-info' });
    ui.burst = h('button', { class: 'dl-burst', title: 'Ki Burst: +1 on every side of the next card. Once a match. (B)', onclick: () => toggleBurst() }, h('span', {}, '気'), 'Ki Burst');
    ui.mute = h('button', { class: 'dl-mini', title: 'Sound', 'aria-label': 'Toggle sound', onclick: () => { muted = !muted; ui.mute.textContent = muted ? '🔇' : '🔊'; try { localStorage.setItem('clubdojo:cards:mute', muted ? '1' : '0'); } catch {} } }, muted ? '🔇' : '🔊');
    ui.reacts = h('div', { class: 'dl-reacts' }, REACTIONS.map((e) => h('button', { class: 'dl-mini', 'aria-label': `React ${e}`, onclick: () => ctx.send({ type: 'react', emote: e }) }, e)));
    ui.banner = h('div', { class: 'dl-banner', hidden: true });
    ui.root = h('div', { class: `dl dl-${modeId}` },
      h('div', { class: 'dl-bg' }),
      h('div', { class: 'dl-main' },
        h('aside', { class: 'dl-left' }, ui.opp.root, h('div', { class: 'dl-scorebox' },
          h('div', { class: 'dl-scorerow opp' }, ui.score.opp), ui.komi = h('span', { class: 'dl-vs' }, 'POINTS'), h('div', { class: 'dl-scorerow you' }, ui.score.you)), ui.detail, ui.me.root),
        h('section', { class: 'dl-center' }, h('div', { class: 'dl-turnbar' }, ui.turn, h('div', { class: 'dl-clock' }, ui.clock)), ui.boardWrap),
        h('aside', { class: 'dl-right' }, ui.info, h('div', { class: 'dl-tools' }, ui.reacts, ui.mute))),
      h('footer', { class: 'dl-foot' }, ui.burst, ui.hand),
      ui.banner);
    stage.append(ui.root);

    let cellPx = 96, cardPx = 88;
    const cellEls = [];
    function fit() {
      if (!view) return;
      const main = ui.root.querySelector('.dl-center');
      const w = main.clientWidth - 24, hgt = main.clientHeight - 44;
      cellPx = Math.floor(Math.max(54, Math.min(138, Math.min(w / view.w, hgt / view.h) - 6)));
      cardPx = Math.round(cellPx * 0.94);
      ui.boardWrap.style.setProperty('--cell', `${cellPx}px`);
      ui.boardWrap.style.setProperty('--cs', `${cardPx}px`);
      ui.board.style.gridTemplateColumns = `repeat(${view.w}, ${cellPx}px)`;
      const handW = ui.root.querySelector('.dl-foot').clientWidth - 150;
      ui.hand.style.setProperty('--cs', `${Math.round(Math.max(76, Math.min(128, Math.min(handW / 3.4, ui.root.clientHeight * 0.17))))}px`);
      for (const [uid, node] of pieces) placeNode(node, Number(node.dataset.cell), uid);
    }
    const ro = new ResizeObserver(fit);
    ro.observe(stage);

    const GAP = 6;
    const cellPos = (i) => {
      const x = i % view.w, y = Math.floor(i / view.w);
      return [x * (cellPx + GAP) + (cellPx - cardPx) / 2, y * (cellPx + GAP) + (cellPx - cardPx) / 2];
    };
    function placeNode(node, i) { const [x, y] = cellPos(i); node.dataset.cell = i; node.style.transform = `translate(${x}px, ${y}px)`; }

    function buildBoard() {
      ui.board.replaceChildren();
      cellEls.length = 0;
      view.cells.forEach((c, i) => {
        const cell = h('button', { class: `dl-cell t-${c.t}`, 'aria-label': `Square ${i + 1}`, onclick: () => clickCell(i), onmouseenter: () => { hoverCell = i; drawPreview(); }, onmouseleave: () => { hoverCell = -1; drawPreview(); } });
        if (c.t === 'shrine') cell.append(h('span', { class: 'dl-shrine' }, '⛩️'));
        if (c.t === 'element') { cell.style.setProperty('--el', D.ELEMENTS[c.el].color); cell.append(h('span', { class: 'dl-tile' }, D.ELEMENTS[c.el].icon)); }
        if (c.t === 'rock') cell.disabled = true;
        if (c.t === 'pit') cell.disabled = true;
        ui.board.append(cell);
        cellEls.push(cell);
      });
    }

    // ---------- pieces ----------
    const seatClass = (owner) => (owner === you ? 'mine' : 'theirs');
    function liveValues(i, card) { return [0, 1, 2, 3].map((d) => R.sideValue(view, i, card, d)); }
    function makePiece(card, i) {
      const wrap = h('div', { class: `dl-piece ${seatClass(card.owner)}` });
      wrap.dataset.uid = card.uid;
      const inner = render(card.id, { values: liveValues(i, card), ward: !!card.ward, burst: !!card.burst });
      wrap.append(inner);
      ui.layer.append(wrap);
      pieces.set(card.uid, wrap);
      placeNode(wrap, i);
      return wrap;
    }
    function refreshPiece(card, i) {
      const node = pieces.get(card.uid);
      if (!node) return;
      node.className = `dl-piece ${seatClass(card.owner)}`;
      const fresh = render(card.id, { values: liveValues(i, card), ward: !!card.ward, burst: !!card.burst });
      node.replaceChildren(fresh);
      if (Number(node.dataset.cell) !== i) placeNode(node, i);
    }
    function settle() {
      const live = new Set();
      view.cells.forEach((c, i) => {
        if (!c.card) return;
        live.add(c.card.uid);
        if (!pieces.has(c.card.uid)) makePiece(c.card, i); else refreshPiece(c.card, i);
      });
      for (const [uid, node] of pieces) if (!live.has(uid)) { node.remove(); pieces.delete(uid); }
    }

    // ---------- effects ----------
    function cellCentre(i) { const [x, y] = cellPos(i); return [x + cardPx / 2, y + cardPx / 2]; }
    function fxAt(i, cls, text, dur = 900) {
      const [x, y] = cellCentre(i);
      const n = h('div', { class: `dl-pop ${cls}`, style: { left: `${x}px`, top: `${y}px` } }, text || '');
      ui.fx.append(n);
      setTimeout(() => n.remove(), dur);
      return n;
    }
    function callout(text, cls = '') {
      const n = h('div', { class: `dl-callout ${cls}` }, text);
      ui.boardWrap.append(n);
      setTimeout(() => n.remove(), 1100);
    }
    function shake(cls = 'shake') {
      ui.boardWrap.classList.remove('shake', 'bigshake');
      void ui.boardWrap.offsetWidth;
      ui.boardWrap.classList.add(cls);
    }
    function clash(from, to, atk, def, won) {
      const [ax, ay] = cellCentre(from), [bx, by] = cellCentre(to);
      const n = h('div', { class: `dl-clash${won ? ' won' : ''}`, style: { left: `${(ax + bx) / 2}px`, top: `${(ay + by) / 2}px` } }, h('b', {}, atk), h('i', {}, won ? '>' : '≤'), h('b', {}, def));
      ui.fx.append(n);
      setTimeout(() => n.remove(), 800);
    }
    function dust(i, dir) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const [x, y] = cellCentre(i);
        const p = h('div', { class: 'dl-dust', style: { left: `${x}px`, top: `${y}px`, '--dx': `${Math.cos(a) * cardPx * 0.7 + (dir ? VEC[dir][0] * 20 : 0)}px`, '--dy': `${Math.sin(a) * cardPx * 0.7 + (dir ? VEC[dir][1] * 20 : 0)}px` } });
        ui.fx.append(p);
        setTimeout(() => p.remove(), 600);
      }
    }

    // Applies one event to the local board and plays its animation. Returns when it is finished.
    async function playEvent(e) {
      switch (e.type) {
        case 'place': {
          view.cells[e.cell].card = { ...e.card };
          const node = makePiece(e.card, e.cell);
          node.classList.add(isPush ? 'slam' : 'drop');
          if (e.burst) { sfx.burst(); callout('KI BURST!', 'gold'); fxAt(e.cell, 'ring gold', '', 700); }
          sfx.place();
          if (isPush) { shake(); dust(e.cell); }
          await wait(isPush ? 300 : 260);
          node.classList.remove('slam', 'drop');
          break;
        }
        case 'whirl': {
          view.cells[e.cell].card.rot = e.rot;
          const node = pieces.get(view.cells[e.cell].card.uid);
          sfx.whirl();
          if (node) node.classList.add('spin');
          await wait(240);
          refreshPiece(view.cells[e.cell].card, e.cell);
          if (node) node.classList.remove('spin');
          fxAt(e.cell, 'label', '🌀');
          break;
        }
        case 'rally': {
          view.cells[e.cell].card.boost = e.boost;
          refreshPiece(view.cells[e.cell].card, e.cell);
          sfx.rally();
          fxAt(e.cell, 'up', '+1');
          await wait(180);
          break;
        }
        case 'hold':
        case 'blocked': {
          sfx.hold();
          clash(e.from, e.cell, e.atk, e.type === 'blocked' ? '🪨' : e.def, false);
          await wait(120);
          break;
        }
        case 'ward': {
          sfx.ward();
          clash(e.from, e.cell, e.atk, e.def, true);
          view.cells[e.cell].card.ward = false;
          refreshPiece(view.cells[e.cell].card, e.cell);
          fxAt(e.cell, 'smoke', '💨', 800);
          callout('SMOKE BOMB!', 'grey');
          await wait(420);
          break;
        }
        case 'flip': {
          const card = view.cells[e.cell].card;
          const node = pieces.get(card.uid);
          clash(e.from, e.cell, e.atk, e.def, true);
          sfx.flip(e.depth);
          if (node) node.classList.add('flipping');
          await wait(190);
          card.owner = e.owner;
          view.p[e.owner].flips += 1;
          refreshPiece(card, e.cell);
          if (node) node.classList.add('flipping');
          updateScore();
          await wait(190);
          if (node) node.classList.remove('flipping');
          fxAt(e.cell, 'ring', '', 500);
          if (e.depth > 0) callout(`CHAIN ×${e.depth + 1}!`, 'gold');
          else callout(e.owner === you ? 'TURNED!' : 'BETRAYED!', e.owner === you ? '' : 'red');
          await wait(60);
          break;
        }
        case 'shove': {
          sfx.shove();
          shake();
          for (const m of e.moves) {
            const card = view.cells[m.from].card;
            view.cells[m.to].card = card;
            view.cells[m.from].card = null;
            const node = pieces.get(card.uid);
            if (node) { node.classList.add('sliding'); placeNode(node, m.to); }
            dust(m.to, e.dir);
          }
          updateScore();
          await wait(320);
          for (const m of e.moves) { const c = view.cells[m.to].card; const node = c && pieces.get(c.uid); if (node) node.classList.remove('sliding'); }
          callout('SHOVE!');
          await wait(90);
          break;
        }
        case 'ko': {
          const node = pieces.get(e.card.uid);
          view.cells[e.cell].card = null;
          view.p[e.scorer].ko += 1;
          sfx.ko();
          shake('bigshake');
          if (node) {
            const [x, y] = cellPos(e.cell);
            const [dx, dy] = VEC[e.dir];
            pieces.delete(e.card.uid);
            node.classList.add(e.into === 'pit' ? 'falling' : 'flying');
            node.style.transform = e.into === 'pit'
              ? `translate(${x + dx * cellPx}px, ${y + dy * cellPx}px) scale(.1) rotate(200deg)`
              : `translate(${x + dx * cellPx * 3}px, ${y + dy * cellPx * 3 - 40}px) rotate(${dx * 240 + dy * 120 + 90}deg) scale(.7)`;
            setTimeout(() => node.remove(), 620);
          }
          updateScore();
          callout(e.into === 'pit' ? 'DOWN THE PIT!' : 'RING OUT!', e.scorer === you ? 'gold' : 'red');
          await wait(480);
          break;
        }
        default:
      }
    }

    // ---------- turn state and drawing ----------
    function updateScore() {
      if (!view) return;
      const s = R.score(view), opp = R.other(you);
      ui.score.you.textContent = s[you];
      ui.score.opp.textContent = s[opp];
      ui.detail.textContent = isPush
        ? `Shrines ${s.shrines[you]}–${s.shrines[opp]} · Knockouts ${s.ko[you]}–${s.ko[opp]}`
        : `Cards ${s.cards[you]}–${s.cards[opp]} · Shrines ${s.shrines[you]}–${s.shrines[opp]}`;
      for (const [panel, n] of [[ui.me, you], [ui.opp, opp]]) panel.ki.classList.toggle('spent', !view.p[n].burst);
    }
    const myTurn = () => view && !view.over && view.turn === you && !busy && !ended;

    function drawHand() {
      const hand = view.p[you].hand;
      ui.hand.replaceChildren(...hand.map((c, i) => {
        const def = D.getCard(c.id);
        const b = h('button', { class: `dl-handcard${selected === c.uid ? ' sel' : ''}`, disabled: !myTurn(), 'aria-label': `${def.name}, hand slot ${i + 1}`, onclick: () => pick(c.uid), onmouseenter: () => showInfo(def), onfocus: () => showInfo(def) },
          render(def, { burst: selected === c.uid && armed }), h('kbd', {}, String(i + 1)));
        return b;
      }));
      if (!hand.length) ui.hand.append(h('p', { class: 'dl-empty' }, 'No cards left. Watch the finish.'));
      ui.burst.disabled = !view.p[you].burst || !myTurn();
      ui.burst.classList.toggle('on', armed);
      const n = view.p[R.other(you)];
      ui.opp.hand.replaceChildren(...Array.from({ length: n.handCount || 0 }, () => h('i')));
      ui.opp.sub.textContent = `${n.deckCount} in deck`;
      ui.me.hand.replaceChildren();
      ui.me.sub.textContent = `${view.p[you].deckCount} in deck`;
    }
    function drawCells() {
      const legal = myTurn() && selected != null;
      view.cells.forEach((c, i) => {
        const can = legal && R.openCell(c);
        const n = cellEls[i];
        n.classList.toggle('can', can);
        if (c.t !== 'rock' && c.t !== 'pit') n.disabled = !can;
      });
    }
    function drawTurn() {
      ui.root.classList.toggle('yours', myTurn());
      if (view.over) { ui.turn.textContent = 'Final score'; return; }
      ui.turn.textContent = view.turn === you ? 'Your turn' : `${seats[view.turn].name} is thinking…`;
    }
    function drawAll() { updateScore(); drawHand(); drawCells(); drawTurn(); drawPreview(); }

    function clearPreview() {
      for (const n of cellEls) { n.classList.remove('pv-win', 'pv-hold', 'pv-ko'); delete n.dataset.pv; }
      ui.layer.querySelectorAll('.dl-ghost').forEach((n) => n.remove());
      ui.fx.querySelectorAll('.dl-arrow').forEach((n) => n.remove());
      ui.detail.classList.remove('pv');
    }
    function drawPreview() {
      clearPreview();
      if (!myTurn() || selected == null || hoverCell < 0 || !R.openCell(view.cells[hoverCell])) { if (view) updateScore(); return; }
      let out;
      try { out = R.applyMove(view, { uid: selected, cell: hoverCell, burst: armed }, { preview: true }); } catch { return; }
      const card = view.p[you].hand.find((c) => c.uid === selected);
      const ghost = h('div', { class: 'dl-ghost' }, render(card.id, { burst: armed }));
      const [x, y] = cellPos(hoverCell);
      ghost.style.transform = `translate(${x}px, ${y}px)`;
      ui.layer.append(ghost);
      for (const e of out.events) {
        if (e.type === 'flip' && cellEls[e.cell]) cellEls[e.cell].classList.add('pv-win');
        if (e.type === 'ko') cellEls[e.cell].classList.add('pv-ko');
        if ((e.type === 'hold' || e.type === 'blocked' || e.type === 'ward') && cellEls[e.cell]) cellEls[e.cell].classList.add('pv-hold');
        if (e.type === 'shove') for (const m of e.moves) {
          cellEls[m.from].classList.add('pv-win');
          const [ax, ay] = cellCentre(m.from);
          ui.fx.append(h('div', { class: 'dl-arrow', style: { left: `${ax}px`, top: `${ay}px` } }, ARROW[e.dir]));
        }
      }
      const s = R.score(out.state), opp = R.other(you);
      ui.detail.textContent = `If played: ${s[you]}–${s[opp]}`;
      ui.detail.classList.add('pv');
    }
    function showInfo(def) {
      const el = D.ELEMENTS[def.element];
      const t = def.tech ? D.TECHNIQUES[def.tech] : null;
      ui.info.replaceChildren(
        h('div', { class: 'label', style: { color: D.RARITIES[def.rarity].color } }, `${D.RARITIES[def.rarity].name} · ${el.icon} ${el.name}`),
        h('h3', {}, def.name),
        t ? h('p', {}, h('b', {}, `${t.icon} ${t.name}. `), t.text) : h('p', { class: 'muted' }, 'No technique.'),
        h('p', { class: 'muted' }, `+1 attacking ${D.ELEMENTS[el.beats].icon} ${D.ELEMENTS[el.beats].name}`));
    }
    function showRules() {
      ui.info.replaceChildren(
        h('h3', {}, mode.name),
        h('p', {}, isPush ? 'Beat a neighbour to shove it. Off the mat is a knockout (+1). Each shrine you hold at the end is +2.' : 'Beat a neighbour to win it over. Each card you own is +1, and a shrine adds +1 more.'),
        h('p', { class: 'muted' }, 'Pick a card, then hover a square to see what would happen.'));
    }

    function pick(uid) {
      if (!myTurn()) return;
      selected = selected === uid ? null : uid;
      sfx.tick();
      drawAll();
    }
    function toggleBurst() {
      if (!myTurn() || !view.p[you].burst) return;
      armed = !armed;
      drawAll();
    }
    function clickCell(i) {
      if (!myTurn() || selected == null || !R.openCell(view.cells[i])) return;
      const uid = selected, burst = armed;
      selected = null; armed = false; busy = true; hoverCell = -1;
      // Take the card out of the hand straight away; the server's move message does the rest.
      view.p[you].hand = view.p[you].hand.filter((c) => c.uid !== uid);
      drawAll();
      ctx.send({ type: 'play', uid, cell: i, burst });
    }
    function onKey(e) {
      if (!view || ended) return;
      if (e.key >= '1' && e.key <= '3') { const c = view.p[you].hand[Number(e.key) - 1]; if (c) pick(c.uid); }
      else if (e.key === 'b' || e.key === 'B') toggleBurst();
      else if (e.key === 'Escape') { selected = null; armed = false; drawAll(); }
    }
    document.addEventListener('keydown', onKey);

    let lastTick = 0;
    const clock = setInterval(() => {
      if (!deadlineAt || !view || view.over) { ui.clock.style.width = '0%'; return; }
      const left = deadlineAt - Date.now();
      ui.clock.style.width = `${Math.max(0, Math.min(100, (left / turnMs) * 100))}%`;
      ui.clock.classList.toggle('low', left < 8000);
      const sec = Math.ceil(left / 1000);
      if (view.turn === you && sec <= 5 && sec > 0 && sec !== lastTick) { lastTick = sec; sfx.tick(); }
    }, 100);

    function setSeat(panel, seat) {
      panel.face.replaceChildren(Avatar.portrait(seat.loadout, 64));
      panel.name.textContent = seat.name;
    }
    function bubble(panel, text, ms = 2200) {
      panel.bubble.textContent = text;
      panel.bubble.hidden = false;
      clearTimeout(panel.bubble.t);
      panel.bubble.t = setTimeout(() => { panel.bubble.hidden = true; }, ms);
    }
    function banner(kids, cls, ms) {
      ui.banner.className = `dl-banner ${cls || ''}`;
      ui.banner.replaceChildren(...kids);
      ui.banner.hidden = false;
      if (ms) setTimeout(() => { ui.banner.hidden = true; }, ms);
    }
    function confetti(n) {
      const cols = ['#ffd23f', '#ff6b5e', '#6f8bff', '#55d394', '#ffffff'];
      for (let i = 0; i < n; i++) {
        const c = h('i', { class: 'dl-confetti', style: { left: `${Math.random() * 100}%`, background: cols[i % cols.length], animationDelay: `${Math.random() * 0.7}s`, animationDuration: `${1.6 + Math.random() * 1.4}s` } });
        ui.root.append(c);
        setTimeout(() => c.remove(), 3800);
      }
    }

    // ---------- messages from the server ----------
    function begin(m) {
      view = m.view; you = m.you; seats = m.seats;
      busy = false;
      setSeat(ui.me, seats[you]);
      setSeat(ui.opp, seats[R.other(you)]);
      buildBoard();
      fit();
      settle();
      showRules();
      if (m.msLeft) { deadlineAt = Date.now() + m.msLeft; turnMs = m.msLeft; } else deadlineAt = null;
      if (view.komi) {
        const who = (view.komi > 0 ? R.other(view.first) : view.first) === you ? 'You have' : `${seats[R.other(you)].name} has`;
        ui.turn.title = `${who} a ${Math.abs(view.komi)}-point head start on this board.`;
        ui.komi.textContent = `POINTS · ${(view.komi > 0 ? R.other(view.first) : view.first) === you ? 'you' : 'they'} start +${Math.abs(view.komi)}`;
      }
      const opp = seats[R.other(you)];
      banner([h('small', {}, m.boardName), h('b', {}, `vs ${opp.name}`), h('span', {}, view.first === you ? 'You go first' : `${opp.name} goes first`)], 'intro', 1900);
      if (opp.line) setTimeout(() => bubble(ui.opp, opp.line, 3200), 500);
      drawAll();
      if (view.turn === you) sfx.turn();
    }
    async function playMove(m) {
      busy = true;
      drawAll();
      for (const e of m.events) { if (disposed) return; await playEvent(e); }
      if (disposed) return;
      view = m.view;
      settle();
      deadlineAt = m.msLeft ? Date.now() + m.msLeft : null;
      if (m.msLeft) turnMs = Math.max(turnMs, m.msLeft);
      busy = false;
      if (selected != null && !view.p[you].hand.some((c) => c.uid === selected)) selected = null;
      drawAll();
      if (!view.over && view.turn === you) sfx.turn();
    }
    function finish(m) {
      ended = true; busy = true; deadlineAt = null;
      clearPreview();
      const text = { win: 'VICTORY', loss: 'DEFEAT', draw: 'DRAW' }[m.outcome];
      const opp = R.other(you);
      banner([h('b', {}, text), h('span', { class: 'dl-final' }, `${m.score[you]} – ${m.score[opp]}`), m.forfeit ? h('small', {}, 'Your opponent left the table') : h('small', {}, m.outcome === 'win' && m.ladder ? `You beat ${m.ladder}` : ' ')], `end ${m.outcome}`);
      if (m.outcome === 'win') { sfx.win(); confetti(90); } else if (m.outcome === 'loss') sfx.lose();
    }
    async function drain() {
      if (draining) return;
      draining = true;
      while (queue.length && !disposed) {
        const m = queue.shift();
        if (m.type === 'begin') begin(m);
        else if (m.type === 'move') await playMove(m);
        else if (m.type === 'end') finish(m);
      }
      draining = false;
    }

    return {
      onMessage(m) {
        if (m.type === 'react') { bubble(m.seat === you ? ui.me : ui.opp, m.emote, 1600); return; }
        if (m.type === 'illegal') { toast(m.text, true); busy = false; if (view) drawAll(); return; }
        queue.push(m);
        drain();
      },
      unmount() {
        disposed = true;
        ro.disconnect();
        clearInterval(clock);
        document.removeEventListener('keydown', onKey);
      },
    };
  }

  window.ClubDojoCardDuel = { mount };
})();
