const assert = require("node:assert/strict");
const test = require("node:test");
const { createServer } = require("../src/server");

async function withServer(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { user, body } = {}) => {
    const headers = { "content-type": "application/json" };
    if (user) headers["x-user"] = user;
    const res = await fetch(base + path, { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  try { await fn(call); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("signed-in users create notes they own", () => withServer(async (call) => {
  const created = await call("POST", "/notes", { user: "alice", body: { title: " Groceries " } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, { id: "1", title: "Groceries", owner: "alice" });
  assert.deepEqual((await call("GET", "/notes/1")).body, created.body);
}));

test("anonymous and invalid creates are rejected", () => withServer(async (call) => {
  assert.equal((await call("POST", "/notes", { body: { title: "x" } })).status, 401);
  assert.equal((await call("POST", "/notes", { user: "alice", body: { title: "  " } })).status, 400);
}));

test("deleting a note removes it", () => withServer(async (call) => {
  await call("POST", "/notes", { user: "alice", body: { title: "Temp" } });
  assert.equal((await call("DELETE", "/notes/1", { user: "alice" })).status, 204);
  assert.equal((await call("GET", "/notes/1")).status, 404);
  assert.equal((await call("DELETE", "/notes/1", { user: "alice" })).status, 404);
}));
