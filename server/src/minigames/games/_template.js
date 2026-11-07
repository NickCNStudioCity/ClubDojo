// Minigame template (server rules). Copy to games/<your-id>.js, rename, then register it in
// ../registry.js. The client half lives in shared/client/minigames/games/<your-id>.js.
// Guide: docs/minigames/README.md
//
// The engine owns the lobby, countdown, results, rewards and saving scores. This module
// only runs the round. Keep all scoring here on the server: clients send inputs, never scores.
module.exports = {
  id: 'my-game', // lowercase-with-dashes; must match the client file name
  name: 'My Game',
  description: 'One sentence shown in the minigame list.',
  minPlayers: 1,
  maxPlayers: 4,
  color: '#2f6fd1', // pavilion and list accent
  icon: '🥋',
  tickRate: 0, // >0 to get tick(dt) that many times per second (e.g. 20 for action games)

  // Tuning values; admins can override them later. Read them from ctx.settings.
  defaults: { roundMs: 30000 },

  // Optional. Base rewards for one player; the engine applies the admin multiplier and caps.
  rewards(result /* { id, score, place } */, { players }) {
    return { coins: result.score, xp: Math.floor(result.score / 2) };
  },

  // Called when the countdown ends. ctx gives you:
  //   ctx.players          [{ id, name, loadout }]   loadout = how to draw the ninja (see character-loading.md)
  //   ctx.settings         defaults merged with admin tuning
  //   ctx.send(id, data)   message one player     -> client module gets it in onMessage(data)
  //   ctx.broadcast(data)  message everyone in the match
  //   ctx.after(ms, fn) / ctx.every(ms, fn) / ctx.cancel(handle)   timers cleaned up for you
  //   ctx.randomInt(n), ctx.now(), ctx.log(...)
  //   ctx.end(results)     finish: [{ id, score }] for every player. Call exactly once.
  create(ctx) {
    const scores = new Map(ctx.players.map((p) => [p.id, 0]));

    return {
      start() {
        ctx.broadcast({ type: 'begin', roundMs: ctx.settings.roundMs });
        ctx.after(ctx.settings.roundMs, () => ctx.end(ctx.players.map((p) => ({ id: p.id, score: scores.get(p.id) }))));
      },
      // Inputs from the client module's ctx.send(data). Validate everything.
      input(id, msg) {
        if (msg.type === 'point') scores.set(id, scores.get(id) + 1);
      },
      // Optional: called every 1/tickRate seconds with dt in seconds.
      tick(dt) {},
      // Optional: a player left mid-round (disconnect or Leave button).
      leave(id) {},
      // Optional: free anything not created through ctx timers.
      dispose() {},
    };
  },
};
