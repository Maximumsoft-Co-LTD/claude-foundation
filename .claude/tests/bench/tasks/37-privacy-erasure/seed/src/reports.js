"use strict";

function revenueByCurrency(store) {
  const totals = {};
  for (const order of store.orders) totals[order.currency] = (totals[order.currency] || 0) + order.total;
  return totals;
}

function customerSummary(store, customerId) {
  const customer = store.customers.find((row) => row.id === customerId);
  if (!customer) return null;
  const orders = store.orders.filter((order) => order.customerId === customerId);
  return { id: customer.id, name: customer.name, orderCount: orders.length,
    spent: orders.reduce((sum, order) => sum + order.total, 0) };
}

module.exports = { revenueByCurrency, customerSummary };
