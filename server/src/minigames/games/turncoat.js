// Turncoat: place ninjas and win the enemy's over to your side. Rules: shared/cards/rules.js
const { createDuel } = require('../card-duel');

module.exports = createDuel('turncoat', {
  description: 'Place ninjas side by side. Beat a neighbour with a stronger side and they join you. Most ninjas at the end wins.',
  guideRewards: {
    house: { win: { coins: 45, xp: 22 }, draw: { coins: 15, xp: 8 }, loss: { coins: 10, xp: 5 } },
    duel: { win: { coins: 70, xp: 35 }, draw: { coins: 35, xp: 18 }, loss: { coins: 25, xp: 12 } },
  },
});
