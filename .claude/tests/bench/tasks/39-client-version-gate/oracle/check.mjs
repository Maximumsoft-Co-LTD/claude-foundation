// Hidden behavioral oracle for 39-client-version-gate. Usage: node check.mjs <work-copy> <seed>
// Every case calls the real app; a served response must equal the seed's
// response byte for byte, so gating cannot alter supported clients.
import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
const load = (root) => {
  try { return createRequire(join(root, "package.json"))(join(root, "src/app.js")); } catch { return null; }
};
const mod = load(work);
const seedMod = load(seed);

const call = (app, path, version) => app.handle({ method: "GET", path,
  headers: version === undefined ? {} : { "x-client-version": version } });
const served = (app, path, version) =>
  isDeepStrictEqual(call(app, path, version), call(seedMod.createApp(), path, undefined));
function upgrade(app, path, version, min) {
  const res = call(app, path, version);
  return res.status === 426 && res.body?.error === "upgrade_required" && res.body.minVersion === min &&
    typeof res.body.message === "string" && /updat|upgrad/i.test(res.body.message);
}
const invalid = (app, path, version) => {
  const res = call(app, path, version);
  return res.status === 400 && res.body?.error === "invalid_client_version";
};
function runCase(id, fn) {
  try { results[id] = fn() === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}

runCase("CASE_SUPPORTED_VERSIONS_SERVED", () => {
  const app = mod.createApp();
  return ["2.4.0", "2.4.1", "2.10.0", "3.0.0", "3.12.7", "10.0.0"].every((version) =>
    served(app, "/api/feed", version) && served(app, "/api/profile", version));
});
runCase("CASE_OLD_VERSIONS_REJECTED", () => {
  const app = mod.createApp();
  return ["2.3.9", "2.3.10", "1.99.99", "0.0.1", "0.9.0"].every((version) =>
    upgrade(app, "/api/feed", version, "2.4.0") && upgrade(app, "/api/profile", version, "2.4.0"));
});
runCase("CASE_NUMERIC_COMPARISON", () => {
  const app = mod.createApp({ minClientVersion: "2.9.0" });
  return served(app, "/api/feed", "2.10.0") && served(app, "/api/feed", "2.9.0") &&
    upgrade(app, "/api/feed", "2.8.10", "2.9.0") && upgrade(app, "/api/feed", "1.10.0", "2.9.0");
});
runCase("CASE_CONFIGURED_MINIMUM", () => {
  const app = mod.createApp({ minClientVersion: "3.1.0" });
  return upgrade(app, "/api/feed", "3.0.9", "3.1.0") && served(app, "/api/feed", "3.1.0") && served(app, "/api/feed", "4.0.0") &&
    upgrade(app, "/api/feed", "2.4.0", "3.1.0");
});
runCase("CASE_INVALID_VERSION", () => {
  const app = mod.createApp();
  return ["3.1", "v3.1.0", "3.1.0-beta", "abc", "3.1.0.1", "3..1", "-1.0.0"].every((version) => invalid(app, "/api/feed", version));
});
runCase("CASE_NO_HEADER_SERVED", () => {
  const app = mod.createApp();
  return served(app, "/api/feed", undefined) && served(app, "/api/profile", undefined) &&
    call(app, "/nope", undefined).status === 404;
});
runCase("CASE_HEALTH_NOT_GATED", () => {
  const app = mod.createApp({ minClientVersion: "5.0.0" });
  return ["1.0.0", "garbage", undefined].every((version) => served(app, "/health", version));
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
