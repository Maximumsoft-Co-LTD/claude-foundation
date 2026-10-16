// Hidden behavioral oracle for 34-deprecate-option. Usage: node check.mjs <work-copy> <seed>
// The old option name must keep producing byte-identical CSV while warning once
// per process on stderr; the new name and the defaults must stay silent.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
const scratch = mkdtempSync(join(tmpdir(), "rows2csv-oracle-"));

function file(name, value) {
  const path = join(scratch, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}
function cli(root, args) {
  const run = spawnSync(process.execPath, [join(root, "bin/rows2csv.js"), ...args],
    { cwd: scratch, encoding: "utf8", timeout: 10000 });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}
// Runs a snippet against the library in a fresh process; returns stdout/stderr.
function lib(root, body) {
  const script = `const { toCsv } = require(${JSON.stringify(join(root, "src/csv.js"))});
const out = [];\n${body}\nprocess.stdout.write(JSON.stringify(out));`;
  const run = spawnSync(process.execPath, ["-e", script], { cwd: scratch, encoding: "utf8", timeout: 10000 });
  let out;
  try { out = JSON.parse(run.stdout); } catch { out = undefined; }
  return { code: run.status, out, stderr: run.stderr };
}
const replacementLines = (stderr) => stderr.split("\n").filter((line) => /delimiter/.test(line));
const warnsOnce = (stderr) => replacementLines(stderr).length === 1 && /deprecat/i.test(stderr);
function runCase(id, fn) {
  try { results[id] = fn() === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}

const people = file("people.json", [{ id: 1, name: "Ann; Lee", note: 'said "hi"' }, { id: 2, name: "Bo", note: "a|b" }]);
const items = file("items.json", [{ sku: "A-1", qty: 3 }, { sku: "B;2", qty: 0 }]);
const broken = file("broken.json", "[{");

runCase("CASE_NEW_OPTION", () => {
  for (const sep of [";", "|", "\t"]) {
    const now = cli(work, ["--delimiter", sep, people, items]);
    const before = cli(seed, ["--sep", sep, people, items]);
    if (now.code !== 0 || now.stdout !== before.stdout || now.stderr !== "") return false;
  }
  return true;
});
runCase("CASE_OLD_OPTION_STILL_WORKS", () => {
  for (const sep of [";", "|"]) {
    const now = cli(work, ["--sep", sep, people, items]);
    const before = cli(seed, ["--sep", sep, people, items]);
    if (now.code !== 0 || now.stdout !== before.stdout || before.stdout === "") return false;
  }
  return true;
});
runCase("CASE_CLI_WARNING_ONCE", () => {
  const out = cli(work, ["--sep", ";", people, items, people]);
  return out.code === 0 && warnsOnce(out.stderr) && !/deprecat/i.test(out.stdout);
});
runCase("CASE_LIBRARY_NEW_OPTION", () => {
  const now = lib(work, `out.push(toCsv(${JSON.stringify([{ a: "x;y", b: 2 }])}, { delimiter: ";" }));`);
  const before = lib(seed, `out.push(toCsv(${JSON.stringify([{ a: "x;y", b: 2 }])}, { sep: ";" }));`);
  return now.code === 0 && now.out?.[0] === before.out?.[0] && now.stderr === "";
});
runCase("CASE_LIBRARY_WARNING_ONCE", () => {
  const rows = JSON.stringify([{ a: "x;y", b: 2 }]);
  const now = lib(work, `for (let i = 0; i < 3; i += 1) out.push(toCsv(${rows}, { sep: ";" }));`);
  const before = lib(seed, `out.push(toCsv(${rows}, { sep: ";" }));`);
  return now.code === 0 && now.out?.length === 3 && now.out.every((text) => text === before.out[0]) &&
    warnsOnce(now.stderr);
});
runCase("CASE_DEFAULTS_SILENT_AND_UNCHANGED", () => {
  for (const args of [[people], [people, items], [], ["--delimiter"], ["--bogus", people], [broken], [people + ".missing"]]) {
    const now = cli(work, args);
    const before = cli(seed, args[0] === "--delimiter" ? ["--sep"] : args);
    if (now.code !== before.code || now.stdout !== before.stdout) return false;
    if (now.code === 0 && now.stderr !== "") return false;
  }
  const silent = lib(work, `out.push(toCsv([{ a: 1 }])); out.push(toCsv([{ a: 1 }], {}));`);
  return silent.code === 0 && silent.stderr === "" && silent.out?.[0] === "a\n1\n";
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
