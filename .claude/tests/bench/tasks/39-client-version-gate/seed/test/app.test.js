const assert = require("node:assert/strict");
const test = require("node:test");
const { createApp } = require("../src/app");

test("serves the feed and health", () => {
  const app = createApp();
  assert.equal(app.handle({ method: "GET", path: "/api/feed", headers: {} }).body.items.length, 2);
  assert.deepEqual(app.handle({ method: "GET", path: "/health", headers: {} }).body, { ok: true });
});

test("unknown routes are 404", () => {
  const app = createApp();
  assert.equal(app.handle({ method: "POST", path: "/api/feed", headers: {} }).status, 404);
  assert.equal(app.handle({ method: "GET", path: "/nope", headers: {} }).status, 404);
});
