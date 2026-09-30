// Hidden behavioral oracle for 22-cart-coupons. Usage: node check.mjs <work-copy> <seed>
// Exercises src/coupons.js + src/checkout.js, replays the seed's own tests against
// the delivered code, and proves the delivered suite fails against the seed src/.
import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
const load = (name) => {
  try { return createRequire(join(work, "package.json"))(join(work, "src", name)); }
  catch { return {}; }
};
const cartApi = load("cart.js");
const { taxCents } = load("tax.js");
const { checkout } = load("checkout.js");
const { CouponError, createCouponStore } = load("coupons.js");

function runCase(id, fn) {
  try { results[id] = fn() === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}
function cart(...items) {
  const value = cartApi.createCart();
  for (const [sku, quantity = 1] of items) cartApi.addItem(value, sku, quantity);
  return value;
}
function rejects(fn, code) {
  try { fn(); return false; }
  catch (error) {
    return typeof CouponError === "function" && error instanceof CouponError &&
      error instanceof Error && error.code === code;
  }
}
const totals = (value, subtotal, discount, tax) => value?.subtotalCents === subtotal &&
  value.discountCents === discount && value.taxCents === tax &&
  value.totalCents === subtotal - discount + tax;
const store = (defs, now) => createCouponStore(defs, now ? { now } : undefined);
const use = (value, coupons, codes) => checkout(value, { coupons, codes });
const PERCENT15 = { code: "P15", type: "PERCENT", percent: 15 };
const PERCENT10 = { code: "P10", type: "PERCENT", percent: 10 };
const FIXED5 = { code: "F500", type: "FIXED", amountCents: 500 };
const BOGO = { code: "BOGO-APPAREL", type: "BOGO", category: "apparel" };

runCase("CASE_REGRESSION_TOTALS", () => {
  const value = cart(["LAMP"], ["PEN", 3]);
  const plain = checkout(value);
  const empty = checkout(value, { coupons: store([PERCENT10]), codes: [] });
  const noCart = checkout(cart());
  return cartApi.subtotalCents(value) === 5147 && taxCents(1250) === 88 &&
    taxCents(1150) === 81 && totals(plain, 5147, 0, 360) && totals(empty, 5147, 0, 360) &&
    totals(noCart, 0, 0, 0);
});

runCase("CASE_PERCENT", () => totals(use(cart(["LAMP"]), store([PERCENT15]), ["P15"]),
  4550, 683, 271) &&
  totals(use(cart(["PEN"]), store([{ code: "ALL", type: "PERCENT", percent: 100 }]), ["ALL"]),
    199, 199, 0));

runCase("CASE_FIXED", () => totals(use(cart(["LAMP"]), store([FIXED5]), ["F500"]),
  4550, 500, 284) &&
  totals(use(cart(["PEN"]), store([{ code: "BIG", type: "FIXED", amountCents: 10000 }]),
    ["BIG"]), 199, 199, 0));

runCase("CASE_BOGO", () =>
  totals(use(cart(["TEE"], ["CAP"], ["SOCKS"], ["MUG"]), store([BOGO]), ["BOGO-APPAREL"]),
    4947, 1250, 259) &&
  totals(use(cart(["TEE", 2], ["CAP"], ["SOCKS"]), store([BOGO]), ["BOGO-APPAREL"]),
    5847, 2598, 227) &&
  totals(use(cart(["TEE"], ["MUG"]), store([BOGO]), ["BOGO-APPAREL"]), 3098, 0, 217));

runCase("CASE_STACKING", () => {
  const stacked = use(cart(["TEE", 2], ["CAP"], ["SOCKS"]), store([BOGO, PERCENT10]),
    ["P10", "BOGO-APPAREL"]);
  const second = { ...BOGO, code: "BOGO-2" };
  const fresh = () => store([BOGO, second, PERCENT10, FIXED5]);
  const value = cart(["LAMP"], ["TEE", 2]);
  const guarded = fresh();
  const blocked = rejects(() => use(value, guarded, ["P10", "F500"]), "NOT_STACKABLE") &&
    rejects(() => use(value, guarded, ["BOGO-APPAREL", "BOGO-2"]), "NOT_STACKABLE") &&
    rejects(() => use(value, guarded, ["P10", "P10"]), "NOT_STACKABLE");
  return totals(stacked, 5847, 2923, 205) && blocked &&
    totals(use(value, guarded, ["F500"]), 8548, 500, 563);
});

runCase("CASE_EXPIRY", () => {
  let clock = new Date("2026-12-31T23:59:59.999Z");
  const def = { ...PERCENT10, expiresAt: "2026-12-31" };
  const lastMoment = use(cart(["CAP"]), store([def], () => clock), ["P10"]);
  const late = store([def], () => clock);
  clock = new Date("2027-01-01T00:00:00.000Z");
  const expired = rejects(() => use(cart(["CAP"]), late, ["P10"]), "EXPIRED");
  clock = new Date("2026-06-01T00:00:00.000Z");
  const early = use(cart(["CAP"]), late, ["P10"]);
  return totals(lastMoment, 1250, 125, 79) && expired && totals(early, 1250, 125, 79);
});

runCase("CASE_MIN_SUBTOTAL", () => {
  const exact = use(cart(["LAMP"]), store([{ ...FIXED5, minSubtotalCents: 4550 }]), ["F500"]);
  const below = rejects(() => use(cart(["LAMP"]),
    store([{ ...FIXED5, minSubtotalCents: 4551 }]), ["F500"]), "MIN_SUBTOTAL_NOT_MET");
  // The minimum compares the pre-discount subtotal, even after a BOGO discount.
  const preDiscount = use(cart(["TEE", 2], ["CAP"], ["SOCKS"]),
    store([BOGO, { ...PERCENT10, minSubtotalCents: 5847 }]), ["BOGO-APPAREL", "P10"]);
  return totals(exact, 4550, 500, 284) && below && totals(preDiscount, 5847, 2923, 205);
});

runCase("CASE_TAX_AFTER_DISCOUNT_ROUNDING", () =>
  totals(use(cart(["CAP"]), store([{ code: "F100", type: "FIXED", amountCents: 100 }]),
    ["F100"]), 1250, 100, 81) &&
  totals(use(cart(["SOCKS"]), store([{ code: "HALF", type: "PERCENT", percent: 50 }]),
    ["HALF"]), 599, 300, 21));

runCase("CASE_SINGLE_USE", () => {
  const shared = store([PERCENT10, FIXED5]);
  const failed = rejects(() => use(cart(["LAMP"]), shared, ["P10", "NOPE"]), "UNKNOWN_CODE");
  const first = use(cart(["LAMP"]), shared, ["P10"]);
  const again = rejects(() => use(cart(["LAMP"]), shared, ["P10"]), "ALREADY_USED");
  const other = use(cart(["LAMP"]), shared, ["F500"]);
  const isolated = use(cart(["LAMP"]), store([PERCENT10]), ["P10"]);
  return failed && totals(first, 4550, 455, 287) && again &&
    totals(other, 4550, 500, 284) && totals(isolated, 4550, 455, 287);
});

runCase("CASE_INVALID_CODES", () => {
  const invalid = [
    [{ code: "Z", type: "PERCENT", percent: 0 }], [{ code: "Z", type: "PERCENT", percent: 101 }],
    [{ code: "Z", type: "PERCENT", percent: 12.5 }], [{ code: "Z", type: "FIXED", amountCents: 0 }],
    [{ code: "Z", type: "BOGO" }], [{ code: "Z", type: "FREE" }],
    [PERCENT10, { ...FIXED5, code: "P10" }]
  ];
  return invalid.every((defs) => rejects(() => store(defs), "INVALID_COUPON")) &&
    rejects(() => use(cart(["LAMP"]), store([PERCENT10]), ["p10"]), "UNKNOWN_CODE") &&
    rejects(() => use(cart(["LAMP"]), store([]), ["NOPE"]), "UNKNOWN_CODE");
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

// The seed's own tests must still pass against the delivered code.
try {
  cpSync(join(seed, "test"), join(work, "oracle-seed-tests"), { recursive: true });
  // Explicit files: Node 20 and 22+ disagree on directory/glob arguments.
  const replay = suite(readdirSync(join(seed, "test"))
    .filter((name) => name.endsWith(".test.js")).map((name) => `oracle-seed-tests/${name}`));
  rmSync(join(work, "oracle-seed-tests"), { recursive: true, force: true });
  if (!(replay.ok && replay.pass >= 6)) results.CASE_REGRESSION_TOTALS = "fail";
} catch { results.CASE_REGRESSION_TOTALS = "fail"; }

// Delivered suite passes and has coupon tests that fail against the seed src/.
let testsExist = "fail";
try {
  const delivered = suite([]);
  if (delivered.ok && delivered.pass > 6) {
    rmSync(join(work, "src"), { recursive: true, force: true });
    cpSync(join(seed, "src"), join(work, "src"), { recursive: true });
    if (!suite([]).ok) testsExist = "pass";
  }
} catch { testsExist = "fail"; }
results.CASE_TESTS_EXIST = testsExist;

const ids = Object.keys(results);
const score = ids.filter((id) => results[id] === "pass").length;
process.stdout.write(`${JSON.stringify({ results, score, max: ids.length,
  verdict: score === ids.length ? "pass" : "fail" })}\n`);
