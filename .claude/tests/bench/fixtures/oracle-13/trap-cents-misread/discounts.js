const r2 = (n) => Math.round(n * 100) / 100;
function applyDiscounts(amount, discounts) {
  return discounts.reduce((a, d) => {
    if (d.kind === "percent") return r2(a - a * (d.value / 100));
    if (d.kind === "fixed") return r2(a - d.value);
    return a;
  }, r2(amount));
}
function orderTotal(items, discounts) {
  const { subtotal } = require("./cart");
  return applyDiscounts(subtotal(items), discounts || []);
}
module.exports = { applyDiscounts, orderTotal };
