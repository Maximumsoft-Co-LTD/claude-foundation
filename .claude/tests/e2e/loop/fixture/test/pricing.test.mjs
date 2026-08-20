import test from "node:test";
import assert from "node:assert/strict";
import { subtotal, total } from "../src/pricing.js";

test("subtotal sums line items", () => {
  assert.equal(subtotal([{ price: 20, qty: 2 }, { price: 5, qty: 1 }]), 45);
});

test("small orders pay full price", () => {
  assert.equal(total([{ price: 40, qty: 1 }]), 40);
});

test("large orders get the loyalty discount", () => {
  assert.equal(total([{ price: 60, qty: 2 }]), 108);
});
