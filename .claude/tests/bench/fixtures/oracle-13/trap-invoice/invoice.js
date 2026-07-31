const { lineTotal } = require("./cart");
const { money } = require("./money");
function invoice(order) {
  const lines = order.items.map((i) => ({ sku: i.sku, amount: money(lineTotal(i)) }));
  const total = lines.reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0) / 100;
  return { id: order.id, lines, total: money(total) };
}
module.exports = { invoice };
