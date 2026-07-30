const test = require("node:test");
const assert = require("node:assert");
const { invoice } = require("./invoice");
const { monthlyTotal } = require("./report");
const orders = require("./orders.json");
test("A-1001 lines sum to its printed total", () => {
  const o = orders.find((x) => x.id === "A-1001");
  const v = invoice(o);
  const lines = v.lines.reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0);
  assert.strictEqual(lines, Math.round(Number(v.total) * 100));
});
test("invoices reconcile with the monthly report", () => {
  const june = orders.filter((o) => o.month === "2026-06");
  const sum = june.reduce((s, o) => s + Math.round(Number(invoice(o).total) * 100), 0);
  assert.strictEqual(sum, Math.round(Number(monthlyTotal(june)) * 100));
});
