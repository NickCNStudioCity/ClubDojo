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

// Grotto: a leafy yard south of the Forest Village. A rocky hill on the north side has a cave mouth
// that leads into the cave room (cave()).
// Layout: hill x 15-24, y 3-8; cave mouth portal (19-20, 9); path down to the village gate at the bottom.
function grotto() {
  const GW = 40;
  const g = grid('g');
  rect(g, 0, 0, GW, 3, '#'); // rock backdrop along the top
  rect(g, 15, 3, 10, 6, '#'); // the rocky hill (drawn by the cave prop)
  rect(g, 0, 3, 1, H - 3, '#'); // west edge
  rect(g, GW - 1, 3, 1, H - 3, '#'); // east edge
  rect(g, 0, H - 1, GW, 1, '#'); // south edge, gap at the entrance
  rect(g, 13, 23, 2, 1, ':'); // entrance (portal back to the village)
  rect(g, GW - 1, 13, 1, 2, ':'); // east gap: path to the Mountain Town
  rect(g, 19, 9, 2, 1, ':'); // path from the cave mouth
  rect(g, 13, 10, 14, 1, ':'); // yard path across the front of the cave
  rect(g, 13, 11, 2, 12, ':'); // path down to the gate
  rect(g, 27, 15, 6, 4, ':'); // gravel patch
  for (const [x, y, w, h] of [[4, 14, 4, 2], [6, 19, 3, 2], [31, 12, 4, 2]]) rect(g, x, y, w, h, '#'); // boulders
  // Flower beds. Only open grass is planted, so paths and boulders stay clear.
  const beds = [[2, 7, 5, 2], [8, 7, 4, 2], [28, 7, 5, 2], [34, 7, 3, 2], [3, 12, 6, 1], [16, 12, 7, 2], [25, 12, 5, 2], [36, 11, 2, 2],
    [16, 16, 8, 2], [9, 16, 3, 3], [34, 16, 4, 2], [2, 21, 4, 1], [16, 22, 8, 1], [27, 20, 8, 1]];
  for (const [bx, by, bw, bh] of beds) for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) if (g[y][x] === 'g') g[y][x] = 'f';
  // Trees through the yard, kept clear of the paths and signs.
  const yardTrees = [[2, 5], [4, 4], [7, 5], [10, 4], [12, 6], [27, 5], [30, 4], [33, 5], [36, 4], [37, 7], [2, 10], [5, 11], [9, 9], [11, 12],
    [3, 17], [10, 14], [11, 18], [3, 20], [9, 22], [18, 14], [22, 13], [24, 18], [17, 20], [21, 21], [26, 21], [30, 21], [35, 19], [36, 15], [29, 10], [33, 9]];
  const trees = [];
  for (const [x, y] of yardTrees) { g[y][x] = '#'; trees.push({ type: 'tree', x, y, style: (x + y) % 3 === 0 ? 'pine' : 'leafy' }); }
  for (let y = 3; y < H - 1; y++) for (const x of [0, GW - 1]) if (g[y][x] === '#') trees.push({ type: 'tree', x, y, style: y % 2 ? 'pine' : 'leafy' });
  return {
    id: 'grotto',
    name: 'Grotto',
    seedVersion: 14, // v14 combines the Mountain Town gap and portal with the cave mouth, trees and flowers
    width: GW,
    height: H,
    tiles: rows(g),
    spawn: { x: 14, y: 20 },
    portals: [
      { x: 13, y: 23, w: 2, h: 1, to: 'plaza', tx: 14, ty: 21, label: 'Forest Village' },
      { x: 19, y: 9, w: 2, h: 1, to: 'cave', tx: 20, ty: 20, label: 'Cave' },
      { x: GW - 1, y: 13, w: 1, h: 2, to: 'mountain-town', tx: 1, ty: 13, label: 'Mountain Town' },
    ],
    minigames: [],
    props: [
      { type: 'forest', x: 0, y: 0, w: GW, h: 3 },
      ...trees,
      { type: 'cave', x: 15, y: 3, w: 10, h: 6 },
      { type: 'lantern', x: 13, y: 9 },
      { type: 'lantern', x: 26, y: 9 },
      { type: 'sign', x: 11, y: 21, text: 'Grotto' },
      { type: 'sign', x: 17, y: 11, text: 'Cave' },
    ],
  };
}

// The cave: the room behind the cave mouth in the Grotto. The mine booth is on the open side;
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
    name: 'Cave',
    seedVersion: 12, // v12 renames it to just Cave
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

// Mountain Town: an alpine town at the foot of the mountain, east of the Grotto. Golden larches,
// cobbled streets and three working buildings: the Trail Post (the Guide's journal), the Ember Lodge
// (cocoa out front) and the Bathhouse (its hot spring pays you to stay). Art: shared/client/mountain-art.js.
function mountainTown() {
  const TW = 40;
  const g = grid('g');
  const S = (p) => { rect(g, p.x, p.y, p.w || 1, p.h || 1, '#'); return p; }; // a prop you cannot walk through
  rect(g, 0, 0, TW, 4, '#'); // the mountain behind the town
  rect(g, 12, 4, 2, 8, ':'); // trail north to the mountain gate
  rect(g, 0, 12, TW, 2, ':'); // cobbled main street (both ends stay open)
  rect(g, 3, 14, 11, 7, ':'); // town square
  rect(g, 20, 14, 2, 8, ':'); // lane south into the larch grove
  rect(g, 18, 20, 6, 2, ':'); // grove clearing
  rect(g, 30, 14, 2, 1, ':'); // steps down to the hot spring
  rect(g, 28, 15, 9, 5, ':'); // the hot spring (walkable: wade in)
  for (const [x, y, w, h] of [[1, 15, 2, 3], [24, 14, 3, 1], [24, 19, 1, 2], [5, 21, 7, 1]]) rect(g, x, y, w, h, 'f');
  rect(g, 16, 19, 4, 2, ':'); // the Cafe's front step, joining the lane
  const pines = [[1, 5], [2, 9], [14, 6], [1, 16], [1, 20], [2, 22], [13, 22], [16, 22], [27, 22], [34, 22], [38, 21], [38, 16], [38, 5]];
  const larches = [[15, 8], [24, 16], [26, 19], [24, 22], [15, 21], [29, 21], [36, 21], [10, 22]];
  const props = [
    { type: 'alpine', x: 0, y: 0, w: TW, h: 4 },
    { type: 'minegate', x: 11, y: 1, w: 4, h: 3 },
    S({ type: 'lodge', style: 'trailpost', x: 3, y: 6, w: 8, h: 5, label: 'TRAIL POST' }),
    S({ type: 'lodge', style: 'lodge', x: 16, y: 5, w: 10, h: 6, label: 'EMBER LODGE' }),
    S({ type: 'lodge', style: 'bathhouse', x: 31, y: 6, w: 7, h: 5, label: 'BATHHOUSE' }),
    S({ type: 'gondola', x: 27, y: 4, w: 4, h: 3, toX: 42, toY: -2 }),
    { type: 'hotspring', x: 28, y: 15, w: 9, h: 5, warm: true },
    S({ type: 'noticeboard', x: 5, y: 11, w: 2, h: 1 }),
    S({ type: 'npc', npc: 'guide', x: 8, y: 11, name: 'Guide Yuki', gi: '#2f6d8c', headband: '#f5d33b', belt: 'brown', hat: true, hover: 'Talk to Guide Yuki' }),
    // The Cafe: card tables, a fire and a place to sit. The door is on its south side.
    S({ type: 'cafe-front', x: 14, y: 14, w: 6, h: 5, label: 'CAFE' }),
    S({ type: 'cocoacart', x: 17, y: 11, w: 3, h: 1 }),
    S({ type: 'npc', npc: 'cocoa', x: 20, y: 11, name: 'Kiku', gi: '#a8532f', headband: '#fff1d6', belt: 'orange', hat: true, hover: 'Buy cocoa from Kiku' }),
    S({ type: 'fountain', x: 7, y: 16, w: 3, h: 3 }),
    S({ type: 'stall', x: 3, y: 16, w: 3, h: 1, awning: '#c0473a' }),
    S({ type: 'stall', x: 11, y: 16, w: 3, h: 1, awning: '#2f8a8c' }),
    S({ type: 'bench', x: 4, y: 19, w: 2, h: 1 }), S({ type: 'bench', x: 11, y: 19, w: 2, h: 1 }),
    S({ type: 'bench', x: 19, y: 22, w: 2, h: 1 }), S({ type: 'bench', x: 22, y: 22, w: 2, h: 1 }),
    S({ type: 'snowman', x: 25, y: 21 }), S({ type: 'snowman', x: 12, y: 17, variant: 1 }),
    S({ type: 'woodpile', x: 27, y: 9, w: 3, h: 2 }), S({ type: 'skirack', x: 11, y: 10 }), S({ type: 'buckets', x: 27, y: 15 }),
    S({ type: 'boulder', x: 34, y: 14, w: 2, h: 1 }), S({ type: 'boulder', x: 37, y: 18, w: 1, h: 2 }),
    ...pines.map(([x, y]) => S({ type: 'pine', x, y })),
    ...larches.map(([x, y]) => S({ type: 'larch', x, y })),
    { type: 'flags', x: 11, y: 7.2, x2: 16, y2: 6.6, depth: 24 },
    { type: 'flags', x: 26, y: 6.8, x2: 31, y2: 7.4, depth: 24 },
    ...[[1, 11], [10, 14], [15, 11], [24, 14], [29, 11], [37, 11], [14, 20], [19, 19], [23, 19]].map(([x, y]) => ({ type: 'lamp', x, y })),
    { type: 'sign', x: 2, y: 11, text: 'Mountain Town' },
  ];
  return {
    id: 'mountain-town',
    name: 'Mountain Town',
    theme: 'alpine',
    seedVersion: 16, // v16 adds the Cafe and its door; v12 is the alpine rebuild: working buildings, hot spring, Guide and cocoa
    width: TW,
    height: H,
    tiles: rows(g),
    spawn: { x: 3, y: 13 },
    portals: [
      { x: 0, y: 12, w: 1, h: 2, to: 'grotto', tx: 38, ty: 13, label: 'Grotto' },
      { x: 12, y: 4, w: 2, h: 1, to: 'mountain-peak', tx: 12, ty: 21, label: 'Mountain Peak' },
      { x: 16, y: 19, w: 2, h: 1, to: 'cafe', tx: 20, ty: 21, label: 'Cafe' },
    ],
    minigames: [],
    props,
  };
}

// The Cafe, inside: four card tables down the middle, a fire and sofas to the west, the barista at
// the back and the card dealer to the east. Art: shared/client/cafe-art.js. The fire's warmth pays
// like the hot spring does, and pays more with company, so it is worth hanging around in here.
function cafe() {
  const g = grid(',');
  const S = (p) => { rect(g, p.x, p.y, p.w || 1, p.h || 1, '#'); return p; };
  rect(g, 0, 0, W, 4, '#'); // back wall
  rect(g, 0, 0, 1, H, '#');
  rect(g, W - 1, 0, 1, H, '#');
  rect(g, 0, H - 1, W, 1, '#');
  rect(g, 19, H - 1, 2, 1, ','); // doorway
  rect(g, 13, 4, 14, 1, '#'); // behind the counter
  return {
    id: 'cafe',
    name: 'The Cafe',
    seedVersion: 16,
    width: W,
    height: H,
    tiles: rows(g),
    spawn: { x: 20, y: 21 },
    portals: [{ x: 19, y: H - 1, w: 2, h: 1, to: 'mountain-town', tx: 16, ty: 20, label: 'Mountain Town' }],
    minigames: [
      { id: 'mg1', game: 'turncoat', x: 13, y: 9 },
      { id: 'mg2', game: 'turncoat', x: 24, y: 9 },
      { id: 'mg3', game: 'ring-out', x: 13, y: 15 },
      { id: 'mg4', game: 'ring-out', x: 24, y: 15 },
    ],
    props: [
      { type: 'cafe-room', x: 0, y: 0, w: W, h: H },
      S({ type: 'cafe-hearth', x: 1, y: 5, w: 4, h: 4, warm: 8 }),
      S({ type: 'cafe-counter', x: 14, y: 5, w: 12, h: 1 }),
      S({ type: 'npc', npc: 'cocoa', x: 19, y: 4, name: 'Mochi', kicker: 'The Cafe', gi: '#7a4a2a', headband: '#fff1d6', belt: 'orange', hover: 'Buy cocoa from Mochi' }),
      S({ type: 'cafe-booth', x: 30, y: 4, w: 6, h: 2 }),
      S({ type: 'npc', npc: 'dealer', x: 32, y: 6, name: 'Dealer Ren', gi: '#3f4fa8', headband: '#f5b82e', belt: 'black', hover: 'Cards, packs and decks' }),
      S({ type: 'cafe-board', interact: 'hall', x: 36, y: 9, w: 3, h: 2, hover: 'Hall of Fame' }),
      S({ type: 'cafe-sofa', x: 6, y: 11, w: 4, h: 1, color: '#2f6d62' }),
      S({ type: 'cafe-chair', x: 10, y: 6, color: '#a8532f' }), S({ type: 'cafe-chair', x: 10, y: 9, color: '#a8532f' }),
      S({ type: 'cafe-cat', interact: 'cat', x: 5, y: 9, hover: 'Pet the cafe cat' }),
      S({ type: 'cafe-shelf', x: 1, y: 13, w: 1, h: 4 }), S({ type: 'cafe-shelf', x: 38, y: 13, w: 1, h: 4 }),
      S({ type: 'cafe-piano', interact: 'piano', x: 33, y: 19, w: 4, h: 2, hover: 'Play the piano' }),
      S({ type: 'cafe-sofa', x: 3, y: 20, w: 4, h: 1, color: '#7a3b5e' }), S({ type: 'table', x: 8, y: 20 }),
      ...[[1, 10], [1, 21], [38, 7], [38, 21], [12, 22], [27, 22]].map(([x, y]) => S({ type: 'cafe-plant', x, y })),
    ],
  };
}

// Mountain Peak: the snowy summit reached through the mountain gate. The Summit Bell and the beacon
// stand at the top, a campfire pays you to stay, and a frozen lake is quicker to cross than snow.
function mountainPeak() {
  const PW = 40;
  const g = grid('.');
  const S = (p) => { rect(g, p.x, p.y, p.w || 1, p.h || 1, '#'); return p; };
  rect(g, 0, 0, PW, 4, '#'); // the summit ridge
  rect(g, 0, 4, 1, H - 4, '#'); // west cliff
  rect(g, PW - 1, 4, 1, H - 4, '#'); // east cliff
  rect(g, 0, H - 1, PW, 1, '#'); // south edge
  rect(g, 12, 14, 2, 10, ':'); // the trail up from the Mountain Town (portal at the bottom)
  rect(g, 7, 13, 14, 1, ':'); // ridge walk
  rect(g, 7, 8, 1, 5, ':'); // to the Sled Race pad
  rect(g, 20, 8, 1, 5, ':'); // stone steps to the bell
  for (let y = 12; y <= 21; y++) for (let x = 23; x <= 38; x++) {
    if (((x - 30.5) / 7) ** 2 + ((y - 16.5) / 4.4) ** 2 <= 1) g[y][x] = '*'; // the frozen lake
  }
  const pines = [];
  for (let y = 4; y < H - 1; y += 2) pines.push([0, y], [PW - 1, y + 1]);
  pines.push([3, 6], [15, 20], [18, 22], [3, 14], [9, 22], [25, 22], [36, 22], [37, 10]);
  const props = [
    { type: 'alpine', x: 0, y: 0, w: PW, h: 4, high: true },
    { type: 'lakeshore', x: 23, y: 12, w: 16, h: 10 },
    S({ type: 'bell', interact: 'bell', x: 18, y: 4, w: 5, h: 4, hover: 'Ring the Summit Bell' }),
    S({ type: 'beacon', x: 25, y: 5, w: 2, h: 2 }),
    S({ type: 'gondola', x: 33, y: 4, w: 4, h: 3, toX: 42, toY: 10 }),
    S({ type: 'campfire', x: 7, y: 18, warm: 2 }),
    S({ type: 'bench', x: 4, y: 18, w: 2, h: 1 }), S({ type: 'bench', x: 9, y: 18, w: 2, h: 1 }), S({ type: 'bench', x: 7, y: 20, w: 2, h: 1 }),
    S({ type: 'woodpile', x: 3, y: 16, w: 2, h: 1 }),
    S({ type: 'cairn', x: 15, y: 6 }), S({ type: 'cairn', x: 28, y: 9 }), S({ type: 'cairn', x: 23, y: 10 }),
    S({ type: 'crystals', x: 36, y: 7, w: 2, h: 2 }), S({ type: 'crystals', x: 16, y: 16, w: 2, h: 2 }), S({ type: 'crystals', x: 2, y: 11, w: 2, h: 1 }),
    S({ type: 'snowman', x: 22, y: 19 }), S({ type: 'snowman', x: 33, y: 21, variant: 1 }),
    S({ type: 'boulder', x: 30, y: 7, w: 2, h: 2 }), S({ type: 'boulder', x: 10, y: 5, w: 3, h: 2 }), S({ type: 'boulder', x: 4, y: 21, w: 3, h: 1 }),
    S({ type: 'slalom', x: 11, y: 9, color: '#e8453c' }), S({ type: 'slalom', x: 14, y: 11, color: '#2f6fd1' }), S({ type: 'slalom', x: 3, y: 9, color: '#2f6fd1' }),
    ...pines.map(([x, y]) => S({ type: 'pine', x, y })),
    { type: 'flags', x: 12, y: 4.8, x2: 18.4, y2: 4.6, depth: 24 },
    { type: 'flags', x: 22.6, y: 4.6, x2: 33, y2: 5, depth: 24 },
    { type: 'lamp', x: 11, y: 14 }, { type: 'lamp', x: 14, y: 19 }, { type: 'lamp', x: 21, y: 11 }, { type: 'lamp', x: 8, y: 10 },
    { type: 'sign', x: 14, y: 14, text: 'Mountain Peak' },
    { type: 'sign', x: 5, y: 8, text: 'Sled Race' },
  ];
  return {
    id: 'mountain-peak',
    name: 'Mountain Peak',
    theme: 'summit',
    seedVersion: 13,
    width: PW,
    height: H,
    tiles: rows(g),
    spawn: { x: 12, y: 20 },
    portals: [{ x: 12, y: 23, w: 2, h: 1, to: 'mountain-town', tx: 12, ty: 6, label: 'Mountain Town' }],
    minigames: [{ id: 'mg1', game: 'sled-race', x: 6, y: 6 }], // pad is (7, 8), at the top of its path
    props,
  };
}

// Bump SEED_VERSION and set seedVersion on a room to push a new starter layout to
// existing servers on their next start (db.js keeps the old layout in room_versions).
function seedRooms() {
  return [plaza(), dojo(), ramen(), sportsPark(), grotto(), cave(), mountainTown(), mountainPeak(), cafe()];
}
seedRooms.SEED_VERSION = 16;
module.exports = seedRooms;
