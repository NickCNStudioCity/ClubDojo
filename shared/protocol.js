// ClubDojo shared protocol: constants and pure helpers used by the server and both clients.
// Loads as a CommonJS module in Node and as a plain <script> (window.ClubDojoProtocol) in the clients.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClubDojoProtocol = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const PROTOCOL_VERSION = 2;
  const DEFAULT_PORT = 7777;
  const DISCOVERY_PORT = 7778;

  // Tile characters used in room grids (one string per row).
  const TILES = {
    '.': { name: 'Snow', walkable: true },
    '#': { name: 'Blocked', walkable: false },
    '~': { name: 'Water', walkable: false },
    '=': { name: 'Rooftop', walkable: true },
    '*': { name: 'Ice', walkable: true },
    ',': { name: 'Wood floor', walkable: true },
    'g': { name: 'Grass', walkable: true },
    ':': { name: 'Dirt path', walkable: true },
    'f': { name: 'Flowers', walkable: true },
  };

  const ROLES = ['ninja', 'sensei', 'grandmaster'];

  const BELTS = [
    { id: 'white', name: 'White Belt', xp: 0, color: '#f3f8fb' },
    { id: 'yellow', name: 'Yellow Belt', xp: 100, color: '#f5d02e' },
    { id: 'orange', name: 'Orange Belt', xp: 250, color: '#f08a2c' },
    { id: 'green', name: 'Green Belt', xp: 450, color: '#3fbf7f' },
    { id: 'blue', name: 'Blue Belt', xp: 700, color: '#2f6fd1' },
    { id: 'brown', name: 'Brown Belt', xp: 1000, color: '#7a4a2a' },
    { id: 'black', name: 'Black Belt', xp: 1500, color: '#15191e' },
  ];

  // Gi colors a new ninja can pick from.
  const NINJA_COLORS = ['#20262e', '#2f6fd1', '#c0392b', '#3fbf7f', '#8e44ad', '#e67e22', '#16a085', '#7f8c8d'];

  const EMOTES = { bow: '🙇', flip: '🤸', meditate: '🧘', throw: '✴️', wave: '👋', laugh: '😆' };

  const LIMITS = {
    usernameMin: 3, usernameMax: 16,
    passwordMin: 6, passwordMax: 64,
    nameMin: 2, nameMax: 16,
    chatMax: 120,
    announceMax: 200,
  };

  // ---------- Minigame spots ----------
  // A spot is a small pavilion placed on a room map ({ id, game, x, y }). Its footprint
  // blocks walking; ninjas join the game by standing on the pad tile in front of it.
  const MINIGAME_SPOT = { w: 3, h: 2 };
  const MINIGAME_PHASES = ['lobby', 'countdown', 'playing', 'results'];

  function spotAt(room, x, y) {
    return (room.minigames || []).find((s) => x >= s.x && x < s.x + MINIGAME_SPOT.w && y >= s.y && y < s.y + MINIGAME_SPOT.h) || null;
  }
  function spotPad(spot) {
    return { x: spot.x + Math.floor(MINIGAME_SPOT.w / 2), y: spot.y + MINIGAME_SPOT.h };
  }
  function spotKey(roomId, spot) {
    return `${roomId}:${spot.id}`;
  }

  // ---------- Character loadout ----------
  // Everything a minigame needs to draw a ninja, snapshotted when they join a lobby.
  // Accessory slots are filled from inventory in a later phase (see docs/minigames/character-loading.md).
  const ACCESSORY_SLOTS = ['back', 'body', 'head', 'face', 'hand', 'feet'];
  function loadoutFromNinja(n) {
    let accessories = {};
    if (n.accessories) { try { accessories = typeof n.accessories === 'string' ? JSON.parse(n.accessories) : n.accessories; } catch {} }
    const clean = {};
    for (const slot of ACCESSORY_SLOTS) if (typeof accessories[slot] === 'string') clean[slot] = accessories[slot];
    return {
      v: 1,
      id: n.account_id ?? n.id,
      name: n.name,
      color: n.color,
      headband: n.headband,
      belt: n.belt,
      accessories: clean,
    };
  }

  function beltById(id) {
    return BELTS.find((b) => b.id === id) || BELTS[0];
  }

  function nextBelt(id) {
    const i = BELTS.findIndex((b) => b.id === id);
    return i >= 0 && i < BELTS.length - 1 ? BELTS[i + 1] : null;
  }

  function tileAt(room, x, y) {
    if (x < 0 || y < 0 || x >= room.width || y >= room.height) return '#';
    return room.tiles[y][x] || '#';
  }

  function isWalkable(room, x, y) {
    const t = TILES[tileAt(room, x, y)];
    return !!(t && t.walkable) && !spotAt(room, x, y);
  }

  function portalAt(room, x, y) {
    return (room.portals || []).find((p) => x >= p.x && x < p.x + (p.w || 1) && y >= p.y && y < p.y + (p.h || 1)) || null;
  }

  // Breadth-first path on the tile grid (8 directions, no corner cutting).
  // Deterministic, so every client draws the same walk the server approved.
  function findPath(room, from, to, maxNodes) {
    if (!isWalkable(room, to.x, to.y)) return null;
    if (from.x === to.x && from.y === to.y) return [{ x: to.x, y: to.y }];
    const w = room.width;
    const limit = maxNodes || w * room.height;
    const prev = new Map();
    const start = from.y * w + from.x;
    const goal = to.y * w + to.x;
    const queue = [start];
    prev.set(start, -1);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let head = 0;
    while (head < queue.length && prev.size <= limit) {
      const cur = queue[head++];
      if (cur === goal) break;
      const cx = cur % w, cy = (cur - cx) / w;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (!isWalkable(room, nx, ny)) continue;
        if (dx && dy && (!isWalkable(room, cx + dx, cy) || !isWalkable(room, cx, cy + dy))) continue;
        const key = ny * w + nx;
        if (prev.has(key)) continue;
        prev.set(key, cur);
        queue.push(key);
      }
    }
    if (!prev.has(goal)) return null;
    const path = [];
    for (let k = goal; k !== -1; k = prev.get(k)) path.push({ x: k % w, y: Math.floor(k / w) });
    return path.reverse();
  }

  return {
    PROTOCOL_VERSION, DEFAULT_PORT, DISCOVERY_PORT, TILES, ROLES, BELTS, NINJA_COLORS, EMOTES, LIMITS,
    MINIGAME_SPOT, MINIGAME_PHASES, ACCESSORY_SLOTS,
    beltById, nextBelt, tileAt, isWalkable, portalAt, findPath, spotAt, spotPad, spotKey, loadoutFromNinja,
  };
});
