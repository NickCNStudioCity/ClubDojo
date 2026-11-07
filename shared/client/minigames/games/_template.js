// Minigame template (client). Copy to games/<your-id>.js (same id as the server module).
// The host shows the lobby, countdown and results; you only draw the round and send inputs.
// Guide: docs/minigames/README.md
ClubDojoMinigames.register({
  id: 'my-game',

  // Called when the round starts. ctx gives you:
  //   ctx.el          the stage element inside the game window (fill it with DOM or a <canvas>)
  //   ctx.youId       your account id
  //   ctx.players     [{ id, name, loadout }]  draw ninjas with ctx.avatar.draw(...) or ctx.avatar.portrait(loadout, size)
  //   ctx.send(data)  send an input to the server module's input(id, data). Never send scores.
  //   ctx.avatar, ctx.protocol, ctx.h (DOM helper), ctx.toast(text)
  mount(ctx) {
    const { h, el } = ctx;
    const label = h('div', { style: { fontSize: '24px', textAlign: 'center', marginTop: '40px' } }, 'Press the button!');
    const button = h('button', { class: 'btn', onclick: () => ctx.send({ type: 'point' }) }, '+1');
    el.append(label, h('div', { style: { textAlign: 'center', marginTop: '16px' } }, button));

    // Example: draw your own ninja on a canvas.
    const canvas = h('canvas', { width: 120, height: 120 });
    el.append(canvas);
    const me = ctx.players.find((p) => p.id === ctx.youId);
    if (me) ctx.avatar.draw(canvas.getContext('2d'), me.loadout, { x: 60, y: 105, size: 64 });

    return {
      // Every ctx.send / ctx.broadcast from the server module lands here.
      onMessage(data) {
        if (data.type === 'begin') label.textContent = `Go! ${Math.round(data.roundMs / 1000)} seconds`;
      },
      // Optional: final results arrive just before the host shows its results screen.
      onResults(results) {},
      // Remove listeners and timers you added outside ctx.el (the host clears ctx.el).
      unmount() {},
    };
  },
});
