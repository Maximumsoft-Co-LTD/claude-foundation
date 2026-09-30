const assert = require("node:assert/strict");
const test = require("node:test");
const { createCart, addItem, setQuantity, removeItem, subtotalCents } = require("../src/cart");

test("adding the same sku merges quantities", () => {
  const cart = addItem(addItem(createCart(), "TEE"), "TEE", 2);
  assert.deepEqual(cart.lines, [{ sku: "TEE", quantity: 3 }]);
});

test("subtotal sums integer cents", () => {
  const cart = addItem(addItem(createCart(), "TEE", 2), "PEN");
  assert.equal(subtotalCents(cart), 2 * 1999 + 199);
});

test("quantity changes and removal", () => {
  const cart = addItem(addItem(createCart(), "MUG"), "CAP");
  setQuantity(cart, "MUG", 4);
  removeItem(cart, "CAP");
  assert.deepEqual(cart.lines, [{ sku: "MUG", quantity: 4 }]);
  setQuantity(cart, "MUG", 0);
  assert.deepEqual(cart.lines, []);
});

test("invalid quantities and unknown skus are rejected", () => {
  assert.throws(() => addItem(createCart(), "TEE", 0), RangeError);
  assert.throws(() => addItem(createCart(), "NOPE"), /unknown sku/);
});
