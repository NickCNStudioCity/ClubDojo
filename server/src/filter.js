// Minimal chat and name filter. Extend BAD_WORDS for your group.
const BAD_WORDS = ['damn', 'hell', 'crap', 'stupid', 'idiot', 'shut up', 'loser'];

const pattern = new RegExp(`\\b(${BAD_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');

function clean(text) {
  return text.replace(pattern, (m) => '*'.repeat(m.length));
}

function isClean(text) {
  pattern.lastIndex = 0;
  const bad = pattern.test(text);
  pattern.lastIndex = 0;
  return !bad;
}

module.exports = { clean, isClean };
