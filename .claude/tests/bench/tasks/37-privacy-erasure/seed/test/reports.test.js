const assert = require("node:assert/strict");
const test = require("node:test");
const { createStore } = require("../src/store");
const { revenueByCurrency, customerSummary } = require("../src/reports");

const data = {
  customers: [{ id: "c1", name: "Ann", email: "ann@example.com", phone: "1", address: "x", createdAt: "2024-01-01T00:00:00.000Z" }],
  orders: [
    { id: "o1", customerId: "c1", currency: "THB", total: 1200, items: [{ sku: "a", quantity: 1, unitPrice: 1200 }] },
    { id: "o2", customerId: "c1", currency: "USD", total: 30, items: [{ sku: "b", quantity: 3, unitPrice: 10 }] }
  ]
};

test("revenue is grouped by currency", () => {
  assert.deepEqual(revenueByCurrency(createStore(data)), { THB: 1200, USD: 30 });
});

test("the support summary counts orders", () => {
  assert.deepEqual(customerSummary(createStore(data), "c1"), { id: "c1", name: "Ann", orderCount: 2, spent: 1230 });
  assert.equal(customerSummary(createStore(data), "zz"), null);
});
