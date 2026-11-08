// Card data shared by the server and both clients: the 36-card set, techniques, boards, packs,
// the House Ladder and collection tuning. No logic lives here apart from small lookups.
// Sides are [north, east, south, west] and run 1-6. A card works in both games: Turncoat reads a
// side as how hard it can win over a neighbour, Ring Out reads it as how hard it can shove one.
(function (root) {
  const MODES = {
    turncoat: { id: 'turncoat', name: 'Turncoat', color: '#3f4fa8', icon: '🎭', blurb: 'Win enemy ninjas over to your side.' },
    'ring-out': { id: 'ring-out', name: 'Ring Out', color: '#b4532a', icon: '🥁', blurb: 'Shove rivals off the mat and hold the shrines.' },
  };

  const ELEMENTS = {
    fire: { name: 'Fire', icon: '🔥', color: '#e8532c', deep: '#7a1f12', glow: '#ffb35c', beats: 'air' },
    water: { name: 'Water', icon: '💧', color: '#2d8fd6', deep: '#123a78', glow: '#8fe0ff', beats: 'fire' },
    earth: { name: 'Earth', icon: '⛰️', color: '#6f9a3c', deep: '#2f4a1c', glow: '#d3e88a', beats: 'water' },
    air: { name: 'Air', icon: '🍃', color: '#39b8a2', deep: '#135a58', glow: '#b6f5e2', beats: 'earth' },
    light: { name: 'Light', icon: '☀️', color: '#e8b33a', deep: '#8a5a12', glow: '#fff0b0', beats: 'dark' },
    dark: { name: 'Dark', icon: '🌙', color: '#7a55c7', deep: '#2b1a5c', glow: '#cdb5ff', beats: 'light' },
  };
  const ELEMENT_LETTER = { F: 'fire', W: 'water', E: 'earth', A: 'air', L: 'light', D: 'dark' };

  const RARITIES = {
    common: { name: 'Common', color: '#a9b4bf', ink: 20, dissolve: 5, order: 0 },
    uncommon: { name: 'Uncommon', color: '#4fc38a', ink: 60, dissolve: 15, order: 1 },
    rare: { name: 'Rare', color: '#4f9bff', ink: 180, dissolve: 45, order: 2 },
    legendary: { name: 'Legendary', color: '#ffb52e', ink: 500, dissolve: 125, order: 3 },
  };

  // Each technique does the same job in both games.
  const TECHNIQUES = {
    strike: { name: 'Strike', icon: '⚔️', text: '+1 on every side when this card attacks.' },
    guard: { name: 'Guard', icon: '🛡️', text: '+1 on every side when this card is attacked.' },
    smoke: { name: 'Smoke Bomb', icon: '💨', text: 'Ignores the first attack that beats it.' },
    whirl: { name: 'Whirlwind', icon: '🌀', text: 'When played, spins every adjacent enemy a quarter turn clockwise before attacking.' },
    rally: { name: 'Rally', icon: '📣', text: 'When played, adjacent allies gain +1 on every side for the rest of the match.' },
    bond: { name: 'Kinship', icon: '🤝', text: '+1 on every side while next to an ally of the same element.' },
    lone: { name: 'Lone Wolf', icon: '🐺', text: '+2 on every side when it attacks with no ally next to it.' },
    chain: { name: 'Chain', icon: '⛓️', text: 'Turncoat: cards it wins over attack too. Ring Out: its shoves travel two squares.' },
  };

  function c(id, name, element, rarity, sides, tech, art, flavor) {
    return { id, name, element, rarity, sides, tech: tech || null, art, flavor };
  }

  const CARDS = [
    // Fire
    c('ember-scout', 'Ember Scout', 'fire', 'common', [3, 3, 3, 3], null, 'ninja', 'First in, last to complain about the heat.'),
    c('cinder-pup', 'Cinder Pup', 'fire', 'common', [5, 3, 2, 2], null, 'pup', 'Fetches anything. Returns it slightly singed.'),
    c('kiln-monk', 'Kiln Monk', 'fire', 'common', [2, 4, 2, 4], null, 'monk', 'Patience, then pottery.'),
    c('flare-dancer', 'Flare Dancer', 'fire', 'uncommon', [4, 4, 2, 3], 'strike', 'dancer', 'The steps are easy. The floor is the hard part.'),
    c('ashen-ronin', 'Ashen Ronin', 'fire', 'rare', [5, 2, 5, 2], 'lone', 'ronin', 'Left the clan over a dispute about soup.'),
    c('phoenix-abbot', 'Phoenix Abbot', 'fire', 'legendary', [5, 5, 4, 4], 'rally', 'phoenix', 'Has retired nine times.'),
    // Water
    c('tide-novice', 'Tide Novice', 'water', 'common', [4, 2, 4, 2], null, 'ninja', 'Comes back no matter how often you send her away.'),
    c('reed-frog', 'Reed Frog', 'water', 'common', [2, 3, 5, 2], null, 'frog', 'One leap, then a long think about it.'),
    c('coral-guard', 'Coral Guard', 'water', 'common', [3, 2, 3, 4], null, 'guard', 'Very sharp. Very colourful. Do not lean on.'),
    c('mist-weaver', 'Mist Weaver', 'water', 'uncommon', [3, 5, 2, 3], 'smoke', 'weaver', 'You were looking right at her, and then you were not.'),
    c('riptide-ray', 'Riptide Ray', 'water', 'rare', [2, 5, 2, 5], 'chain', 'ray', 'It does not pull you under. It just keeps going.'),
    c('deep-matriarch', 'Deep Matriarch', 'water', 'legendary', [5, 4, 4, 4], 'whirl', 'whale', 'Her lullaby moves ships.'),
    // Earth
    c('moss-turtle', 'Moss Turtle', 'earth', 'common', [4, 3, 2, 3], null, 'turtle', 'Has been meaning to get up.'),
    c('pebble-pup', 'Pebble Pup', 'earth', 'common', [2, 5, 2, 3], null, 'pup', 'Good dog. Terrible at swimming.'),
    c('clay-sentry', 'Clay Sentry', 'earth', 'common', [3, 3, 4, 2], null, 'golem', 'Stood guard so long the door moved away.'),
    c('stone-sensei', 'Stone Sensei', 'earth', 'uncommon', [4, 2, 4, 3], 'guard', 'monk', 'Lesson one: stand there. Lesson two: keep standing there.'),
    c('mountain-ox', 'Mountain Ox', 'earth', 'rare', [5, 3, 3, 3], 'bond', 'ox', 'Pulls the whole village uphill on festival days.'),
    c('old-bedrock', 'The Old Bedrock', 'earth', 'legendary', [5, 5, 4, 4], 'guard', 'golem', 'The mountain calls it grandfather.'),
    // Air
    c('kite-runner', 'Kite Runner', 'air', 'common', [2, 3, 3, 4], null, 'ninja', 'Never once looked where he was going.'),
    c('paper-crane', 'Paper Crane', 'air', 'common', [5, 2, 3, 2], null, 'crane', 'Folded a thousand times, unfolds for no one.'),
    c('breeze-acolyte', 'Breeze Acolyte', 'air', 'common', [3, 4, 3, 2], null, 'monk', 'Meditates on a very windy ledge, by choice.'),
    c('storm-crane', 'Storm Crane', 'air', 'uncommon', [3, 3, 3, 4], 'whirl', 'crane', 'Weather is just its opinion.'),
    c('wind-fox', 'Wind Fox', 'air', 'rare', [4, 4, 1, 5], 'chain', 'fox', 'Everyone agrees it was here. No one agrees when.'),
    c('sky-hermit', 'Sky Hermit', 'air', 'legendary', [4, 5, 4, 5], 'chain', 'hermit', 'Comes down the mountain only for dumplings.'),
    // Light
    c('lantern-page', 'Lantern Page', 'light', 'common', [3, 2, 4, 3], null, 'lantern', 'Knows every shortcut, and lights the long way anyway.'),
    c('temple-moth', 'Temple Moth', 'light', 'common', [4, 4, 2, 2], null, 'moth', 'Has strong feelings about candles.'),
    c('dawn-blade', 'Dawn Blade', 'light', 'common', [2, 2, 5, 3], null, 'ninja', 'Trains before sunrise, then tells everyone.'),
    c('sun-lancer', 'Sun Lancer', 'light', 'uncommon', [5, 3, 3, 2], 'strike', 'lancer', 'Points the spear at noon. Nobody argues.'),
    c('halo-monk', 'Halo Monk', 'light', 'rare', [4, 3, 4, 3], 'rally', 'monk', 'A quiet word from him and the whole line stands taller.'),
    c('daybreak-empress', 'Daybreak Empress', 'light', 'legendary', [4, 5, 4, 4], 'smoke', 'empress', 'The morning waits until she is ready.'),
    // Dark
    c('ink-rat', 'Ink Rat', 'dark', 'common', [3, 4, 2, 3], null, 'rat', 'Reads your letters. Corrects the spelling.'),
    c('shade-hound', 'Shade Hound', 'dark', 'common', [4, 2, 2, 4], null, 'pup', 'Your shadow has been barking.'),
    c('night-owl', 'Night Owl', 'dark', 'common', [2, 2, 3, 5], null, 'owl', 'Up late, and judging you for it.'),
    c('smoke-tanuki', 'Smoke Tanuki', 'dark', 'uncommon', [3, 4, 3, 3], 'smoke', 'tanuki', 'Technically the statue was there first.'),
    c('void-serpent', 'Void Serpent', 'dark', 'rare', [4, 4, 5, 3], 'bond', 'serpent', 'Its coils are longer on the inside.'),
    c('moonless-shogun', 'Moonless Shogun', 'dark', 'legendary', [6, 4, 4, 4], 'lone', 'shogun', 'Rules a court nobody has ever seen.'),
  ];
  const BY_ID = new Map(CARDS.map((x) => [x.id, x]));
  // The AI imagines this average card when it asks "what could they answer with?".
  const PHANTOM = { id: '__phantom', name: 'Unknown', element: null, rarity: 'common', sides: [4, 4, 4, 4], tech: null };
  BY_ID.set(PHANTOM.id, PHANTOM);
  const getCard = (id) => BY_ID.get(id) || null;

  // ---------- Starter set ----------
  // Two commons of every element, plus three technique cards so new players meet the system early.
  const STARTER_COLLECTION = [
    'ember-scout', 'cinder-pup', 'reed-frog', 'coral-guard', 'moss-turtle', 'clay-sentry', 'paper-crane', 'kite-runner',
    'lantern-page', 'dawn-blade', 'ink-rat', 'shade-hound', 'flare-dancer', 'stone-sensei', 'smoke-tanuki',
  ];
  // A ready-to-play deck: strong sides pointing every way, all six elements, and one of each starter technique.
  const STARTER_DECK = ['cinder-pup', 'reed-frog', 'coral-guard', 'moss-turtle', 'kite-runner', 'dawn-blade', 'flare-dancer', 'stone-sensei', 'smoke-tanuki'];

  const DECK = { size: 9, maxCopies: 2, maxLegendary: 1, slots: 3, handSize: 3 };

  // ---------- Boards ----------
  // '.' open  '*' shrine  '#' rock  'v' pit (Ring Out)  F W E A L D element tile
  // komi: a head start tuned with `npm run check:cards`. Positive goes to the second player, negative to the first.
  const BOARDS = [
    { id: 'lantern-row', mode: 'turncoat', name: 'Lantern Row', blurb: 'A small table and one prize square. Quick and sharp.', komi: 1, rows: ['...', '.*.', '...'] },
    { id: 'two-rivers', mode: 'turncoat', name: 'Two Rivers', blurb: 'Fire and water corners around a contested centre.', komi: 1, rows: ['F.W', '.*.', 'W.F'] },
    { id: 'moon-court', mode: 'turncoat', name: 'Moon Court', blurb: 'A wide court where light and dark share the corners.', komi: -1, rows: ['L..D', '....', '....', 'D..L'] },
    { id: 'broken-bridge', mode: 'turncoat', name: 'Broken Bridge', blurb: 'Two rocks split the board into winding lanes.', komi: -1, rows: ['A..E', '.#*.', '.*#.', 'E..A'] },
    { id: 'clay-ring', mode: 'ring-out', name: 'Clay Ring', blurb: 'The classic mat, with three shrines across the middle.', komi: 0, rows: ['#...#', '.*...', '..*..', '...*.', '#...#'] },
    { id: 'pit-stop', mode: 'ring-out', name: 'Pit Stop', blurb: 'Two pits in the middle. The edge is never far away.', komi: -1, rows: ['.*.*.', '..v..', '..v..', '.*.*.'] },
    { id: 'tight-quarters', mode: 'ring-out', name: 'Tight Quarters', blurb: 'Four shrines packed together. Nowhere to hide.', komi: -1, rows: ['....', '.**.', '.**.', '....'] },
    { id: 'hot-springs', mode: 'ring-out', name: 'Hot Springs', blurb: 'Fire and water tiles guard a shrine on each flank.', komi: -1, rows: ['F...W', '.*v*.', 'W...F'] },
  ];
  const boardById = (id) => BOARDS.find((b) => b.id === id) || null;
  const boardsFor = (mode) => BOARDS.filter((b) => b.mode === mode);

  // ---------- Packs ----------
  // Each slot rolls its own table. Weights are out of 100.
  const FOIL_CHANCE = 0.07;
  const PACKS = {
    street: { id: 'street', name: 'Street Pack', price: 80, count: 3, color: '#3f8fd1', blurb: '3 cards. At least one Uncommon or better.', slots: [
      { common: 80, uncommon: 17, rare: 3 }, { common: 80, uncommon: 17, rare: 3 }, { uncommon: 80, rare: 17, legendary: 3 },
    ] },
    temple: { id: 'temple', name: 'Temple Pack', price: 240, count: 5, color: '#c9862a', blurb: '5 cards. At least one Rare or better.', slots: [
      { common: 70, uncommon: 25, rare: 5 }, { common: 70, uncommon: 25, rare: 5 }, { common: 50, uncommon: 40, rare: 10 }, { uncommon: 75, rare: 22, legendary: 3 }, { rare: 88, legendary: 12 },
    ] },
  };

  // ---------- The House Ladder ----------
  // Beat each regular in order, once per game, for a prize. The last one is a real test.
  const LADDER = [
    { id: 'pip', name: 'Pip the Busboy', level: 0, gi: '#7a8c9a', headband: '#f5d33b', belt: 'white', line: 'I only play on my break.', reward: { coins: 40, xp: 20 },
      deck: ['ember-scout', 'tide-novice', 'moss-turtle', 'kite-runner', 'lantern-page', 'ink-rat', 'reed-frog', 'pebble-pup', 'temple-moth'] },
    { id: 'hana', name: 'Auntie Hana', level: 0, gi: '#c0567a', headband: '#fff1d6', belt: 'yellow', line: 'Sit down, dear. This will not hurt much.', reward: { coins: 80, xp: 30, pack: 'street' },
      deck: ['kiln-monk', 'coral-guard', 'clay-sentry', 'breeze-acolyte', 'dawn-blade', 'shade-hound', 'mist-weaver', 'stone-sensei', 'storm-crane'] },
    { id: 'tomo', name: 'Tomo the Tidecaller', level: 1, gi: '#2d8fd6', headband: '#8fe0ff', belt: 'green', line: 'Everything comes back around.', reward: { coins: 120, xp: 40, pack: 'street' },
      deck: ['tide-novice', 'reed-frog', 'coral-guard', 'tide-novice', 'mist-weaver', 'pebble-pup', 'moss-turtle', 'clay-sentry', 'stone-sensei'] },
    { id: 'sora', name: 'Madam Sora', level: 2, gi: '#39b8a2', headband: '#b6f5e2', belt: 'blue', line: 'I read cards for a living. Yours say goodbye.', reward: { coins: 180, xp: 60, pack: 'temple' },
      deck: ['storm-crane', 'storm-crane', 'wind-fox', 'paper-crane', 'kite-runner', 'sun-lancer', 'halo-monk', 'flare-dancer', 'smoke-tanuki'] },
    { id: 'kuro', name: 'Grandmaster Kuro', level: 2, gi: '#2b1a5c', headband: '#cdb5ff', belt: 'black', line: 'Close the door on your way out. You will want privacy to cry.', reward: { coins: 300, xp: 120, pack: 'temple', card: 'moonless-shogun' },
      deck: ['moonless-shogun', 'void-serpent', 'void-serpent', 'smoke-tanuki', 'smoke-tanuki', 'halo-monk', 'ashen-ronin', 'wind-fox', 'stone-sensei'] },
  ];

  // Finishing every card of an element pays once.
  const SET_REWARD = { coins: 400, ink: 150 };
  const COMPLETE_REWARD = { coins: 2000, ink: 500 };
  const FIRST_WIN_PACK = 'street';

  const RANKS = [
    { wins: 0, name: 'Newcomer' }, { wins: 3, name: 'Table Regular' }, { wins: 10, name: 'Card Sharp' },
    { wins: 25, name: 'House Favourite' }, { wins: 60, name: 'Legend of the Cafe' },
  ];
  const rankFor = (wins) => [...RANKS].reverse().find((r) => wins >= r.wins);

  const api = {
    MODES, ELEMENTS, ELEMENT_LETTER, RARITIES, TECHNIQUES, CARDS, PHANTOM, getCard, STARTER_COLLECTION, STARTER_DECK, DECK,
    BOARDS, boardById, boardsFor, PACKS, FOIL_CHANCE, LADDER, SET_REWARD, COMPLETE_REWARD, FIRST_WIN_PACK, RANKS, rankFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ClubDojoCardData = api;
})(typeof window !== 'undefined' ? window : globalThis);
