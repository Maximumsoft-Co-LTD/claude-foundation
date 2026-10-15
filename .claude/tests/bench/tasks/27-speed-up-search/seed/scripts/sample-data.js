// Deterministic product catalog for local benchmarking.
const ADJECTIVES = ["red", "blue", "green", "large", "small", "classic", "modern", "Crème",
  "Café", "naïve", "smart", "eco", "ultra", "mini", "pro", "Ångström"];
const NOUNS = ["lamp", "chair", "table", "mug", "kettle", "phone", "case", "cable", "shirt",
  "shoe", "bag", "desk", "pen", "notebook", "speaker", "charger"];
const TAGS = ["home", "office", "kitchen", "audio", "travel", "outdoor", "gift", "sale"];

function sampleProducts(count, seed = 1) {
  let state = seed;
  const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = (list) => list[Math.floor(next() * list.length)];
  return Array.from({ length: count }, (_, index) => ({
    id: `p${Math.floor(next() * count * 0.9)}`,
    title: `${pick(ADJECTIVES)} ${pick(ADJECTIVES)} ${pick(NOUNS)} ${index}`,
    tags: next() < 0.2 ? undefined : [pick(TAGS), pick(TAGS)]
  }));
}

module.exports = { sampleProducts };
