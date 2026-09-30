const assert = require("node:assert/strict");
const test = require("node:test");
const { total } = require("../src/cart");

test("total sums price times quantity", () => {
  assert.equal(total([{ price: 5, quantity: 2 }, { price: 1.5, quantity: 4 }]), 16);
});

test("an empty cart totals zero", () => {
  assert.equal(total([]), 0);
});
