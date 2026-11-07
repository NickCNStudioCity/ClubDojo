# Making a ClubDojo minigame

This guide is for building a new minigame. Each game is self-contained (one server file, one client file, one registry line), so several can be built at the same time without touching each other's code.

**Reference game:** Dojo Memory, in `server/src/minigames/games/dojo-memory.js` and `shared/client/minigames/games/dojo-memory.js`.
**Starting point:** the `_template.js` file next to each of those.

## How it fits together

```
 Map (room JSON)                 Server                                   Client (inside the game window)
 ┌──────────────────┐            ┌───────────────────────────────┐        ┌──────────────────────────────┐
 │ minigames: [     │  player    │ engine.js (shared by all games)│ mg:*   │ host.js (shared by all games)│
 │  {id, game, x, y}│──walks to─▶│  lobby → countdown → playing   │◀──────▶│  lobby, countdown, results   │
 │ ]  (pavilions)   │  the pad   │        → results → lobby       │        │  overlay                     │
 └──────────────────┘            │  rewards, scores, admin config │        │                              │
                                 │            │                   │        │            │                 │
                                 │   games/<id>.js  ("playing")   │ mg:msg │  games/<id>.js ("playing")   │
                                 │   rules, timing, scoring       │◀──────▶│  drawing, input, sound       │
                                 └───────────────────────────────┘ mg:input└──────────────────────────────┘
```

- **The engine** (`server/src/minigames/engine.js`) runs one lobby per pavilion. It handles joining, ready-up, the 3-second countdown, the results screen, rewards (with the admin multiplier and a per-match cap), saving to `minigame_scores`, and cleanup when players leave or disconnect. A crash in your game's code stops that match with a notice; it does not take the server down.
- **The host** (`shared/client/minigames/host.js`) shows the same lobby, countdown and results screens for every game, inside the game window. It loads your client file on demand from `shared/client/minigames/games/<id>.js`.
- **Your game** only implements the round itself, on both sides.

The server is the source of truth: clients send inputs (taps, aim, key presses) and draw what the server says. Never let a client send a score.

## Steps

1. **Pick an id**, using lowercase letters and dashes (for example `shuriken-arena`). The server file, the client file and the registry entry all use the same id.
2. **Server rules:** copy `server/src/minigames/games/_template.js` to `games/<id>.js`. Fill in the metadata, `defaults`, `rewards()` and `create(ctx)`.
3. **Client screen:** copy `shared/client/minigames/games/_template.js` to `games/<id>.js` and change the `id`. Build the round UI in `mount(ctx)`.
4. **Register it:** add `require('./games/<id>')` to `INSTALLED` in `server/src/minigames/registry.js`. If the game is listed in `PLANNED`, remove it from there.
5. **Check it:** run `npm run check:minigames`. It confirms the client file registers the right id, and runs matches with idle players and with random inputs on a simulated clock. A failure usually means a round can't end without player input, or a player is missing from the results.
6. **Try it:** run `npm run server`, then the admin client. In **Map Editor**, use the **Minigame pavilion** brush to place your game, then **Publish**. Walk a player client up to the pavilion.
7. **Tune it:** the admin **Minigames** tab can open or close a game and set its reward multiplier. Your `defaults` are the tuning values (admin tuning overrides are stored but don't have an editor yet).

## Server module

```js
module.exports = {
  id, name, description,           // shown in the minigame list
  minPlayers, maxPlayers,          // lobby limits (the host can start once minPlayers are in)
  color, icon,                     // pavilion roof color and emoji sign
  tickRate: 0,                     // >0 → tick(dt) runs that many times per second (action games: 15–30)
  defaults: { ... },               // tuning, read through ctx.settings
  rewards(result, { players }) { return { coins, xp }; },   // optional, per player
  create(ctx) { return { start, input, tick, leave, dispose }; },
};
```

| `ctx` member | Use |
|---|---|
| `ctx.players` | `[{ id, name, loadout }]`, snapshotted when the round starts. See [character-loading.md](character-loading.md). |
| `ctx.settings` | `defaults` merged with admin tuning. |
| `ctx.send(id, data)` / `ctx.broadcast(data)` | Message one player or everyone. Arrives in the client's `onMessage(data)`. Keep messages small; prefer events over full state every tick. |
| `ctx.after(ms, fn)`, `ctx.every(ms, fn)`, `ctx.cancel(h)` | Timers. All are cleared automatically when the match ends or aborts. Use these instead of `setTimeout` so `check:minigames` can run your game on simulated time. |
| `ctx.now()`, `ctx.randomInt(n)` | Time and randomness. Use these instead of `Date.now()` and `Math.random()` so tests stay deterministic later. |
| `ctx.end(results)` | Finish the match: `[{ id, score }]` for every player in `ctx.players`. Call it once; extra calls are ignored. |
| `ctx.isPlaying(id)` | False once a player has left. |

Instance methods:
- `start()` runs when the countdown ends.
- `input(id, data)` receives everything the client sends. Validate it all: type, range, and whether the action is allowed right now.
- `tick(dt)` runs only if `tickRate > 0`. `dt` is in seconds.
- `leave(id)` runs when a player leaves or disconnects mid-round. Keep going with the others, or call `ctx.end` if the game can't continue.
- `dispose()` frees anything you created outside `ctx` timers.

**Rewards:** the engine places players by score (ties share a place), calls your `rewards()`, multiplies by the admin's setting, and caps each match at 500 coins and 250 XP. Without `rewards()`, a player gets coins equal to their score and XP equal to half of it.

## Client module

```js
ClubDojoMinigames.register({
  id: 'my-game',
  mount(ctx) {
    // build UI inside ctx.el (DOM or <canvas>)
    return { onMessage(data) {}, onResults(results) {}, unmount() {} };
  },
});
```

| `ctx` member | Use |
|---|---|
| `ctx.el` | The stage element. It fills the game window under the minigame header, and the host clears it after the round. |
| `ctx.youId`, `ctx.players` | Who you are, and each player's `loadout`. |
| `ctx.send(data)` | Send an input to the server's `input(id, data)`. |
| `ctx.avatar` | `draw(ctx2d, loadout, { x, y, size, facing, walking, time })` draws a ninja with accessories. `portrait(loadout, px)` returns a ready-made canvas. |
| `ctx.h`, `ctx.toast`, `ctx.protocol` | DOM helper, toast messages, shared constants. |

Tips:
- **Self-contained styles:** add a `<style>` element in `mount` and prefix your classes (for example `dm-` for Dojo Memory). Colors and fonts can use the game's CSS variables (`--gold`, `--display`, and so on).
- **Clean up:** remove document-level listeners and stop animation frames in `unmount`.
- **Smoothness:** for action games, interpolate between server updates on the client, and treat local effects as cosmetic until the server confirms them.
- **Keyboard:** while the overlay is open, world shortcuts (chat, emotes) are off, so your game can use any keys.

## Placing games on the map

A pavilion is `{ id, game, x, y }` in a room's `minigames` list. It's 3×2 tiles and blocks walking, and the tile in front of it (its pad) is where players join. Admins place, re-assign and remove pavilions with the Map Editor brushes. The server rejects pavilions that overlap each other, cover a door, sit off the map, or have a blocked pad. Starter layouts live in `server/src/rooms-seed.js`.

## Messages (for reference)

| Direction | Type | Purpose |
|---|---|---|
| client → server | `mg:list` | Games, pavilion locations, lobby counts, your stats |
| client → server | `mg:join {spotId}`, `mg:leave`, `mg:ready {ready}`, `mg:start` | Lobby actions |
| client → server | `mg:input {data}` | Forwarded to your `input()` |
| server → lobby | `mg:lobby {lobby}` | Phase, players with loadouts, host, countdown end |
| server → lobby | `mg:msg {key, data}` | Your game's `send` / `broadcast` |
| server → lobby | `mg:results {results}` | Places, scores, coins, XP |
| server → lobby | `mg:notice`, `mg:closed` | Errors and lobby closed |
| server → room | `mg:spots {spots}` | Pavilion badges in the world ("2/4 waiting") |

## Checklist before calling a game done

- [ ] `npm run check:minigames` passes.
- [ ] A round ends on its own when nobody plays, and when only one player is left after others leave.
- [ ] Every input is validated on the server, and the client never decides a score.
- [ ] It works at the minimum and maximum player counts.
- [ ] `unmount()` leaves no listeners or loops running.
- [ ] Rewards feel fair next to Dojo Memory (about 2 coins per point).
- [ ] It's added to `npm run smoke`, or has its own scripted test, if it has tricky rules.

Belt progression and rank-ups are out of scope for minigames for now; see [../notes/belt-progression.md](../notes/belt-progression.md).
