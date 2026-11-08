// Turncoat (client). The match screen is shared with Ring Out: shared/client/card-duel.js
ClubDojoMinigames.register({
  id: 'turncoat',
  ownEnding: true,
  guide: {
    summary: 'Place ninjas on the table. Beat a neighbour with a stronger side and they join you. Most points at the end wins.',
    controls: [['Click a card', 'Pick it up'], ['Hover a square', 'See who you would win over'], ['Click a square', 'Play the card'], ['1 2 3 / B', 'Pick a card / arm Ki Burst']],
    tips: ['A card is only as safe as its weakest open side.', 'Element tiles add +1. Shrines are worth an extra point.', 'Playing alone? You take on the next House regular.'],
  },
  lobbyPanel: () => window.ClubDojoCards.lobbyPanel('turncoat'),
  mount(ctx) { return window.ClubDojoCardDuel.mount(ctx, 'turncoat'); },
});
