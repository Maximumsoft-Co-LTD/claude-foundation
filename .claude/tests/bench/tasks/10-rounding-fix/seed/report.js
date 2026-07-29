// Existing accounting consumer. The finance team runs this file as-is: it
// reconciles an invoice by checking the printed line amounts add up to the
// printed order total. Do not edit it to make a test pass.
const { lineTotal, orderTotal } = require("./cart");

function money(n) {
  return n.toFixed(2);
}

// { lines: ["4.97", ...], total: "17.68", reconciles: true|false }
function invoice(items) {
  const lines = items.map((i) => money(lineTotal(i)));
  const total = money(orderTotal(items));
  const sumOfLines = lines.reduce((s, l) => s + Number(l), 0);
  return { lines, total, reconciles: money(sumOfLines) === total };
}

module.exports = { invoice, money };
