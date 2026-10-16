const assert = require("node:assert/strict");
const test = require("node:test");
const { createRunner } = require("../src/runner");

function sinks() {
  const counters = [];
  const records = [];
  return { counters, records, metrics: { increment: (name, labels) => counters.push({ name, labels }) },
    logger: { log: (record) => records.push(record) } };
}

test("a successful job is counted and logged", async () => {
  const s = sinks();
  const runner = createRunner({ handlers: { echo: async (p) => p.value }, metrics: s.metrics, logger: s.logger });
  assert.deepEqual(await runner.run({ id: "j1", type: "echo", payload: { value: 7 } }), { ok: true, output: 7 });
  assert.deepEqual(s.counters, [{ name: "jobs_succeeded_total", labels: { type: "echo" } }]);
  assert.equal(s.records[0].event, "job_succeeded");
});

test("a failing handler does not reject; an unknown type does", async () => {
  const s = sinks();
  const runner = createRunner({ handlers: { boom: () => { throw new Error("x"); } }, metrics: s.metrics, logger: s.logger });
  assert.equal((await runner.run({ id: "j2", type: "boom", payload: {} })).ok, false);
  await assert.rejects(runner.run({ id: "j3", type: "nope", payload: {} }));
});
