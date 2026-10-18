import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVAL_ROLES, ARTIFACTS, DOMAINS, RISK_LEVELS, riskLevel, routeChange
} from "../runtime/contracts/scratch-router.mjs";

const WITHDRAWAL = {
  workType: ["feature", "ui", "api", "data", "async"],
  riskSignals: ["financial", "access-control", "persisted-data-change", "external-integration"],
  impact: "high"
};
const ids = (rows) => rows.map((row) => row.id);

test("the table covers 28 domains whose artifacts and roles exist", () => {
  assert.equal(DOMAINS.length, 28);
  assert.deepEqual(ids(DOMAINS), Array.from({ length: 28 }, (_, i) => i + 1));
  for (const domain of DOMAINS) {
    for (const artifact of domain.artifacts) assert.ok(ARTIFACTS[artifact], `${domain.key}: ${artifact}`);
    for (const role of domain.roles) assert.ok(APPROVAL_ROLES.includes(role), `${domain.key}: ${role}`);
  }
  for (const [id, artifact] of Object.entries(ARTIFACTS))
    if (artifact.runnable) assert.ok(artifact.capability, `${id} names a preview capability`);
});

test("the withdrawal example is Critical and spans its domains", () => {
  const route = routeChange(WITHDRAWAL);
  assert.equal(route.level, "Critical");
  for (const id of [6, 10, 11, 14, 15]) assert.ok(ids(route.domains).includes(id), `domain ${id}`);
  assert.deepEqual(route.warnings, []);
});

test("an artifact shared by several domains appears once with every source", () => {
  const route = routeChange(WITHDRAWAL);
  const retry = route.artifacts.filter((row) => row.id === "retry");
  assert.equal(retry.length, 1);
  assert.deepEqual([...retry[0].domains].sort((a, b) => a - b), [8, 9]);
  assert.equal(new Set(ids(route.artifacts)).size, route.artifacts.length);
});

test("docs-only work is Low with only the change impact and test map", () => {
  const route = routeChange({ workType: ["docs"], riskSignals: [], impact: "low" });
  assert.equal(route.level, "Low");
  assert.deepEqual(ids(route.artifacts), ["impact", "testmap"]);
});

test("an unknown work type is ignored with a warning instead of throwing", () => {
  const route = routeChange({ workType: ["feature", "unknown-kind"], impact: "low" });
  assert.match(route.warnings.join("\n"), /unknown-kind/);
  assert.ok(ids(route.domains).includes(1));
});

test("runnable artifacts are offered only from High upward", () => {
  const medium = routeChange({ workType: ["api"], impact: "medium" });
  assert.equal(medium.level, "Medium");
  assert.ok(!medium.artifacts.some((row) => row.runnable));
  const high = routeChange({ workType: ["api"], impact: "high" });
  assert.ok(high.artifacts.some((row) => row.id === "playground" && row.runnable));
});

test("risk levels follow impact and signal weight", () => {
  assert.deepEqual(RISK_LEVELS, ["Low", "Medium", "High", "Critical"]);
  assert.equal(riskLevel({ impact: "low" }).level, "Low");
  assert.equal(riskLevel({ riskSignals: ["user-interface"] }).level, "Medium");
  assert.equal(riskLevel({ riskSignals: ["persisted-data-change"] }).level, "High");
  assert.equal(riskLevel({ impact: "high", riskSignals: ["access-control"] }).level, "Critical");
});

test("coupling, integrations, and security triggers add their domains", () => {
  const route = routeChange({
    workType: ["refactor"], coupling: "coupled", integrations: [{ name: "x" }],
    securityTriggers: ["auth"], impact: "medium"
  });
  for (const id of [8, 18, 23, 25]) assert.ok(ids(route.domains).includes(id), `domain ${id}`);
  assert.deepEqual(route.intents, ["refactor"]);
});
