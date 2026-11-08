// Mountain Town and Peak in the HUD: today's card, the Guide and her journal, cocoa, the Summit Bell
// and picking up finds. The rules live on the server (server/src/mountain.js).
(function () {
  const THEMES = new Set(['alpine', 'summit']);
  const Art = window.ClubDojoMountainArt;

  function create({ h, conn, world, state, toasts, toast, openModal, closeModal, confetti, showBanner, chatLine }) {
    const P = window.ClubDojoProtocol;
    const World = window.ClubDojoWorld;
    const ui = {};
    const panel = h('button', { class: 'panel mountain-card', hidden: true, 'aria-label': 'Today on the mountain. Open the Mountain Journal.', onclick: () => openJournal(null) },
      ui.weather = h('b', {}), ui.perk = h('small', {}),
      h('div', { class: 'mt-stats' }, ui.finds = h('span', {}), ui.bell = h('span', {}), ui.beacon = h('span', {})),
      h('div', { class: 'mt-warm' }, h('small', {}, '♨ Warmth'), h('div', { class: 'qbar', 'aria-hidden': 'true' }, ui.warmFill = h('i')), ui.warmText = h('small', {})));

    const mt = () => state.me && state.me.mountain;
    const quiet = () => { state.quietCoinsUntil = performance.now() + 1500; };

    function update() {
      const m = mt();
      world.mountain = m || null;
      const show = !!(m && state.room && THEMES.has(state.room.theme));
      panel.hidden = !show;
      if (!show) return;
      ui.weather.textContent = `${m.weather.icon} ${m.weather.name}`;
      ui.perk.textContent = m.weather.perk;
      ui.finds.textContent = `✦ Finds ${m.foundCount}/${m.findTotal}`;
      ui.bell.textContent = m.bell.rung ? `🔔 Rung · ${m.bell.streak}d` : `🔔 Ring +${m.bell.next}`;
      ui.bell.classList.toggle('go', !m.bell.rung);
      ui.beacon.textContent = m.beacon.lit ? '🔥 Beacon lit' : `🔥 Beacon ${Math.min(m.beacon.rings, m.beacon.goal)}/${m.beacon.goal}`;
      ui.warmFill.style.width = `${Math.min(100, (m.cozy.earned / m.cozy.cap) * 100)}%`;
      ui.warmText.textContent = `${m.cozy.earned}/${m.cozy.cap}${m.cocoa ? ' ☕' : ''}`;
    }

    // ---------- finds ----------
    const asking = new Set();
    function arrived(t) {
      const m = mt();
      if (!m || !state.room) return;
      for (const f of m.finds) {
        if (f.room !== state.room.id || asking.has(f.id) || Math.max(Math.abs(f.x - t.x), Math.abs(f.y - t.y)) > 1) continue;
        asking.add(f.id);
        quiet();
        conn.request('mt:gather', { id: f.id }).then((r) => {
          world.floatText(state.me.id, `+${r.coins}`);
          const c = icon(r.kind, 30);
          const card = h('div', { class: 'toast win find-toast' }, c, h('div', {},
            h('small', {}, r.firstOfKind ? 'New journal entry!' : 'Mountain find'), r.name, h('span', { class: 'toast-pay' }, `+${r.coins} coins · +${r.xp} XP`)));
          toasts.append(card);
          setTimeout(() => card.remove(), 3600);
          if (r.rare) confetti(30, ['#ffe27a', '#7a6ee0', '#ffffff']);
          chime(r.rare ? 880 : 660, 0.04);
        }).catch(() => {}).finally(() => asking.delete(f.id));
      }
    }
    function icon(kind, size) {
      const dpr = window.devicePixelRatio || 1;
      const c = h('canvas', { width: size * dpr, height: size * dpr, style: { width: `${size}px`, height: `${size}px` } });
      const x = c.getContext('2d');
      x.scale(dpr, dpr);
      Art.drawFind(x, kind, size / 2, size / 2, size * 0.34, 0);
      return c;
    }

    // ---------- the bell ----------
    let actx = null;
    function chime(freq, vol) {
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === 'suspended') actx.resume().catch(() => {});
        const t = actx.currentTime;
        for (const [ratio, gain, dur] of [[1, 1, 2.4], [2.01, 0.5, 1.5], [3.02, 0.25, 0.8]]) {
          const o = actx.createOscillator(), g = actx.createGain();
          o.frequency.value = freq * ratio;
          g.gain.setValueAtTime(vol * gain, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
          o.connect(g).connect(actx.destination);
          o.start(t); o.stop(t + dur + 0.05);
        }
      } catch {}
    }
    function ring() {
      const m = mt();
      if (m && m.bell.rung) { toast(`You have rung the bell today. Streak: ${m.bell.streak} day${m.bell.streak === 1 ? '' : 's'}. Come back tomorrow!`); return; }
      quiet();
      conn.request('mt:ring').then((r) => {
        world.floatText(state.me.id, `+${r.coins}`);
        const card = h('div', { class: 'toast win' }, h('small', {}, `Summit Bell · ${r.streak}-day streak`), r.streak > 1 ? 'The mountain remembers you.' : 'The mountain heard you.',
          h('span', { class: 'toast-pay' }, `+${r.coins} coins · +${r.xp} XP`));
        toasts.append(card);
        setTimeout(() => card.remove(), 4200);
      }).catch((e) => toast(e.message, true));
    }

    // ---------- NPCs ----------
    function portrait(npc) {
      const c = h('canvas', { width: 90, height: 110 });
      setTimeout(() => World.drawNinja(c.getContext('2d'), { x: 1.1, y: 2.35, color: npc.gi, headband: npc.headband, belt: npc.belt, accessories: npc.hat ? { head: 'fur-hat' } : undefined }, 40, performance.now()));
      return c;
    }
    function guideLine(m, name) {
      if (m.finds.length && m.foundCount === 0) return `Morning, ${name}. ${m.findTotal} things turned up on the trails overnight. Keep your eyes on the ground.`;
      if (!m.bell.rung && m.bell.streak) return `${m.bell.streak} days running on the bell. Don't let today be the day you stop.`;
      if (!m.bell.rung) return `Climb through the gate and ring the Summit Bell. The whole valley hears it.`;
      if (m.finds.length) return `Still ${m.finds.length} out there today. The trails are worth another walk.`;
      if (m.cozy.earned < m.cozy.cap) return `You've done a proper day's walking. Go soak in the spring, you've earned it.`;
      return `That's the mountain done for today. Come see me tomorrow: ${m.tomorrow.name.toLowerCase()} on the way.`;
    }
    function objective(done, text, note) {
      return h('div', { class: `objective${done ? ' complete' : ''}` }, h('span', { class: `check${done ? ' done' : ''}`, 'aria-hidden': 'true' }), h('div', { class: 'grow' }, text, h('small', { class: 'muted', style: { display: 'block' } }, note)));
    }
    function openJournal(npc) {
      const m = mt();
      if (!m) return;
      const owned = m.journal.filter((j) => j.count).length;
      const pages = m.journal.map((j) => h('div', { class: `jn-page${j.count ? '' : ' empty'}${j.rare ? ' rare' : ''}`, title: j.where },
        icon(j.id, 40), h('b', {}, j.count ? j.name : '???'), h('small', {}, j.count ? `Found ${j.count}` : j.where)));
      const week = m.bell.week.map((c, i) => {
        const slot = m.bell.streak ? ((m.bell.streak - 1) % 7) + 1 : 0;
        return h('div', { class: `stamp${i + 1 < slot || (i + 1 === slot && !m.bell.rung) ? ' got' : ''}${i + 1 === slot && m.bell.rung ? ' today' : ''}` }, h('small', {}, `Day ${i + 1}`), h('b', {}, c), h('span', { class: 'coin sm', 'aria-hidden': 'true' }));
      });
      openModal(npc ? 'Trail Post' : 'Mountain Journal', npc ? npc.name : 'Today on the mountain',
        npc ? h('div', { class: 'preview-row' }, portrait(npc), h('p', { class: 'sensei-say' }, `“${guideLine(m, state.me.name)}”`)) : null,
        h('div', { class: 'forecast' },
          h('div', {}, h('small', {}, 'Today'), h('b', {}, `${m.weather.icon} ${m.weather.name}`), h('span', {}, m.weather.perk)),
          h('div', {}, h('small', {}, 'Tomorrow'), h('b', {}, `${m.tomorrow.icon} ${m.tomorrow.name}`), h('span', {}, m.tomorrow.perk))),
        objective(m.finds.length === 0, `Collect today's finds (${m.foundCount}/${m.findTotal})`, 'Look for sparkles in the Town and at the Peak. New spots every day.'),
        objective(m.bell.rung, 'Ring the Summit Bell', m.bell.rung ? `Rung. Best streak: ${m.bell.best} days.` : `Pays ${m.bell.next} coins today, more each day in a row.`),
        objective(m.beacon.lit, `Light the beacon (${Math.min(m.beacon.rings, m.beacon.goal)}/${m.beacon.goal} rings)`, 'Everyone who rings shares a bonus, and warming up pays more.'),
        objective(m.cozy.earned >= m.cozy.cap, `Warm up (${m.cozy.earned}/${m.cozy.cap} coins)`, 'Stay in the hot spring or by the campfire. Cocoa, company and the beacon all speed it up.'),
        h('h2', { class: 'sub' }, 'Summit Bell streak'), h('div', { class: 'week' }, week),
        h('h2', { class: 'sub' }, `Mountain Journal · ${owned}/${m.journal.length}`),
        h('p', { class: 'muted' }, m.scarf ? 'Journal complete. Wear that Summit Scarf with pride.' : 'Fill every page to earn the Summit Scarf, worn only by those who did, plus 300 coins.'),
        h('div', { class: 'journal' }, pages),
        h('div', { class: 'foot' }, h('span', { class: 'muted' }, `${m.bell.total} bell rings in all`), h('button', { class: 'btn ghost', onclick: closeModal }, 'Close')));
    }
    function openCocoa(npc) {
      const m = mt();
      if (!m) return;
      const canPay = state.me.coins >= m.cocoaPrice;
      const buy = !m.cocoa ? h('button', { class: 'btn', disabled: !canPay, onclick: () => {
        buy.disabled = true;
        quiet();
        conn.request('mt:cocoa').then(() => { closeModal(); toast('☕ Warm all the way down. Warming up pays more today.'); world.floatText(state.me.id, '☕'); })
          .catch((e) => { buy.disabled = false; toast(e.message, true); });
      } }, `Buy cocoa (${m.cocoaPrice} coins)`) : h('span');
      openModal(npc.kicker || 'Ember Lodge', npc.name,
        h('div', { class: 'preview-row' }, portrait(npc), h('p', { class: 'sensei-say' }, m.cocoa ? '“Still got that cup in your hands? Off you go, the spring is just down the road.”' : `“Cold out there, ${state.me.name}. One of these and you'll stay warm all day.”`)),
        h('p', { class: 'muted' }, 'One cup a day. Earns you an extra coin every time you warm up in the hot spring or by the campfire.'),
        h('div', { class: 'foot' }, h('button', { class: 'btn ghost', onclick: closeModal }, 'Maybe later'), buy));
    }
    function talk(npc) {
      if (npc.npc === 'guide') openJournal(npc);
      else if (npc.npc === 'cocoa') openCocoa(npc);
      else if (npc.interact === 'bell') ring();
      else return false;
      return true;
    }

    // ---------- things that happen to everyone ----------
    conn.on('mt:ring', (m) => {
      if (state.room && state.room.theme === 'summit') { world.bellAt = performance.now(); chime(196, 0.13); }
      chatLine(`🔔 ${m.name} rang the Summit Bell.`, 'sys');
    });
    conn.on('mt:beacon', (m) => {
      showBanner('The summit beacon is lit! Warming up pays more today.', m.name);
      chatLine(`🔥 ${m.name} lit the summit beacon for everyone.`, 'ann');
      if (state.room && THEMES.has(state.room.theme)) confetti(40, ['#ff9b58', '#f5d33b', '#e8532c', '#ffffff']);
    });
    conn.on('mt:journal', (m) => {
      const you = state.me && m.id === state.me.id;
      showBanner(you ? 'You filled the Mountain Journal and earned the Summit Scarf!' : `${m.name} filled the Mountain Journal and earned the Summit Scarf!`, 'Guide Yuki');
      chatLine(`🧣 ${m.name} earned the Summit Scarf!`, 'ann');
      if (you) confetti(70, ['#d9402f', '#fff4dd', '#f5b82e']);
    });
    conn.on('mt:cozy', (m) => {
      quiet();
      if (state.me) world.floatText(state.me.id, `+${m.coins}${m.company ? ' 🤝' : ''}`);
    });

    return { panel, update, arrived, talk };
  }

  window.ClubDojoMountainUi = { create };
})();
