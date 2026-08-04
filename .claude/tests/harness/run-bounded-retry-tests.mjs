import assert from "node:assert/strict";
import { boundedRetry, isTransientInfrastructureFailure, RetryExhaustedError } from "../../harness/runtime/reliability/bounded-retry.mjs";

let calls = 0;
const attempts = [];
const value = await boundedRetry(async () => {
  calls += 1;
  if (calls < 3) throw Object.assign(new Error("busy"), { status: 503 });
  return "ok";
}, { idempotent: true, baseDelayMs: 1, sleep: async () => {}, random: () => 0, onAttempt: (row) => attempts.push(row) });
assert.equal(value, "ok");
assert.equal(calls, 3);
assert.deepEqual(attempts.map(({ status }) => status), ["failed", "failed", "completed"]);

calls = 0;
await assert.rejects(() => boundedRetry(async () => {
  calls += 1;
  throw Object.assign(new Error("assertion failed"), { code: "ERR_ASSERTION" });
}, { idempotent: true, sleep: async () => {} }), /bounded infrastructure retry exhausted/);
assert.equal(calls, 1, "validation/test failures are not retried");

await assert.rejects(() => boundedRetry(async () => "unsafe", { idempotent: false }), /idempotent/);
assert.equal(isTransientInfrastructureFailure({ status: 429 }), true);
assert.equal(isTransientInfrastructureFailure({ status: 400 }), false);

let timeoutCalls = 0;
await assert.rejects(() => boundedRetry(async () => {
  timeoutCalls += 1;
  return new Promise(() => {});
}, { idempotent: true, maxAttempts: 2, timeoutMs: 2, baseDelayMs: 0, sleep: async () => {} }), RetryExhaustedError);
assert.equal(timeoutCalls, 2);

console.log("bounded retry: ALL PASS (9/9 assertions)");
