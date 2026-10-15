// Hidden behavioral oracle for 25-owner-only-delete. Usage: node check.mjs <work-copy> <seed>
// A solution that denies everyone or allows everyone must fail: every case pairs
// an allow path with a deny path and checks whether the note really is gone.
import { spawnSync } from "node:child_process";
import { cpSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const results = {};
let createServer = null;
try { ({ createServer } = createRequire(join(work, "package.json"))(join(work, "src/server.js"))); }
catch { createServer = null; }

async function withServer(fn) {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { user, body } = {}) => {
    const headers = { "content-type": "application/json" };
    if (user) headers["x-user"] = user;
    const res = await fetch(base + path, { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed };
  };
  try { return await fn(call); }
  finally { server.closeAllConnections?.(); await new Promise((done) => server.close(done)); }
}

async function runCase(id, fn) {
  try { results[id] = (await withServer(fn)) === true ? "pass" : "fail"; }
  catch { results[id] = "fail"; }
}

const create = async (call, user, title = "note") => {
  const res = await call("POST", "/notes", { user, body: { title } });
  if (res.status !== 201 || !res.body?.id) throw new Error("create failed");
  return res.body.id;
};
const present = async (call, id) => (await call("GET", `/notes/${id}`)).status === 200;
const gone = async (call, id) => (await call("GET", `/notes/${id}`)).status === 404;
const deleted = (status) => status === 204 || status === 200;

if (typeof createServer !== "function") {
  for (const id of ["CASE_OWNER_DELETE", "CASE_ADMIN_DELETE", "CASE_OTHER_USER_403",
    "CASE_ANONYMOUS_401", "CASE_MISSING_404", "CASE_EXISTING_ROUTES"]) results[id] = "fail";
} else {
  await runCase("CASE_OWNER_DELETE", async (call) => {
    const alice = await create(call, "alice");
    const bob = await create(call, "bob");
    return deleted((await call("DELETE", `/notes/${alice}`, { user: "alice" })).status) &&
      await gone(call, alice) &&
      deleted((await call("DELETE", `/notes/${bob}`, { user: "bob" })).status) &&
      await gone(call, bob);
  });
  await runCase("CASE_ADMIN_DELETE", async (call) => {
    const alice = await create(call, "alice");
    const bob = await create(call, "bob");
    const own = await create(call, "ada");
    return deleted((await call("DELETE", `/notes/${alice}`, { user: "ada" })).status) &&
      await gone(call, alice) &&
      deleted((await call("DELETE", `/notes/${bob}`, { user: "ada" })).status) &&
      await gone(call, bob) &&
      deleted((await call("DELETE", `/notes/${own}`, { user: "ada" })).status) &&
      await gone(call, own);
  });
  await runCase("CASE_OTHER_USER_403", async (call) => {
    const alice = await create(call, "alice");
    const admin = await create(call, "ada");
    const denied = (await call("DELETE", `/notes/${alice}`, { user: "bob" })).status === 403 &&
      await present(call, alice) &&
      (await call("DELETE", `/notes/${admin}`, { user: "alice" })).status === 403 &&
      await present(call, admin);
    // A refused attempt must not poison the owner's own delete.
    return denied && deleted((await call("DELETE", `/notes/${alice}`, { user: "alice" })).status) &&
      await gone(call, alice);
  });
  await runCase("CASE_ANONYMOUS_401", async (call) => {
    const alice = await create(call, "alice");
    return (await call("DELETE", `/notes/${alice}`)).status === 401 &&
      (await call("DELETE", `/notes/${alice}`, { user: "mallory" })).status === 401 &&
      await present(call, alice) &&
      (await call("GET", "/notes")).body?.length === 1;
  });
  await runCase("CASE_MISSING_404", async (call) =>
    (await call("DELETE", "/notes/999", { user: "alice" })).status === 404 &&
    (await call("DELETE", "/notes/999", { user: "ada" })).status === 404);
  await runCase("CASE_EXISTING_ROUTES", async (call) => {
    const created = await call("POST", "/notes", { user: "bob", body: { title: " Plan " } });
    const list = await call("GET", "/notes");
    return created.status === 201 && created.body.title === "Plan" && created.body.owner === "bob" &&
      (await call("GET", `/notes/${created.body.id}`)).body?.owner === "bob" &&
      Array.isArray(list.body) && list.body.length === 1 &&
      (await call("POST", "/notes", { body: { title: "x" } })).status === 401 &&
      (await call("POST", "/notes", { user: "alice", body: { title: " " } })).status === 400 &&
      (await call("GET", "/nope")).status === 404;
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

// The seed's own tests still pass against the delivered code.
try {
  cpSync(join(seed, "test"), join(work, "oracle-seed-tests"), { recursive: true });
  const replay = suite(readdirSync(join(seed, "test"))
    .filter((name) => name.endsWith(".test.js")).map((name) => `oracle-seed-tests/${name}`));
  rmSync(join(work, "oracle-seed-tests"), { recursive: true, force: true });
  results.CASE_SEED_TESTS_REPLAY = replay.ok && replay.pass >= 3 ? "pass" : "fail";
} catch { results.CASE_SEED_TESTS_REPLAY = "fail"; }

// The delivered suite passes and fails once src/ is put back to the seed.
let passes = "fail"; let detects = "fail";
try {
  const delivered = suite([]);
  if (delivered.ok && delivered.pass > 3) {
    passes = "pass";
    rmSync(join(work, "src"), { recursive: true, force: true });
    cpSync(join(seed, "src"), join(work, "src"), { recursive: true });
    if (!suite([]).ok) detects = "pass";
  }
} catch { passes = passes === "pass" ? passes : "fail"; }
results.CASE_TESTS_PASS = passes;
results.CASE_TESTS_DETECT_SEED = detects;

const ids = Object.keys(results);
const score = ids.filter((id) => results[id] === "pass").length;
process.stdout.write(`${JSON.stringify({ results, score, max: ids.length,
  verdict: score === ids.length ? "pass" : "fail" })}\n`);
process.exit(0);
