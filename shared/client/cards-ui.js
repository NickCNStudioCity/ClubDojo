// The card collection screen: album, deck builder, packs, the House Ladder and the rules. Also draws
// a single card (used by the match screen too) and answers the Cafe's dealer, cat, piano and board.
(function () {
  const D = window.ClubDojoCardData;
  const Art = window.ClubDojoCardArt;
  const DIRS = ['n', 'e', 's', 'w'];
  const MODE_IDS = Object.keys(D.MODES);

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // One card. opts: owner (1|2 seat colour class), foil, values [n,e,s,w] to show instead of the
  // printed sides, ward, burst, count, isNew, locked.
  function renderCard(cardOrId, opts = {}) {
    const def = typeof cardOrId === 'string' ? D.getCard(cardOrId) : cardOrId;
    const element = D.ELEMENTS[def.element];
    const n = el('div', `cc r-${def.rarity}`);
    n.style.setProperty('--el', element.color);
    n.style.setProperty('--el-glow', element.glow);
    n.style.setProperty('--rar', D.RARITIES[def.rarity].color);
    if (opts.foil) n.classList.add('foil');
    if (opts.locked) n.classList.add('locked');
    const art = el('div', 'cc-art');
    art.innerHTML = Art.svg(def, D.ELEMENTS); // static strings from card-art.js only
    n.append(art);
    if (opts.foil) n.append(el('div', 'cc-shine'));
    n.append(el('div', 'cc-frame'));
    n.append(el('div', 'cc-el', element.icon));
    if (def.tech) { const t = el('div', 'cc-tech', D.TECHNIQUES[def.tech].icon); t.title = `${D.TECHNIQUES[def.tech].name}: ${D.TECHNIQUES[def.tech].text}`; n.append(t); }
    n.append(el('div', 'cc-name', opts.locked ? '???' : def.name));
    DIRS.forEach((dir, i) => {
      const value = opts.values ? opts.values[i] : def.sides[i];
      const s = el('span', `cc-s ${dir}`, String(value));
      if (opts.values) { if (value > def.sides[i]) s.classList.add('up'); }
      n.append(s);
    });
    if (opts.count > 1) n.append(el('span', 'cc-count', `×${opts.count}`));
    if (opts.isNew) n.append(el('span', 'cc-new', 'NEW'));
    if (opts.ward) n.append(el('div', 'cc-ward'));
    if (opts.burst) n.classList.add('burst');
    return n;
  }

  function create({ root, h, conn, world, state, toast, toasts, openModal, closeModal, confetti, chatLine }) {
    const Avatar = window.ClubDojoAvatar;
    let data = null;
    let tab = 'album';
    const filters = { element: 'all', rarity: 'all', owned: false };
    let deckSlot = 0;
    let draft = null; // { slot, name, cards }
    const body = h('div', { class: 'cx-body' });
    const inkEl = h('b'), coinEl = h('b'), rankEl = h('span', { class: 'cx-rank' });
    const tabs = [['album', 'Album'], ['decks', 'Decks'], ['packs', 'Packs'], ['ladder', 'House Ladder'], ['rules', 'How to play']];
    const tabButtons = new Map();
    const overlay = h('section', { class: 'cx-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Card collection', hidden: true },
      h('header', { class: 'cx-head' },
        h('h2', { class: 'cx-title' }, 'Cards'), rankEl,
        h('nav', { class: 'cx-tabs' }, tabs.map(([id, label]) => { const b = h('button', { class: 'cx-tab', onclick: () => show(id) }, label); tabButtons.set(id, b); return b; })),
        h('div', { class: 'cx-wallet' }, h('span', { title: 'Ink: make new cards with it' }, '🖋️ ', inkEl), h('span', { title: 'Coins' }, h('span', { class: 'coin sm', 'aria-hidden': 'true' }), ' ', coinEl)),
        h('button', { class: 'btn ghost small', onclick: close }, 'Close')),
      body);
    root.append(overlay);

    const isOpen = () => !overlay.hidden;
    const refreshWallet = () => {
      if (!data) return;
      inkEl.textContent = data.ink.toLocaleString();
      coinEl.textContent = (state.me ? state.me.coins : 0).toLocaleString();
      rankEl.textContent = `${data.rank} · ${data.wins} win${data.wins === 1 ? '' : 's'}`;
    };
    async function load() { const r = await conn.request('cards:get'); data = r.cards; refreshWallet(); return data; }
    function apply(r) { if (r && r.cards) data = r.cards; refreshWallet(); }
    function act(type, payload) {
      return conn.request(type, payload).then((r) => { apply(r); return r; }).catch((e) => { toast(e.message, true); throw e; });
    }

    async function open(which) {
      try { await load(); } catch (e) { toast(e.message, true); return; }
      overlay.hidden = false;
      show(which || (Object.values(data.packs).some(Boolean) ? 'packs' : 'album'));
    }
    function close() {
      if (data && data.unseen.length) conn.request('cards:seen').then(apply).catch(() => {});
      overlay.hidden = true;
      draft = null;
      refreshLobbies();
    }
    function show(id) {
      tab = id;
      for (const [k, b] of tabButtons) b.classList.toggle('on', k === id);
      refreshWallet();
      body.scrollTop = 0;
      ({ album: renderAlbum, decks: renderDecks, packs: renderPacks, ladder: renderLadder, rules: renderRules })[id]();
    }

    // ---------- album ----------
    function renderAlbum() {
      const total = D.CARDS.length;
      const have = D.CARDS.filter((c) => data.owned[c.id]).length;
      const chips = [['all', 'All'], ...Object.entries(D.ELEMENTS).map(([k, v]) => [k, `${v.icon} ${v.name}`])];
      const list = D.CARDS.filter((c) => (filters.element === 'all' || c.element === filters.element) && (filters.rarity === 'all' || c.rarity === filters.rarity) && (!filters.owned || data.owned[c.id]));
      const setBars = Object.entries(D.ELEMENTS).map(([k, v]) => {
        const all = D.CARDS.filter((c) => c.element === k), got = all.filter((c) => data.owned[c.id]).length;
        return h('div', { class: `cx-set${got === all.length ? ' done' : ''}`, title: `Finish this set for ${D.SET_REWARD.coins} coins and ${D.SET_REWARD.ink} Ink` },
          h('span', {}, v.icon), h('div', { class: 'qbar' }, h('i', { style: { width: `${(got / all.length) * 100}%`, background: v.color } })), h('small', {}, `${got}/${all.length}`));
      });
      body.replaceChildren(
        h('div', { class: 'cx-summary' },
          h('div', {}, h('b', { class: 'cx-big' }, `${have}/${total}`), h('small', {}, ' cards collected')),
          h('div', { class: 'cx-sets' }, setBars)),
        h('div', { class: 'cx-filters' },
          chips.map(([k, label]) => h('button', { class: `chip${filters.element === k ? ' on' : ''}`, onclick: () => { filters.element = k; renderAlbum(); } }, label)),
          h('select', { 'aria-label': 'Rarity', onchange: (e) => { filters.rarity = e.target.value; renderAlbum(); } },
            ['all', ...Object.keys(D.RARITIES)].map((r) => h('option', { value: r, selected: filters.rarity === r }, r === 'all' ? 'Every rarity' : D.RARITIES[r].name))),
          h('label', { class: 'chip-check' }, h('input', { type: 'checkbox', checked: filters.owned, onchange: (e) => { filters.owned = e.target.checked; renderAlbum(); } }), ' Owned only')),
        h('div', { class: 'cx-grid' }, list.map((c) => {
          const owned = data.owned[c.id] || 0;
          const card = renderCard(c, { foil: data.foils.includes(c.id), locked: !owned, count: owned, isNew: data.unseen.includes(c.id) });
          return h('button', { class: 'cx-slot', 'aria-label': owned ? c.name : 'Unknown card', onclick: () => inspect(c) }, card);
        })));
    }

    function inspect(c) {
      const owned = data.owned[c.id] || 0;
      const rarity = D.RARITIES[c.rarity];
      const element = D.ELEMENTS[c.element];
      const tech = c.tech ? D.TECHNIQUES[c.tech] : null;
      const canCraft = owned < 3 && data.ink >= rarity.ink;
      const backdrop = h('div', { class: 'cx-inspect', onclick: (e) => { if (e.target === backdrop) backdrop.remove(); } });
      const big = renderCard(c, { foil: data.foils.includes(c.id), locked: !owned });
      big.classList.add('cc-big');
      backdrop.append(h('div', { class: 'cx-inspect-panel' },
        big,
        h('div', { class: 'cx-inspect-info' },
          h('div', { class: 'label', style: { color: rarity.color } }, `${rarity.name} · ${element.icon} ${element.name}`),
          h('h3', {}, owned ? c.name : 'Not collected yet'),
          h('p', { class: 'cx-flavor' }, owned ? `“${c.flavor}”` : 'Open packs, or make this card with Ink.'),
          tech ? h('p', { class: 'cx-techline' }, h('b', {}, `${tech.icon} ${tech.name}. `), tech.text) : h('p', { class: 'muted' }, 'No technique. Just good sides.'),
          h('p', { class: 'muted' }, `Beats ${D.ELEMENTS[element.beats].icon} ${D.ELEMENTS[element.beats].name}: +1 when attacking it.`),
          h('p', { class: 'muted' }, owned ? `You own ${owned} of 3${data.foils.includes(c.id) ? ', with a foil finish' : ''}.` : ''),
          h('div', { class: 'cx-actions' },
            h('button', { class: 'btn', disabled: !canCraft, onclick: () => act('cards:craft', { id: c.id }).then((r) => { backdrop.remove(); toast(`Made ${c.name} for ${r.cost} Ink.`); setsToast(r.sets); renderAlbum(); }).catch(() => {}) }, owned >= 3 ? 'At the limit' : `Make (${rarity.ink} Ink)`),
            h('button', { class: 'btn ghost', disabled: owned < 2, onclick: () => act('cards:dissolve', { id: c.id }).then((r) => { backdrop.remove(); toast(`Dissolved a spare copy for ${r.ink} Ink.`); renderAlbum(); }).catch(() => {}) }, `Dissolve spare (+${rarity.dissolve})`),
            h('button', { class: 'btn ghost', onclick: () => backdrop.remove() }, 'Back')))));
      body.append(backdrop);
    }
    function setsToast(sets) {
      if (!sets || !sets.names.length) return;
      toast(`Finished ${sets.names.join(' and ')}! +${sets.coins} coins, +${sets.ink} Ink.`);
      confetti(70, ['#ffd23f', '#7fd6ff', '#ffffff']);
    }

    // ---------- decks ----------
    function startDraft(slot) {
      deckSlot = slot;
      const d = data.decks[slot];
      draft = { slot, name: d.name, cards: [...d.cards] };
    }
    function draftProblem() {
      if (draft.cards.length !== D.DECK.size) return `${draft.cards.length}/${D.DECK.size} cards`;
      return null;
    }
    function renderDecks() {
      if (!draft) startDraft(deckSlot);
      const counts = {};
      for (const id of draft.cards) counts[id] = (counts[id] || 0) + 1;
      const legends = draft.cards.filter((id) => D.getCard(id).rarity === 'legendary').length;
      const canAdd = (c) => draft.cards.length < D.DECK.size && (counts[c.id] || 0) < Math.min(D.DECK.maxCopies, data.owned[c.id] || 0) && (c.rarity !== 'legendary' || legends < D.DECK.maxLegendary);
      const sum = [0, 0, 0, 0];
      draft.cards.forEach((id) => D.getCard(id).sides.forEach((v, i) => { sum[i] += v; }));
      const slots = Array.from({ length: D.DECK.size }, (_, i) => {
        const id = draft.cards[i];
        if (!id) return h('div', { class: 'cx-deckslot empty' });
        return h('button', { class: 'cx-deckslot', 'aria-label': `Remove ${D.getCard(id).name}`, onclick: () => { draft.cards.splice(i, 1); renderDecks(); } }, renderCard(id, { foil: data.foils.includes(id) }));
      });
      const avail = D.CARDS.filter((c) => data.owned[c.id]).sort((a, b) => D.RARITIES[b.rarity].order - D.RARITIES[a.rarity].order);
      const problem = draftProblem();
      const elements = Object.keys(D.ELEMENTS).filter((k) => draft.cards.some((id) => D.getCard(id).element === k));
      const n = draft.cards.length || 1;
      const nameInput = h('input', { class: 'cx-name', value: draft.name, maxlength: 20, 'aria-label': 'Deck name', oninput: (e) => { draft.name = e.target.value; } });
      const save = async () => { await act('cards:deck', { slot: draft.slot, name: draft.name, cards: draft.cards }); toast('Deck saved.'); };
      body.replaceChildren(
        h('div', { class: 'cx-deckbar' },
          data.decks.map((d, i) => h('button', { class: `chip${i === deckSlot ? ' on' : ''}`, onclick: () => { startDraft(i); renderDecks(); } }, d.name)),
          nameInput,
          h('button', { class: 'btn small', onclick: () => save().catch(() => {}) }, 'Save deck'),
          h('button', { class: 'btn ghost small', onclick: () => { draft.cards = []; renderDecks(); } }, 'Clear')),
        h('div', { class: 'cx-deckgrid' },
          h('div', { class: 'cx-deck' },
            h('div', { class: 'cx-deckhead' }, h('b', {}, problem || 'Ready to play'), h('small', {}, `Up to ${D.DECK.maxCopies} copies of a card and ${D.DECK.maxLegendary} Legendary`)),
            h('div', { class: 'cx-deckslots' }, slots),
            h('div', { class: 'cx-compass', title: 'Average strength your deck points each way' },
              ['North', 'East', 'South', 'West'].map((name, i) => h('div', {}, h('small', {}, name), h('b', {}, (sum[i] / n).toFixed(1))))),
            h('p', { class: 'muted' }, `Elements: ${elements.map((k) => D.ELEMENTS[k].icon).join(' ') || 'none yet'}. Spread strength across all four sides so you can attack from anywhere.`),
            h('div', { class: 'cx-actions' },
              MODE_IDS.map((g) => h('button', { class: `btn ghost small${data.active[g] === deckSlot ? ' on' : ''}`, disabled: !!problem, onclick: () => save().then(() => act('cards:active', { game: g, slot: draft.slot })).then(() => { toast(`${D.MODES[g].name} will use ${draft.name}.`); renderDecks(); }).catch(() => {}) }, data.active[g] === deckSlot ? `✓ Used for ${D.MODES[g].name}` : `Use for ${D.MODES[g].name}`)))),
          h('div', { class: 'cx-grid cx-pool' }, avail.map((c) => {
            const left = Math.min(D.DECK.maxCopies, data.owned[c.id]) - (counts[c.id] || 0);
            return h('button', { class: 'cx-slot', disabled: !canAdd(c), 'aria-label': `Add ${c.name}`, onclick: () => { draft.cards.push(c.id); renderDecks(); } },
              renderCard(c, { foil: data.foils.includes(c.id), count: left }));
          }))));
    }

    // ---------- packs ----------
    function packArt(pack) {
      return h('div', { class: 'cx-pack', style: { '--pack': pack.color } }, h('span', { class: 'cx-pack-mark' }, '札'), h('b', {}, pack.name));
    }
    function renderPacks() {
      body.replaceChildren(
        h('p', { class: 'cx-lead' }, data.firstWinReady ? 'Win a match at the Cafe today for a free Street Pack.' : 'You have claimed today\'s free pack. Come back tomorrow for another.'),
        h('div', { class: 'cx-shop' }, Object.values(D.PACKS).map((pack) => {
          const have = data.packs[pack.id] || 0;
          return h('div', { class: 'cx-packcard' }, packArt(pack),
            h('p', { class: 'muted' }, pack.blurb),
            h('div', { class: 'cx-actions' },
              h('button', { class: 'btn', disabled: !have, onclick: () => openPack(pack) }, have ? `Open (${have})` : 'None to open'),
              h('button', { class: 'btn ghost', disabled: state.me.coins < pack.price, onclick: () => act('cards:buy', { pack: pack.id }).then(() => setTimeout(renderPacks, 60)).catch(() => {}) }, `Buy · ${pack.price}`)));
        })),
        h('p', { class: 'muted cx-note' }, 'Cards you do not own yet are three times as likely to turn up. Copies past your third become Ink, and any card can be made with Ink from the Album.'));
    }
    function openPack(pack) {
      act('cards:open', { pack: pack.id }).then((r) => reveal(pack, r), () => {});
    }
    function reveal(pack, result) {
      const cards = result.drawn;
      let flipped = 0;
      const next = h('div', { class: 'cx-actions' });
      const backdrop = h('div', { class: 'cx-reveal' });
      const flip = (holder, c) => {
        if (holder.classList.contains('shown')) return;
        holder.classList.add('shown');
        flipped++;
        const rarity = D.getCard(c.id).rarity;
        sfxFlip(rarity);
        if (rarity === 'rare' || rarity === 'legendary' || c.foil) confetti(rarity === 'legendary' ? 90 : 36, [D.RARITIES[rarity].color, '#ffffff', '#ffd23f']);
        if (flipped === cards.length) setsToast(result.sets), showDone();
      };
      const row = h('div', { class: 'cx-reveal-row' }, cards.map((c, i) => {
        const def = D.getCard(c.id);
        const holder = h('button', { class: `cx-flip r-${def.rarity}`, style: { '--delay': `${i * 90}ms` }, 'aria-label': 'Reveal card', onclick: () => flip(holder, c) },
          h('div', { class: 'cx-flip-in' },
            h('div', { class: 'cx-flip-back' }, h('span', {}, '札')),
            h('div', { class: 'cx-flip-front' }, renderCard(def, { foil: c.foil || data.foils.includes(c.id), isNew: c.isNew }))),
          h('small', { class: 'cx-flip-tag' }, c.isNew ? 'New!' : c.ink ? `+${c.ink} Ink` : D.RARITIES[def.rarity].name));
        return holder;
      }));
      function showDone() {
        next.replaceChildren(
          ...((data.packs[pack.id] || 0) > 0 ? [h('button', { class: 'btn', onclick: () => { backdrop.remove(); openPack(pack); } }, `Open another (${data.packs[pack.id]})`)] : []),
          h('button', { class: 'btn ghost', onclick: () => { backdrop.remove(); renderPacks(); } }, 'Done'));
      }
      next.append(h('button', { class: 'btn', onclick: () => { [...row.children].forEach((b, i) => setTimeout(() => flip(b, cards[i]), i * 220)); } }, 'Reveal all'));
      backdrop.append(h('h3', { class: 'cx-reveal-title' }, pack.name), row, next);
      body.append(backdrop);
    }

    // ---------- ladder ----------
    function rewardText(r) {
      return [r.coins ? `${r.coins} coins` : '', r.pack ? D.PACKS[r.pack].name : '', r.card ? `foil ${D.getCard(r.card).name}` : ''].filter(Boolean).join(' + ');
    }
    function renderLadder() {
      body.replaceChildren(
        h('p', { class: 'cx-lead' }, 'Sit down at a Cafe table alone and you play the next regular. Beat them to climb, once in each game.'),
        h('div', { class: 'cx-ladders' }, MODE_IDS.map((g) => {
          const at = data.ladder[g];
          const st = data.stats[g];
          return h('section', { class: 'cx-ladder', style: { '--mode': D.MODES[g].color } },
            h('h3', {}, `${D.MODES[g].icon} ${D.MODES[g].name}`),
            h('small', { class: 'muted' }, `${st.w} wins, ${st.l} losses${st.d ? `, ${st.d} draws` : ''}`),
            D.LADDER.map((o, i) => {
              const status = i < at ? 'beaten' : i === at ? 'next' : 'locked';
              return h('div', { class: `cx-rung ${status}` },
                Avatar.portrait({ v: 1, id: `h-${o.id}`, name: o.name, color: o.gi, headband: o.headband, belt: o.belt, accessories: {} }, 44),
                h('div', { class: 'grow' }, h('b', {}, status === 'locked' ? '???' : o.name), h('small', {}, status === 'locked' ? 'Beat the regular above' : `“${o.line}”`)),
                h('span', { class: 'cx-reward' }, status === 'beaten' ? '✓ Beaten' : rewardText(o.reward)));
            }));
        })));
    }

    // ---------- rules ----------
    function renderRules() {
      const techs = Object.values(D.TECHNIQUES).map((t) => h('li', {}, h('b', {}, `${t.icon} ${t.name}. `), t.text));
      const order = ['fire', 'air', 'earth', 'water'].map((k) => `${D.ELEMENTS[k].icon} ${D.ELEMENTS[k].name}`).join(' beats ');
      body.replaceChildren(h('div', { class: 'cx-rules' },
        h('section', {}, h('h3', {}, '🎭 Turncoat'), h('ul', {},
          h('li', {}, 'Take turns placing a card on any empty square.'),
          h('li', {}, 'It attacks all four neighbours. If your side is stronger than the side facing it, that ninja joins you.'),
          h('li', {}, 'Each card you own is a point, and a shrine square adds one more. Most points wins.'))),
        h('section', {}, h('h3', {}, '🥁 Ring Out'), h('ul', {},
          h('li', {}, 'Take turns slamming a card onto any empty square.'),
          h('li', {}, 'Beat a neighbour and it is shoved one square. Every card behind it makes the line one heavier. Rocks stop a line dead.'),
          h('li', {}, 'Cards pushed off the mat or into a pit are knocked out for a point. Each shrine you hold at the end is two points.'))),
        h('section', {}, h('h3', {}, 'Both games'), h('ul', {},
          h('li', {}, `You hold ${D.DECK.handSize} cards from a deck of ${D.DECK.size} and draw back up after each play.`),
          h('li', {}, `${order} beats Fire, and Light and Dark beat each other: +1 when attacking.`),
          h('li', {}, 'A card on a tile of its own element has +1 on every side.'),
          h('li', {}, 'Ki Burst, once a match: the card you are playing gets +1 on every side for good.'),
          h('li', {}, 'Some boards give one player a small head start to keep things fair. Look for it next to the score.'))),
        h('section', {}, h('h3', {}, 'Techniques'), h('ul', {}, techs))));
    }

    // ---------- sound ----------
    let actx = null;
    function tone(freq, dur, vol, type = 'triangle', delay = 0) {
      try {
        actx = actx || new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === 'suspended') actx.resume().catch(() => {});
        const t = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
        o.type = type; o.frequency.value = freq;
        g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.05);
      } catch {}
    }
    function sfxFlip(rarity) {
      const base = { common: 392, uncommon: 494, rare: 587, legendary: 784 }[rarity];
      tone(base, 0.22, 0.06);
      if (rarity === 'rare' || rarity === 'legendary') { tone(base * 1.5, 0.4, 0.05, 'triangle', 0.09); tone(base * 2, 0.6, 0.04, 'triangle', 0.18); }
    }
    const SCALE = [392, 440, 523, 587, 659, 784, 880];

    // ---------- the Cafe ----------
    function me() { return state.me && world.players.get(state.me.id); }
    async function openHall() {
      let r;
      try { r = await conn.request('cards:hall'); } catch (e) { toast(e.message, true); return; }
      openModal('The Cafe', 'Hall of Fame',
        h('p', { class: 'muted' }, 'The most wins across both card games.'),
        r.top.length ? h('ol', { class: 'cx-hall' }, r.top.map((row, i) => h('li', {}, h('span', { class: 'cx-place' }, ['🥇', '🥈', '🥉'][i] || `${i + 1}.`), h('b', { class: 'grow' }, row.name), h('span', {}, `${row.wins} win${row.wins === 1 ? '' : 's'}`), h('small', { class: 'muted' }, `${row.plays} played`))))
          : h('p', {}, 'Nobody has played yet. The top spot is wide open.'),
        r.news.length ? h('div', {}, h('h2', { class: 'sub' }, 'Tonight at the tables'), h('ul', { class: 'cx-news' }, r.news.map((n) => h('li', {}, n.text)))) : null,
        h('div', { class: 'foot' }, h('span'), h('button', { class: 'btn ghost', onclick: closeModal }, 'Close')));
    }
    function talk(npc) {
      if (npc.npc === 'dealer') { open(); return true; }
      if (npc.interact === 'hall') { openHall(); return true; }
      if (npc.interact === 'cat') { if (me()) world.floatText(state.me.id, '❤️'); tone(110, 0.5, 0.03, 'sine'); toast(['The cat purrs and does not open its eyes.', 'The cat stretches a paw towards you.', 'The cat has accepted you. For now.'][Math.floor(Math.random() * 3)]); return true; }
      if (npc.interact === 'piano') {
        for (let i = 0; i < 5; i++) tone(SCALE[Math.floor(Math.random() * SCALE.length)], 0.8, 0.06, 'triangle', i * 0.18);
        if (me()) world.floatText(state.me.id, '🎵');
        return true;
      }
      return false;
    }

    // ---------- lobby panel: pick your deck and see who you are up against ----------
    const lobbyPanels = new Set();
    function refreshLobbies() { for (const fn of [...lobbyPanels]) { if (!fn.el.isConnected) lobbyPanels.delete(fn); else fn(); } }
    function lobbyPanel(game) {
      const wrap = h('section', { class: 'cx-lobby' });
      function draw() {
        if (!data) return;
        const usable = data.decks.map((d, i) => ({ d, i })).filter(({ d }) => d.cards.length === D.DECK.size);
        const step = Math.min(data.ladder[game], D.LADDER.length - 1);
        const o = D.LADDER[step];
        wrap.replaceChildren(
          h('div', { class: 'cx-lobby-row' },
            h('label', {}, 'Your deck ',
              h('select', { onchange: (e) => act('cards:active', { game, slot: Number(e.target.value) }).catch(() => draw()) },
                usable.map(({ d, i }) => h('option', { value: i, selected: data.active[game] === i }, d.name)))),
            h('button', { class: 'btn ghost small', onclick: () => open('decks') }, 'Edit decks')),
          h('div', { class: 'cx-lobby-row' },
            Avatar.portrait({ v: 1, id: `h-${o.id}`, name: o.name, color: o.gi, headband: o.headband, belt: o.belt, accessories: {} }, 44),
            h('div', { class: 'grow' }, h('small', {}, data.ladder[game] >= D.LADDER.length ? 'Ladder finished. Rematch:' : `Playing alone? Rung ${step + 1} of ${D.LADDER.length}:`), h('b', {}, o.name)),
            h('small', { class: 'muted' }, 'A second ninja at this table plays you instead.')));
      }
      draw.el = wrap;
      lobbyPanels.add(draw);
      load().then(draw).catch(() => {});
      return wrap;
    }

    // ---------- news and rewards ----------
    conn.on('cards:news', (m) => chatLine(`🃏 ${m.text}`, 'sys'));
    conn.on('cards:reward', (m) => {
      const lines = [];
      if (m.firstWin) lines.push('First win of the day: a free Street Pack');
      if (m.ladder) lines.push(`Beat ${m.ladder}${m.coins ? `: +${m.coins} coins` : ''}`);
      if (m.cards && m.cards.length) lines.push(`New card: ${D.getCard(m.cards[0].id).name}`);
      if (m.sets && m.sets.names.length) lines.push(`Finished ${m.sets.names.join(' and ')}`);
      if (m.packs && m.packs.length > (m.firstWin ? 1 : 0)) lines.push(`Pack earned: ${D.PACKS[m.packs[m.packs.length - 1]].name}`);
      const card = h('div', { class: 'toast win' }, h('small', {}, 'Cafe reward'), lines.join(' · '), h('span', { class: 'toast-pay' }, 'Open the Cards menu to see it'));
      toasts.append(card);
      setTimeout(() => card.remove(), 6000);
    });
    function badge() {
      const b = [...root.querySelectorAll('.menu button')].find((x) => x.textContent.startsWith('Cards'));
      if (!b || !state.me) return;
      const n = state.me.cardsBadge || 0;
      b.textContent = n ? `Cards (${n})` : 'Cards';
    }
    conn.on('you', () => setTimeout(() => { badge(); if (isOpen()) refreshWallet(); }));

    const api = { open, close, isOpen, talk, lobbyPanel };
    window.ClubDojoCards.current = api;
    return api;
  }

  window.ClubDojoCards = { create, renderCard, lobbyPanel: (game) => window.ClubDojoCards.current.lobbyPanel(game) };
})();
