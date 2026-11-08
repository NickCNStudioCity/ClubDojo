// Dojo Memory (client). Reference implementation of a client minigame module.
// Server rules: server/src/minigames/games/dojo-memory.js
ClubDojoMinigames.register({
  id: 'dojo-memory',
  guide: {
    summary: 'Watch the scrolls light up, then repeat the pattern. It gets one step longer every round. The last ninja standing wins.',
    controls: [['Mouse or touch', 'Tap the scrolls in the same order'], ['1 to 9', 'Tap a scroll with the number keys']],
    tips: ['One wrong scroll puts you out, and so does running out of time.', 'Saying the numbers to yourself makes long patterns easier.'],
  },

  mount(ctx) {
    const { h, el, avatar } = ctx;
    const SCROLL_COLORS = ['#e8453c', '#f5b82e', '#3fbf7f', '#2f6fd1', '#8e44ad', '#e67e22', '#16a085', '#ff7eb6'];
    const timers = new Set();
    const later = (ms, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };

    const style = h('style', {}, `
      .dm { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2vh; padding: 8px; box-sizing: border-box; --s: min(24vh, 20vw);
        background: radial-gradient(ellipse at 50% 35%, #7a4a30 0%, #47291c 55%, #26150f 100%); }
      .dm-players { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
      .dm-p { display: flex; flex-direction: column; align-items: center; background: rgba(255,255,255,.08); border-radius: 12px; padding: 6px 10px; min-width: 92px; transition: opacity .3s; }
      .dm-p.out { opacity: .4; }
      .dm-p.cleared { box-shadow: 0 0 0 2px var(--good); }
      .dm-p b { font-size: 13px; } .dm-p small { opacity: .8; }
      .dm-status { font-family: var(--display); font-size: clamp(26px, 5vh, 52px); letter-spacing: .05em; min-height: 36px; text-align: center; }
      .dm-timer { width: min(420px, 90%); height: 8px; background: rgba(255,255,255,.15); border-radius: 999px; overflow: hidden; }
      .dm-timer i { display: block; height: 100%; width: 100%; background: var(--gold); transform-origin: left; }
      .dm-grid { display: grid; grid-template-columns: repeat(3, var(--s)); gap: 2.4vh; }
      .dm-scroll { aspect-ratio: 3 / 4; border: 0; border-radius: 14px; cursor: pointer; position: relative; font: inherit; font-weight: 800; color: rgba(255,255,255,.85);
        background: linear-gradient(180deg, rgba(255,255,255,.18), rgba(0,0,0,.18)), var(--c); filter: brightness(.55) saturate(.8); transition: filter .12s, transform .12s; box-shadow: 0 4px 0 rgba(0,0,0,.35); }
      .dm-scroll::before, .dm-scroll::after { content: ''; position: absolute; left: -6px; right: -6px; height: 12px; border-radius: 6px; background: #6b4226; }
      .dm-scroll::before { top: -4px; } .dm-scroll::after { bottom: -4px; }
      .dm-scroll.lit { filter: brightness(1.25) saturate(1.2); transform: scale(1.06); box-shadow: 0 0 24px var(--c), 0 4px 0 rgba(0,0,0,.35); }
      .dm-scroll:disabled { cursor: default; }
      .dm-scroll kbd { position: absolute; bottom: 12px; left: 0; right: 0; font-size: 12px; font-family: var(--body); }
      .dm-scroll.wrong { animation: dm-shake .35s; }
      @keyframes dm-shake { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
    `);
    const status = h('div', { class: 'dm-status' }, 'Get ready...');
    const timerFill = h('i');
    const timer = h('div', { class: 'dm-timer', hidden: true }, timerFill);
    const grid = h('div', { class: 'dm-grid' });
    const playersRow = h('div', { class: 'dm-players' });
    el.append(style, h('div', { class: 'dm' }, playersRow, status, timer, grid));

    // Player cards built from each ninja's loadout (see docs/minigames/character-loading.md).
    const cards = new Map();
    for (const p of ctx.players) {
      const score = h('small', {}, '0 pts');
      const card = h('div', { class: 'dm-p' }, avatar.portrait(p.loadout, 56), h('b', {}, p.id === ctx.youId ? `${p.name} (you)` : p.name), score);
      cards.set(p.id, { card, score });
      playersRow.append(card);
    }

    let scrolls = [];
    let canTap = false;
    let iAmOut = false;

    function buildScrolls(n) {
      grid.style.gridTemplateColumns = `repeat(${n <= 4 ? 4 : Math.ceil(n / 2)}, var(--s))`;
      scrolls = Array.from({ length: n }, (_, i) => h('button', {
        class: 'dm-scroll', style: { '--c': SCROLL_COLORS[i % SCROLL_COLORS.length] }, 'aria-label': `Scroll ${i + 1}`, disabled: true,
        onclick: () => tap(i),
      }, h('kbd', {}, String(i + 1))));
      grid.replaceChildren(...scrolls);
    }

    function light(i, ms) {
      const s = scrolls[i];
      if (!s) return;
      s.classList.add('lit');
      later(ms, () => s.classList.remove('lit'));
    }

    function setTapping(on) {
      canTap = on && !iAmOut;
      for (const s of scrolls) s.disabled = !canTap;
    }

    function tap(i) {
      if (!canTap) return;
      light(i, 180);
      ctx.send({ type: 'tap', scroll: i });
    }

    function updateScores(scores) {
      for (const [id, v] of Object.entries(scores || {})) {
        const c = cards.get(Number(id));
        if (c) c.score.textContent = `${v} pts`;
      }
    }

    function onKey(e) {
      const n = Number(e.key);
      if (n >= 1 && n <= scrolls.length) { tap(n - 1); e.preventDefault(); }
    }
    document.addEventListener('keydown', onKey);

    return {
      onMessage(m) {
        switch (m.type) {
          case 'setup':
            buildScrolls(m.scrolls);
            break;
          case 'show': {
            setTapping(false);
            timer.hidden = true;
            for (const c of cards.values()) c.card.classList.remove('cleared');
            updateScores(m.scores);
            status.textContent = iAmOut ? `Round ${m.round} · watching` : `Round ${m.round} · watch closely`;
            m.sequence.forEach((s, i) => later(i * (m.showMs + m.gapMs) + 200, () => light(s, m.showMs)));
            break;
          }
          case 'input':
            if (!iAmOut) status.textContent = 'Your turn!';
            setTapping(true);
            timer.hidden = false;
            timerFill.style.transition = 'none';
            timerFill.style.transform = 'scaleX(1)';
            requestAnimationFrame(() => { timerFill.style.transition = `transform ${m.ms}ms linear`; timerFill.style.transform = 'scaleX(0)'; });
            break;
          case 'ok':
            if (m.step === m.of) { status.textContent = 'Cleared! Waiting for others...'; setTapping(false); }
            break;
          case 'wrong':
            scrolls[m.expected] && light(m.expected, 900);
            for (const s of scrolls) { s.classList.remove('wrong'); void s.offsetWidth; s.classList.add('wrong'); }
            break;
          case 'cleared':
            updateScores(m.scores);
            cards.get(m.id) && cards.get(m.id).card.classList.add('cleared');
            break;
          case 'out':
            updateScores(m.scores);
            cards.get(m.id) && cards.get(m.id).card.classList.add('out');
            if (m.id === ctx.youId) {
              iAmOut = true;
              setTapping(false);
              status.textContent = m.reason === 'time' ? 'Out of time! Watch the others.' : 'Wrong scroll! Watch the others.';
            }
            break;
          default:
        }
      },
      unmount() {
        document.removeEventListener('keydown', onKey);
        for (const t of timers) clearTimeout(t);
        timers.clear();
      },
    };
  },
});
