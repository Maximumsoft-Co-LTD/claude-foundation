// Hidden behavioral oracle for 37-privacy-erasure. Usage: node check.mjs <work-copy> <seed>
// Every case builds a fresh hidden store and erases through the real module; the
// privacy case serializes the whole store afterwards and searches for the data.
import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
const req = createRequire(join(work, "package.json"));
const load = (path) => { try { return req(join(work, path)); } catch { return null; } };
const erasure = load("src/erasure.js");
const { createStore } = load("src/store.js") || {};
const reports = load("src/reports.js");

const NOW = new Date("2026-03-04T05:06:07.000Z");
const PERSONAL = ["Malee Srisuk", "malee.s@example.org", "+66 2 555 0101", "88 Sukhumvit Rd, Bangkok", "Office, 9th floor", "Happy birthday Malee!"];
function data() {
  return {
    customers: [
      { id: "c-7", name: "Malee Srisuk", email: "malee.s@example.org", phone: "+66 2 555 0101", address: "88 Sukhumvit Rd, Bangkok", createdAt: "2023-02-01T10:00:00.000Z" },
      { id: "c-8", name: "Arthit Chai", email: "arthit@example.org", phone: "+66 2 555 0202", address: "1 Silom Rd", createdAt: "2023-05-01T10:00:00.000Z" }
    ],
    orders: [
      { id: "o-1", customerId: "c-7", placedAt: "2024-01-05T09:00:00.000Z", currency: "THB", total: 2590, shippingAddress: "Office, 9th floor", giftMessage: "Happy birthday Malee!", items: [{ sku: "TEA-1", quantity: 2, unitPrice: 1295 }] },
      { id: "o-2", customerId: "c-8", placedAt: "2024-02-05T09:00:00.000Z", currency: "THB", total: 990, shippingAddress: "1 Silom Rd", giftMessage: null, items: [{ sku: "CUP-2", quantity: 1, unitPrice: 990 }] },
      { id: "o-3", customerId: "c-7", placedAt: "2024-03-05T09:00:00.000Z", currency: "USD", total: 45, shippingAddress: "88 Sukhumvit Rd, Bangkok", giftMessage: null, items: [{ sku: "POT-3", quantity: 3, unitPrice: 15 }] }
    ]
  };
}
function erased() {
  const store = createStore(data());
  const result = erasure.eraseCustomer(store, "c-7", { requestedBy: "staff-42", now: NOW });
  return { store, result };
}
function runCase(id, fn) {
  try { results[id] = fn() === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}

runCase("CASE_PERSONAL_FIELDS_ERASED", () => {
  const { store } = erased();
  const customer = store.customers.find(({ id }) => id === "c-7");
  const orders = store.orders.filter(({ customerId }) => customerId === "c-7");
  return isDeepStrictEqual(customer, { id: "c-7", name: "Erased customer", email: null, phone: null, address: null,
    createdAt: "2023-02-01T10:00:00.000Z", erasedAt: NOW.toISOString() }) &&
    orders.length === 2 && orders.every((order) => order.shippingAddress === null && order.giftMessage === null);
});
runCase("CASE_NO_PERSONAL_DATA_LEFT", () => {
  const { store } = erased();
  const text = JSON.stringify(store);
  return PERSONAL.every((value) => !text.includes(value)) && text.includes("Arthit Chai");
});
runCase("CASE_FINANCIAL_TOTALS_RETAINED", () => {
  const before = createStore(data());
  const { store } = erased();
  const keep = ({ id, customerId, placedAt, currency, total, items }) => ({ id, customerId, placedAt, currency, total, items });
  return isDeepStrictEqual(reports.revenueByCurrency(store), reports.revenueByCurrency(before)) &&
    isDeepStrictEqual(store.orders.map(keep), before.orders.map(keep)) &&
    reports.customerSummary(store, "c-7").spent === 2635;
});
runCase("CASE_AUDIT_ENTRY", () => {
  const { store, result } = erased();
  return isDeepStrictEqual(store.audit, [{ action: "customer_erased", customerId: "c-7", requestedBy: "staff-42", at: NOW.toISOString() }]) &&
    isDeepStrictEqual(result, { customerId: "c-7", ordersAnonymized: 2, alreadyErased: false });
});
runCase("CASE_REPEAT_IS_NOOP", () => {
  const { store } = erased();
  const snapshot = structuredClone(store);
  const again = erasure.eraseCustomer(store, "c-7", { requestedBy: "staff-43", now: new Date("2026-04-01T00:00:00.000Z") });
  return isDeepStrictEqual(again, { customerId: "c-7", ordersAnonymized: 0, alreadyErased: true }) &&
    isDeepStrictEqual(store, snapshot);
});
runCase("CASE_OTHERS_UNTOUCHED", () => {
  const before = createStore(data());
  const { store } = erased();
  return isDeepStrictEqual(store.customers.find(({ id }) => id === "c-8"), before.customers.find(({ id }) => id === "c-8")) &&
    isDeepStrictEqual(store.orders.find(({ id }) => id === "o-2"), before.orders.find(({ id }) => id === "o-2"));
});
runCase("CASE_UNKNOWN_CUSTOMER", () => {
  const store = createStore(data());
  const snapshot = structuredClone(store);
  try { erasure.eraseCustomer(store, "c-404", { requestedBy: "staff-42", now: NOW }); return false; }
  catch (error) { return error?.code === "CUSTOMER_NOT_FOUND" && isDeepStrictEqual(store, snapshot); }
});

function suite(args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [
    "--test", "--test-force-exit", "--test-timeout=20000", "--test-reporter=tap", ...args
  ], { cwd: work, encoding: "utf8", timeout: 40000, env, maxBuffer: 10 * 1024 * 1024 });
  const pass = Number((String(run.stdout).match(/^# pass (\d+)/m) || [])[1] || 0);
  return { ok: run.status === 0, pass };
}
const seedTests = readdirSync(join(seed, "test")).filter((name) => name.endsWith(".test.js"));
try {
  cpSync(join(seed, "test"), join(work, "oracle-seed-tests"), { recursive: true });
  const replay = suite(seedTests.map((name) => `oracle-seed-tests/${name}`));
  rmSync(join(work, "oracle-seed-tests"), { recursive: true, force: true });
  results.CASE_SEED_TESTS_REPLAY = replay.ok && replay.pass >= 2 ? "pass" : "fail";
} catch { results.CASE_SEED_TESTS_REPLAY = "fail"; }
try {
  const delivered = suite([]);
  results.CASE_TESTS_PASS = delivered.ok && delivered.pass > 2 ? "pass" : "fail";
} catch { results.CASE_TESTS_PASS = "fail"; }

const ids = Object.keys(results);
const score = ids.filter((id) => results[id] === "pass").length;
process.stdout.write(`${JSON.stringify({ results, score, max: ids.length,
  verdict: score === ids.length ? "pass" : "fail" })}\n`);
process.exit(0);
