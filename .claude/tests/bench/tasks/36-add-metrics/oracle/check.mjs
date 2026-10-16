// Hidden behavioral oracle for 36-add-metrics. Usage: node check.mjs <work-copy> <seed>
// Every case drives the real runner with recording sinks; the privacy case
// serializes everything the runner emitted and searches it for customer data.
import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
const load = (root) => {
  try { return createRequire(join(root, "package.json"))(join(root, "src/runner.js")); } catch { return null; }
};
const mod = load(work);
const seedMod = load(seed);

const customer = { name: "Somchai Rattanakorn", email: "somchai.r@example.co.th", phone: "+66 81 234 5678", card: "4111111111111111" };
const smtpError = () => Object.assign(new Error(`SMTP rejected ${customer.email} for ${customer.name}`), { code: "SMTP_DOWN" });
const handlers = {
  send_receipt: async () => { throw smtpError(); },
  charge_card: (payload) => { throw new Error(`card ${payload.card} declined for ${payload.phone}`); },
  echo: async (payload) => payload.value
};
function harness(m = mod) {
  const counters = [];
  const records = [];
  const runner = m.createRunner({ handlers, metrics: { increment: (name, labels) => counters.push({ name, labels }) },
    logger: { log: (record) => records.push(record) } });
  return { counters, records, runner };
}
const job = (id, type) => ({ id, type, payload: { ...customer, value: 1 } });
const failedRecords = (records) => records.filter((record) => record?.event === "job_failed");
async function runCase(id, fn) {
  try { results[id] = (await fn()) === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}

await runCase("CASE_FAILED_COUNTER", async () => {
  const h = harness();
  await h.runner.run(job("j-1", "send_receipt"), { correlationId: "req-1" });
  await h.runner.run(job("j-2", "charge_card"), { correlationId: "req-2" });
  await h.runner.run(job("j-3", "echo"), { correlationId: "req-3" });
  return isDeepStrictEqual(h.counters.filter(({ name }) => name === "jobs_failed_total"), [
    { name: "jobs_failed_total", labels: { type: "send_receipt", errorCode: "SMTP_DOWN" } },
    { name: "jobs_failed_total", labels: { type: "charge_card", errorCode: "UNKNOWN" } }
  ]);
});
await runCase("CASE_FAILURE_LOG", async () => {
  const h = harness();
  await h.runner.run(job("j-9", "send_receipt"), { correlationId: "req-77" });
  const found = failedRecords(h.records);
  return found.length === 1 && found[0].level === "error" && found[0].jobId === "j-9" &&
    found[0].type === "send_receipt" && found[0].errorCode === "SMTP_DOWN" && found[0].correlationId === "req-77";
});
await runCase("CASE_CORRELATION_GENERATED", async () => {
  const h = harness();
  const first = await h.runner.run(job("j-4", "charge_card"));
  const second = await h.runner.run(job("j-5", "charge_card"), {});
  const [a, b] = failedRecords(h.records);
  return typeof a?.correlationId === "string" && a.correlationId.length > 0 && typeof b?.correlationId === "string" &&
    a.correlationId !== b.correlationId && first.correlationId === a.correlationId && second.correlationId === b.correlationId;
});
await runCase("CASE_NO_CUSTOMER_DATA", async () => {
  const h = harness();
  await h.runner.run(job("j-6", "send_receipt"), { correlationId: "req-6" });
  await h.runner.run(job("j-7", "charge_card"));
  await h.runner.run(job("j-8", "echo"));
  const emitted = JSON.stringify([h.records, h.counters]);
  const leaks = [...Object.values(customer), "Somchai", "SMTP rejected", "declined", "5678"]
    .filter((value) => emitted.includes(value));
  return failedRecords(h.records).length === 2 && leaks.length === 0;
});
await runCase("CASE_FAILURE_RESULT", async () => {
  const h = harness();
  const sync = await h.runner.run(job("j-10", "charge_card"), { correlationId: "c-1" });
  const later = await h.runner.run(job("j-11", "send_receipt"), { correlationId: "c-2" });
  let rejected = false;
  await h.runner.run(job("j-12", "missing")).catch(() => { rejected = true; });
  return sync.ok === false && later.ok === false && later.errorCode === "SMTP_DOWN" && sync.errorCode === "UNKNOWN" &&
    sync.correlationId === "c-1" && rejected && failedRecords(h.records).length === 2;
});
await runCase("CASE_SUCCESS_UNCHANGED", async () => {
  const now = harness();
  const before = harness(seedMod);
  const a = await now.runner.run(job("j-13", "echo"), { correlationId: "s-1" });
  const b = await before.runner.run(job("j-13", "echo"), { correlationId: "s-1" });
  const strip = (records) => records.map(({ correlationId, ...rest }) => rest);
  return isDeepStrictEqual(a, b) && isDeepStrictEqual(now.counters, before.counters) &&
    isDeepStrictEqual(strip(now.records), strip(before.records));
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
