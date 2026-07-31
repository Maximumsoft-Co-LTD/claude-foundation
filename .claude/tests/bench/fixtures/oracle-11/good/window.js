// Shared list helpers. Several screens import these — keep the names and shapes.
function lastN(items, n) {
  const k = Math.trunc(n);
  if (!(k > 0)) return [];
  return items.slice(Math.max(0, items.length - k));
}
function dropLastN(items, n) {
  return items.slice(0, items.length - n);
}
module.exports = { lastN, dropLastN };
