const assert = require("node:assert/strict");
const test = require("node:test");
const { loyaltyPercent, priceOrder, subtotalCents } = require("../src/pricing");

const lines = [{ priceCents: 1250, quantity: 2 }, { priceCents: 499, quantity: 1 }];

test("subtotal sums price times quantity", () => {
  assert.equal(subtotalCents(lines), 2999);
  assert.equal(subtotalCents([]), 0);
});

test("loyalty tiers", () => {
  assert.equal(loyaltyPercent(0), 0);
  assert.equal(loyaltyPercent(500), 0);
  assert.equal(loyaltyPercent(2000), 5);
  assert.equal(loyaltyPercent(8000), 10);
});

test("discount rounds half a cent up", () => {
  assert.deepEqual(priceOrder([{ priceCents: 1010, quantity: 1 }], { points: 3000 }),
    { subtotalCents: 1010, discountPercent: 5, discountCents: 51, totalCents: 959 });
});

test("invalid point balances are rejected", () => {
  assert.throws(() => loyaltyPercent(-1), RangeError);
  assert.throws(() => priceOrder(lines, { points: 1.5 }), RangeError);
});
