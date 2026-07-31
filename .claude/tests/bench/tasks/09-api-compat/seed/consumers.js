// Existing callers. These MUST keep working unchanged after the change.
const { listArticles } = require("./api");

// Consumer A treats the return value as an array directly.
function countNews() {
  return listArticles({ tag: "news" }).length;
}

// Consumer B iterates it and reads .title.
function titles() {
  return listArticles().map((a) => a.title);
}

// Consumer C indexes into it.
function firstArticle() {
  return listArticles()[0];
}

module.exports = { countNews, titles, firstArticle };
