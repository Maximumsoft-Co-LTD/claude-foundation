import assert from "node:assert/strict";
import test from "node:test";
import {
  DELIVERY_FIELDS,
  renderDependencies,
  renderRecovery,
  renderRollout,
  renderTestStrategy,
  validateDependencies,
  validateRecovery,
  validateRollout,
  validateTestStrategy,
} from "../runtime/workflow/validation/delivery-fields.mjs";

const enablement = {
  mechanism: "feature flag checkout.v2", defaultChanges: false, canDisable: true,
  reenable: "resumes from stored cart state", downtime: false, test: "flag on/off integration test",
};

const rollout = {
  strategy: "canary 5% → 50% → 100%", deployOrder: ["db migration", "api", "web"],
  gates: ["error rate < 1%", "p95 < 300ms"], enablement, rollbackTrigger: "error rate > 2% for 5 min",
  rollback: "disable flag, redeploy previous image",
  rollbackProof: "upgrade → downgrade → upgrade test in staging",
  versionSkew: [{ api: "v2", web: "v1", works: true }, { api: "v1", web: "v2", works: false }],
  upgradeSteps: ["update client SDK to 3.x", "rotate API key"],
  maturity: { alpha: "internal only", ga: "two weeks without incident" },
  changeWindow: "weekdays 10:00-16:00, no deploy during month-end close",
};

const testStrategy = {
  levels: [{ level: "unit", proves: "pricing rules", why: "pure logic" },
    { level: "integration", proves: "order persists", why: "real database" }],
  doubles: [{ replaces: "payment gateway", with: "stub server", gap: "no real 3DS flow" }],
  data: "seeded fixtures", environment: "docker compose", realSurface: "staging smoke",
  regression: "test fails before fix", untested: ["third-party outage"],
};

test("DELIVERY_FIELDS exposes validate and render for each field", () => {
  assert.deepEqual(Object.keys(DELIVERY_FIELDS), ["rollout", "testStrategy", "dependencies", "recovery"]);
  for (const field of Object.values(DELIVERY_FIELDS)) {
    assert.equal(typeof field.validate, "function");
    assert.equal(typeof field.render, "function");
  }
});

test("a complete rollout validates for a high-impact change", () => {
  assert.deepEqual(validateRollout(rollout, "rollout", { impact: "high" }), []);
});

test("high impact rollout without rollbackProof reports the path", () => {
  const { rollbackProof, ...noProof } = rollout;
  assert.deepEqual(validateRollout(noProof, "rollout", { impact: "high" }),
    ["rollout.rollbackProof is required for a high-impact change"]);
});

test("low impact rollout without rollbackProof has no issue", () => {
  const { rollbackProof, ...noProof } = rollout;
  assert.deepEqual(validateRollout(noProof, "rollout", { impact: "low" }), []);
  assert.deepEqual(validateRollout(noProof), []);
});

test("enablement needs all six answers", () => {
  const issues = validateRollout({ ...rollout, enablement: { mechanism: "flag", defaultChanges: "no" } },
    "rollout", { impact: "low" });
  assert.deepEqual(issues, [
    "rollout.enablement.defaultChanges must be true or false",
    "rollout.enablement.canDisable is required",
    "rollout.enablement.reenable is required",
    "rollout.enablement.downtime is required",
    "rollout.enablement.test is required",
  ]);
});

test("rollout requires strategy and rollback and validates version skew rows", () => {
  assert.deepEqual(validateRollout({ versionSkew: [{ works: "yes" }] }), [
    "rollout.strategy is required",
    "rollout.rollback is required",
    "rollout.versionSkew[0].works must be true or false",
    "rollout.versionSkew[0] must name a combination or component versions",
  ]);
});

test("enablement renders a six-row question table", () => {
  const out = renderRollout(rollout, { language: "en" });
  const section = out.slice(out.indexOf("**Enablement**"));
  const rows = section.split("\n\n")[1].split("\n").slice(2);
  assert.equal(rows.length, 6);
  assert.match(out, /\| How is it enabled\? \| feature flag checkout\.v2 \|/);
  assert.match(out, /\| Can it be disabled once enabled\? \| yes \|/);
  assert.match(out, /\| Is downtime needed\? \| no \|/);
});

test("rollout renders bullets, version skew table, and upgrade steps", () => {
  const out = renderRollout(rollout, { language: "en" });
  assert.match(out, /- Deploy order: db migration → api → web/);
  assert.match(out, /- Rollback proof: upgrade → downgrade → upgrade test in staging/);
  assert.match(out, /- Maturity: Alpha: internal only; GA: two weeks without incident/);
  assert.match(out, /\| api \| web \| Works \|\n\|---\|---\|---\|\n\| v2 \| v1 \| yes \|\n\| v1 \| v2 \| no \|/);
  assert.match(out, /1\. update client SDK to 3\.x\n2\. rotate API key/);
  assert.doesNotMatch(out, /\[object Object\]/);
});

test("version skew combination rows render a combination table", () => {
  const out = renderRollout({ strategy: "s", rollback: "r",
    versionSkew: [{ combination: "api v2 + web v1", works: true, note: "read-only" }] });
  assert.match(out, /\| Combination \| Works \| Note \|\n\|---\|---\|---\|\n\| api v2 \+ web v1 \| yes \| read-only \|/);
});

test("testStrategy validates and renders levels", () => {
  assert.deepEqual(validateTestStrategy(testStrategy), []);
  assert.deepEqual(validateTestStrategy({ levels: [{ level: "unit" }], doubles: [{ replaces: "x" }] }), [
    "testStrategy.levels[0].proves is required",
    "testStrategy.levels[0].why is required",
    "testStrategy.doubles[0].with is required",
    "testStrategy.doubles[0].gap is required",
  ]);
  const out = renderTestStrategy(testStrategy, { language: "en" });
  assert.match(out, /\| Level \| Proves \| Why \|\n\|---\|---\|---\|\n\| unit \| pricing rules \| pure logic \|/);
  assert.match(out, /- Test doubles: replaces payment gateway with stub server \(gap: no real 3DS flow\)/);
  assert.match(out, /- Not tested: third-party outage/);
});

test("dependencies and recovery validate paths and render", () => {
  assert.deepEqual(validateDependencies([{ name: "payments team" }]), ["dependencies[0].need is required"]);
  assert.match(renderDependencies([{ name: "payments", type: "team", need: "webhook", before: "T003" }]),
    /\| Dependency \| Type \| Need \| Needed before \|\n\|---\|---\|---\|---\|\n\| payments \| team \| webhook \| T003 \|/);
  assert.deepEqual(validateRecovery({ backup: "nightly" }), [
    "recovery.rpo is required", "recovery.rto is required", "recovery.restoreTest is required",
  ]);
  assert.equal(renderRecovery({ backup: "nightly", rpo: "24h", rto: "1h", restoreTest: "monthly drill" }),
    "- Backup: nightly\n- RPO: 24h\n- RTO: 1h\n- Restore test: monthly drill");
});

test("Thai labels render when language is th", () => {
  const out = renderRollout(rollout, { language: "th" });
  assert.match(out, /\*\*การเปิดปิด\*\*/);
  assert.match(out, /\| เปิดใช้งานอย่างไร \| feature flag checkout\.v2 \|/);
  assert.match(out, /- หลักฐาน rollback:/);
  assert.match(out, /\*\*ขั้นตอน upgrade\*\*/);
  assert.match(renderTestStrategy(testStrategy, { language: "th" }), /\| ระดับ \| พิสูจน์อะไร \| เหตุผล \|/);
  assert.match(renderRecovery({ backup: "nightly" }, { language: "th" }), /- การสำรองข้อมูล: nightly/);
});

test("empty values render and validate as nothing", () => {
  for (const [key, field] of Object.entries(DELIVERY_FIELDS)) {
    for (const empty of [undefined, null, key === "dependencies" ? [] : {}]) {
      assert.equal(field.render(empty, { language: "en" }), "", key);
      assert.deepEqual(field.validate(empty), [], key);
    }
  }
});
