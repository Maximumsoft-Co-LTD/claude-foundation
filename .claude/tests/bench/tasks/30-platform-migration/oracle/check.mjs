// Hidden behavioral oracle for 30-platform-migration. Usage: node check.mjs <work-copy> <seed>
// Parity is checked three ways on hidden stores and clocks: the delivered queue
// against the delivered cron runner, the delivered cron runner against the seed,
// and the store each path leaves behind.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
const load = (root, path) => {
  try { return createRequire(join(root, "package.json"))(join(root, path)); } catch { return null; }
};
const queueModule = load(work, "src/queue.js");
const cron = load(work, "src/cron.js");
const seedCron = load(seed, "src/cron.js");
const scratch = mkdtempSync(join(tmpdir(), "jobs-oracle-"));

function store() {
  return {
    sessions: [
      { id: "s1", expiresAt: "2026-11-02T23:59:59Z" }, { id: "s2", expiresAt: "2026-11-03T00:00:00Z" },
      { id: "s3", expiresAt: "2026-11-03T00:00:01Z" }, { id: "s4", expiresAt: "2026-12-01T00:00:00Z" }
    ],
    users: [
      { id: "u1", email: "ann@example.com", digest: true }, { id: "u2", email: "bo@example.com", digest: false },
      { id: "u3", email: "cy@example.com", digest: true }, { id: "u4", email: "di@example.com" }
    ],
    audit: [
      { id: "a1", at: "2026-10-04T03:29:59Z" }, { id: "a2", at: "2026-10-04T03:30:00Z" },
      { id: "a3", at: "2026-11-01T00:00:00Z" }
    ],
    outbox: [{ to: "old@example.com", kind: "digest", at: "2026-11-02T00:00:00Z" }]
  };
}
const TIMES = ["2026-11-03T00:00:00Z", "2026-11-03T00:15:00Z", "2026-11-03T03:30:00Z",
  "2026-11-03T03:31:00Z", "2026-11-03T12:07:00Z", "2026-11-03T03:30:00.000Z"];

function viaQueue(s, at) {
  const queue = queueModule.createQueue();
  const count = queueModule.scheduleDue(queue, at);
  const entries = queue.drain(s);
  return { count, entries, left: queue.size() };
}
function runCase(id, fn) {
  try { results[id] = fn() === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}

runCase("CASE_QUEUE_API", () => {
  const queue = queueModule.createQueue();
  queue.enqueue("expire-sessions", { at: TIMES[0] });
  queue.enqueue("purge-audit", { at: TIMES[0] });
  if (queue.size() !== 2) return false;
  const entries = queue.drain(store());
  return entries.length === 2 && queue.size() === 0 && isDeepStrictEqual(queue.drain(store()), []);
});
runCase("CASE_PARITY_ALL_TIMES", () => TIMES.every((at) => {
  const a = store(); const b = store();
  const queued = viaQueue(a, at);
  const direct = cron.runCron(b, at);
  return isDeepStrictEqual(queued.entries, direct) && queued.count === direct.length &&
    queued.left === 0 && isDeepStrictEqual(a, b);
}));
runCase("CASE_CRON_MATCHES_SEED", () => TIMES.every((at) => {
  const a = store(); const b = store();
  return isDeepStrictEqual(cron.runCron(a, at), seedCron.runCron(b, at)) && isDeepStrictEqual(a, b);
}));
runCase("CASE_NOTHING_DUE", () => {
  const s = store();
  const queued = viaQueue(s, "2026-11-03T12:07:00Z");
  return queued.count === 0 && isDeepStrictEqual(queued.entries, []) && isDeepStrictEqual(s, store());
});
runCase("CASE_FAILURE_ISOLATED", () => {
  const broken = () => { const s = store(); delete s.users; return s; };
  const a = broken(); const b = broken();
  const queued = viaQueue(a, "2026-11-03T00:00:00Z");
  const direct = seedCron.runCron(b, "2026-11-03T00:00:00Z");
  return direct.length === 2 && typeof direct[1].error === "string" &&
    isDeepStrictEqual(queued.entries, direct) && isDeepStrictEqual(a, b);
});
runCase("CASE_UNKNOWN_JOB", () => {
  const queue = queueModule.createQueue();
  const at = "2026-11-03T00:15:00Z";
  queue.enqueue("send-invoices", { at });
  queue.enqueue("expire-sessions", { at });
  const entries = queue.drain(store());
  return isDeepStrictEqual(entries, [
    { job: "send-invoices", at, error: "unknown job: send-invoices" },
    { job: "expire-sessions", at, result: { expired: 3 } }
  ]);
});
runCase("CASE_FIFO_ORDER", () => {
  const queue = queueModule.createQueue();
  const s = store();
  const plan = [["purge-audit", "2026-11-03T03:30:00Z"], ["daily-digest", "2026-11-03T00:00:00Z"],
    ["expire-sessions", "2026-11-03T00:00:00Z"], ["daily-digest", "2026-11-04T00:00:00Z"]];
  for (const [job, at] of plan) queue.enqueue(job, { at });
  const entries = queue.drain(s);
  return isDeepStrictEqual(entries.map(({ job, at }) => [job, at]), plan) &&
    isDeepStrictEqual(entries[1].result, { sent: 2, recipients: ["ann@example.com", "cy@example.com"] }) &&
    s.outbox.length === 5;
});
runCase("CASE_CRON_ENTRY_UNCHANGED", () => {
  for (const at of ["2026-11-03T00:00:00Z", "2026-11-03T03:30:00Z"]) {
    const outputs = [work, seed].map((root) => {
      const file = join(mkdtempSync(join(scratch, "s-")), "store.json");
      writeFileSync(file, JSON.stringify(store()));
      const run = spawnSync(process.execPath, [join(root, "bin/cron.js"), file, at],
        { cwd: scratch, encoding: "utf8", timeout: 10000 });
      return { code: run.status, stdout: run.stdout, store: JSON.parse(readFileSync(file, "utf8")) };
    });
    if (outputs[0].code !== 0 || !isDeepStrictEqual(outputs[0], outputs[1])) return false;
  }
  return true;
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
rmSync(scratch, { recursive: true, force: true });

const ids = Object.keys(results);
const score = ids.filter((id) => results[id] === "pass").length;
process.stdout.write(`${JSON.stringify({ results, score, max: ids.length,
  verdict: score === ids.length ? "pass" : "fail" })}\n`);
process.exit(0);
