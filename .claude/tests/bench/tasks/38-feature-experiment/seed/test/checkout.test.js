const assert = require("node:assert/strict");
const test = require("node:test");
const { createCheckout } = require("../src/checkout");

const flags = { isEnabled: () => false };

test("guests get the classic layout", () => {
  const events = [];
  const checkout = createCheckout({ track: (event) => events.push(event), flags });
  assert.deepEqual(checkout.render(null), { layout: "classic", userId: null });
  assert.deepEqual(events, []);
});

test("signed-in shoppers get a layout and their id", () => {
  const checkout = createCheckout({ track: () => {}, flags });
  const view = checkout.render({ id: "u-1" });
  assert.equal(view.userId, "u-1");
  assert.equal(typeof view.layout, "string");
});
