import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Build actions name no skills; an agent chooses skills from their own
// descriptions. Each description names the spec signals that call for the
// skill (workType, riskSignals, requirement, scenario) and when to skip it.
test("skill descriptions speak the spec's vocabulary", () => {
  for (const name of ["testing-fundamentals", "database-fundamentals", "api-design-fundamentals",
    "security-fundamentals", "debug-fundamentals"]) {
    const text = readFileSync(new URL(`../../skills/${name}/SKILL.md`, import.meta.url), "utf8");
    const description = text.match(/^description: (.*)$/m)?.[1] || "";
    assert.match(description, /workType|riskSignals|requirement|scenario/, name);
    assert.match(description, /Skip /, name);
  }
});
