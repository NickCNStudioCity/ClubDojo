// Fishing (server rules). Club Penguin style: lower the line by holding left click, let go to reel in.
// Fish swim under the water; the hook catches them as it passes. Once the hook is out of the water,
// left click to take each fish off the hook. Every fish is paid out in coins, so the score is coins.
// Client: shared/client/minigames/games/fishing.js

// Water begins at depth WATER. The hook is out of the water at depth 0 (resting above the surface).
const WATER = 0.12;

// Fish species. Weight controls how often they spawn; value is coins paid when landed.
const KINDS = {
  minnow: { value: 2, weight: 50, speed: 0.12 },
  perch: { value: 5, weight: 30, speed: 0.09 },
  snapper: { value: 10, weight: 15, speed: 0.07 },
  golden: { value: 25, weight: 5, speed: 0.05 },
};
const KIND_IDS = Object.keys(KINDS);
const TOTAL_WEIGHT = KIND_IDS.reduce((sum, k) => sum + KINDS[k].weight, 0);

module.exports = {
  id: 'fishing',
  name: 'Fishing',
  description: 'Lower the line, hook the fish, and reel them in. Click them off the hook once they are out of the water.',
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
    lowerPerSec: 0.45, // hook depth gained per second while holding
    reelPerSec: 0.5, // hook depth lost per second when reeling
    escapePerSec: 0.15, // chance per second that a hooked fish wriggles free underwater
  },

  // Coins are the score, so the payout is the score itself. XP is a fifth of it.
  rewards(result) {
    return { coins: result.score, xp: Math.floor(result.score / 5) };
  },

  create(ctx) {
    const s = ctx.settings;
    const line = { x: 0.5, depth: 0, hold: false };
    const pond = []; // { id, kind, x, depth, dir, hooked }
    let nextId = 1;
    let score = 0;
    let ended = false;
    let endsAt = 0;
    const player = ctx.players[0];

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
      const kind = randomKind();
      const fromLeft = ctx.randomInt(2) === 0;
      pond.push({
        id: nextId++,
        kind,
        x: fromLeft ? 0.02 : 0.98,
        depth: 0.25 + ctx.randomInt(70) / 100, // 0.25 .. 0.95
        dir: fromLeft ? 1 : -1,
        hooked: false,
      });
    }

    function hookedFish() {
      return pond.filter((f) => f.hooked);
    }

    function finish() {
      if (ended) return;
      ended = true;
      ctx.end([{ id: player.id, score }]);
    }

    function clamp(v, lo, hi) {
      return Math.min(hi, Math.max(lo, v));
    }

    function tryHook() {
      if (line.depth <= WATER) return;
      let count = hookedFish().length;
      for (const f of pond) {
        if (count >= s.maxHook) break;
        if (f.hooked) continue;
        if (Math.abs(f.x - line.x) < s.hookRadius && Math.abs(f.depth - line.depth) < s.hookDepthTol) {
          f.hooked = true;
          count++;
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

    function escapeCheck(dt) {
      if (line.depth <= WATER) return; // fish stay on the hook once they are out of the water
      for (const f of hookedFish()) {
        if (ctx.randomInt(10000) < s.escapePerSec * dt * 10000) {
          f.hooked = false;
          f.dir = ctx.randomInt(2) === 0 ? 1 : -1;
        }
      }
    }

    function moveLine(dt) {
      const hasFish = hookedFish().length > 0;
      if (line.hold && !hasFish) {
        line.depth = clamp(line.depth + s.lowerPerSec * dt, 0, 1);
      } else {
        line.depth = clamp(line.depth - s.reelPerSec * dt, 0, 1);
      }
      for (const f of hookedFish()) {
        f.x = line.x;
        f.depth = line.depth;
      }
    }

    function snapshot() {
      return {
        type: 'state',
        line: { x: line.x, depth: line.depth, hold: line.hold },
        fish: pond.map((f) => ({ id: f.id, kind: f.kind, x: f.x, depth: f.depth, dir: f.dir, hooked: f.hooked })),
        score,
        timeLeft: Math.max(0, endsAt - ctx.now()),
      };
    }

    return {
      start() {
        endsAt = ctx.now() + s.roundMs;
        ctx.broadcast({ type: 'begin', roundMs: s.roundMs });
        for (let i = 0; i < Math.ceil(s.maxFish / 2); i++) spawn();
        ctx.every(s.spawnMs, spawn);
        ctx.after(s.roundMs, finish);
      },

      input(id, msg) {
        if (ended || id !== player.id || !msg || typeof msg !== 'object') return;
        switch (msg.type) {
          case 'move': {
            const x = Number(msg.x);
            if (Number.isFinite(x)) line.x = clamp(x, 0, 1);
            break;
          }
          case 'hold':
            line.hold = msg.on === true;
            break;
          case 'unhook': {
            // Only out of the water, and only fish that are actually on the hook.
            if (line.depth > 0) return;
            const target = msg.id === undefined
              ? hookedFish()[0]
              : hookedFish().find((f) => f.id === Number(msg.id));
            if (!target) return;
            pond.splice(pond.indexOf(target), 1);
            const value = KINDS[target.kind].value;
            score += value;
            ctx.send(id, { type: 'landed', id: target.id, kind: target.kind, value, score });
            break;
          }
          default:
        }
      },

      tick(dt) {
        if (ended) return;
        moveFish(dt);
        moveLine(dt);
        tryHook();
        escapeCheck(dt);
        ctx.broadcast(snapshot());
      },

      leave() {
        finish();
      },

      dispose() {
        pond.length = 0;
      },
    };
  },
};
