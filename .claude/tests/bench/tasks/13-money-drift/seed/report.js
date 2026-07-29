// Monthly revenue report. Finance reconciles this against the invoices.
const { orderTotal } = require("./discounts");
const { money } = require("./money");

function monthlyTotal(orders) {
  return money(orders.reduce((s, o) => s + orderTotal(o.items, o.discounts), 0));
}
module.exports = { monthlyTotal };
