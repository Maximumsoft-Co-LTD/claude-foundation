// Discounts apply to the order subtotal, in order, before tax.
//   { kind: "percent", value: 15 }  -> 15% off
//   { kind: "fixed",   value: 5 }   -> $5 off
function applyDiscounts(amount, discounts) {
  return discounts.reduce((a, d) => {
    if (d.kind === "percent") return a - a * (d.value / 100);
    if (d.kind === "fixed") return a - d.value;
    return a;
  }, amount);
}
function orderTotal(items, discounts) {
  const { subtotal } = require("./cart");
  return applyDiscounts(subtotal(items), discounts || []);
}
module.exports = { applyDiscounts, orderTotal };
