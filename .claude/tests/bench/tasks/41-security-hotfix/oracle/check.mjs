// Hidden behavioral oracle for 41-security-hotfix. Usage: node check.mjs <work-copy> <seed>
// A hidden root sits next to secret files, including a sibling directory whose
// name starts with the root's name; no request variant may return their bytes,
// and legitimate names containing dots must still be served.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
const mod = (() => { try { return createRequire(join(work, "package.json"))(join(work, "src/static.js")); } catch { return null; } })();
const scratch = mkdtempSync(join(tmpdir(), "static-oracle-"));

function put(path, text) {
  mkdirSync(join(scratch, path, ".."), { recursive: true });
  writeFileSync(join(scratch, path), text);
}
put("public/index.html", "<h1>home</h1>");
put("public/assets/app.js", "app();");
put("public/..notes.txt", "dot notes");
put("public/a b.txt", "spaced");
put("public/v1..2/readme.txt", "versioned");
put("secret.txt", "TOP-SECRET-1");
put("public-private/keys.txt", "TOP-SECRET-2");
put("public/assets/secret.txt", "inside asset");

const handle = mod.createStaticHandler(join(scratch, "public"));
async function refused(urlPath) {
  try {
    const res = await handle(urlPath);
    return [400, 403, 404].includes(res.status) && !String(res.body ?? "").includes("TOP-SECRET");
  } catch { return false; }
}
async function servesAll(pairs) {
  for (const [urlPath, text] of pairs) {
    const res = await handle(urlPath);
    if (res.status !== 200 || String(res.body) !== text) return false;
  }
  return true;
}
async function refusesAll(list) {
  for (const urlPath of list) if (!(await refused(urlPath))) return false;
  return true;
}
async function runCase(id, fn) {
  try { results[id] = (await fn()) === true ? "pass" : "fail"; } catch { results[id] = "fail"; }
}

await runCase("CASE_PLAIN_TRAVERSAL", () => refusesAll(["/../secret.txt", "/../../secret.txt", "/./../secret.txt"]));
await runCase("CASE_ENCODED_TRAVERSAL", () => refusesAll([
  "/%2e%2e/secret.txt", "/%2E%2E/secret.txt", "/..%2fsecret.txt", "/%2e%2e%2fsecret.txt", "/%2E%2E%2Fsecret.txt",
  "/.%2e/secret.txt", "/%2e./secret.txt", "/%252e%252e/secret.txt", "/..%5csecret.txt"]));
await runCase("CASE_NESTED_TRAVERSAL", () => refusesAll([
  "/assets/../../secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt",
  "/assets/./../.././secret.txt", "/v1..2/../../secret.txt", "/assets/../assets/../../secret.txt?x=1"]));
await runCase("CASE_SIBLING_PREFIX", () => refusesAll([
  "/../public-private/keys.txt", "/..%2fpublic-private%2fkeys.txt", "/assets/../../public-private/keys.txt"]));
await runCase("CASE_NORMAL_FILES_SERVED", async () => {
  const page = await handle("/index.html");
  return page.contentType === "text/html" && (await handle("/assets/app.js?v=2")).contentType === "text/javascript" &&
    servesAll([["/index.html", "<h1>home</h1>"], ["/assets/app.js?v=2", "app();"], ["/assets/secret.txt", "inside asset"]]);
});
await runCase("CASE_DOTTED_AND_ENCODED_NAMES_SERVED", () => servesAll([
  ["/..notes.txt", "dot notes"], ["/a%20b.txt", "spaced"], ["/v1..2/readme.txt", "versioned"], ["/%2e%2enotes.txt", "dot notes"]]));
await runCase("CASE_MISSING_STILL_404", async () =>
  (await handle("/nope.html")).status === 404 && (await handle("/assets")).status === 404 && (await handle("/")).status === 404);

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
