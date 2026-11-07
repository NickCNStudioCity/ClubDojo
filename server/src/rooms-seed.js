// Starter village rooms. Loaded into the database on first run; after that the
// admin Map Editor owns them. Tile characters are defined in shared/protocol.js.
const W = 40;
const H = 24;

function grid(fill) {
  return Array.from({ length: H }, () => Array(W).fill(fill));
}
function rect(g, x, y, w, h, ch) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j] && i >= 0 && i < W) g[j][i] = ch;
}
function rows(g) {
  return g.map((r) => r.join(''));
}

// Hub: the Forest Village (v1.1 replaced the original Snow Plaza).
function plaza() {
  const g = grid('g');
  rect(g, 0, 0, W, 3, '#'); // forest backdrop
  rect(g, 15, 3, 10, 6, '#'); // Main Dojo
  rect(g, 2, 4, 9, 5, '#'); // Ramen House
  rect(g, 29, 4, 8, 5, '#'); // Market (opens with the shop)
  // Dirt paths linking the doors, the village square and the minigame clearing.
  rect(g, 3, 10, 34, 2, ':');
  rect(g, 19, 9, 2, 13, ':');
  rect(g, 6, 9, 2, 1, ':');
  rect(g, 32, 9, 2, 1, ':');
  rect(g, 9, 12, 1, 6, ':');
  rect(g, 16, 13, 8, 3, ':'); // village square
  // Pond with a flower bank.
  rect(g, 28, 15, 8, 5, '~');
  rect(g, 27, 14, 10, 1, 'f');
  rect(g, 27, 20, 10, 1, 'f');
  for (const [x, y, w, h] of [[23, 18, 3, 2], [13, 13, 2, 2], [4, 18, 3, 1], [33, 12, 3, 1]]) rect(g, x, y, w, h, 'f');
  // Trees: a dense edge on both sides plus a few in the open.
  const trees = [
    [0, 4], [1, 9], [0, 13], [1, 16], [0, 19], [1, 22], [3, 21], [6, 22], [12, 22], [14, 20],
    [39, 4], [38, 9], [39, 12], [38, 15], [39, 18], [38, 22], [36, 22], [31, 22], [26, 22],
    [13, 17], [24, 12], [11, 4], [27, 4], [4, 14], [15, 11 + 6],
  ];
  for (const [x, y] of trees) g[y][x] = '#';
  return {
    id: 'plaza',
    seedVersion: 2,
    name: 'Forest Village',
    width: W,
    height: H,
    tiles: rows(g),
    spawn: { x: 20, y: 14 },
    portals: [
      { x: 19, y: 9, w: 2, h: 1, to: 'dojo', tx: 20, ty: 20, label: 'Main Dojo' },
      { x: 6, y: 9, w: 2, h: 1, to: 'ramen', tx: 20, ty: 20, label: 'Ramen House' },
    ],
    // Minigame spots (pavilions). Admins add, move or remove these in the Map Editor.
    minigames: [
      { id: 'mg1', game: 'dojo-memory', x: 8, y: 15 },
      { id: 'mg2', game: 'sled-race', x: 3, y: 12 },
    ],
    props: [
      { type: 'forest', x: 0, y: 0, w: W, h: 3 },
      { type: 'building', x: 15, y: 3, w: 10, h: 6, label: 'MAIN DOJO', color: '#7a3b2e', roof: '#3a1d17' },
      { type: 'building', x: 2, y: 4, w: 9, h: 5, label: 'RAMEN HOUSE', color: '#b5562f', roof: '#5b2a17' },
      { type: 'building', x: 29, y: 4, w: 8, h: 5, label: 'MARKET', color: '#4f6d7a', roof: '#24343c' },
      ...trees.map(([x, y], i) => ({ type: 'tree', x, y, style: i % 3 === 0 ? 'pine' : 'leafy' })),
      { type: 'lantern', x: 14, y: 9 },
      { type: 'lantern', x: 25, y: 9 },
      { type: 'lantern', x: 11, y: 9 },
      { type: 'lantern', x: 22, y: 16 },
      { type: 'sign', x: 17, y: 13, text: 'Forest Village' },
      { type: 'sign', x: 11, y: 14, text: 'Minigames' },
    ],
  };
}

function interior(id, name, opts) {
  const g = grid(',');
  rect(g, 0, 0, W, 4, '#'); // back wall
  rect(g, 0, 0, 1, H, '#');
  rect(g, W - 1, 0, 1, H, '#');
  rect(g, 0, H - 1, W, 1, '#');
  rect(g, 19, H - 1, 2, 1, ','); // doorway
  for (const b of opts.blocks) rect(g, b[0], b[1], b[2], b[3], '#');
  for (const m of opts.mats || []) rect(g, m[0], m[1], m[2], m[3], m[4]);
  return {
    id,
    name,
    width: W,
    height: H,
    tiles: rows(g),
    spawn: { x: 20, y: 20 },
    portals: [{ x: 19, y: H - 1, w: 2, h: 1, to: 'plaza', tx: opts.exitX, ty: 11, label: 'Snow Plaza' }],
    props: [{ type: 'wall', x: 0, y: 0, w: W, h: 4, color: opts.wall }, ...opts.props],
  };
}

function dojo() {
  return interior('dojo', 'Main Dojo', {
    exitX: 20,
    wall: '#5a2c22',
    blocks: [[19, 5, 1, 1], [8, 9, 1, 1], [12, 9, 1, 1], [27, 9, 1, 1], [31, 9, 1, 1]],
    mats: [[14, 10, 12, 8, '=']],
    props: [
      { type: 'npc', x: 19, y: 5, name: 'Sensei Oru' },
      { type: 'dummy', x: 8, y: 9 }, { type: 'dummy', x: 12, y: 9 },
      { type: 'dummy', x: 27, y: 9 }, { type: 'dummy', x: 31, y: 9 },
      { type: 'banner', x: 6, y: 1 }, { type: 'banner', x: 33, y: 1 },
      { type: 'lantern', x: 15, y: 4 }, { type: 'lantern', x: 24, y: 4 },
    ],
  });
}

function ramen() {
  return interior('ramen', 'Ramen House', {
    exitX: 7,
    wall: '#7a3a1c',
    blocks: [[6, 5, 28, 2], [6, 12, 3, 2], [14, 12, 3, 2], [23, 12, 3, 2], [31, 12, 3, 2], [10, 17, 3, 2], [27, 17, 3, 2]],
    props: [
      { type: 'counter', x: 6, y: 5, w: 28, h: 2 },
      { type: 'table', x: 6, y: 12 }, { type: 'table', x: 14, y: 12 }, { type: 'table', x: 23, y: 12 },
      { type: 'table', x: 31, y: 12 }, { type: 'table', x: 10, y: 17 }, { type: 'table', x: 27, y: 17 },
      { type: 'lantern', x: 10, y: 4 }, { type: 'lantern', x: 20, y: 4 }, { type: 'lantern', x: 30, y: 4 },
      { type: 'sign', x: 19, y: 8, text: 'Shop opens soon' },
    ],
  });
}

// Bump SEED_VERSION and set seedVersion on a room to push a new starter layout to
// existing servers on their next start (db.js keeps the old layout in room_versions).
function seedRooms() {
  return [plaza(), dojo(), ramen()];
}
seedRooms.SEED_VERSION = 2;
module.exports = seedRooms;
