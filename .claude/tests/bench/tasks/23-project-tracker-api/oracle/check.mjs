// Hidden behavioral oracle for 23-project-tracker-api.
// Usage: node check.mjs <work-copy> <seed>
// Drives createServer({ dataFile, now }) over real HTTP with an injected clock,
// then proves the delivered suite passes, has at least fifteen tests, and fails
// against the seed server.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const scratch = mkdtempSync(join(tmpdir(), "tracker-oracle-"));
const results = {};
const T0 = Date.parse("2026-03-10T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

let createServer = null;
try {
  const mod = await import(`${pathToFileURL(join(work, "src/server.js"))}?oracle=${Date.now()}`);
  createServer = mod.createServer || mod.default?.createServer || null;
} catch { createServer = null; }

let fileCounter = 0;
const freshFile = () => join(scratch, `tracker-${++fileCounter}.json`);

async function start(dataFile, clock) {
  const server = createServer({ dataFile, now: () => new Date(clock.t) });
  await new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  // call(method, path, body?, token?, raw?) -> { status, type, text, json }
  const call = async (method, path, body, token, raw = false) => {
    const init = { method, headers: { connection: "close" } };
    if (token) init.headers.authorization = token.includes(" ") ? token : `Bearer ${token}`;
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

// fn(api) where api = { call, clock, dataFile, user, project, task, member }.
async function withServer(fn, dataFile = freshFile(), clock = { t: T0 }) {
  const server = await start(dataFile, clock);
  const call = server.call;
  let counter = 0;
  const api = {
    call, clock, dataFile,
    async user(name = "user", password = "password-123") {
      const address = `${name.toLowerCase()}-${++counter}@example.com`;
      const reg = await call("POST", "/users", { email: address, password, name });
      const login = await call("POST", "/sessions", { email: address, password });
      if (reg.status !== 201 || login.status !== 201 || typeof login.json?.token !== "string")
        throw new Error("cannot register/login");
      return { id: reg.json.id, token: login.json.token, email: address, password };
    },
    async project(owner, name = "Apollo") {
      const res = await call("POST", "/projects", { name }, owner.token);
      if (res.status !== 201) throw new Error("cannot create project");
      return res.json;
    },
    async member(project, owner, user, role) {
      const res = await call("POST", `/projects/${project.id}/members`,
        { userId: user.id, role }, owner.token);
      if (res.status !== 201) throw new Error("cannot add member");
    },
    async task(project, actor, body) {
      const res = await call("POST", `/projects/${project.id}/tasks`, body, actor.token);
      if (res.status !== 201) throw new Error(`cannot create task ${res.status}`);
      return res.json;
    }
  };
  try { return await fn(api); } finally { await server.stop(); }
}

async function runCase(id, fn) {
  if (typeof createServer !== "function") { results[id] = "fail"; return; }
  let timer;
  try {
    const ok = await Promise.race([
      fn(),
      new Promise((_, fail) => { timer = setTimeout(() => fail(new Error("timeout")), 15000); })
    ]);
    results[id] = ok === true ? "pass" : "fail";
  } catch { results[id] = "fail"; }
  finally { clearTimeout(timer); }
}

const isJson = (res) => res.type.includes("application/json");
const err = (res, status, field) => res.status === status && isJson(res) &&
  typeof res.json?.error === "string" && (field === undefined || res.json.field === field);
const iso = (t) => new Date(t).toISOString();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const titles = (res) => (res.json?.items || []).map((task) => task.title).join();
const SECRET = /pass|hash|salt/i;
const leaks = (value) => value && typeof value === "object" &&
  Object.entries(value).some(([key, inner]) => SECRET.test(key) || leaks(inner));

// ---------------------------------------------------------------- auth

await runCase("CASE_AUTH_REGISTER", () => withServer(async ({ call }) => {
  const health = await call("GET", "/health");
  const reg = await call("POST", "/users",
    { email: "  Ada@Example.COM ", password: "12345678", name: "  Ada  ", id: "forced" });
  const u = reg.json || {};
  const other = await call("POST", "/users",
    { email: "grace@example.com", password: "12345678", name: "Grace" });
  return health.status === 200 && health.json?.ok === true &&
    reg.status === 201 && isJson(reg) && typeof u.id === "string" && u.id !== "forced" &&
    u.email === "ada@example.com" && u.name === "Ada" && u.createdAt === iso(T0) &&
    !leaks(u) && other.status === 201 && other.json?.id !== u.id;
}));

await runCase("CASE_AUTH_REGISTER_VALIDATION", () => withServer(async ({ call }) => {
  const ok = { email: "a@example.com", password: "12345678", name: "A" };
  const expect = [
    [{ ...ok, email: undefined }, "email"], [{ ...ok, email: "nope" }, "email"],
    [{ ...ok, email: "a@b@example.com" }, "email"], [{ ...ok, email: "a b@example.com" }, "email"],
    [{ ...ok, email: "a@localhost" }, "email"], [{ ...ok, password: "1234567" }, "password"],
    [{ ...ok, password: 12345678 }, "password"], [{ ...ok, password: "x".repeat(129) }, "password"],
    [{ ...ok, name: "   " }, "name"], [{ ...ok, name: "n".repeat(101) }, "name"],
    [{ email: "a@example.com", password: "12345678" }, "name"]
  ];
  for (const [body, field] of expect)
    if (!err(await call("POST", "/users", body), 400, field)) return false;
  const first = await call("POST", "/users", ok);
  const dup = await call("POST", "/users", { ...ok, email: " A@EXAMPLE.com", name: "Other" });
  const login = await call("POST", "/sessions", { email: "a@example.com", password: "12345678" });
  return first.status === 201 && err(dup, 409, "email") && login.json?.user?.name === "A";
}));

await runCase("CASE_AUTH_LOGIN", () => withServer(async ({ call }) => {
  const reg = await call("POST", "/users",
    { email: "lin@example.com", password: "s3cret-pass", name: "Lin" });
  const a = await call("POST", "/sessions", { email: " LIN@example.com ", password: "s3cret-pass" });
  const b = await call("POST", "/sessions", { email: "lin@example.com", password: "s3cret-pass" });
  const wrong = await call("POST", "/sessions", { email: "lin@example.com", password: "s3cret-pasS" });
  const unknown = await call("POST", "/sessions", { email: "nobody@example.com", password: "s3cret-pass" });
  const token = a.json?.token;
  return a.status === 201 && typeof token === "string" && token.length >= 20 &&
    a.json.expiresAt === iso(T0 + DAY) && same(a.json.user, reg.json) && !leaks(a.json) &&
    b.status === 201 && b.json.token !== token &&
    !token.includes(reg.json.id) && !token.toLowerCase().includes("lin@example.com") &&
    !Buffer.from(token, "base64").toString("latin1").includes(reg.json.id) &&
    err(wrong, 401) && err(unknown, 401) && wrong.json.token === undefined;
}));

await runCase("CASE_AUTH_REQUIRED", () => withServer(async ({ call, user }) => {
  const u = await user("Ann");
  const me = await call("GET", "/users/me", undefined, u.token);
  const probes = [
    await call("GET", "/users/me"),
    await call("GET", "/users/me", undefined, "not-a-real-token"),
    await call("GET", "/users/me", undefined, `Basic ${u.token}`),
    await call("GET", "/projects"),
    await call("POST", "/projects", { name: "x" }),
    await call("DELETE", "/sessions")
  ];
  const list = await call("GET", "/projects", undefined, u.token);
  return me.status === 200 && me.json?.id === u.id && me.json.email === u.email &&
    !leaks(me.json) && probes.every((res) => err(res, 401)) &&
    list.status === 200 && same(list.json?.items, []);
}));

await runCase("CASE_AUTH_LOGOUT", () => withServer(async ({ call, user }) => {
  const u = await user("Bo");
  const second = (await call("POST", "/sessions", { email: u.email, password: u.password })).json;
  const out = await call("DELETE", "/sessions", undefined, u.token);
  const after = await call("GET", "/users/me", undefined, u.token);
  const again = await call("DELETE", "/sessions", undefined, u.token);
  const other = await call("GET", "/users/me", undefined, second.token);
  return out.status === 204 && out.text === "" && err(after, 401) && err(again, 401) &&
    other.status === 200 && other.json?.id === u.id;
}));

await runCase("CASE_AUTH_EXPIRY", () => withServer(async ({ call, user, clock }) => {
  const u = await user("Cy");
  clock.t = T0 + DAY - 1;
  const before = await call("GET", "/users/me", undefined, u.token);
  clock.t = T0 + DAY;
  const at = await call("GET", "/users/me", undefined, u.token);
  const fresh = await call("POST", "/sessions", { email: u.email, password: u.password });
  const renewed = await call("GET", "/users/me", undefined, fresh.json?.token);
  return before.status === 200 && err(at, 401) && fresh.json?.expiresAt === iso(T0 + 2 * DAY) &&
    renewed.status === 200;
}));

await runCase("CASE_AUTH_HASH_NOT_EXPOSED", () => withServer(async ({ call, user, dataFile }) => {
  const password = "Plaintext-Canary-42";
  const a = await user("Dee", password);
  const b = await user("Eve", password);
  const project = (await call("POST", "/projects", { name: "p" }, a.token)).json;
  await call("POST", `/projects/${project.id}/members`, { userId: b.id, role: "viewer" }, a.token);
  const members = await call("GET", `/projects/${project.id}/members`, undefined, b.token);
  const login = await call("POST", "/sessions", { email: a.email, password });
  const stored = readFileSync(dataFile, "utf8");
  const digests = ["md5", "sha1", "sha256", "sha512"].flatMap((algo) => {
    const d = createHash(algo).update(password).digest();
    return [d.toString("hex"), d.toString("base64")];
  });
  return !stored.includes(password) && !stored.includes(Buffer.from(password).toString("base64")) &&
    digests.every((d) => !stored.includes(d)) &&
    members.status === 200 && members.json?.items?.length === 2 && !leaks(members.json) &&
    login.status === 201 && !leaks(login.json);
}));

// ------------------------------------------------------------ projects

await runCase("CASE_PROJECT_CRUD", () => withServer(async (api) => {
  const { call, user, clock } = api;
  const a = await user("Owner");
  const b = await user("Other");
  const created = await call("POST", "/projects",
    { name: "  Apollo ", description: "moon", ownerId: b.id }, a.token);
  const p = created.json || {};
  await call("POST", "/projects", { name: "Hidden" }, b.token);
  const second = (await call("POST", "/projects", { name: "Zeus" }, a.token)).json;
  const got = await call("GET", `/projects/${p.id}`, undefined, a.token);
  clock.t = T0 + 5000;
  const patched = await call("PATCH", `/projects/${p.id}`, { name: "Artemis" }, a.token);
  const list = await call("GET", "/projects", undefined, a.token);
  const removed = await call("DELETE", `/projects/${second.id}`, undefined, a.token);
  const gone = await call("GET", `/projects/${second.id}`, undefined, a.token);
  const tasksGone = await call("GET", `/projects/${second.id}/tasks`, undefined, a.token);
  const after = await call("GET", "/projects", undefined, a.token);
  return created.status === 201 && p.name === "Apollo" && p.description === "moon" &&
    p.ownerId === a.id && p.createdAt === iso(T0) && p.updatedAt === iso(T0) &&
    got.status === 200 && same(got.json, p) &&
    patched.status === 200 && patched.json?.name === "Artemis" &&
    patched.json.description === "moon" && patched.json.createdAt === iso(T0) &&
    patched.json.updatedAt === iso(T0 + 5000) &&
    list.json?.items?.map((x) => x.name).join() === "Artemis,Zeus" &&
    removed.status === 204 && removed.text === "" && err(gone, 404) && err(tasksGone, 404) &&
    after.json?.items?.map((x) => x.name).join() === "Artemis";
}));

await runCase("CASE_PROJECT_VALIDATION", () => withServer(async ({ call, user }) => {
  const a = await user("Val");
  const expect = [
    [{}, "name"], [{ name: "  " }, "name"], [{ name: 5 }, "name"],
    [{ name: "n".repeat(101) }, "name"], [{ name: "ok", description: 1 }, "description"],
    [{ name: "ok", description: "d".repeat(2001) }, "description"]
  ];
  for (const [body, field] of expect)
    if (!err(await call("POST", "/projects", body, a.token), 400, field)) return false;
  const edge = await call("POST", "/projects", { name: "n".repeat(100) }, a.token);
  const bad = await call("PATCH", `/projects/${edge.json?.id}`, { name: "", description: "x" }, a.token);
  const still = await call("GET", `/projects/${edge.json?.id}`, undefined, a.token);
  return edge.status === 201 && edge.json.description === "" && err(bad, 400, "name") &&
    still.json?.description === "" && still.json.name.length === 100;
}));

await runCase("CASE_PROJECT_MEMBERS", () => withServer(async (api) => {
  const { call, user, project } = api;
  const owner = await user("Olive");
  const ed = await user("Ed");
  const vi = await user("Vi");
  const extra = await user("Xa");
  const p = await project(owner);
  const addEd = await call("POST", `/projects/${p.id}/members`, { userId: ed.id, role: "editor" }, owner.token);
  const addVi = await call("POST", `/projects/${p.id}/members`, { userId: vi.id, role: "viewer" }, owner.token);
  const dup = await call("POST", `/projects/${p.id}/members`, { userId: vi.id, role: "editor" }, owner.token);
  const ghost = await call("POST", `/projects/${p.id}/members`, { userId: "no-such-user", role: "viewer" }, owner.token);
  const badRole = await call("POST", `/projects/${p.id}/members`, { userId: extra.id, role: "owner" }, owner.token);
  const admin = await call("POST", `/projects/${p.id}/members`, { userId: extra.id, role: "admin" }, owner.token);
  const byEditor = await call("POST", `/projects/${p.id}/members`, { userId: extra.id, role: "viewer" }, ed.token);
  const list = await call("GET", `/projects/${p.id}/members`, undefined, vi.token);
  const visible = await call("GET", "/projects", undefined, vi.token);
  return addEd.status === 201 && same(addEd.json, { userId: ed.id, role: "editor" }) &&
    addVi.status === 201 && err(dup, 409, "userId") && err(ghost, 400, "userId") &&
    err(badRole, 400, "role") && err(admin, 400, "role") && err(byEditor, 403) &&
    list.status === 200 &&
    list.json?.items?.map((m) => `${m.userId}:${m.role}`).join() ===
      `${owner.id}:owner,${ed.id}:editor,${vi.id}:viewer` &&
    list.json.items[1].name === "Ed" && list.json.items[1].email === ed.email &&
    visible.json?.items?.length === 1 && visible.json.items[0].id === p.id;
}));

await runCase("CASE_MEMBER_REMOVAL", () => withServer(async (api) => {
  const { call, user, project, member, task } = api;
  const owner = await user("Olive");
  const ed = await user("Ed");
  const vi = await user("Vi");
  const p = await project(owner);
  await member(p, owner, ed, "editor");
  await member(p, owner, vi, "viewer");
  const t1 = await task(p, owner, { title: "a", assigneeId: vi.id });
  const t2 = await task(p, owner, { title: "b", assigneeId: ed.id });
  const byEditor = await call("DELETE", `/projects/${p.id}/members/${vi.id}`, undefined, ed.token);
  const ownerOut = await call("DELETE", `/projects/${p.id}/members/${owner.id}`, undefined, owner.token);
  const notMember = await call("DELETE", `/projects/${p.id}/members/nobody`, undefined, owner.token);
  const removed = await call("DELETE", `/projects/${p.id}/members/${vi.id}`, undefined, owner.token);
  const lost = await call("GET", `/projects/${p.id}`, undefined, vi.token);
  const a = (await call("GET", `/projects/${p.id}/tasks/${t1.id}`, undefined, owner.token)).json;
  const b = (await call("GET", `/projects/${p.id}/tasks/${t2.id}`, undefined, owner.token)).json;
  const reassign = await call("PATCH", `/projects/${p.id}/tasks/${t2.id}`, { assigneeId: vi.id }, owner.token);
  return err(byEditor, 403) && err(ownerOut, 400, "userId") && err(notMember, 404) &&
    removed.status === 204 && err(lost, 404) && a?.assigneeId === null &&
    b?.assigneeId === ed.id && err(reassign, 400, "assigneeId");
}));

await runCase("CASE_PERMISSION_VIEWER", () => withServer(async (api) => {
  const { call, user, project, member, task } = api;
  const owner = await user("Olive");
  const vi = await user("Vi");
  const other = await user("Oz");
  const p = await project(owner);
  await member(p, owner, vi, "viewer");
  const t = await task(p, owner, { title: "read me" });
  const base = `/projects/${p.id}`;
  const reads = [
    await call("GET", base, undefined, vi.token),
    await call("GET", `${base}/members`, undefined, vi.token),
    await call("GET", `${base}/tasks`, undefined, vi.token),
    await call("GET", `${base}/tasks/${t.id}`, undefined, vi.token),
    await call("GET", `${base}/activity`, undefined, vi.token)
  ];
  const writes = [
    await call("PATCH", base, { name: "hijack" }, vi.token),
    await call("DELETE", base, undefined, vi.token),
    await call("POST", `${base}/tasks`, { title: "nope" }, vi.token),
    await call("PATCH", `${base}/tasks/${t.id}`, { title: "nope" }, vi.token),
    await call("PATCH", `${base}/tasks/${t.id}`, { status: "doing" }, vi.token),
    await call("DELETE", `${base}/tasks/${t.id}`, undefined, vi.token),
    await call("POST", `${base}/members`, { userId: other.id, role: "viewer" }, vi.token)
  ];
  const after = await call("GET", `${base}/tasks/${t.id}`, undefined, owner.token);
  const list = await call("GET", `${base}/tasks`, undefined, owner.token);
  return reads.every((res) => res.status === 200) && writes.every((res) => err(res, 403)) &&
    after.json?.title === "read me" && after.json.status === "todo" && list.json?.total === 1;
}));

await runCase("CASE_PERMISSION_EDITOR", () => withServer(async (api) => {
  const { call, user, project, member } = api;
  const owner = await user("Olive");
  const ed = await user("Ed");
  const other = await user("Oz");
  const p = await project(owner);
  await member(p, owner, ed, "editor");
  const base = `/projects/${p.id}`;
  const created = await call("POST", `${base}/tasks`, { title: "by editor" }, ed.token);
  const patched = await call("PATCH", `${base}/tasks/${created.json?.id}`, { priority: 5 }, ed.token);
  const project2 = await call("PATCH", base, { description: "edited" }, ed.token);
  const delProject = await call("DELETE", base, undefined, ed.token);
  const addMember = await call("POST", `${base}/members`, { userId: other.id, role: "viewer" }, ed.token);
  const deleted = await call("DELETE", `${base}/tasks/${created.json?.id}`, undefined, ed.token);
  const still = await call("GET", base, undefined, owner.token);
  return created.status === 201 && created.json.createdBy === ed.id &&
    patched.status === 200 && patched.json?.priority === 5 &&
    project2.status === 200 && project2.json?.description === "edited" &&
    err(delProject, 403) && err(addMember, 403) && deleted.status === 204 &&
    still.status === 200;
}));

await runCase("CASE_NON_MEMBER_404", () => withServer(async (api) => {
  const { call, user, project, task } = api;
  const owner = await user("Olive");
  const out = await user("Mallory");
  const p = await project(owner);
  const t = await task(p, owner, { title: "secret" });
  const probe = async (id, taskId) => [
    await call("GET", `/projects/${id}`, undefined, out.token),
    await call("PATCH", `/projects/${id}`, { name: "x" }, out.token),
    await call("DELETE", `/projects/${id}`, undefined, out.token),
    await call("GET", `/projects/${id}/members`, undefined, out.token),
    await call("POST", `/projects/${id}/members`, { userId: out.id, role: "editor" }, out.token),
    await call("GET", `/projects/${id}/tasks`, undefined, out.token),
    await call("POST", `/projects/${id}/tasks`, { title: "x" }, out.token),
    await call("GET", `/projects/${id}/tasks/${taskId}`, undefined, out.token),
    await call("PATCH", `/projects/${id}/tasks/${taskId}`, { title: "x" }, out.token),
    await call("GET", `/projects/${id}/activity`, undefined, out.token)
  ];
  const real = await probe(p.id, t.id);
  const fake = await probe("no-such-project", "no-such-task");
  const own = await call("GET", "/projects", undefined, out.token);
  const intact = await call("GET", `/projects/${p.id}/tasks/${t.id}`, undefined, owner.token);
  const members = await call("GET", `/projects/${p.id}/members`, undefined, owner.token);
  return real.every((res, i) => err(res, 404) && res.status === fake[i].status &&
      res.text === fake[i].text) &&
    same(own.json?.items, []) && intact.json?.title === "secret" &&
    members.json?.items?.length === 1;
}));

// --------------------------------------------------------------- tasks

await runCase("CASE_TASK_CREATE", () => withServer(async (api) => {
  const { call, user, project, member } = api;
  const owner = await user("Olive");
  const ed = await user("Ed");
  const p = await project(owner);
  await member(p, owner, ed, "editor");
  const full = await call("POST", `/projects/${p.id}/tasks`, {
    title: "  Ship it  ", description: "all of it", priority: 1, assigneeId: ed.id,
    dueDate: "2026-03-20", labels: [" Backend", "backend", "API"], id: "forced",
    createdBy: "someone", projectId: "elsewhere"
  }, owner.token);
  const minimal = await call("POST", `/projects/${p.id}/tasks`, { title: "x", status: "todo" }, ed.token);
  const t = full.json || {};
  const m = minimal.json || {};
  return full.status === 201 && isJson(full) && typeof t.id === "string" && t.id !== "forced" &&
    t.projectId === p.id && t.title === "Ship it" && t.description === "all of it" &&
    t.status === "todo" && t.priority === 1 && t.assigneeId === ed.id &&
    t.dueDate === "2026-03-20" && same(t.labels, ["backend", "api"]) &&
    t.createdBy === owner.id && t.createdAt === iso(T0) && t.updatedAt === iso(T0) &&
    minimal.status === 201 && m.description === "" && m.status === "todo" && m.priority === 3 &&
    m.assigneeId === null && m.dueDate === null && same(m.labels, []) && m.createdBy === ed.id &&
    m.id !== t.id;
}));

await runCase("CASE_TASK_VALIDATION", () => withServer(async (api) => {
  const { call, user, project } = api;
  const owner = await user("Olive");
  const stranger = await user("Stan");
  const p = await project(owner);
  const path = `/projects/${p.id}/tasks`;
  const expect = [
    [{}, "title"], [{ title: "   " }, "title"], [{ title: 9 }, "title"],
    [{ title: "t".repeat(201) }, "title"], [{ title: "ok", description: 5 }, "description"],
    [{ title: "ok", description: "d".repeat(5001) }, "description"],
    [{ title: "ok", status: "doing" }, "status"], [{ title: "ok", status: "later" }, "status"],
    [{ title: "ok", priority: 0 }, "priority"], [{ title: "ok", priority: 6 }, "priority"],
    [{ title: "ok", priority: 2.5 }, "priority"], [{ title: "ok", priority: "3" }, "priority"],
    [{ title: "ok", assigneeId: stranger.id }, "assigneeId"],
    [{ title: "ok", assigneeId: 7 }, "assigneeId"],
    [{ title: "ok", dueDate: "2026-02-30" }, "dueDate"], [{ title: "ok", dueDate: "2026-3-01" }, "dueDate"],
    [{ title: "ok", dueDate: "tomorrow" }, "dueDate"], [{ title: "ok", dueDate: "2026-03-01T00:00:00Z" }, "dueDate"],
    [{ title: "ok", labels: "x" }, "labels"], [{ title: "ok", labels: [""] }, "labels"],
    [{ title: "ok", labels: [3] }, "labels"], [{ title: "ok", labels: ["l".repeat(31)] }, "labels"],
    [{ title: "ok", labels: ["a", "b", "c", "d", "e", "f"] }, "labels"],
    [{ title: "", priority: 9 }, "title"], [{ title: "ok", priority: 9, dueDate: "x" }, "priority"]
  ];
  for (const [body, field] of expect)
    if (!err(await call("POST", path, body, owner.token), 400, field)) return false;
  const edge = await call("POST", path, {
    title: ` ${"t".repeat(200)} `, description: "d".repeat(5000), priority: 5,
    dueDate: "2028-02-29", labels: ["A", "b", "c", "d", "e", "a"], assigneeId: null
  }, owner.token);
  const list = await call("GET", path, undefined, owner.token);
  return edge.status === 201 && edge.json.title.length === 200 && edge.json.labels.length === 5 &&
    edge.json.dueDate === "2028-02-29" && list.json?.total === 1;
}));

await runCase("CASE_TASK_UPDATE", () => withServer(async (api) => {
  const { call, user, project, member, task, clock } = api;
  const owner = await user("Olive");
  const ed = await user("Ed");
  const p = await project(owner);
  const q = await project(owner, "Other");
  await member(p, owner, ed, "editor");
  const t = await task(p, owner, { title: "Old", description: "keep", labels: ["a"], priority: 2 });
  clock.t = T0 + 60000;
  const patched = await call("PATCH", `/projects/${p.id}/tasks/${t.id}`,
    { title: "  New ", assigneeId: ed.id, dueDate: "2026-04-01", createdAt: "1999-01-01T00:00:00.000Z" },
    owner.token);
  const u = patched.json || {};
  clock.t = T0 + 120000;
  const invalid = await call("PATCH", `/projects/${p.id}/tasks/${t.id}`,
    { description: "changed", labels: ["1", "2", "3", "4", "5", "6"] }, owner.token);
  const after = (await call("GET", `/projects/${p.id}/tasks/${t.id}`, undefined, owner.token)).json || {};
  const clear = await call("PATCH", `/projects/${p.id}/tasks/${t.id}`,
    { assigneeId: null, dueDate: null }, owner.token);
  const wrongProject = await call("GET", `/projects/${q.id}/tasks/${t.id}`, undefined, owner.token);
  const wrongPatch = await call("PATCH", `/projects/${q.id}/tasks/${t.id}`, { title: "x" }, owner.token);
  const missing = await call("PATCH", `/projects/${p.id}/tasks/nope`, { title: "x" }, owner.token);
  const removed = await call("DELETE", `/projects/${p.id}/tasks/${t.id}`, undefined, owner.token);
  const gone = await call("GET", `/projects/${p.id}/tasks/${t.id}`, undefined, owner.token);
  const again = await call("DELETE", `/projects/${p.id}/tasks/${t.id}`, undefined, owner.token);
  return patched.status === 200 && u.title === "New" && u.description === "keep" &&
    same(u.labels, ["a"]) && u.priority === 2 && u.assigneeId === ed.id &&
    u.dueDate === "2026-04-01" && u.createdAt === iso(T0) && u.updatedAt === iso(T0 + 60000) &&
    err(invalid, 400, "labels") && after.description === "keep" &&
    after.updatedAt === iso(T0 + 60000) &&
    clear.status === 200 && clear.json?.assigneeId === null && clear.json.dueDate === null &&
    clear.json.updatedAt === iso(T0 + 120000) &&
    err(wrongProject, 404) && err(wrongPatch, 404) && err(missing, 404) &&
    removed.status === 204 && removed.text === "" && err(gone, 404) && err(again, 404);
}));

await runCase("CASE_STATUS_TRANSITIONS", () => withServer(async (api) => {
  const { call, user, project, member, task } = api;
  const owner = await user("Olive");
  const ed = await user("Ed");
  const p = await project(owner);
  await member(p, owner, ed, "editor");
  const t = await task(p, owner, { title: "flow" });
  const path = `/projects/${p.id}/tasks/${t.id}`;
  const steps = [
    [{ status: "done" }, 409], [{ status: "blocked" }, 400], [{ status: "todo" }, 200],
    [{ status: "doing" }, 200], [{ status: "todo" }, 409], [{ status: "doing" }, 200],
    [{ status: "done" }, 200], [{ status: "doing" }, 409], [{ status: "todo" }, 200],
    [{ status: "doing" }, 200], [{ status: "done" }, 200]
  ];
  for (const [body, status] of steps) {
    const res = await call("PATCH", path, body, ed.token);
    if (res.status !== status) return false;
    if (status === 409 && !err(res, 409, "status")) return false;
    if (status === 400 && !err(res, 400, "status")) return false;
  }
  const bad = await call("PATCH", path, { title: "renamed", status: "doing" }, owner.token);
  const final = (await call("GET", path, undefined, owner.token)).json || {};
  const reopen = await call("PATCH", path, { status: "todo" }, owner.token);
  return err(bad, 409, "status") && final.status === "done" && final.title === "flow" &&
    reopen.status === 200 && reopen.json?.status === "todo";
}));

await runCase("CASE_ASSIGNEE_VIEWER_STATUS", () => withServer(async (api) => {
  const { call, user, project, member, task } = api;
  const owner = await user("Olive");
  const vi = await user("Vi");
  const vi2 = await user("Vo");
  const p = await project(owner);
  await member(p, owner, vi, "viewer");
  await member(p, owner, vi2, "viewer");
  const mine = await task(p, owner, { title: "mine", assigneeId: vi.id });
  const path = `/projects/${p.id}/tasks/${mine.id}`;
  const otherViewer = await call("PATCH", path, { status: "doing" }, vi2.token);
  const rename = await call("PATCH", path, { title: "x" }, vi.token);
  const mixed = await call("PATCH", path, { status: "doing", priority: 1 }, vi.token);
  const skip = await call("PATCH", path, { status: "done" }, vi.token);
  const doing = await call("PATCH", path, { status: "doing" }, vi.token);
  const done = await call("PATCH", path, { status: "done" }, vi.token);
  const reopen = await call("PATCH", path, { status: "todo" }, vi.token);
  const final = (await call("GET", path, undefined, vi.token)).json || {};
  const ownerReopen = await call("PATCH", path, { status: "todo" }, owner.token);
  return err(otherViewer, 403) && err(rename, 403) && err(mixed, 403) && err(skip, 409, "status") &&
    doing.status === 200 && doing.json?.status === "doing" &&
    done.status === 200 && done.json?.status === "done" && err(reopen, 403) &&
    final.status === "done" && final.priority === 3 && final.title === "mine" &&
    ownerReopen.status === 200;
}));

// --------------------------------------------------------------- lists

async function listFixture(api) {
  const { user, project, member, task } = api;
  const owner = await user("Olive");
  const ed = await user("Ed");
  const p = await project(owner);
  await member(p, owner, ed, "editor");
  const rows = [
    { title: "A", priority: 3, dueDate: "2026-03-12", labels: ["Backend"], assigneeId: ed.id },
    { title: "B", priority: 1, dueDate: null, labels: ["frontend"] },
    { title: "C", priority: 5, dueDate: "2026-03-01", labels: ["backend", "bug"], assigneeId: owner.id },
    { title: "D", priority: 1, dueDate: "2026-03-09", labels: [], assigneeId: ed.id },
    { title: "E", priority: 3, dueDate: "2026-03-10", labels: ["bug"] },
    { title: "F", priority: 5, dueDate: "2026-03-01", labels: ["backend"], assigneeId: ed.id }
  ];
  const tasks = {};
  for (const row of rows) tasks[row.title] = await task(p, owner, row);
  const move = (title, status) => api.call("PATCH", `/projects/${p.id}/tasks/${tasks[title].id}`,
    { status }, owner.token);
  await move("C", "doing");
  await move("D", "doing");
  await move("D", "done");
  await move("F", "doing");
  const get = (query) => api.call("GET", `/projects/${p.id}/tasks${query}`, undefined, owner.token);
  return { owner, ed, p, tasks, get };
}

await runCase("CASE_FILTER_STATUS", () => withServer(async (api) => {
  const { get } = await listFixture(api);
  const todo = await get("?status=todo");
  const doing = await get("?status=doing");
  const done = await get("?status=done");
  const bad = await get("?status=blocked");
  return titles(todo) === "A,B,E" && todo.json.total === 3 && titles(doing) === "C,F" &&
    titles(done) === "D" && err(bad, 400, "status");
}));

await runCase("CASE_FILTER_ASSIGNEE", () => withServer(async (api) => {
  const { get, ed, owner } = await listFixture(api);
  const edTasks = await get(`?assigneeId=${ed.id}`);
  const ownerTasks = await get(`?assigneeId=${owner.id}`);
  const none = await get("?assigneeId=nobody");
  return titles(edTasks) === "A,D,F" && edTasks.json.total === 3 && titles(ownerTasks) === "C" &&
    none.json?.total === 0 && same(none.json.items, []);
}));

await runCase("CASE_FILTER_LABEL", () => withServer(async (api) => {
  const { get } = await listFixture(api);
  const backend = await get("?label=BACKEND");
  const bug = await get("?label=%20bug%20");
  const partial = await get("?label=back");
  return titles(backend) === "A,C,F" && titles(bug) === "C,E" && partial.json?.total === 0;
}));

await runCase("CASE_FILTER_OVERDUE", () => withServer(async (api) => {
  const { get, clock } = { ...(await listFixture(api)), clock: api.clock };
  // Today is 2026-03-10 (UTC). D is done; E is due today; B has no due date.
  const late = await get("?overdue=true");
  const onTime = await get("?overdue=false");
  const bad = await get("?overdue=yes");
  // Next UTC day (still inside the 24h session): E becomes overdue.
  clock.t = Date.parse("2026-03-11T11:59:59.999Z");
  const later = await get("?overdue=true");
  clock.t = Date.parse("2026-03-10T23:59:59.999Z");
  const sameDay = await get("?overdue=true");
  return titles(late) === "C,F" && late.json.total === 2 && titles(onTime) === "A,B,D,E" &&
    err(bad, 400, "overdue") && titles(later) === "C,E,F" && titles(sameDay) === "C,F";
}));

await runCase("CASE_FILTER_COMBINED", () => withServer(async (api) => {
  const { get, ed } = await listFixture(api);
  const a = await get(`?label=backend&assigneeId=${ed.id}`);
  const b = await get("?label=backend&status=doing&overdue=true");
  const c = await get(`?assigneeId=${ed.id}&status=todo&label=backend&overdue=false`);
  const d = await get("?label=bug&status=done");
  return titles(a) === "A,F" && titles(b) === "C,F" && titles(c) === "A" && d.json?.total === 0;
}));

await runCase("CASE_SORT", () => withServer(async (api) => {
  const { get } = await listFixture(api);
  const checks = [
    ["", "A,B,C,D,E,F"], ["?sort=createdAt&order=desc", "F,E,D,C,B,A"],
    ["?sort=priority", "B,D,A,E,C,F"], ["?sort=priority&order=desc", "C,F,A,E,B,D"],
    ["?sort=dueDate", "C,F,D,E,A,B"], ["?sort=dueDate&order=desc", "A,E,D,C,F,B"],
    ["?sort=priority&order=asc&status=todo", "B,A,E"]
  ];
  for (const [query, expected] of checks) if (titles(await get(query)) !== expected) return false;
  return err(await get("?sort=title"), 400, "sort") && err(await get("?order=up"), 400, "order");
}));

await runCase("CASE_PAGINATION", () => withServer(async (api) => {
  const { call, user, project, task } = api;
  const owner = await user("Olive");
  const p = await project(owner);
  for (let i = 1; i <= 25; i += 1)
    await task(p, owner, { title: `t${i}`, labels: i % 2 ? ["odd"] : [] });
  const get = (query) => call("GET", `/projects/${p.id}/tasks${query}`, undefined, owner.token);
  const first = (await get("")).json || {};
  const tail = (await get("?limit=10&offset=20")).json || {};
  const past = (await get("?offset=40")).json || {};
  const odd = (await get("?label=odd&limit=5&offset=10")).json || {};
  const desc = (await get("?sort=createdAt&order=desc&limit=3&offset=1")).json || {};
  return first.items?.length === 20 && first.total === 25 && first.limit === 20 &&
    first.offset === 0 && first.items[0].title === "t1" && first.items[19].title === "t20" &&
    tail.items?.map((t) => t.title).join() === "t21,t22,t23,t24,t25" &&
    tail.total === 25 && tail.limit === 10 && tail.offset === 20 &&
    past.items?.length === 0 && past.total === 25 &&
    odd.total === 13 && odd.items?.map((t) => t.title).join() === "t21,t23,t25" &&
    desc.items?.map((t) => t.title).join() === "t24,t23,t22";
}));

await runCase("CASE_LIMIT_CAP", () => withServer(async (api) => {
  const { call, user, project, task } = api;
  const owner = await user("Olive");
  const p = await project(owner);
  await task(p, owner, { title: "one" });
  const get = (query) => call("GET", `/projects/${p.id}/tasks${query}`, undefined, owner.token);
  const max = await get("?limit=100");
  const min = await get("?limit=1");
  const bad = [
    ["?limit=101", "limit"], ["?limit=0", "limit"], ["?limit=abc", "limit"],
    ["?limit=2.5", "limit"], ["?limit=-1", "limit"], ["?offset=-1", "offset"],
    ["?offset=x", "offset"], ["?offset=1.5", "offset"]
  ];
  for (const [query, field] of bad) if (!err(await get(query), 400, field)) return false;
  return max.status === 200 && max.json?.limit === 100 && max.json.items.length === 1 &&
    min.json?.limit === 1 && min.json.total === 1;
}));

// ------------------------------------------------------------ activity

await runCase("CASE_ACTIVITY_LOG", () => withServer(async (api) => {
  const { call, user, clock } = api;
  const owner = await user("Olive");
  const ed = await user("Ed");
  const p = (await call("POST", "/projects", { name: "Log" }, owner.token)).json;
  clock.t = T0 + 1000;
  await call("POST", `/projects/${p.id}/members`, { userId: ed.id, role: "editor" }, owner.token);
  clock.t = T0 + 2000;
  const t = (await call("POST", `/projects/${p.id}/tasks`, { title: "x" }, ed.token)).json;
  const path = `/projects/${p.id}/tasks/${t.id}`;
  await call("PATCH", path, { priority: 1, title: "y" }, ed.token);
  await call("PATCH", path, { status: "doing", labels: ["z"] }, ed.token);
  await call("PATCH", path, { status: "doing" }, ed.token);
  await call("PATCH", path, { status: "done" }, owner.token);
  await call("PATCH", path, { status: "todo" }, ed.token); // editor reopen: logged
  await call("PATCH", path, { status: "done" }, ed.token); // todo -> done: 409, not logged
  await call("PATCH", `/projects/${p.id}`, { description: "d" }, owner.token);
  await call("DELETE", path, undefined, owner.token);
  clock.t = T0 + 3000;
  await call("DELETE", `/projects/${p.id}/members/${ed.id}`, undefined, owner.token);
  const log = await call("GET", `/projects/${p.id}/activity`, undefined, owner.token);
  const items = log.json?.items || [];
  const types = items.map((e) => e.type).join();
  const expected = [
    "member.removed", "task.deleted", "project.updated", "task.status_changed",
    "task.status_changed", "task.status_changed", "task.updated", "task.updated",
    "task.created", "member.added", "project.created"
  ].join();
  const [removed, deleted, projUpd, reopen, done, doing, upd2, upd1, created, added, pc] = items;
  return log.status === 200 && types === expected &&
    items.every((e) => typeof e.id === "string" && typeof e.at === "string") &&
    new Set(items.map((e) => e.id)).size === items.length &&
    removed.userId === ed.id && removed.actorId === owner.id && removed.at === iso(T0 + 3000) &&
    deleted.taskId === t.id && same(projUpd.fields, ["description"]) &&
    reopen.from === "done" && reopen.to === "todo" && reopen.actorId === ed.id &&
    done.from === "doing" && done.to === "done" && done.actorId === owner.id &&
    doing.from === "todo" && doing.to === "doing" &&
    same(upd2.fields, ["labels"]) && upd2.taskId === t.id &&
    same(upd1.fields, ["title", "priority"]) && upd1.actorId === ed.id &&
    created.taskId === t.id && created.at === iso(T0 + 2000) &&
    added.userId === ed.id && added.role === "editor" && added.at === iso(T0 + 1000) &&
    pc.actorId === owner.id && pc.at === iso(T0);
}));

// -------------------------------------------------- persistence / infra

await runCase("CASE_PERSISTENCE", async () => {
  const dataFile = freshFile();
  const clock = { t: T0 };
  const saved = await withServer(async (api) => {
    const owner = await api.user("Olive", "persist-pass");
    const vi = await api.user("Vi");
    const p = await api.project(owner, "Durable");
    await api.member(p, owner, vi, "viewer");
    const keep = await api.task(p, owner, { title: "keep", labels: ["x"], assigneeId: vi.id });
    const drop = await api.task(p, owner, { title: "drop" });
    await api.call("PATCH", `/projects/${p.id}/tasks/${keep.id}`, { status: "doing" }, owner.token);
    await api.call("DELETE", `/projects/${p.id}/tasks/${drop.id}`, undefined, owner.token);
    return { owner, vi, p, keep, drop };
  }, dataFile, clock);
  if (!existsSync(dataFile)) return false;
  JSON.parse(readFileSync(dataFile, "utf8"));
  return withServer(async ({ call }) => {
    const { owner, vi, p, keep, drop } = saved;
    const me = await call("GET", "/users/me", undefined, owner.token);
    const login = await call("POST", "/sessions", { email: owner.email, password: "persist-pass" });
    const dup = await call("POST", "/users", { email: owner.email, password: "12345678", name: "x" });
    const list = await call("GET", `/projects/${p.id}/tasks`, undefined, vi.token);
    const kept = (await call("GET", `/projects/${p.id}/tasks/${keep.id}`, undefined, owner.token)).json || {};
    const dropped = await call("GET", `/projects/${p.id}/tasks/${drop.id}`, undefined, owner.token);
    const role = await call("PATCH", `/projects/${p.id}/tasks/${keep.id}`, { title: "no" }, vi.token);
    const log = await call("GET", `/projects/${p.id}/activity`, undefined, vi.token);
    const added = await call("POST", `/projects/${p.id}/tasks`, { title: "later" }, owner.token);
    const after = await call("GET", `/projects/${p.id}/tasks`, undefined, owner.token);
    return me.status === 200 && me.json?.id === owner.id && login.status === 201 &&
      err(dup, 409, "email") && list.json?.total === 1 && kept.status === "doing" &&
      same(kept.labels, ["x"]) && kept.assigneeId === vi.id && err(dropped, 404) &&
      err(role, 403) && log.json?.items?.length === 6 &&
      log.json.items[0].type === "task.deleted" && added.status === 201 &&
      titles(after) === "keep,later";
  }, dataFile, clock);
});

await runCase("CASE_BAD_JSON", () => withServer(async (api) => {
  const { call, user, project, task } = api;
  const owner = await user("Olive");
  const p = await project(owner);
  const t = await task(p, owner, { title: "t" });
  const probes = [
    await call("POST", "/users", "{bad", undefined, true),
    await call("POST", "/sessions", "not json", undefined, true),
    await call("POST", "/projects", "[1]", owner.token, true),
    await call("POST", `/projects/${p.id}/tasks`, "{\"title\":", owner.token, true),
    await call("POST", `/projects/${p.id}/tasks`, "null", owner.token, true),
    await call("PATCH", `/projects/${p.id}/tasks/${t.id}`, "\"title\"", owner.token, true),
    await call("POST", `/projects/${p.id}/members`, "{", owner.token, true)
  ];
  const list = await call("GET", `/projects/${p.id}/tasks`, undefined, owner.token);
  const projects = await call("GET", "/projects", undefined, owner.token);
  return probes.every((res) => err(res, 400) && res.json.field === undefined) &&
    list.json?.total === 1 && list.json.items[0].title === "t" &&
    projects.json?.items?.length === 1;
}));

await runCase("CASE_UNKNOWN_ROUTE", () => withServer(async ({ call, user }) => {
  const u = await user("Una");
  const probes = [
    await call("GET", "/nope"),
    await call("GET", "/nope", undefined, u.token),
    await call("GET", "/projects/a/b/c/d", undefined, u.token),
    await call("PUT", "/projects", { name: "x" }, u.token),
    await call("GET", "/users")
  ];
  return probes.every((res) => err(res, 404));
}));

await runCase("CASE_NO_LOST_UPDATE", async () => {
  const dataFile = freshFile();
  const clock = { t: T0 };
  const saved = await withServer(async (api) => {
    const { call, user, project, task } = api;
    const owner = await user("Olive");
    const p = await project(owner);
    const t = await task(p, owner, { title: "race" });
    const path = `/projects/${p.id}/tasks/${t.id}`;
    const [a, b, c] = await Promise.all([
      call("PATCH", path, { title: "raced" }, owner.token),
      call("PATCH", path, { priority: 5 }, owner.token),
      call("PATCH", path, { labels: ["hot"] }, owner.token)
    ]);
    const burst = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      call("POST", `/projects/${p.id}/tasks`, { title: `b${i}` }, owner.token)));
    const now = (await call("GET", path, undefined, owner.token)).json || {};
    const ok = [a, b, c].every((res) => res.status === 200) &&
      burst.every((res) => res.status === 201) &&
      new Set(burst.map((res) => res.json?.id)).size === 20 &&
      now.title === "raced" && now.priority === 5 && same(now.labels, ["hot"]);
    return ok && { owner, p, t };
  }, dataFile, clock);
  if (!saved) return false;
  JSON.parse(readFileSync(dataFile, "utf8"));
  return withServer(async ({ call }) => {
    const { owner, p, t } = saved;
    const task = (await call("GET", `/projects/${p.id}/tasks/${t.id}`, undefined, owner.token)).json || {};
    const list = await call("GET", `/projects/${p.id}/tasks?limit=100`, undefined, owner.token);
    const log = await call("GET", `/projects/${p.id}/activity`, undefined, owner.token);
    return task.title === "raced" && task.priority === 5 && same(task.labels, ["hot"]) &&
      list.json?.total === 21 &&
      log.json?.items?.filter((e) => e.type === "task.created").length === 21 &&
      log.json.items.filter((e) => e.type === "task.updated").length === 3;
  }, dataFile, clock);
});

// Delivered suite: passes, has >= 15 tests, and fails once src/ is the seed's.
function suite() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  // Force exit so a failing test that leaks a listening server cannot hang.
  const run = spawnSync(process.execPath, [
    "--test", "--test-force-exit", "--test-timeout=20000", "--test-reporter=tap"
  ], {
    cwd: work, encoding: "utf8", timeout: 40000, env, maxBuffer: 10 * 1024 * 1024
  });
  const pass = Number((String(run.stdout).match(/^# pass (\d+)/m) || [])[1] || 0);
  return { ok: run.status === 0, pass };
}
let testsExist = "fail";
try {
  const delivered = suite();
  if (delivered.ok && delivered.pass >= 15) {
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
