// Hidden behavioral oracle for 33-dependency-upgrade. Usage: node check.mjs <work-copy> <seed>
// The delivered tree is reinstalled from its own lockfile with `npm ci --offline`
// (which fails when manifest and lockfile disagree), then invoice paths are
// compared with an installed copy of the seed on hidden inputs, including the
// long names that slugkit 2.0's default truncation would change.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
const scratch = mkdtempSync(join(tmpdir(), "upgrade-oracle-"));
const seedCopy = join(scratch, "seed");
cpSync(seed, seedCopy, { recursive: true });

function npmCi(cwd) {
  rmSync(join(cwd, "node_modules"), { recursive: true, force: true });
  const run = spawnSync("npm", ["ci", "--ignore-scripts", "--offline", "--no-audit", "--no-fund"],
    { cwd, encoding: "utf8", timeout: 120000, env: { ...process.env, npm_config_update_notifier: "false" } });
  return run.status === 0;
}
function runCase(id, fn) {
  try { results[id] = fn() === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const outcome = (fn) => { try { return { value: fn() }; } catch (error) { return { error: error.constructor.name }; } };

const installed = npmCi(work);
const seedInstalled = npmCi(seedCopy);
const req = createRequire(join(work, "package.json"));
let invoice = null; let seedInvoice = null;
try { invoice = req(join(work, "src/invoice.js")); } catch { invoice = null; }
try { seedInvoice = createRequire(join(seedCopy, "package.json"))(join(seedCopy, "src/invoice.js")); } catch { seedInvoice = null; }

runCase("CASE_CLEAN_INSTALL", () => installed && seedInstalled);
runCase("CASE_MANIFEST_UPGRADED", () => {
  const manifest = readJson(join(work, "package.json"));
  return manifest.dependencies?.slugkit === "file:vendor/slugkit-2.0.0";
});
runCase("CASE_LOCKFILE_UPGRADED", () => {
  const lock = readJson(join(work, "package-lock.json"));
  const packages = lock.packages || {};
  return lock.lockfileVersion === 3 &&
    packages[""]?.dependencies?.slugkit === "file:vendor/slugkit-2.0.0" &&
    packages["node_modules/slugkit"]?.resolved === "vendor/slugkit-2.0.0" &&
    packages["vendor/slugkit-2.0.0"]?.version === "2.0.0" &&
    !Object.hasOwn(packages, "vendor/slugkit-1.0.0");
});
runCase("CASE_RESOLVES_V2", () => {
  if (req("slugkit/package.json").version !== "2.0.0") return false;
  const sources = readdirSync(join(work, "src"), { recursive: true })
    .filter((name) => /\.(c|m)?js$/.test(name))
    .map((name) => readFileSync(join(work, "src", name), "utf8"));
  return sources.every((text) => !/slugkit-1|vendor\//.test(text));
});
runCase("CASE_VENDOR_UNTOUCHED", () => {
  const vendored = join("vendor", "slugkit-2.0.0");
  const names = readdirSync(join(seed, vendored)).sort();
  if (JSON.stringify(readdirSync(join(work, vendored)).sort()) !== JSON.stringify(names)) return false;
  if (!names.every((name) => readFileSync(join(work, vendored, name)).equals(readFileSync(join(seed, vendored, name)))))
    return false;
  const old = join(work, "vendor", "slugkit-1.0.0");
  return !existsSync(old) || readFileSync(join(old, "index.js")).equals(
    readFileSync(join(seed, "vendor", "slugkit-1.0.0", "index.js")));
});
const INPUTS = [
  { customer: "Café Müller GmbH", number: 42, title: "March Hosting" },
  { customer: "ACME", number: 7, title: "" },
  { customer: "ACME", number: 8 },
  { customer: "Østfold Kommune — Avdeling for Teknisk Drift og Vedlikehold av Bygg", number: 123456,
    title: "Quarterly maintenance retainer for municipal buildings, parks, and roads Q3 2026" },
  { customer: "a".repeat(64) + " b", number: 9, title: "x ".repeat(40) },
  { customer: "Shop", number: 10, title: "Ünïcödé — ½ price — 2×3 offer!!" },
  { customer: "!!!", number: 11, title: "bad customer" },
  { customer: "ACME", number: 0, title: "bad number" },
  { customer: "ACME", number: 12, title: "!!!" }
];
runCase("CASE_PATHS_UNCHANGED", () => INPUTS.every((input) =>
  JSON.stringify(outcome(() => invoice.invoicePath(input))) ===
  JSON.stringify(outcome(() => seedInvoice.invoicePath(input)))) &&
  seedInvoice.invoicePath(INPUTS[3]).length > 140);

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
