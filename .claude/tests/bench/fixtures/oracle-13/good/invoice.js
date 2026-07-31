// Customer-facing invoice. Finance runs this as-is.
const { lineTotal } = require("./cart");
const { orderTotal } = require("./discounts");
const { money } = require("./money");

function invoice(order) {
  return {
    id: order.id,
    lines: order.items.map((i) => ({ sku: i.sku, amount: money(lineTotal(i)) })),
    total: money(orderTotal(order.items, order.discounts)),
  };
}
module.exports = { invoice };
