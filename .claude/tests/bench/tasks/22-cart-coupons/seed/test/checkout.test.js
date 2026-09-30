const assert = require("node:assert/strict");
const test = require("node:test");
const { createCart, addItem } = require("../src/cart");
const { taxCents } = require("../src/tax");
const { checkout } = require("../src/checkout");

test("tax is 7% rounded half up", () => {
  assert.equal(taxCents(1250), 88);
  assert.equal(taxCents(1000), 70);
  assert.equal(taxCents(0), 0);
});

test("checkout totals subtotal plus tax", () => {
  const totals = checkout(addItem(addItem(createCart(), "LAMP"), "PEN", 3));
  assert.equal(totals.subtotalCents, 4550 + 597);
  assert.equal(totals.taxCents, 360);
  assert.equal(totals.totalCents, 5147 + 360);
});
