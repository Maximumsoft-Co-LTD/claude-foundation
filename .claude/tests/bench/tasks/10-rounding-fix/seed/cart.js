// Order money maths. Amounts are dollars as JS numbers.
// report.js (accounting) imports these — keep the names and shapes.

function lineTotal(item) {
  return item.price * item.qty;
}

function orderTotal(items) {
  return items.reduce((s, i) => s + lineTotal(i), 0);
}

module.exports = { lineTotal, orderTotal };
