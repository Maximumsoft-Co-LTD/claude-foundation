// Product catalog search.

function normalize(text) {
  return String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function words(text) {
  return normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function scoreRecord(record, terms) {
  const recordWords = words(`${record.title} ${(record.tags || []).join(" ")}`);
  let score = 0;
  for (const term of terms) {
    if (recordWords.includes(term)) score += 2;
    else if (recordWords.some((word) => word.startsWith(term))) score += 1;
    else return 0;
  }
  return score;
}

function createCatalog(records) {
  const items = records.slice();
  return {
    search(query, { limit = 20 } = {}) {
      const terms = words(query);
      if (terms.length === 0) return [];
      const hits = [];
      for (let index = 0; index < items.length; index++) {
        const record = items[index];
        const score = scoreRecord(record, terms);
        if (score === 0) continue;
        if (hits.some((hit) => hit.id === record.id)) continue;
        hits.push({ id: record.id, title: record.title, score, index });
      }
      hits.sort((left, right) => right.score - left.score || left.index - right.index);
      return hits.slice(0, limit).map(({ id, title, score }) => ({ id, title, score }));
    }
  };
}

module.exports = { createCatalog };
