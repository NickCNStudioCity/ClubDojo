// Minigame registry. To add a game:
//   1. Copy games/_template.js to games/<your-id>.js and fill it in (server rules).
//   2. Copy shared/client/minigames/games/_template.js to shared/client/minigames/games/<your-id>.js (drawing + input).
//   3. Add one require line to INSTALLED below and remove the game from PLANNED if it was listed there.
// Full guide: docs/minigames/README.md
const INSTALLED = [
  require('./games/dojo-memory'),
  require('./games/fishing'),
  require('./games/sled-race'),
  require('./games/go-kart-race'),
  require('./games/cart-surfer'),
];

// Shown in the in-game minigame list as "coming soon" until a module is installed.
const PLANNED = [
  { id: 'shuriken-arena', name: 'Shuriken Arena', description: 'Throw shuriken at moving targets. Highest score wins.', minPlayers: 2, maxPlayers: 8, color: '#c0392b', icon: '✴️' },
  { id: 'snowfall-dodge', name: 'Snowfall Dodge', description: 'Dodge falling snowballs and icicles. Longest survival wins.', minPlayers: 1, maxPlayers: 8, color: '#2f6fd1', icon: '❄️' },
  { id: 'rooftop-race', name: 'Rooftop Race', description: 'Race across rooftops and jump gaps without falling.', minPlayers: 1, maxPlayers: 6, color: '#e67e22', icon: '🏃' },
];

const REQUIRED = ['id', 'name', 'description', 'minPlayers', 'maxPlayers', 'create'];

function check(game) {
  for (const k of REQUIRED) if (game[k] === undefined) throw new Error(`Minigame ${game.id || '(no id)'} is missing "${k}".`);
  if (!/^[a-z0-9-]+$/.test(game.id)) throw new Error(`Minigame id "${game.id}" must be lowercase letters, numbers and dashes.`);
  if (game.minPlayers < 1 || game.maxPlayers < game.minPlayers) throw new Error(`Minigame ${game.id} has a bad player range.`);
  if (typeof game.create !== 'function') throw new Error(`Minigame ${game.id}.create must be a function.`);
  return { tickRate: 0, defaults: {}, color: '#7a3b2e', icon: '🥋', ...game };
}

const games = new Map();
for (const g of INSTALLED.map(check)) {
  if (games.has(g.id)) throw new Error(`Two minigames use the id "${g.id}".`);
  games.set(g.id, g);
}

function meta(g, available) {
  return { id: g.id, name: g.name, description: g.description, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers, color: g.color, icon: g.icon, available };
}

module.exports = {
  get: (id) => games.get(id) || null,
  installed: () => [...games.values()],
  list: () => [...[...games.values()].map((g) => meta(g, true)), ...PLANNED.filter((p) => !games.has(p.id)).map((p) => meta(p, false))],
};
