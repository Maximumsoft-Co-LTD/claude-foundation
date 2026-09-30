// Direct behavioral assertions for 20-tiny-feature against the delivered tree.
const { resolve } = require("node:path");

const results = {};
let cart = {};
try { cart = require(resolve(process.argv[2], "src/cart.js")); } catch { cart = {}; }
const { discount, total } = cart;
const throwsRange = (fn) => {
  try { fn(); return false; } catch (error) { return error instanceof RangeError; }
};
const close = (actual, expected) =>
  typeof actual === "number" && Math.abs(actual - expected) < 1e-9;
const guarded = (fn) => { try { return fn(); } catch { return false; } };

results.CASE_DISCOUNT_EXPORTED = typeof discount === "function" ? "pass" : "fail";
results.CASE_DISCOUNT_VALUE = guarded(() => close(discount(200, 25), 150) &&
  close(discount(80, 10), 72)) ? "pass" : "fail";
results.CASE_BOUNDS_INCLUSIVE = guarded(() => close(discount(50, 0), 50) &&
  close(discount(50, 100), 0)) ? "pass" : "fail";
results.CASE_RANGE_BELOW = typeof discount === "function" &&
  throwsRange(() => discount(100, -1)) && throwsRange(() => discount(100, -0.5))
  ? "pass" : "fail";
results.CASE_RANGE_ABOVE = typeof discount === "function" &&
  throwsRange(() => discount(100, 101)) && throwsRange(() => discount(100, 100.5))
  ? "pass" : "fail";
results.CASE_TOTAL_INTACT = guarded(() => typeof total === "function" &&
  total([{ price: 5, quantity: 2 }, { price: 1.5, quantity: 4 }]) === 16 &&
  total([]) === 0) ? "pass" : "fail";
process.stdout.write(JSON.stringify({ results }));
