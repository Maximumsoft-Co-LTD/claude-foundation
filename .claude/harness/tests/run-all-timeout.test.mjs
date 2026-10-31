import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const RUN_ALL = fileURLToPath(new URL("../../tests/run-all.sh", import.meta.url));

// The hidden forms of run-all.sh that expose its watchdog decisions.
const run = (args, env = {}) => spawnSync("sh", [RUN_ALL, ...args], {
  encoding: "utf8", env: { ...process.env, FOUNDATION_SUITE_TIMEOUT_SECONDS: "", ...env }
});
const limitOf = (label, env) => run(["--timeout-seconds", label], env).stdout.trim();

function work(t, files) {
  const dir = mkdtempSync(join(tmpdir(), "foundation-run-all-timeout-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

test("installer smoke ได้ 600 วินาที", () => {
  assert.equal(limitOf("installer smoke"), "600");
});

test("the other long suites keep their ten minutes", () => {
  for (const label of ["harness contracts (topology planning)", "pull request delivery",
    "proof loop end to end", "apply conflict", "concurrent repositories seam"])
    assert.equal(limitOf(label), "600", label);
});

test("suite อื่นยังได้ 300 วินาที", () => {
  assert.equal(limitOf("scratch router"), "300");
  assert.equal(limitOf("installer transaction"), "300");
});

test("ตัวแปรสภาพแวดล้อมครอบทุก suite", () => {
  const env = { FOUNDATION_SUITE_TIMEOUT_SECONDS: "45" };
  assert.equal(limitOf("installer smoke", env), "45");
  assert.equal(limitOf("scratch router", env), "45");
});

test("suite ที่ถูกฆ่ารายงาน timed out", (t) => {
  const dir = work(t, { "7.timeout": "300\n", "7.status": "1\n" });
  assert.equal(run(["--timeout-note", dir, "7"]).stdout, " (timed out after 300s)");
});

test("suite ที่ถูกฆ่านับว่าล้มแม้สถานะเป็น 0", (t) => {
  // The tree is stopped child first, so the suite's own shell can finish and
  // record success before the watchdog's TERM reaches it.
  const dir = work(t, { "7.timeout": "300\n", "7.status": "0\n" });
  assert.equal(run(["--suite-failed", dir, "7"]).stdout.trim(), "failed");
});

test("suite ปกติไม่มีหมายเหตุ", (t) => {
  const dir = work(t, { "8.status": "0\n", "9.status": "1\n" });
  assert.equal(run(["--timeout-note", dir, "8"]).stdout, "");
  assert.equal(run(["--suite-failed", dir, "8"]).stdout.trim(), "passed");
  // An ordinary failure is still a failure and is not blamed on the watchdog.
  assert.equal(run(["--suite-failed", dir, "9"]).stdout.trim(), "failed");
  assert.equal(run(["--timeout-note", dir, "9"]).stdout, "");
});

test("a suite with no recorded status counts as failed", (t) => {
  const dir = work(t, {});
  assert.equal(run(["--suite-failed", dir, "10"]).stdout.trim(), "failed");
});

test("the hidden forms refuse missing arguments instead of guessing", () => {
  for (const args of [["--timeout-seconds"], ["--timeout-note"], ["--timeout-note", "dir"], ["--suite-failed"]])
    assert.equal(run(args).status, 2, args.join(" "));
});
