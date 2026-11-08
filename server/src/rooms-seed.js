// Starter village rooms. Loaded into the database on first run; after that the
// admin Map Editor owns them. Tile characters are defined in shared/protocol.js.
const W = 40;
const H = 24;

function grid(fill) {
  return Array.from({ length: H }, () => Array(W).fill(fill));
}
function rect(g, x, y, w, h, ch) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j] && i >= 0 && i < g[j].length) g[j][i] = ch;
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
  for (const [x, y, w, h] of [[23, 18, 3, 2], [13, 13, 2, 2], [10, 13, 2, 1], [33, 12, 3, 1]]) rect(g, x, y, w, h, 'f');
  // Minigame clearing paths, and a path from the square to the fishing dock.
  rect(g, 4, 14, 5, 1, ':');
  rect(g, 4, 17, 10, 1, ':');
  rect(g, 8, 18, 1, 2, ':');
  rect(g, 4, 20, 10, 1, ':');
  rect(g, 21, 21, 11, 1, ':');
  rect(g, 13, 21, 2, 3, ':'); // path south to the Grotto
  rect(g, 37, 10, 1, 2, ':'); // path to the Sports Park gate on the east edge
  // Fishing dock: planks out over the pond (the fishing spot sits on the end).
  rect(g, 30, 16, 3, 5, ',');
  // Trees: a dense edge on both sides plus a few in the open.
  const trees = [
    [0, 4], [1, 9], [0, 13], [1, 16], [0, 19], [1, 22], [3, 21], [6, 22], [12, 22], [17, 19],
    [39, 4], [38, 9], [39, 12], [38, 15], [39, 18], [38, 22], [36, 22], [31, 22], [26, 22],
    [16, 21], [24, 12], [11, 4], [27, 4], [15, 17],
  ];
  for (const [x, y] of trees) g[y][x] = '#';
  return {
    id: 'plaza',
    seedVersion: 8, // v8 moves the go-kart booth from here to the Sports Park track. v7 adds the Grotto portal and moves Cart Surfer into the Grotto cave
    name: 'Forest Village',
    width: W,
    height: H,
    tiles: rows(g),
    spawn: { x: 20, y: 14 },
    portals: [
      { x: 19, y: 9, w: 2, h: 1, to: 'dojo', tx: 20, ty: 20, label: 'Main Dojo' },
      { x: 6, y: 9, w: 2, h: 1, to: 'ramen', tx: 20, ty: 20, label: 'Ramen House' },
      { x: 37, y: 10, w: 1, h: 2, to: 'sports-park', tx: 1, ty: 13, label: 'Sports Park' },
      { x: 13, y: 23, w: 2, h: 1, to: 'grotto', tx: 14, ty: 21, label: 'Grotto' },
    ],
    // Minigame spots (pavilions). Admins add, move or remove these in the Map Editor.
    minigames: [
      { id: 'mg1', game: 'dojo-memory', x: 8, y: 15 },
      { id: 'mg2', game: 'sled-race', x: 3, y: 12 },
      { id: 'mg5', game: 'fishing', x: 30, y: 16 },
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

// Sports Park: east of the Forest Village. Four pitches: soccer, tennis and a football field on the
// north side, basketball and a go-kart track on the south. The pitches are flat "court" / "track"
// props drawn over the grass. Pavilions for the four new games sit on the walkway's north and south edges.
function sportsPark() {
  const SW = 48; // the park is wider than the village to fit the football field
  const g = Array.from({ length: H }, () => Array(SW).fill('g'));
  rect(g, 0, 0, SW, 3, '#'); // tree line along the top
  rect(g, 0, 3, 1, H - 3, '#'); // west edge, gap at the gate
  rect(g, SW - 1, 3, 1, H - 3, '#'); // east edge
  rect(g, 0, H - 1, SW, 1, '#'); // south edge
  rect(g, 0, 13, 1, 2, ':'); // gate (portal back to the village)
  rect(g, 1, 13, SW - 2, 2, ':'); // main walkway
  const trees = [];
  for (let y = 3; y < H - 1; y++) for (const x of [0, SW - 1]) if (g[y][x] === '#') trees.push({ type: 'tree', x, y, style: y % 2 ? 'pine' : 'leafy' });
  for (let x = 2; x < SW - 2; x += 3) if (g[H - 1][x] === '#') trees.push({ type: 'tree', x, y: H - 1, style: x % 2 ? 'leafy' : 'pine' });
  return {
    id: 'sports-park',
    name: 'Sports Park',
    seedVersion: 8, // v5 widened it for the football field; v6 fixes the walkway and edges past column 40; v8 moves the go-kart booth onto the track
    width: SW,
    height: H,
    tiles: rows(g),
    spawn: { x: 4, y: 14 },
    portals: [{ x: 0, y: 13, w: 1, h: 2, to: 'plaza', tx: 36, ty: 10, label: 'Forest Village' }],
    // Pavilions: a 3x2 spot whose pad (the tile below its middle) must be walkable.
    minigames: [
      { id: 'mg1', game: 'soccer', x: 6, y: 11 },
      { id: 'mg2', game: 'tennis', x: 24, y: 11 },
      { id: 'mg3', game: 'football', x: 39, y: 11 },
      { id: 'mg4', game: 'basketball', x: 13, y: 16 },
      { id: 'mg5', game: 'go-kart-race', x: 26, y: 14 }, // on the north edge of the track, pad on the track
    ],
    props: [
      { type: 'forest', x: 0, y: 0, w: SW, h: 3 },
      ...trees,
      { type: 'court', sport: 'soccer', x: 2, y: 3, w: 16, h: 8 },
      { type: 'court', sport: 'tennis', x: 21, y: 3, w: 12, h: 6 },
      { type: 'court', sport: 'football', x: 34, y: 3, w: 12, h: 7 },
      { type: 'court', sport: 'basketball', x: 2, y: 16, w: 10, h: 6 },
      { type: 'track', x: 16, y: 16, w: 20, h: 6 },
      { type: 'sign', x: 9, y: 9, text: 'Soccer Field' },
      { type: 'sign', x: 27, y: 9, text: 'Tennis Court' },
      { type: 'sign', x: 44, y: 9, text: 'Football Field' },
      { type: 'sign', x: 7, y: 15, text: 'Basketball' },
      { type: 'sign', x: 30, y: 15, text: 'Go-Kart Track' },
      { type: 'sign', x: 36, y: 12, text: 'Sports Park' },
      { type: 'lantern', x: 18, y: 12 },
      { type: 'lantern', x: 34, y: 15 },
      { type: 'lantern', x: 12, y: 15 },
    ],
  };
}

// Grotto: a rocky yard south of the Forest Village. The Cart Surfer cave is a building on the
// north side, like the hub buildings. Its door leads into the cave room (cave()).
// Layout: building x 15-24, y 3-8; door portal (19-20, 9); path down to the village gate at the bottom.
function grotto() {
  const GW = 40;
  const g = grid('g');
  rect(g, 0, 0, GW, 3, '#'); // rock backdrop along the top
  rect(g, 15, 3, 10, 6, '#'); // the cave building (drawn by the building prop)
  rect(g, 0, 3, 1, H - 3, '#'); // west edge
  rect(g, GW - 1, 3, 1, H - 3, '#'); // east edge
  rect(g, 0, H - 1, GW, 1, '#'); // south edge, gap at the entrance
  rect(g, 13, 23, 2, 1, ':'); // entrance (portal back to the village)
  rect(g, 19, 9, 2, 1, ':'); // path from the cave door
  rect(g, 13, 10, 14, 1, ':'); // yard path across the front of the cave
  rect(g, 13, 11, 2, 12, ':'); // path down to the gate
  rect(g, 27, 15, 6, 4, ':'); // gravel patch
  for (const [x, y, w, h] of [[4, 14, 4, 2], [6, 19, 3, 2], [31, 12, 4, 2]]) rect(g, x, y, w, h, '#'); // boulders
  const trees = [];
  for (let y = 3; y < H - 1; y++) for (const x of [0, GW - 1]) if (g[y][x] === '#') trees.push({ type: 'tree', x, y, style: y % 2 ? 'pine' : 'leafy' });
  return {
    id: 'grotto',
    name: 'Grotto',
    seedVersion: 9,
    width: GW,
    height: H,
    tiles: rows(g),
    spawn: { x: 14, y: 20 },
    portals: [
      { x: 13, y: 23, w: 2, h: 1, to: 'plaza', tx: 14, ty: 21, label: 'Forest Village' },
      { x: 19, y: 9, w: 2, h: 1, to: 'cave', tx: 20, ty: 20, label: 'Cart Surfer Cave' },
    ],
    minigames: [],
    props: [
      { type: 'forest', x: 0, y: 0, w: GW, h: 3 },
      ...trees,
      { type: 'building', x: 15, y: 3, w: 10, h: 6, label: 'CAVE', color: '#5d5a63', roof: '#2a2430' },
      { type: 'lantern', x: 13, y: 9 },
      { type: 'lantern', x: 26, y: 9 },
      { type: 'sign', x: 11, y: 21, text: 'Grotto' },
      { type: 'sign', x: 17, y: 11, text: 'Cart Surfer Cave' },
    ],
  };
}

// Cart Surfer cave: a room inside the Grotto building. The mine booth is on the open side;
// the right side is a closed-off section behind a rockfall.
function cave() {
  const g = grid(',');
  rect(g, 0, 0, W, 4, '#'); // back wall
  rect(g, 0, 0, 1, H, '#');
  rect(g, W - 1, 0, 1, H, '#');
  rect(g, 0, H - 1, W, 1, '#');
  rect(g, 19, H - 1, 2, 1, ','); // doorway
  rect(g, 28, 4, 1, H - 4, '#'); // rockfall wall: the closed section sits behind it
  rect(g, 29, 4, W - 30, 6, '#'); // rock mass filling the closed section's top
  rect(g, 30, 10, 9, 1, '#');
  return {
    id: 'cave',
    name: 'Cart Surfer Cave',
    width: W,
    height: H,
    tiles: rows(g),
    spawn: { x: 20, y: 20 },
    portals: [{ x: 19, y: H - 1, w: 2, h: 1, to: 'grotto', tx: 20, ty: 10, label: 'Grotto' }],
    minigames: [{ id: 'mg1', game: 'cart-surfer', x: 18, y: 8 }],
    props: [
      { type: 'wall', x: 0, y: 0, w: W, h: 4, color: '#4a4650' },
      { type: 'lantern', x: 8, y: 4 },
      { type: 'lantern', x: 22, y: 4 },
      { type: 'sign', x: 18, y: 12, text: 'Cart Surfer' },
      { type: 'sign', x: 33, y: 13, text: 'CLOSED - Rockfall' },
    ],
  };
}

// Bump SEED_VERSION and set seedVersion on a room to push a new starter layout to
// existing servers on their next start (db.js keeps the old layout in room_versions).
function seedRooms() {
  return [plaza(), dojo(), ramen(), sportsPark(), grotto(), cave()];
}
seedRooms.SEED_VERSION = 9;
module.exports = seedRooms;
