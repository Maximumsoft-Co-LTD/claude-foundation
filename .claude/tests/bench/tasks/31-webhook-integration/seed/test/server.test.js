const assert = require("node:assert/strict");
const test = require("node:test");
const { createServer } = require("../src/server");

async function withServer(options, fn) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("health and unknown routes", async () => {
  await withServer({ secrets: ["s"] }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
    assert.equal((await fetch(`${base}/nope`)).status, 404);
  });
});

test("no events before any delivery", async () => {
  await withServer({ secrets: ["s"] }, async (base) => {
    assert.deepEqual(await (await fetch(`${base}/events`)).json(), { events: [] });
  });
});
