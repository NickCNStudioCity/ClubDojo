// Ring Out (client). The match screen is shared with Turncoat: shared/client/card-duel.js
ClubDojoMinigames.register({
  id: 'ring-out',
  ownEnding: true,
  guide: {
    summary: 'Slam ninjas onto the mat to shove rivals across it. Knock them off the edge for a point, and hold shrines for two each at the end.',
    controls: [['Click a card', 'Pick it up'], ['Hover a square', 'See who you would shove'], ['Click a square', 'Slam the card down'], ['1 2 3 / B', 'Pick a card / arm Ki Burst']],
    tips: ['Each card behind a target makes the line one heavier.', 'A shove can carry your own card over the edge.', 'Rocks stop a line dead, so a card against one is safe from that side.'],
  },
  lobbyPanel: () => window.ClubDojoCards.lobbyPanel('ring-out'),
  mount(ctx) { return window.ClubDojoCardDuel.mount(ctx, 'ring-out'); },
});
