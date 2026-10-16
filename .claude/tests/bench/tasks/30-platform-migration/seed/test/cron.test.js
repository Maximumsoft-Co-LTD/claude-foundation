const assert = require("node:assert/strict");
const test = require("node:test");
const { runCron } = require("../src/cron");

function store() {
  return {
    sessions: [{ id: "s1", expiresAt: "2026-10-01T00:00:00Z" }, { id: "s2", expiresAt: "2026-10-02T00:00:00Z" }],
    users: [{ id: "u1", email: "a@example.com", digest: true }, { id: "u2", email: "b@example.com" }],
    audit: [{ id: "a1", at: "2026-08-01T00:00:00Z" }, { id: "a2", at: "2026-09-30T00:00:00Z" }],
    outbox: []
  };
}

test("midnight runs session expiry then the digest", () => {
  const s = store();
  const at = "2026-10-01T00:00:00Z";
  assert.deepEqual(runCron(s, at), [
    { job: "expire-sessions", at, result: { expired: 1 } },
    { job: "daily-digest", at, result: { sent: 1, recipients: ["a@example.com"] } }
  ]);
  assert.deepEqual(s.sessions.map(({ id }) => id), ["s2"]);
  assert.equal(s.outbox.length, 1);
});

test("a failing job does not stop later jobs", () => {
  const s = store();
  delete s.audit;
  const at = "2026-10-01T03:30:00Z";
  const entries = runCron(s, at);
  assert.deepEqual(entries[0], { job: "expire-sessions", at, result: { expired: 1 } });
  assert.equal(entries[1].job, "purge-audit");
  assert.equal(typeof entries[1].error, "string");
  assert.deepEqual(runCron(store(), "2026-10-01T03:31:00Z"), []);
});
