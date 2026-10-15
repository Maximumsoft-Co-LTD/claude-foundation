// Hidden behavioral oracle for 26-idempotent-refund. Usage: node check.mjs <work-copy> <seed>
// Every case reads the payment back: a refund is counted by refundedCents, not by
// the response, so a replay that silently refunds twice cannot pass.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
let createServer = null;
try { ({ createServer } = createRequire(join(work, "package.json"))(join(work, "src/server.js"))); }
catch { createServer = null; }
const scratch = mkdtempSync(join(tmpdir(), "refund-oracle-"));

function ledger(payments) {
  const file = join(mkdtempSync(join(scratch, "l-")), "ledger.json");
  writeFileSync(file, JSON.stringify({ payments }));
  return file;
}
const PAY = () => ({
  pay_1: { amountCents: 10000, capturedCents: 10000 },
  pay_2: { amountCents: 8000, capturedCents: 5000 }
});

async function withServer(ledgerFile, fn) {
  const server = createServer({ ledgerFile });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { key, body } = {}) => {
    const headers = { "content-type": "application/json" };
    if (key !== undefined) headers["idempotency-key"] = key;
    const res = await fetch(base + path, { method, headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed };
  };
  try { return await fn(call); }
  finally { server.closeAllConnections?.(); await new Promise((done) => server.close(done)); }
}

const refund = (call, id, key, amountCents) =>
  call("POST", `/payments/${id}/refunds`, { key, body: { amountCents } });
const refunded = async (call, id) => (await call("GET", `/payments/${id}`)).body?.refundedCents;
const ok = (res, paymentId, amountCents, total) => res.status === 201 &&
  typeof res.body?.refundId === "string" && res.body.refundId.length > 0 &&
  res.body.paymentId === paymentId && res.body.amountCents === amountCents &&
  res.body.refundedCents === total;

async function runCase(id, fn) {
  try { results[id] = (await fn()) === true ? "pass" : "fail"; }
  catch { results[id] = "fail"; }
}

const CASES = ["CASE_REFUND_CREATED", "CASE_REPLAY_SAME_RESPONSE", "CASE_KEY_REUSE_REJECTED",
  "CASE_OVER_REFUND_REJECTED", "CASE_RESTART_DEDUPES", "CASE_CONCURRENT_DUPLICATES",
  "CASE_CONCURRENT_OVER_REFUND", "CASE_VALIDATION", "CASE_EXISTING_ROUTES"];
if (typeof createServer !== "function") {
  for (const id of CASES) results[id] = "fail";
} else {
  await runCase("CASE_REFUND_CREATED", () => withServer(ledger(PAY()), async (call) => {
    const first = await refund(call, "pay_1", "k1", 2500);
    const second = await refund(call, "pay_1", "k2", 1500);
    return ok(first, "pay_1", 2500, 2500) && ok(second, "pay_1", 1500, 4000) &&
      first.body.refundId !== second.body.refundId &&
      await refunded(call, "pay_1") === 4000 && await refunded(call, "pay_2") === 0;
  }));
  await runCase("CASE_REPLAY_SAME_RESPONSE", () => withServer(ledger(PAY()), async (call) => {
    const first = await refund(call, "pay_1", "retry-1", 3000);
    const again = await refund(call, "pay_1", "retry-1", 3000);
    const third = await refund(call, "pay_1", "retry-1", 3000);
    return ok(first, "pay_1", 3000, 3000) && again.status === first.status &&
      isDeepStrictEqual(again.body, first.body) && isDeepStrictEqual(third.body, first.body) &&
      await refunded(call, "pay_1") === 3000;
  }));
  await runCase("CASE_KEY_REUSE_REJECTED", () => withServer(ledger(PAY()), async (call) => {
    const first = await refund(call, "pay_1", "shared", 1000);
    const otherAmount = await refund(call, "pay_1", "shared", 1001);
    const otherPayment = await refund(call, "pay_2", "shared", 1000);
    const replay = await refund(call, "pay_1", "shared", 1000);
    return ok(first, "pay_1", 1000, 1000) &&
      otherAmount.status === 422 && otherAmount.body?.error === "idempotency_key_reused" &&
      otherPayment.status === 422 && otherPayment.body?.error === "idempotency_key_reused" &&
      isDeepStrictEqual(replay.body, first.body) &&
      await refunded(call, "pay_1") === 1000 && await refunded(call, "pay_2") === 0;
  }));
  await runCase("CASE_OVER_REFUND_REJECTED", () => withServer(ledger(PAY()), async (call) => {
    // pay_2 captured 5000 of 8000 authorized: the limit is captured, not authorized.
    const over = await refund(call, "pay_2", "o1", 5001);
    const part = await refund(call, "pay_2", "o2", 4000);
    const rest = await refund(call, "pay_2", "o3", 1001);
    const exact = await refund(call, "pay_2", "o4", 1000);
    const more = await refund(call, "pay_2", "o5", 1);
    return over.status === 409 && over.body?.error === "exceeds_captured" &&
      ok(part, "pay_2", 4000, 4000) && rest.status === 409 &&
      ok(exact, "pay_2", 1000, 5000) && more.status === 409 &&
      await refunded(call, "pay_2") === 5000;
  }));
  await runCase("CASE_RESTART_DEDUPES", async () => {
    const file = ledger(PAY());
    const first = await withServer(file, (call) => refund(call, "pay_1", "restart-1", 4200));
    return withServer(file, async (call) => {
      const replay = await refund(call, "pay_1", "restart-1", 4200);
      const reused = await refund(call, "pay_1", "restart-1", 10);
      const next = await refund(call, "pay_1", "restart-2", 800);
      return ok(first, "pay_1", 4200, 4200) && replay.status === 201 &&
        isDeepStrictEqual(replay.body, first.body) && reused.status === 422 &&
        ok(next, "pay_1", 800, 5000) && await refunded(call, "pay_1") === 5000;
    });
  });
  await runCase("CASE_CONCURRENT_DUPLICATES", () => withServer(ledger(PAY()), async (call) => {
    const burst = await Promise.all(Array.from({ length: 6 },
      () => refund(call, "pay_1", "burst", 700)));
    return burst.every((res) => ok(res, "pay_1", 700, 700) &&
      isDeepStrictEqual(res.body, burst[0].body)) && await refunded(call, "pay_1") === 700;
  }));
  await runCase("CASE_CONCURRENT_OVER_REFUND", () => withServer(ledger(PAY()), async (call) => {
    const race = await Promise.all([6000, 6000, 6000].map((amount, index) =>
      refund(call, "pay_1", `race-${index}`, amount)));
    const wins = race.filter((res) => res.status === 201).length;
    const losses = race.filter((res) => res.status === 409).length;
    return wins === 1 && losses === 2 && await refunded(call, "pay_1") === 6000;
  }));
  await runCase("CASE_VALIDATION", () => withServer(ledger(PAY()), async (call) => {
    const noKey = await call("POST", "/payments/pay_1/refunds", { body: { amountCents: 100 } });
    const emptyKey = await refund(call, "pay_1", "", 100);
    const bad = await Promise.all([0, -5, 1.5, "100", null].map((amount, index) =>
      refund(call, "pay_1", `bad-${index}`, amount)));
    const missing = await refund(call, "pay_404", "m1", 100);
    return noKey.status === 400 && noKey.body?.error === "idempotency_key_required" &&
      emptyKey.status === 400 &&
      bad.every((res) => res.status === 400 && res.body?.error === "invalid_amount") &&
      missing.status === 404 && await refunded(call, "pay_1") === 0;
  }));
  await runCase("CASE_EXISTING_ROUTES", async () => {
    const file = ledger({ pay_9: { amountCents: 5000, capturedCents: 0 } });
    await withServer(file, async (call) => {
      if ((await call("POST", "/payments/pay_9/capture", { body: { amountCents: 3000 } })).status !== 200)
        throw new Error("capture");
    });
    return withServer(file, async (call) => {
      const view = await call("GET", "/payments/pay_9");
      return isDeepStrictEqual(view.body,
        { id: "pay_9", amountCents: 5000, capturedCents: 3000, refundedCents: 0 }) &&
        (await call("POST", "/payments/pay_9/capture", { body: { amountCents: 2001 } })).status === 409 &&
        (await call("GET", "/payments/none")).status === 404 &&
        (await call("GET", "/nope")).status === 404;
    });
  });
}

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
  results.CASE_SEED_TESTS_REPLAY = replay.ok && replay.pass >= 2 ? "pass" : "fail";
} catch { results.CASE_SEED_TESTS_REPLAY = "fail"; }

let passes = "fail"; let detects = "fail";
try {
  const delivered = suite([]);
  if (delivered.ok && delivered.pass > 2) {
    passes = "pass";
    rmSync(join(work, "src"), { recursive: true, force: true });
    cpSync(join(seed, "src"), join(work, "src"), { recursive: true });
    if (!suite([]).ok) detects = "pass";
  }
} catch { /* recorded as fail */ }
results.CASE_TESTS_PASS = passes;
results.CASE_TESTS_DETECT_SEED = detects;
rmSync(scratch, { recursive: true, force: true });

const ids = Object.keys(results);
const score = ids.filter((id) => results[id] === "pass").length;
process.stdout.write(`${JSON.stringify({ results, score, max: ids.length,
  verdict: score === ids.length ? "pass" : "fail" })}\n`);
process.exit(0);
