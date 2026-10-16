"use strict";

function createStore({ customers = [], orders = [] } = {}) {
  return {
    customers: customers.map((customer) => ({ ...customer })),
    orders: orders.map((order) => ({ ...order, items: order.items.map((item) => ({ ...item })) })),
    audit: []
  };
}

module.exports = { createStore };
