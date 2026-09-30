// Hidden behavioral oracle for 21-notes-api. Usage: node check.mjs <work-copy> <seed>
// Drives createServer({ dataFile }) over real HTTP, then proves the delivered
// suite passes, has at least five tests, and fails against the seed server.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const scratch = mkdtempSync(join(tmpdir(), "notes-oracle-"));
const results = {};

let createServer = null;
try {
  const mod = await import(`${pathToFileURL(join(work, "src/server.js"))}?oracle=${Date.now()}`);
  createServer = mod.createServer || mod.default?.createServer || null;
} catch { createServer = null; }

let fileCounter = 0;
const freshFile = () => join(scratch, `notes-${++fileCounter}.json`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function start(dataFile) {
  const server = createServer({ dataFile });
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, raw = false) => {
    const init = { method, headers: { connection: "close" } };
    if (body !== undefined) {
      init.body = raw ? body : JSON.stringify(body);
      init.headers["content-type"] = "application/json";
    }
    const response = await fetch(base + path, init);
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: response.status, type: response.headers.get("content-type") || "",
      text, json };
  };
  const stop = () => new Promise((done) => {
    server.closeAllConnections?.();
    server.close(() => done());
  });
  return { call, stop };
}

async function withServer(fn, dataFile = freshFile()) {
  const api = await start(dataFile);
  try { return await fn(api.call, dataFile); } finally { await api.stop(); }
}

async function runCase(id, fn) {
  if (typeof createServer !== "function") { results[id] = "fail"; return; }
  let timer;
  try {
    const ok = await Promise.race([
      fn(),
      new Promise((_, fail) => { timer = setTimeout(() => fail(new Error("timeout")), 8000); })
    ]);
    results[id] = ok === true ? "pass" : "fail";
  } catch { results[id] = "fail"; }
  finally { clearTimeout(timer); }
}

const isIso = (value) => typeof value === "string" &&
  !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
const errorBody = (res, status, field) => res.status === status &&
  typeof res.json?.error === "string" && (field === undefined || res.json.field === field);
const isJson = (res) => res.type.includes("application/json");

await runCase("CASE_CREATE", () => withServer(async (call) => {
  const health = await call("GET", "/health");
  const full = await call("POST", "/notes",
    { title: "  Hello  ", body: "b", tags: ["Work", " work ", "Home"], id: "forced" });
  const minimal = await call("POST", "/notes", { title: "x" });
  const n = full.json || {};
  return health.status === 200 && health.json?.ok === true &&
    full.status === 201 && isJson(full) && typeof n.id === "string" && n.id !== "forced" &&
    n.title === "Hello" && n.body === "b" &&
    JSON.stringify(n.tags) === JSON.stringify(["work", "home"]) &&
    isIso(n.createdAt) && n.updatedAt === n.createdAt &&
    minimal.status === 201 && minimal.json?.body === "" &&
    Array.isArray(minimal.json?.tags) && minimal.json.tags.length === 0 &&
    minimal.json.id !== n.id;
}));

await runCase("CASE_VALIDATION", () => withServer(async (call) => {
  const tags11 = Array.from({ length: 11 }, (_, i) => `t${i}`);
  const expect = [
    [{}, "title"], [{ title: "   " }, "title"], [{ title: 7 }, "title"],
    [{ title: "a".repeat(121) }, "title"], [{ title: "ok", body: 12 }, "body"],
    [{ title: "ok", body: "a".repeat(10001) }, "body"], [{ title: "ok", tags: "a" }, "tags"],
    [{ title: "ok", tags: tags11 }, "tags"], [{ title: "ok", tags: [""] }, "tags"],
    [{ title: "ok", tags: [1] }, "tags"]
  ];
  for (const [body, field] of expect)
    if (!errorBody(await call("POST", "/notes", body), 400, field)) return false;
  const edge = await call("POST", "/notes", {
    title: ` ${"a".repeat(120)} `, body: "a".repeat(10000),
    tags: [...Array.from({ length: 10 }, (_, i) => `T${i}`), "t0"]
  });
  const list = await call("GET", "/notes");
  return edge.status === 201 && edge.json?.title.length === 120 &&
    edge.json.tags.length === 10 && edge.json.tags[0] === "t0" && list.json?.total === 1;
}));

await runCase("CASE_GET_404", () => withServer(async (call) => {
  const created = await call("POST", "/notes", { title: "find me" });
  const found = await call("GET", `/notes/${created.json?.id}`);
  const missing = await call("GET", "/notes/does-not-exist");
  return found.status === 200 && JSON.stringify(found.json) === JSON.stringify(created.json) &&
    errorBody(missing, 404) && isJson(missing);
}));

await runCase("CASE_PATCH", () => withServer(async (call) => {
  const created = (await call("POST", "/notes",
    { title: "Old", body: "keep", tags: ["a"] })).json;
  await sleep(15);
  const patched = await call("PATCH", `/notes/${created.id}`, { title: "  New  " });
  const p = patched.json || {};
  const invalid = await call("PATCH", `/notes/${created.id}`, { title: "", body: "changed" });
  const after = (await call("GET", `/notes/${created.id}`)).json || {};
  const tagsPatch = await call("PATCH", `/notes/${created.id}`, { tags: ["X", "x"] });
  const missing = await call("PATCH", "/notes/does-not-exist", { title: "z" });
  return patched.status === 200 && p.title === "New" && p.body === "keep" &&
    JSON.stringify(p.tags) === '["a"]' && p.createdAt === created.createdAt &&
    isIso(p.updatedAt) && p.updatedAt > created.updatedAt &&
    errorBody(invalid, 400, "title") && after.title === "New" && after.body === "keep" &&
    tagsPatch.status === 200 && JSON.stringify(tagsPatch.json?.tags) === '["x"]' &&
    errorBody(missing, 404);
}));

await runCase("CASE_DELETE", () => withServer(async (call) => {
  const created = (await call("POST", "/notes", { title: "bye" })).json;
  const removed = await call("DELETE", `/notes/${created.id}`);
  const read = await call("GET", `/notes/${created.id}`);
  const again = await call("DELETE", `/notes/${created.id}`);
  const patch = await call("PATCH", `/notes/${created.id}`, { title: "zombie" });
  const list = await call("GET", "/notes");
  return removed.status === 204 && removed.text === "" && errorBody(read, 404) &&
    errorBody(again, 404) && errorBody(patch, 404) && list.json?.total === 0;
}));

await runCase("CASE_PAGINATION", () => withServer(async (call) => {
  for (let i = 1; i <= 25; i += 1) await call("POST", "/notes", { title: `n${i}` });
  const first = (await call("GET", "/notes")).json || {};
  const tail = (await call("GET", "/notes?limit=10&offset=20")).json || {};
  const past = (await call("GET", "/notes?offset=30")).json || {};
  const bad = [
    ["/notes?offset=-1", "offset"], ["/notes?offset=x", "offset"],
    ["/notes?limit=0", "limit"], ["/notes?limit=abc", "limit"], ["/notes?limit=2.5", "limit"]
  ];
  for (const [path, field] of bad)
    if (!errorBody(await call("GET", path), 400, field)) return false;
  return first.items?.length === 20 && first.total === 25 && first.limit === 20 &&
    first.offset === 0 && first.items[0].title === "n1" && first.items[19].title === "n20" &&
    tail.items?.map((n) => n.title).join() === "n21,n22,n23,n24,n25" &&
    tail.total === 25 && tail.limit === 10 && tail.offset === 20 &&
    past.items?.length === 0 && past.total === 25;
}));

await runCase("CASE_LIMIT_CAP", () => withServer(async (call) => {
  await call("POST", "/notes", { title: "one" });
  const max = await call("GET", "/notes?limit=100");
  const over = await call("GET", "/notes?limit=101");
  return max.status === 200 && max.json?.limit === 100 && max.json.items.length === 1 &&
    errorBody(over, 400, "limit");
}));

await runCase("CASE_SEARCH", () => withServer(async (call) => {
  await call("POST", "/notes", { title: "Groceries", body: "buy MILK" });
  await call("POST", "/notes", { title: "Meeting notes" });
  await call("POST", "/notes", { title: "Other", body: "milkshake recipe" });
  const milk = (await call("GET", "/notes?q=milk")).json || {};
  const meet = (await call("GET", "/notes?q=MEET")).json || {};
  const none = (await call("GET", "/notes?q=zzz")).json || {};
  const paged = (await call("GET", "/notes?q=milk&limit=1&offset=1")).json || {};
  return milk.total === 2 && milk.items?.map((n) => n.title).join() === "Groceries,Other" &&
    meet.total === 1 && meet.items[0].title === "Meeting notes" &&
    none.total === 0 && none.items?.length === 0 &&
    paged.total === 2 && paged.items?.length === 1 && paged.items[0].title === "Other";
}));

await runCase("CASE_TAG_FILTER", () => withServer(async (call) => {
  await call("POST", "/notes", { title: "a", tags: ["work"] });
  await call("POST", "/notes", { title: "b", tags: ["home"] });
  await call("POST", "/notes", { title: "c", body: "report", tags: ["Work", "urgent"] });
  const work = (await call("GET", "/notes?tag=WORK")).json || {};
  const both = (await call("GET", "/notes?tag=work&q=report")).json || {};
  const none = (await call("GET", "/notes?tag=wor")).json || {};
  return work.total === 2 && work.items?.map((n) => n.title).join() === "a,c" &&
    both.total === 1 && both.items[0].title === "c" && none.total === 0;
}));

await runCase("CASE_PERSISTENCE", async () => {
  const dataFile = freshFile();
  const ids = await withServer(async (call) => {
    const keep = (await call("POST", "/notes", { title: "keep", tags: ["x"] })).json;
    const drop = (await call("POST", "/notes", { title: "drop" })).json;
    await call("PATCH", `/notes/${keep.id}`, { title: "kept" });
    await call("DELETE", `/notes/${drop.id}`);
    return { keep: keep.id, drop: drop.id };
  }, dataFile);
  if (!existsSync(dataFile)) return false;
  JSON.parse(readFileSync(dataFile, "utf8"));
  return withServer(async (call) => {
    const list = (await call("GET", "/notes")).json || {};
    const kept = await call("GET", `/notes/${ids.keep}`);
    const dropped = await call("GET", `/notes/${ids.drop}`);
    const added = await call("POST", "/notes", { title: "later" });
    const after = (await call("GET", "/notes")).json || {};
    return list.total === 1 && kept.status === 200 && kept.json?.title === "kept" &&
      JSON.stringify(kept.json.tags) === '["x"]' && errorBody(dropped, 404) &&
      added.status === 201 && after.items?.map((n) => n.title).join() === "kept,later";
  }, dataFile);
});

await runCase("CASE_BAD_JSON", () => withServer(async (call) => {
  const created = (await call("POST", "/notes", { title: "t" })).json;
  const post = await call("POST", "/notes", "{bad", true);
  const array = await call("POST", "/notes", "[1]", true);
  const patch = await call("PATCH", `/notes/${created.id}`, "{\"title\":", true);
  const list = (await call("GET", "/notes")).json || {};
  return errorBody(post, 400) && isJson(post) && errorBody(array, 400) &&
    errorBody(patch, 400) && list.total === 1 && list.items[0].title === "t";
}));

await runCase("CASE_UNKNOWN_ROUTE", () => withServer(async (call) => {
  const route = await call("GET", "/nope");
  const nested = await call("GET", "/notes/a/b");
  return errorBody(route, 404) && isJson(route) && errorBody(nested, 404);
}));

// Delivered suite: passes, has >= 5 tests, and fails once src/ is the seed's.
function suite() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  // Force exit so a failing test that leaks a listening server cannot hang.
  const run = spawnSync(process.execPath, [
    "--test", "--test-force-exit", "--test-timeout=20000", "--test-reporter=tap"
  ], {
    cwd: work, encoding: "utf8", timeout: 45000, env, maxBuffer: 10 * 1024 * 1024
  });
  const pass = Number((String(run.stdout).match(/^# pass (\d+)/m) || [])[1] || 0);
  return { ok: run.status === 0, pass };
}
let testsExist = "fail";
try {
  const delivered = suite();
  if (delivered.ok && delivered.pass >= 5) {
    rmSync(join(work, "src"), { recursive: true, force: true });
    cpSync(join(seed, "src"), join(work, "src"), { recursive: true });
    if (!suite().ok) testsExist = "pass";
  }
} catch { testsExist = "fail"; }
results.CASE_TESTS_EXIST = testsExist;

rmSync(scratch, { recursive: true, force: true });
const ids = Object.keys(results);
const score = ids.filter((id) => results[id] === "pass").length;
process.stdout.write(`${JSON.stringify({ results, score, max: ids.length,
  verdict: score === ids.length ? "pass" : "fail" })}\n`);
process.exit(0);
