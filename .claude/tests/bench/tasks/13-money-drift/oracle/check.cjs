// Deterministic AC oracle for 13-money-drift.
//
//   node check.cjs <sandbox-dir>   ->  JSON on stdout
//
// The task's ACs are mostly CONSISTENCY claims, not value claims: the acceptance
// file deliberately does not fix a rounding rule ("one stated rule"), so asserting
// a particular total for A-1001 would grade a style choice rather than the defect.
// What is objectively checkable is that the printed parts agree with each other
// and with the shared computation — which is exactly the two live defects.
//
// AC6 (regression-first) is the caller's job — run.sh does the FAIL_TO_PASS swap.
// Never copied into a sandbox: run-bench.sh copies only tasks/<t>/seed/.

const path = require("path");
const fs = require("fs");

const sandbox = process.argv[2];
if (!sandbox) {
  console.log(JSON.stringify({ error: "usage: check.cjs <sandbox-dir>" }));
  process.exit(2);
}

const results = {};
const note = [];
const record = (id, ok, why) => {
  results[id] = ok ? "pass" : "fail";
  if (!ok && why) note.push(`${id}: ${why}`);
};

const load = (m) => require(path.resolve(sandbox, m));
const cents = (s) => Math.round(Number(s) * 100);   // compare in integer cents, never floats

let cart, disc, inv, rep, mon, orders;
try {
  cart = load("cart.js");
  disc = load("discounts.js");
  inv = load("invoice.js");
  rep = load("report.js");
  mon = load("money.js");
  orders = JSON.parse(fs.readFileSync(path.resolve(sandbox, "orders.json"), "utf8"));
} catch (e) {
  console.log(JSON.stringify({ error: `cannot load sandbox modules: ${e.message}`, results: {} }));
  process.exit(2);
}

// AC4 — PUBLIC SHAPES UNBROKEN. First, because everything else calls through them.
const fns = {
  lineTotal: cart.lineTotal, subtotal: cart.subtotal,
  applyDiscounts: disc.applyDiscounts, orderTotal: disc.orderTotal,
  invoice: inv.invoice, monthlyTotal: rep.monthlyTotal, money: mon.money,
};
const missing = Object.entries(fns).filter(([, v]) => typeof v !== "function").map(([k]) => k);
let shapeOk = missing.length === 0;
if (shapeOk) {
  try {
    const s = inv.invoice(orders[0]);
    shapeOk =
      typeof s.id === "string" &&
      Array.isArray(s.lines) &&
      s.lines.every((l) => typeof l.sku === "string" && /^-?\d+\.\d{2}$/.test(String(l.amount))) &&
      /^-?\d+\.\d{2}$/.test(String(s.total));
  } catch (e) {
    shapeOk = false;
    note.push(`AC4 invoice() threw: ${e.message}`);
  }
} else {
  note.push(`AC4: missing exports: ${missing.join(", ")}`);
}
record("AC4_public_shapes", shapeOk, "exports or invoice() shape changed (amounts must stay 2-decimal strings)");
if (!shapeOk) {
  console.log(JSON.stringify({ results, note, error: "shapes broken — later ACs unevaluable" }));
  process.exit(0);
}

const invoices = orders.map((o) => inv.invoice(o));

// AC2 — BOTH DEFECTS FIXED, as internal consistency.
//   (a) undiscounted orders: printed lines sum exactly to the printed total
//   (b) the month's invoice totals sum exactly to monthlyTotal()
let a = true, b = true;
orders.forEach((o, i) => {
  if ((o.discounts || []).length) return;
  const lines = invoices[i].lines.reduce((s, l) => s + cents(l.amount), 0);
  if (lines !== cents(invoices[i].total)) {
    a = false;
    note.push(`AC2a ${o.id}: lines ${lines}c vs total ${cents(invoices[i].total)}c`);
  }
});
try {
  const june = orders.map((o, i) => ({ o, v: invoices[i] })).filter((x) => x.o.month === "2026-06");
  const sumInv = june.reduce((s, x) => s + cents(x.v.total), 0);
  const reported = cents(rep.monthlyTotal(june.map((x) => x.o)));
  if (sumInv !== reported) {
    b = false;
    note.push(`AC2b: invoices ${sumInv}c vs monthlyTotal ${reported}c`);
  }
} catch (e) { b = false; note.push(`AC2b threw: ${e.message}`); }
record("AC2_reconciles", a && b, "invoice lines vs total, or invoices vs monthlyTotal, still disagree");

// AC1 — RIGHT LAYER. The shared computation must agree with the invoice. Fixing
// invoice() to sum its own rounded lines reconciles the page and leaves
// orderTotal() handing the wrong number to the report, the CSV and every other
// caller — the documented trap.
let layer = true;
orders.forEach((o, i) => {
  try {
    const shared = cents(mon.money(disc.orderTotal(o.items, o.discounts)));
    if (shared !== cents(invoices[i].total)) {
      layer = false;
      note.push(`AC1 ${o.id}: orderTotal->${shared}c but invoice total ${cents(invoices[i].total)}c`);
    }
  } catch (e) { layer = false; note.push(`AC1 ${o.id} threw: ${e.message}`); }
});
record("AC1_right_layer", layer, "invoice total no longer matches money(orderTotal(...)) — fix sits above the computation");

// AC3 — DISCOUNTS ROUND ONCE AND CONSISTENTLY.
//   A-1002: 19.99 x 3 = 59.97, 15% off = 50.9745 -> 50.97 under any single rule.
//   Order of operations: percent then fixed, applied to the subtotal, in order.
let d3 = true;
try {
  const i1002 = orders.findIndex((o) => o.id === "A-1002");
  if (i1002 >= 0 && cents(invoices[i1002].total) !== 5097) {
    d3 = false;
    note.push(`AC3: A-1002 total ${cents(invoices[i1002].total)}c, expected 5097c`);
  }
  const seq = cents(mon.money(disc.applyDiscounts(100, [{ kind: "percent", value: 10 }, { kind: "fixed", value: 5 }])));
  if (seq !== 8500) { d3 = false; note.push(`AC3: percent-then-fixed on 100 gave ${seq}c, expected 8500c`); }
} catch (e) { d3 = false; note.push(`AC3 threw: ${e.message}`); }
record("AC3_discount_once", d3, "fractional-cent discount or discount ordering changed");

// AC5 — PERSISTED DATA STILL READS. 19.99 must still mean $19.99, whether the file
// was left in dollars or migrated with values preserved.
let d5 = true;
try {
  const i1002 = orders.findIndex((o) => o.id === "A-1002");
  const amt = cents(invoices[i1002].lines[0].amount);
  if (amt !== 5997) { d5 = false; note.push(`AC5: PANEL line ${amt}c, expected 5997c — orders.json precision lost`); }
} catch (e) { d5 = false; note.push(`AC5 threw: ${e.message}`); }
record("AC5_persisted_data", d5, "stored dollar amounts were reinterpreted or lost precision");

// AC7 — NO COLLATERAL DRIFT. A-1003 was already exact and must stay exact.
let d7 = true;
try {
  const i = orders.findIndex((o) => o.id === "A-1003");
  const amts = invoices[i].lines.map((l) => cents(l.amount)).sort((x, y) => x - y);
  if (cents(invoices[i].total) !== 490) { d7 = false; note.push(`AC7: A-1003 total ${cents(invoices[i].total)}c, expected 490c`); }
  if (amts[0] !== 245 || amts[1] !== 345) { d7 = false; note.push(`AC7: A-1003 lines ${amts}c, expected 245c and 345c`); }
} catch (e) { d7 = false; note.push(`AC7 threw: ${e.message}`); }
record("AC7_no_collateral", d7, "an order that already reconciled changed");

console.log(JSON.stringify({ results, note }));
