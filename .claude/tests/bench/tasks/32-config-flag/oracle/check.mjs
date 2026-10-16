// Hidden behavioral oracle for 32-config-flag. Usage: node check.mjs <work-copy> <seed>
// Every case loads the real config through hidden env/file combinations; the
// existing settings are compared with the seed loader so a new key cannot
// change their resolution or messages.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
const load = (root) => {
  try { return createRequire(join(root, "package.json"))(join(root, "src/config.js")); } catch { return null; }
};
const mod = load(work);
const seedMod = load(seed);
const scratch = mkdtempSync(join(tmpdir(), "config-oracle-"));

function configFile(value) {
  const file = join(mkdtempSync(join(scratch, "c-")), "gateway.json");
  writeFileSync(file, JSON.stringify(value));
  return file;
}
const timeout = (options) => mod.loadConfig(options).requestTimeoutMs;
function rejects(options, pattern) {
  try { mod.loadConfig(options); return false; }
  catch (error) { return error instanceof mod.ConfigError && pattern.test(error.message); }
}
function runCase(id, fn) {
  try { results[id] = fn() === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}

runCase("CASE_DEFAULT", () => timeout({ env: {} }) === 5000 &&
  timeout({ env: { REQUEST_TIMEOUT_MS: "" } }) === 5000 &&
  timeout({ env: {}, file: configFile({ port: 9000 }) }) === 5000);
runCase("CASE_ENV_OVERRIDE", () => timeout({ env: { REQUEST_TIMEOUT_MS: "2500" } }) === 2500 &&
  typeof timeout({ env: { REQUEST_TIMEOUT_MS: "2500" } }) === "number");
runCase("CASE_FILE_OVERRIDE", () => timeout({ env: {}, file: configFile({ requestTimeoutMs: 12000 }) }) === 12000);
runCase("CASE_ENV_BEATS_FILE", () => {
  const file = configFile({ requestTimeoutMs: 12000 });
  return timeout({ env: { REQUEST_TIMEOUT_MS: "750" }, file }) === 750 &&
    timeout({ env: { REQUEST_TIMEOUT_MS: "" }, file }) === 12000;
});
runCase("CASE_BOUNDS_ACCEPTED", () => timeout({ env: { REQUEST_TIMEOUT_MS: "100" } }) === 100 &&
  timeout({ env: { REQUEST_TIMEOUT_MS: "60000" } }) === 60000);
runCase("CASE_INVALID_REJECTED", () => {
  for (const raw of ["99", "60001", "abc", "1.5", "-200", "5s", "0"])
    if (!rejects({ env: { REQUEST_TIMEOUT_MS: raw } }, /requestTimeoutMs/)) return false;
  for (const raw of [99, 60001, 2.5, true, null, "fast"])
    if (!rejects({ env: {}, file: configFile({ requestTimeoutMs: raw }) }, /requestTimeoutMs/)) return false;
  return true;
});
runCase("CASE_ERROR_MESSAGE", () => {
  const file = configFile({ requestTimeoutMs: 99 });
  const message = (options) => { try { mod.loadConfig(options); return ""; } catch (error) { return error.message; } };
  const fromEnv = message({ env: { REQUEST_TIMEOUT_MS: "5s" } });
  const fromFile = message({ env: {}, file });
  return fromEnv.includes("requestTimeoutMs") && fromEnv.includes("REQUEST_TIMEOUT_MS") &&
    fromEnv.includes('"5s"') && /100/.test(fromEnv) && /60000/.test(fromEnv) &&
    fromFile.includes("requestTimeoutMs") && fromFile.includes(file) && fromFile.includes("99");
});
runCase("CASE_CLI", () => {
  const cli = (env, args = []) => spawnSync(process.execPath, [join(work, "bin/print-config.js"), ...args],
    { cwd: scratch, encoding: "utf8", timeout: 10000, env: { PATH: process.env.PATH, ...env } });
  const ok = cli({ REQUEST_TIMEOUT_MS: "3000" });
  const bad = cli({ REQUEST_TIMEOUT_MS: "nope" });
  return ok.status === 0 && JSON.parse(ok.stdout).requestTimeoutMs === 3000 &&
    bad.status === 1 && bad.stdout === "" && /requestTimeoutMs/.test(bad.stderr);
});
runCase("CASE_EXISTING_SETTINGS_UNCHANGED", () => {
  const strip = (config) => { const copy = { ...config }; delete copy.requestTimeoutMs; return copy; };
  const outcome = (m, options) => { try { return { value: strip(m.loadConfig(options)) }; } catch (error) { return { error: error.message }; } };
  const cases = [
    { env: {} }, { env: { PORT: "1", LOG_LEVEL: "debug", UPSTREAM_URL: "https://up.example:8443/x" } },
    { env: { PORT: "65536" } }, { env: { LOG_LEVEL: "trace" } }, { env: { UPSTREAM_URL: "ftp://x" } },
    { env: { PORT: "" }, file: configFile({ port: 3000, logLevel: "error" }) },
    { env: {}, file: configFile({ timeout: 10 }) }
  ];
  return cases.every((options) => isDeepStrictEqual(outcome(mod, options), outcome(seedMod, options))) &&
    Object.isFrozen(mod.loadConfig({ env: {} }));
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
