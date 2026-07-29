// Line and order maths. invoice.js and report.js both import these —
// keep the exported names and the shape of what they return.
function lineTotal(item) {
  return item.price * item.qty;
}
function subtotal(items) {
  return items.reduce((s, i) => s + lineTotal(i), 0);
}
module.exports = { lineTotal, subtotal };
