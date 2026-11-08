// Server side of the two card games. Builds a minigame module for a mode; the rules themselves are
// in shared/cards/rules.js. One ninja plays the next House regular, two ninjas play each other.
const Data = require('../../../shared/cards/data');
const R = require('../../../shared/cards/rules');
const AI = require('../../../shared/cards/ai');

const WIN_BONUS = 20;
const END_AFTER_ANIM_MS = 700;
const REACTIONS = ['👍', '😮', '😂', '😤', '🙇', '🔥'];

// Rough time the client needs to play a move's animation, so the House never moves on top of it.
function animMs(events) {
  return 450 + events.reduce((n, e) => n + ({ flip: 420, shove: 420, ko: 520, ward: 420, whirl: 260, rally: 200, hold: 120, blocked: 120 }[e.type] || 0), 0);
}

function outcomeFor(w, seat) { return w === 0 ? 'draw' : w === seat ? 'win' : 'loss'; }

function createDuel(modeId, { description, guideRewards }) {
  const mode = Data.MODES[modeId];
  const boards = Data.boardsFor(modeId);
  return {
    id: modeId, name: mode.name, description, minPlayers: 1, maxPlayers: 2, color: mode.color, icon: mode.icon, tickRate: 0,
    defaults: { turnSeconds: 40 },
    rewards(row) {
      const d = row.detail || {};
      return guideRewards[d.vsHouse ? 'house' : 'duel'][d.outcome || 'loss'];
    },
    create(ctx) {
      const humans = ctx.players.slice(0, 2);
      const vsHouse = humans.length < 2;
      const step = vsHouse ? (humans[0].data && Number.isInteger(humans[0].data.step) ? humans[0].data.step : 0) : 0;
      const house = vsHouse ? Data.LADDER[Math.min(step, Data.LADDER.length - 1)] : null;
      const deckOf = (p) => (p && p.data && Array.isArray(p.data.deck) && p.data.deck.length === Data.DECK.size ? p.data.deck : Data.STARTER_DECK);
      const seatOf = new Map(humans.map((p, i) => [p.id, i + 1]));
      const humanAt = (seat) => humans[seat - 1] || null;
      const rng = () => ctx.randomInt(1000000) / 1000000;
      const turnMs = (ctx.settings.turnSeconds || 40) * 1000;

      const board = boards[ctx.randomInt(boards.length)];
      const first = 1 + ctx.randomInt(2);
      let state = R.createMatch({ mode: modeId, boardId: board.id, decks: { 1: deckOf(humans[0]), 2: vsHouse ? house.deck : deckOf(humans[1]) }, first, rng });
      let turnTimer = null;
      let deadline = null;
      let finished = false;
      const lastReact = new Map();

      const seatInfo = (seat) => {
        const p = humanAt(seat);
        if (p) return { name: p.name, loadout: p.loadout };
        return { name: house.name, house: true, line: house.line, loadout: { v: 1, id: `house-${house.id}`, name: house.name, color: house.gi, headband: house.headband, belt: house.belt, accessories: {} } };
      };

      function sendAll(build) {
        for (const p of humans) if (ctx.isPlaying(p.id)) ctx.send(p.id, build(seatOf.get(p.id)));
      }

      function armClock() {
        if (turnTimer) { ctx.cancel(turnTimer); turnTimer = null; }
        if (state.over) { deadline = null; return; }
        if (!humanAt(state.turn)) { deadline = null; return; }
        deadline = ctx.now() + turnMs;
        turnTimer = ctx.after(turnMs, () => {
          // Out of time: a random-ish move is played for them, so a table can never stall.
          const m = AI.choose(state, { level: 0, rng });
          if (m) play(m);
        });
      }

      function play(move) {
        const { state: next, events } = R.applyMove(state, move);
        state = next;
        armClock();
        sendAll((seat) => ({ type: 'move', view: R.viewFor(state, seat), events, deadline, msLeft: deadline ? deadline - ctx.now() : null }));
        if (state.over) { ctx.after(animMs(events) + END_AFTER_ANIM_MS, finish); return; }
        scheduleHouse(animMs(events));
      }

      function scheduleHouse(delay) {
        if (state.over || humanAt(state.turn)) return;
        ctx.after(delay + 500 + ctx.randomInt(500), () => {
          if (finished || state.over) return;
          const m = AI.choose(state, { level: house.level, rng });
          if (m) play(m);
        });
      }

      function finish(forfeit) {
        if (finished) return;
        finished = true;
        if (turnTimer) ctx.cancel(turnTimer);
        const w = forfeit || R.winner(state);
        const sc = R.score(state);
        const rows = humans.map((p) => {
          const seat = seatOf.get(p.id);
          const outcome = outcomeFor(w, seat);
          const opp = R.other(seat);
          const oppName = seatInfo(opp).name;
          const detail = {
            outcome, vsHouse, step, board: board.name, points: sc[seat], against: sc[opp], forfeit: !!forfeit,
            headline: outcome === 'win' ? `${p.name} beat ${oppName} at ${mode.name}, ${sc[seat]} to ${sc[opp]}.` : null,
          };
          // Against the House only a win earns "points", so a loss can't count as first place.
          const score = vsHouse ? (outcome === 'win' ? sc[seat] + WIN_BONUS : 0) : sc[seat] + (outcome === 'win' ? WIN_BONUS : outcome === 'draw' ? WIN_BONUS / 2 : 0);
          return { id: p.id, score: outcome === 'draw' && !vsHouse ? WIN_BONUS : score, detail };
        });
        sendAll((seat) => ({ type: 'end', outcome: outcomeFor(w, seat), score: sc, you: seat, forfeit: !!forfeit, ladder: vsHouse ? house.name : null }));
        ctx.end(rows);
      }

      return {
        start() {
          armClock();
          sendAll((seat) => ({
            type: 'begin', you: seat, first, view: R.viewFor(state, seat), boardName: board.name, boardBlurb: board.blurb,
            seats: { 1: seatInfo(1), 2: seatInfo(2) }, deadline, msLeft: deadline ? deadline - ctx.now() : null, step, vsHouse,
          }));
          scheduleHouse(2400);
        },
        input(id, data) {
          const seat = seatOf.get(id);
          if (!seat || finished) return;
          if (data.type === 'react') {
            if (!REACTIONS.includes(data.emote) || ctx.now() - (lastReact.get(id) || 0) < 1200) return;
            lastReact.set(id, ctx.now());
            sendAll(() => ({ type: 'react', seat, emote: data.emote }));
            return;
          }
          if (data.type !== 'play' || state.over || state.turn !== seat) return;
          const move = { uid: Number(data.uid), cell: Number(data.cell), burst: !!data.burst };
          try { play(move); } catch (e) { ctx.send(id, { type: 'illegal', text: e.message }); }
        },
        leave(id) {
          const seat = seatOf.get(id);
          if (!seat || finished) return;
          if (vsHouse) { finished = true; if (turnTimer) ctx.cancel(turnTimer); return; }
          finish(R.other(seat));
        },
        dispose() { finished = true; },
      };
    },
  };
}

module.exports = { createDuel, REACTIONS };
