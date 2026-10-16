const assert = require("node:assert/strict");
const test = require("node:test");
const { predict, LABELS } = require("../src/classifier");
const { routeTicket } = require("../src/router");

test("the classifier always returns a known label", () => {
  for (const text of ["", "hello", "my invoice", "error 42"]) assert.ok(LABELS.includes(predict(text)));
});

test("tickets route to the queue for their label", () => {
  assert.deepEqual(routeTicket("I forgot my password"), { queue: "account-desk", label: "account" });
  assert.deepEqual(routeTicket("x", { model: { predict: () => "billing" } }), { queue: "billing-team", label: "billing" });
});
