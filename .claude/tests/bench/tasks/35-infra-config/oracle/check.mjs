// Hidden behavioral oracle for 35-infra-config. Usage: node check.mjs <work-copy> <seed>
// The pipeline diffs manifests between releases: after removing the two new
// container fields, every generated manifest must equal the seed's byte for byte.
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
  try { return createRequire(join(root, "package.json"))(join(root, "src/manifest.js")); } catch { return null; }
};
const mod = load(work);
const seedMod = load(seed);
const scratch = mkdtempSync(join(tmpdir(), "deploygen-oracle-"));

const DEFAULTS = { requests: { cpu: "100m", memory: "128Mi" }, limits: { cpu: "500m", memory: "256Mi" } };
const services = [
  { name: "orders-api", image: "registry.example/orders-api:1.8.2", port: 8080, replicas: 3, env: { LOG_LEVEL: "info" }, team: "commerce" },
  { name: "email-worker", image: "registry.example/email-worker:0.4.0", port: 9100 },
  { name: "search", image: "img/search@sha256:abc", port: 3000, env: { A: 1, B: "two" }, healthPath: "/ready" }
];
const container = (manifest) => manifest.spec.template.spec.containers[0];
const probeOk = (probe, path, port) => probe?.httpGet?.path === path && probe.httpGet.port === port &&
  probe.initialDelaySeconds === 5 && probe.periodSeconds === 10;
function strip(manifest) {
  const copy = structuredClone(manifest);
  for (const item of copy.spec.template.spec.containers) { delete item.readinessProbe; delete item.resources; }
  return copy;
}
function runCase(id, fn) {
  try { results[id] = fn() === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}

runCase("CASE_PROBE_DEFAULT_PATH", () => services.slice(0, 2).every((service) =>
  probeOk(container(mod.buildManifest(service)).readinessProbe, "/healthz", service.port)));
runCase("CASE_PROBE_CUSTOM_PATH", () =>
  probeOk(container(mod.buildManifest(services[2])).readinessProbe, "/ready", 3000) &&
  probeOk(container(mod.buildManifest({ ...services[1], healthPath: "/status/live" })).readinessProbe, "/status/live", 9100));
runCase("CASE_DEFAULT_RESOURCES", () => services.every((service) =>
  isDeepStrictEqual(container(mod.buildManifest(service)).resources, DEFAULTS)));
runCase("CASE_OVERRIDDEN_RESOURCES", () => {
  const full = { requests: { cpu: "250m", memory: "512Mi" }, limits: { cpu: "1", memory: "1Gi" } };
  const partial = { limits: { memory: "1Gi" } };
  return isDeepStrictEqual(container(mod.buildManifest({ ...services[0], resources: full })).resources, full) &&
    isDeepStrictEqual(container(mod.buildManifest({ ...services[0], resources: partial })).resources,
      { requests: DEFAULTS.requests, limits: { cpu: "500m", memory: "1Gi" } });
});
runCase("CASE_INVALID_HEALTH_PATH", () => {
  for (const healthPath of ["healthz", "", 42]) {
    try { mod.buildManifest({ ...services[0], healthPath }); return false; }
    catch (error) { if (!(error instanceof mod.ServiceError)) return false; }
  }
  return true;
});
runCase("CASE_OTHER_FIELDS_UNCHANGED", () => {
  for (const service of services) {
    const { healthPath, ...plain } = service;
    if (!isDeepStrictEqual(strip(mod.buildManifest(service)), seedMod.buildManifest(plain))) return false;
  }
  const keys = Object.keys(container(mod.buildManifest(services[0])));
  return isDeepStrictEqual(keys.filter((key) => !["readinessProbe", "resources"].includes(key)),
    Object.keys(container(seedMod.buildManifest(services[0]))));
});
runCase("CASE_CLI", () => {
  const file = join(scratch, "svc.json");
  writeFileSync(file, JSON.stringify(services[1]));
  const ok = spawnSync(process.execPath, [join(work, "bin/render.js"), file], { encoding: "utf8", timeout: 10000 });
  const bad = join(scratch, "bad.json");
  writeFileSync(bad, JSON.stringify({ ...services[1], healthPath: "nope" }));
  const failed = spawnSync(process.execPath, [join(work, "bin/render.js"), bad], { encoding: "utf8", timeout: 10000 });
  const manifest = JSON.parse(ok.stdout);
  return ok.status === 0 && probeOk(container(manifest).readinessProbe, "/healthz", 9100) &&
    isDeepStrictEqual(container(manifest).resources, DEFAULTS) && failed.status === 1 && failed.stdout === "";
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
