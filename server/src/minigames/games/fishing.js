// Fishing (server rules). The bobber follows the mouse cursor (or a finger on a touch screen).
// The client sends where the cursor is; the line swims toward it at a capped speed, slower when it
// carries fish, so the pond can't be swept in one frame. Fish swim under the water and the hook
// catches them as it passes. Once the hook is out of the water, click each fish to take it off.
// Every fish is paid out in coins, so the score is coins.
//
// Extras that keep a round interesting:
//   - depth bands: valuable fish live deeper, so going deep is risky but pays
//   - jellyfish: touching one with the line underwater shakes every fish off the hook
//   - time fish: landing one adds seconds to the clock
//   - combo: fish landed in a row without losing one raise a coin multiplier (up to x3)
//   - full haul: bring up a full hook and get a bonus when the last fish comes off
//   - frenzy: in the last seconds fish spawn twice as fast
// Client: shared/client/minigames/games/fishing.js

// Water begins at depth WATER. The hook is out of the water at depth <= WATER.
const WATER = 0.12;

// Fish species. Weight controls how often they spawn; value is coins paid when landed.
// minDepth..maxDepth is the band of the pond each species swims in.
const KINDS = {
  minnow: { value: 2, weight: 46, speed: 0.12, minDepth: 0.22, maxDepth: 0.55 },
  perch: { value: 5, weight: 28, speed: 0.09, minDepth: 0.3, maxDepth: 0.72 },
  snapper: { value: 10, weight: 14, speed: 0.075, minDepth: 0.5, maxDepth: 0.9 },
  golden: { value: 25, weight: 4, speed: 0.06, minDepth: 0.72, maxDepth: 0.95 },
  timefish: { value: 3, weight: 5, speed: 0.1, minDepth: 0.3, maxDepth: 0.85, bonusMs: 5000 },
};
const KIND_IDS = Object.keys(KINDS);
const TOTAL_WEIGHT = KIND_IDS.reduce((sum, k) => sum + KINDS[k].weight, 0);

// Combo multiplier from the number of fish landed in a row.
function comboMult(streak) {
  return Math.min(3, 1 + Math.floor(streak / 4) * 0.5);
}

module.exports = {
  id: 'fishing',
  name: 'Fishing',
  description: 'Steer the bobber with the mouse, hook the fish and bring them up. Avoid the jellyfish, chain catches for a combo, and land a full hook for a bonus.',
  minPlayers: 1,
  maxPlayers: 1,
  color: '#16a085',
  icon: '🎣',
  tickRate: 15, // the line and the fish move on each tick

  // Tuning values; admins can override later. Read them through ctx.settings.
  defaults: {
    roundMs: 60000,
    maxFish: 7, // fish in the pond at once
    spawnMs: 1400, // how often a new fish may appear
    maxHook: 3, // fish that can be on the hook at once
    hookRadius: 0.035, // how close (fraction of pond width) a fish must swim to the hook
    hookDepthTol: 0.05, // how close in depth it must be
    escapePerSec: 0.15, // chance per second that a hooked fish wriggles free underwater
    lineSpeed: 1.5, // how far the line moves per second toward the cursor (pond fractions)
    loadSlow: 0.12, // each hooked fish slows the line by this fraction
    jellies: 2, // jellyfish drifting in the pond
    zapMs: 1200, // how long the line can't hook anything after touching a jellyfish
    haulBonus: 10, // coins for landing a full hook
    frenzyMs: 10000, // the last stretch of the round where fish spawn twice as fast
    maxBonusMs: 20000, // cap on extra time from time fish in one round
  },

  // Coins are the score, so the payout is the score itself. XP is a fifth of it.
  rewards(result) {
    return { coins: result.score, xp: Math.floor(result.score / 5) };
  },

  create(ctx) {
    const s = ctx.settings;
    const line = { x: 0.5, depth: 0, tx: 0.5, tdepth: 0 }; // tx/tdepth: where the cursor is
    const pond = []; // { id, kind, x, depth, dir, hooked }
    const jellies = []; // { id, x, depth, dir, phase }
    let nextId = 1;
    let score = 0;
    let streak = 0; // fish landed in a row without losing one
    let bestStreak = 0;
    let caught = 0;
    let ended = false;
    let endsAt = 0;
    let bonusMs = 0;
    let zappedUntil = 0;
    let spawnAcc = 0;
    let fullHaul = false; // the hook came up with maxHook fish on it
    let wasOut = true; // line was out of the water on the previous tick
    const player = ctx.players[0];

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const rand = (lo, hi) => lo + (ctx.randomInt(1000) / 1000) * (hi - lo);
    const hookedFish = () => pond.filter((f) => f.hooked);
    const timeLeft = () => Math.max(0, endsAt - ctx.now());

    function randomKind() {
      let roll = ctx.randomInt(TOTAL_WEIGHT);
      for (const k of KIND_IDS) {
        if (roll < KINDS[k].weight) return k;
        roll -= KINDS[k].weight;
      }
      return KIND_IDS[0];
    }

    function spawn() {
      if (ended || pond.length >= s.maxFish) return;
      let kind = randomKind();
      if (kind === 'timefish' && bonusMs >= s.maxBonusMs) kind = 'minnow';
      const k = KINDS[kind];
      const fromLeft = ctx.randomInt(2) === 0;
      pond.push({
        id: nextId++,
        kind,
        x: fromLeft ? 0.02 : 0.98,
        depth: rand(k.minDepth, k.maxDepth),
        dir: fromLeft ? 1 : -1,
        hooked: false,
      });
    }

    function spawnJelly(i) {
      jellies.push({
        id: nextId++,
        x: 0.2 + (0.6 * (i + 0.5)) / Math.max(1, s.jellies),
        depth: rand(0.35, 0.85),
        dir: ctx.randomInt(2) === 0 ? 1 : -1,
        phase: rand(0, Math.PI * 2),
      });
    }

    function finish() {
      if (ended) return;
      ended = true;
      ctx.end([{ id: player.id, score }]);
    }

    function loseStreak() {
      streak = 0;
    }

    function tryHook() {
      if (line.depth <= WATER || ctx.now() < zappedUntil) return;
      let count = hookedFish().length;
      for (const f of pond) {
        if (count >= s.maxHook) break;
        if (f.hooked) continue;
        if (Math.abs(f.x - line.x) < s.hookRadius && Math.abs(f.depth - line.depth) < s.hookDepthTol) {
          f.hooked = true;
          count++;
          ctx.send(player.id, { type: 'hooked', id: f.id, kind: f.kind });
        }
      }
    }

    function moveFish(dt) {
      for (const f of pond) {
        if (f.hooked) continue;
        f.x += f.dir * KINDS[f.kind].speed * dt;
        if (f.x < 0.02 || f.x > 0.98) f.dir = -f.dir; // turn around at the edges
        f.x = clamp(f.x, 0.02, 0.98);
      }
    }

    // Jellyfish drift slowly sideways and pulse up and down.
    function moveJellies(dt) {
      for (const j of jellies) {
        j.phase += dt * 1.3;
        j.x += j.dir * 0.03 * dt;
        if (j.x < 0.06 || j.x > 0.94) j.dir = -j.dir;
        j.x = clamp(j.x, 0.06, 0.94);
        j.depth = clamp(j.depth + Math.sin(j.phase) * 0.05 * dt, 0.3, 0.92);
      }
    }

    function jellyCheck() {
      if (line.depth <= WATER || ctx.now() < zappedUntil) return;
      for (const j of jellies) {
        if (Math.abs(j.x - line.x) < 0.04 && Math.abs(j.depth - line.depth) < 0.06) {
          const lost = hookedFish();
          for (const f of lost) {
            f.hooked = false;
            f.dir = ctx.randomInt(2) === 0 ? 1 : -1;
          }
          zappedUntil = ctx.now() + s.zapMs;
          fullHaul = false;
          loseStreak();
          ctx.send(player.id, { type: 'zap', x: line.x, depth: line.depth, lost: lost.length });
          return;
        }
      }
    }

    function escapeCheck(dt) {
      if (line.depth <= WATER) return; // fish stay on the hook once they are out of the water
      for (const f of hookedFish()) {
        if (ctx.randomInt(10000) < s.escapePerSec * dt * 10000) {
          f.hooked = false;
          f.dir = ctx.randomInt(2) === 0 ? 1 : -1;
          loseStreak();
          ctx.send(player.id, { type: 'escaped', id: f.id, kind: f.kind });
        }
      }
    }

    // The line swims toward the cursor at a capped speed. Hooked fish ride along with it.
    function moveLine(dt) {
      const load = hookedFish().length;
      const step = s.lineSpeed * Math.max(0.3, 1 - s.loadSlow * load) * dt;
      const dx = line.tx - line.x;
      const dd = line.tdepth - line.depth;
      const dist = Math.hypot(dx, dd);
      if (dist <= step || dist === 0) {
        line.x = line.tx;
        line.depth = line.tdepth;
      } else {
        line.x += (dx / dist) * step;
        line.depth += (dd / dist) * step;
      }
      const out = line.depth <= WATER;
      if (out && !wasOut) fullHaul = load >= s.maxHook; // the hook just broke the surface
      wasOut = out;
      for (const f of hookedFish()) {
        f.x = line.x;
        f.depth = line.depth;
      }
    }

    function snapshot() {
      const left = timeLeft();
      return {
        type: 'state',
        line: { x: line.x, depth: line.depth, zapped: ctx.now() < zappedUntil },
        fish: pond.map((f) => ({ id: f.id, kind: f.kind, x: f.x, depth: f.depth, dir: f.dir, hooked: f.hooked })),
        jellies: jellies.map((j) => ({ id: j.id, x: j.x, depth: j.depth, dir: j.dir })),
        score,
        streak,
        mult: comboMult(streak),
        timeLeft: left,
        frenzy: left <= s.frenzyMs,
        maxHook: s.maxHook,
      };
    }

    return {
      start() {
        endsAt = ctx.now() + s.roundMs;
        ctx.broadcast({ type: 'begin', roundMs: s.roundMs, maxHook: s.maxHook });
        for (let i = 0; i < Math.ceil(s.maxFish / 2); i++) spawn();
        for (let i = 0; i < s.jellies; i++) spawnJelly(i);
        // Time fish can extend the round, so the end is checked here and on every tick.
        ctx.every(250, () => { if (!ended && timeLeft() <= 0) finish(); });
      },

      input(id, msg) {
        if (ended || id !== player.id || !msg || typeof msg !== 'object') return;
        switch (msg.type) {
          case 'move': {
            // x and y are the cursor as fractions of the pond. y maps to depth; above the water is 0.
            const x = Number(msg.x);
            const y = Number(msg.y);
            if (Number.isFinite(x)) line.tx = clamp(x, 0, 1);
            if (Number.isFinite(y)) line.tdepth = clamp(y, 0, 1);
            break;
          }
          case 'unhook': {
            // Only out of the water, and only fish that are actually on the hook.
            if (line.depth > WATER) return;
            const target = msg.id === undefined
              ? hookedFish()[0]
              : hookedFish().find((f) => f.id === Number(msg.id));
            if (!target) return;
            pond.splice(pond.indexOf(target), 1);
            const kind = KINDS[target.kind];
            const mult = comboMult(streak);
            let value = Math.round(kind.value * mult);
            streak++;
            caught++;
            bestStreak = Math.max(bestStreak, streak);
            let addMs = 0;
            if (kind.bonusMs && bonusMs < s.maxBonusMs) {
              addMs = Math.min(kind.bonusMs, s.maxBonusMs - bonusMs);
              bonusMs += addMs;
              endsAt += addMs;
            }
            let haul = 0;
            if (fullHaul && hookedFish().length === 0) {
              haul = s.haulBonus;
              fullHaul = false;
            }
            value += haul;
            score += value;
            ctx.send(id, {
              type: 'landed', id: target.id, kind: target.kind, value, mult, haul, addMs,
              score, streak, caught, bestStreak,
            });
            break;
          }
          default:
        }
      },

      tick(dt) {
        if (ended) return;
        if (timeLeft() <= 0) { finish(); return; }
        // Spawning runs off the tick so the final frenzy can speed it up.
        spawnAcc += dt * 1000 * (timeLeft() <= s.frenzyMs ? 2 : 1);
        while (spawnAcc >= s.spawnMs) { spawnAcc -= s.spawnMs; spawn(); }
        moveFish(dt);
        moveJellies(dt);
        moveLine(dt);
        jellyCheck();
        tryHook();
        escapeCheck(dt);
        ctx.broadcast(snapshot());
      },

      leave() {
        finish();
      },

      dispose() {
        pond.length = 0;
        jellies.length = 0;
      },
    };
  },
};
