// Ring Out: shove rivals off the mat and hold the shrines. Rules: shared/cards/rules.js
const { createDuel } = require('../card-duel');

module.exports = createDuel('ring-out', {
  description: 'Slam ninjas onto the mat to shove rivals across it. Hold shrines and knock opponents off the edge to score.',
  guideRewards: {
    house: { win: { coins: 45, xp: 22 }, draw: { coins: 15, xp: 8 }, loss: { coins: 10, xp: 5 } },
    duel: { win: { coins: 70, xp: 35 }, draw: { coins: 35, xp: 18 }, loss: { coins: 25, xp: 12 } },
  },
});
