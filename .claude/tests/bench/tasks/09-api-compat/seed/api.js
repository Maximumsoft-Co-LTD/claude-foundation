// Public API module. Callers below already depend on listArticles' contract.
const ARTICLES = Array.from({ length: 47 }, (_, i) => ({
  id: i + 1,
  title: `Article ${i + 1}`,
  tag: i % 3 === 0 ? "news" : "blog",
}));

/**
 * Returns articles, optionally filtered by tag.
 * @returns {Array} a plain array of article objects.
 */
function listArticles(opts = {}) {
  const { tag } = opts;
  return tag ? ARTICLES.filter((a) => a.tag === tag) : ARTICLES.slice();
}

module.exports = { listArticles };
