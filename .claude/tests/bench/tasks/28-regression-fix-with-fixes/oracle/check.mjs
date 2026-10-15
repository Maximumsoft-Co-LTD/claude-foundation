// Hidden behavioral oracle for 28-regression-fix-with-fixes. Usage: node check.mjs <work-copy> <seed>
// The 2026-10-01 loyalty change used `>` where its spec says "from 1000/5000
// points". Both boundaries must be fixed; every neighbouring partition, the
// rounding rule, and validation must stay as they were.
import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
let pricing = {};
try { pricing = createRequire(join(work, "package.json"))(join(work, "src/pricing.js")); }
catch { pricing = {}; }
const { loyaltyPercent, priceOrder, subtotalCents } = pricing;

function runCase(id, fn) {
  try { results[id] = fn() === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}
const one = (priceCents) => [{ priceCents, quantity: 1 }];
const priced = (cents, points, discountPercent, discountCents) => isDeepStrictEqual(
  priceOrder(one(cents), { points }),
  { subtotalCents: cents, discountPercent, discountCents, totalCents: cents - discountCents });
const throwsRange = (fn) => { try { fn(); return false; } catch (error) { return error instanceof RangeError; } };

runCase("CASE_LOWER_BOUNDARY", () => loyaltyPercent(1000) === 5 && priced(2000, 1000, 5, 100) &&
  priced(1010, 1000, 5, 51));
runCase("CASE_UPPER_BOUNDARY", () => loyaltyPercent(5000) === 10 && priced(2000, 5000, 10, 200) &&
  priced(995, 5000, 10, 100));
runCase("CASE_BELOW_BOUNDARIES", () => loyaltyPercent(0) === 0 && loyaltyPercent(999) === 0 &&
  loyaltyPercent(4999) === 5 && priced(2000, 999, 0, 0) && priced(2000, 4999, 5, 100));
runCase("CASE_ABOVE_BOUNDARIES", () => loyaltyPercent(1001) === 5 && loyaltyPercent(5001) === 10 &&
  loyaltyPercent(1000000) === 10 && priced(2000, 1001, 5, 100) && priced(2000, 5001, 10, 200));
runCase("CASE_ROUNDING_INTACT", () => priced(1010, 3000, 5, 51) && priced(1009, 3000, 5, 50) &&
  priced(1030, 3000, 5, 52) && priced(995, 6000, 10, 100) && priced(994, 6000, 10, 99) &&
  priced(0, 6000, 10, 0));
runCase("CASE_VALIDATION_INTACT", () => throwsRange(() => loyaltyPercent(-1)) &&
  throwsRange(() => loyaltyPercent(1.5)) && throwsRange(() => loyaltyPercent(Number.NaN)) &&
  throwsRange(() => loyaltyPercent("1000")) &&
  throwsRange(() => priceOrder(one(100), { points: -1000 })) &&
  isDeepStrictEqual(priceOrder(one(1999)),
    { subtotalCents: 1999, discountPercent: 0, discountCents: 0, totalCents: 1999 }));
runCase("CASE_SUBTOTAL_INTACT", () => subtotalCents([]) === 0 &&
  subtotalCents([{ priceCents: 1250, quantity: 2 }, { priceCents: 499, quantity: 3 }]) === 3997 &&
  isDeepStrictEqual(priceOrder([{ priceCents: 1250, quantity: 2 }, { priceCents: 499, quantity: 3 }],
    { points: 3000 }), { subtotalCents: 3997, discountPercent: 5, discountCents: 200, totalCents: 3797 }));

function suite(args) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, [
    "--test", "--test-force-exit", "--test-timeout=20000", "--test-reporter=tap", ...args
  ], { cwd: work, encoding: "utf8", timeout: 40000, env, maxBuffer: 10 * 1024 * 1024 });
  const pass = Number((String(run.stdout).match(/^# pass (\d+)/m) || [])[1] || 0);
  return { ok: run.status === 0, pass };
}

try {
  cpSync(join(seed, "test"), join(work, "oracle-seed-tests"), { recursive: true });
  const replay = suite(readdirSync(join(seed, "test"))
    .filter((name) => name.endsWith(".test.js")).map((name) => `oracle-seed-tests/${name}`));
  rmSync(join(work, "oracle-seed-tests"), { recursive: true, force: true });
  results.CASE_SEED_TESTS_REPLAY = replay.ok && replay.pass >= 4 ? "pass" : "fail";
} catch { results.CASE_SEED_TESTS_REPLAY = "fail"; }

// The delivered suite passes and fails once src/ is put back to the seed.
let passes = "fail"; let detects = "fail";
try {
  const delivered = suite([]);
  if (delivered.ok && delivered.pass >= 4) {
    passes = "pass";
    rmSync(join(work, "src"), { recursive: true, force: true });
    cpSync(join(seed, "src"), join(work, "src"), { recursive: true });
    if (!suite([]).ok) detects = "pass";
  }
} catch { /* recorded as fail */ }
results.CASE_TESTS_PASS = passes;
results.CASE_TESTS_DETECT_SEED = detects;

const ids = Object.keys(results);
const score = ids.filter((id) => results[id] === "pass").length;
process.stdout.write(`${JSON.stringify({ results, score, max: ids.length,
  verdict: score === ids.length ? "pass" : "fail" })}\n`);
