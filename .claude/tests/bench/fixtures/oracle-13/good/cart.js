const r2 = (n) => Math.round(n * 100) / 100;
function lineTotal(item) { return r2(item.price * item.qty); }
function subtotal(items) { return r2(items.reduce((s, i) => s + lineTotal(i), 0)); }
module.exports = { lineTotal, subtotal };
