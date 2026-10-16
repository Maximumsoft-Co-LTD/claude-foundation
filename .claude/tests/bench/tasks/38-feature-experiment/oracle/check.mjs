// Hidden behavioral oracle for 38-feature-experiment. Usage: node check.mjs <work-copy> <seed>
// Assignment must be a pure function of the user id: two checkout instances and
// a separate process must agree, and the split on 1000 fixed ids must be near even.
import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
const modulePath = join(work, "src/checkout.js");
const mod = (() => { try { return createRequire(join(work, "package.json"))(modulePath); } catch { return null; } })();

const KILL = "one-page-checkout-kill";
const users = Array.from({ length: 1000 }, (_, index) => `user-${(index * 7919 + 13) % 100000}`);
function harness(killed = () => false) {
  const events = [];
  const checkout = mod.createCheckout({ track: (event) => events.push(event),
    flags: { isEnabled: (name) => name === KILL && killed() } });
  return { events, checkout };
}
const layouts = (checkout, list) => list.map((id) => checkout.render({ id }).layout);
const VARIANT = { classic: "control", "one-page": "treatment" };
function runCase(id, fn) {
  try { results[id] = fn() === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}

runCase("CASE_SPLIT_NEAR_EVEN", () => {
  const all = layouts(harness().checkout, users);
  const onePage = all.filter((layout) => layout === "one-page").length;
  return all.every((layout) => layout === "classic" || layout === "one-page") && onePage >= 450 && onePage <= 550;
});
runCase("CASE_STABLE_ASSIGNMENT", () => {
  const first = layouts(harness().checkout, users);
  const reversed = layouts(harness().checkout, [...users].reverse()).reverse();
  const sample = users.slice(0, 200);
  const script = `const { createCheckout } = require(${JSON.stringify(modulePath)});
const c = createCheckout({ track() {}, flags: { isEnabled: () => false } });
process.stdout.write(JSON.stringify(${JSON.stringify(sample)}.map((id) => c.render({ id }).layout)));`;
  const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 10000 });
  return isDeepStrictEqual(first, reversed) && isDeepStrictEqual(JSON.parse(child.stdout), first.slice(0, 200)) &&
    new Set(first).size === 2;
});
runCase("CASE_EXPOSURE_ONCE", () => {
  const { events, checkout } = harness();
  const shoppers = users.slice(0, 20);
  const seen = [];
  for (let round = 0; round < 3; round += 1) for (const id of shoppers) seen.push(checkout.render({ id }));
  const expected = shoppers.map((id, index) => ({ event: "experiment_exposure", experiment: "one-page-checkout",
    variant: VARIANT[seen[index].layout], userId: id }));
  return isDeepStrictEqual(events, expected) && seen.every((view, index) => view.layout === seen[index % 20].layout);
});
runCase("CASE_GUESTS_EXCLUDED", () => {
  const { events, checkout } = harness();
  return isDeepStrictEqual(checkout.render(null), { layout: "classic", userId: null }) &&
    checkout.render(undefined)?.layout === "classic" && events.length === 0;
});
runCase("CASE_KILL_SWITCH", () => {
  let killed = true;
  const { events, checkout } = harness(() => killed);
  const off = layouts(checkout, users.slice(0, 100));
  if (!off.every((layout) => layout === "classic") || events.length !== 0) return false;
  killed = false;
  const on = layouts(checkout, users.slice(0, 100));
  killed = true;
  const offAgain = layouts(checkout, users.slice(0, 100));
  return isDeepStrictEqual(on, layouts(harness().checkout, users.slice(0, 100))) && on.includes("one-page") &&
    events.length === 100 && offAgain.every((layout) => layout === "classic") && events.length === 100;
});
runCase("CASE_RENDER_SHAPE", () => {
  const { checkout } = harness();
  return users.slice(0, 50).every((id) => {
    const view = checkout.render({ id });
    return view.userId === id && Object.keys(view).sort().join() === "layout,userId";
  });
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
