// Hidden behavioral oracle for 29-library-cli-flag. Usage: node check.mjs <work-copy> <seed>
// The CLI is a public contract: every case spawns the real bin and compares the
// plain report byte for byte with the seed, so a --json change that alters the
// old output or an exit code cannot pass.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
const scratch = mkdtempSync(join(tmpdir(), "wordstat-oracle-"));

function file(name, text) {
  const path = join(scratch, name);
  writeFileSync(path, text);
  return path;
}
function cli(root, args) {
  const run = spawnSync(process.execPath, [join(root, "bin/wordstat.js"), ...args],
    { cwd: scratch, encoding: "utf8", timeout: 10000 });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}
function json(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}
function runCase(id, fn) {
  try { results[id] = fn() === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}

const sample = file("notes.txt", "Grüße aus\n  Bangkok  und\tBerlin\n\nlast line no newline");
const empty = file("empty.txt", "");
const missing = join(scratch, "nope.txt");
const expected = (path, text) => {
  const words = (text.match(/\S+/g) || []).length;
  const lines = (text.match(/\n/g) || []).length + (text && !text.endsWith("\n") ? 1 : 0);
  return { file: path, words, lines, chars: Array.from(text).length };
};

runCase("CASE_JSON_FLAG", () => {
  const out = cli(work, ["--json", sample]);
  const text = "Grüße aus\n  Bangkok  und\tBerlin\n\nlast line no newline";
  return out.code === 0 && out.stderr === "" && out.stdout.trim().split("\n").length === 1 &&
    isDeepStrictEqual(json(out.stdout), expected(sample, text)) &&
    isDeepStrictEqual(json(cli(work, ["--json", empty]).stdout), expected(empty, ""));
});
runCase("CASE_JSON_FLAG_AFTER_FILE", () => {
  const out = cli(work, [sample, "--json"]);
  return out.code === 0 && isDeepStrictEqual(json(out.stdout), json(cli(work, ["--json", sample]).stdout)) &&
    json(out.stdout) !== undefined;
});
runCase("CASE_JSON_ERRORS_KEEP_EXIT_CODES", () => {
  const unreadable = cli(work, ["--json", missing]);
  const noFile = cli(work, ["--json"]);
  const extra = cli(work, ["--json", sample, sample]);
  return unreadable.code === 2 && unreadable.stdout === "" && unreadable.stderr.length > 0 &&
    noFile.code === 1 && noFile.stdout === "" && noFile.stderr.length > 0 &&
    extra.code === 1 && extra.stdout === "";
});
runCase("CASE_UNKNOWN_OPTION_STILL_USAGE", () => {
  const yaml = cli(work, ["--yaml", sample]);
  const short = cli(work, ["-j", sample]);
  return yaml.code === 1 && yaml.stdout === "" && short.code === 1 && short.stdout === "";
});
runCase("CASE_PLAIN_OUTPUT_UNCHANGED", () => {
  for (const args of [[sample], [empty], [missing], [], [sample, sample], ["--yaml", sample]]) {
    const now = cli(work, args);
    const before = cli(seed, args);
    if (now.code !== before.code || now.stdout !== before.stdout) return false;
  }
  return true;
});
runCase("CASE_LIBRARY_API_UNCHANGED", () => {
  const lib = createRequire(join(work, "package.json"))(work);
  const old = createRequire(join(seed, "package.json"))(seed);
  for (const text of ["", "a b\nc", "x\n\n", "Grüße 👋 there"])
    if (!isDeepStrictEqual(lib.countText(text), old.countText(text))) return false;
  try { lib.countText(42); return false; } catch (error) { return error instanceof TypeError; }
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
