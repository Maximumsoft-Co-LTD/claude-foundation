import assert from "node:assert/strict";
import { parseSpecDocument, verifySpecSync } from "../../harness/runtime/workflow/spec-sync-verify.mjs";

const lines = (...rows) => `${rows.join("\n")}\n`;

// Real OpenSpec shapes: a current spec.md keeps its requirements under
// '## Requirements'; a delta groups them under '## ADDED|MODIFIED|REMOVED'.
const spec = (...blocks) => lines(
  "# appearance Specification", "", "## Purpose", "", "Fixture capability.", "",
  "## Requirements", "", ...blocks);

const remembered = [
  "### Requirement: The choice is remembered", "",
  "The system SHALL remember the choice.", "",
  "#### Scenario: A choice survives a reload", "",
  "- **WHEN** the page reloads", "- **THEN** the choice is kept", "",
  "#### Scenario: A value that is not one of the three is discarded", "",
  "- **WHEN** an unknown value is stored", "- **THEN** it is discarded", ""
];

const contrast = [
  "### Requirement: Contrast follows the system", "",
  "The system SHALL follow the system contrast preference.", "",
  "#### Scenario: High contrast is honored", "",
  "- **WHEN** the system requests high contrast", "- **THEN** the app raises contrast", ""
];

const kinds = (result) => result.violations.map(({ kind }) => kind);
const detailFor = (result, kind) =>
  result.violations.find((violation) => violation.kind === kind)?.detail || "";

// Parser: section context, scenario list, and a verbatim body per requirement.
const parsed = parseSpecDocument(spec(...remembered, ...contrast));
assert.deepEqual(parsed.map(({ name }) => name),
  ["The choice is remembered", "Contrast follows the system"]);
assert.deepEqual(parsed[0].scenarios,
  ["A choice survives a reload", "A value that is not one of the three is discarded"]);
assert.deepEqual(parsed.map(({ section }) => section), ["Requirements", "Requirements"]);
assert.match(parsed[1].body, /^### Requirement: Contrast follows the system/);
assert.equal(/\s$/.test(parsed[1].body), false, "requirement bodies are trailing-trimmed");

// 1. ADDED: a brand-new capability has no 'before' at all.
const addedDelta = lines("## ADDED Requirements", "", ...contrast);
assert.deepEqual(
  verifySpecSync({ before: null, after: spec(...contrast), delta: addedDelta }),
  { valid: true, violations: [] });

assert.deepEqual(
  kinds(verifySpecSync({ before: null, after: spec(), delta: addedDelta })),
  ["added-requirement-missing"]);

assert.deepEqual(
  kinds(verifySpecSync({
    before: spec(...contrast),
    after: spec(...contrast),
    delta: addedDelta
  })),
  ["added-requirement-preexisting"]);

// 2. REMOVED: retires behavior the spec actually declared.
const removedDelta = lines(
  "## REMOVED Requirements", "",
  "### Requirement: Contrast follows the system", "",
  "The system SHALL follow the system contrast preference.", "");
assert.deepEqual(
  verifySpecSync({
    before: spec(...remembered, ...contrast),
    after: spec(...remembered),
    delta: removedDelta
  }),
  { valid: true, violations: [] });

assert.deepEqual(
  kinds(verifySpecSync({
    before: spec(...remembered, ...contrast),
    after: spec(...remembered, ...contrast),
    delta: removedDelta
  })),
  ["removed-requirement-present"]);

assert.deepEqual(
  kinds(verifySpecSync({ before: spec(...remembered), after: spec(...remembered), delta: removedDelta })),
  ["removed-requirement-absent"]);

// 3. MODIFIED: the archived scenario list must equal the delta's exactly.
const modifiedBlock = [
  "### Requirement: The choice is remembered", "",
  "The system SHALL remember the choice for a session.", "",
  "#### Scenario: A choice survives a reload", "",
  "- **WHEN** the page reloads", "- **THEN** the choice is kept", "",
  "#### Scenario: A value that is not one of the three is discarded", "",
  "- **WHEN** an unknown value is stored", "- **THEN** it is discarded", ""
];
const modifiedDelta = lines("## MODIFIED Requirements", "", ...modifiedBlock);
assert.deepEqual(
  verifySpecSync({
    before: spec(...remembered),
    after: spec(...modifiedBlock),
    delta: modifiedDelta
  }),
  { valid: true, violations: [] });

assert.deepEqual(
  kinds(verifySpecSync({ before: spec(...remembered), after: spec(), delta: modifiedDelta })),
  ["modified-requirement-missing"]);

// The merge kept a scenario the MODIFIED block replaced.
assert.deepEqual(
  kinds(verifySpecSync({
    before: spec(...remembered),
    after: spec(...modifiedBlock.slice(0, -1),
      "#### Scenario: A stale scenario the merge kept", "",
      "- **WHEN** archive runs", "- **THEN** the scenario lingers", ""),
    delta: modifiedDelta
  })),
  ["modified-scenario-extra"]);

// The merge dropped a scenario the MODIFIED block declared.
assert.deepEqual(
  kinds(verifySpecSync({
    before: spec(...remembered),
    after: spec(...modifiedBlock.slice(0, 8)),
    delta: modifiedDelta
  })),
  ["modified-scenario-missing"]);

// Same set, different order: the merge did not replace the list wholesale.
const reordered = [
  "### Requirement: The choice is remembered", "",
  "The system SHALL remember the choice for a session.", "",
  "#### Scenario: A value that is not one of the three is discarded", "",
  "- **WHEN** an unknown value is stored", "- **THEN** it is discarded", "",
  "#### Scenario: A choice survives a reload", "",
  "- **WHEN** the page reloads", "- **THEN** the choice is kept", ""
];
assert.deepEqual(
  kinds(verifySpecSync({ before: spec(...remembered), after: spec(...reordered), delta: modifiedDelta })),
  ["modified-scenario-order"]);

// A MODIFIED block that silently drops a scenario the spec still declared:
// archive obeys the delta, so 'after' looks self-consistent and only 'before'
// proves the deletion. This is what assertNoDroppedScenarios guards at /change.
const droppingBlock = [
  "### Requirement: The choice is remembered", "",
  "The system SHALL remember the choice.", "",
  "#### Scenario: A choice survives a reload", "",
  "- **WHEN** the page reloads", "- **THEN** the choice is kept", ""
];
const dropped = verifySpecSync({
  before: spec(...remembered),
  after: spec(...droppingBlock),
  delta: lines("## MODIFIED Requirements", "", ...droppingBlock)
});
assert.deepEqual(kinds(dropped), ["modified-scenario-deleted"]);
assert.match(detailFor(dropped, "modified-scenario-deleted"),
  /A value that is not one of the three is discarded/);
assert.match(detailFor(dropped, "modified-scenario-deleted"), /REMOVED Requirements/);

// A scenario RENAME inside MODIFIED reads identically: 'three' becomes 'four'.
const renamedBlock = [
  "### Requirement: The choice is remembered", "",
  "The system SHALL remember the choice.", "",
  "#### Scenario: A choice survives a reload", "",
  "- **WHEN** the page reloads", "- **THEN** the choice is kept", "",
  "#### Scenario: A value that is not one of the four is discarded", "",
  "- **WHEN** an unknown value is stored", "- **THEN** it is discarded", ""
];
const renamedScenario = verifySpecSync({
  before: spec(...remembered),
  after: spec(...renamedBlock),
  delta: lines("## MODIFIED Requirements", "", ...renamedBlock)
});
assert.deepEqual(kinds(renamedScenario), ["modified-scenario-deleted"]);
assert.match(detailFor(renamedScenario, "modified-scenario-deleted"),
  /'A value that is not one of the three is discarded'/);

// 4. A requirement the delta never mentions must survive verbatim.
const mutatedContrast = [
  "### Requirement: Contrast follows the system", "",
  "The system SHALL ignore the system contrast preference.", "",
  "#### Scenario: High contrast is honored", "",
  "- **WHEN** the system requests high contrast", "- **THEN** the app raises contrast", ""
];
assert.deepEqual(
  kinds(verifySpecSync({
    before: spec(...remembered, ...contrast),
    after: spec(...modifiedBlock, ...mutatedContrast),
    delta: modifiedDelta
  })),
  ["untouched-requirement-modified"]);

assert.deepEqual(
  kinds(verifySpecSync({
    before: spec(...remembered, ...contrast),
    after: spec(...modifiedBlock),
    delta: modifiedDelta
  })),
  ["untouched-requirement-missing"]);

// Reordering untouched requirements around the merged one is not a mutation.
assert.deepEqual(
  verifySpecSync({
    before: spec(...remembered, ...contrast),
    after: spec(...contrast, ...modifiedBlock),
    delta: modifiedDelta
  }),
  { valid: true, violations: [] });

// A '## RENAMED Requirements' block names requirements in FROM/TO list items,
// so they count as mentioned rather than as silently mutated untouched work.
assert.deepEqual(
  verifySpecSync({
    before: spec(...contrast),
    after: spec("### Requirement: Contrast follows the platform", "",
      "The system SHALL follow the system contrast preference.", "",
      "#### Scenario: High contrast is honored", "",
      "- **WHEN** the system requests high contrast", "- **THEN** the app raises contrast", ""),
    delta: lines("## RENAMED Requirements", "",
      "- FROM: `### Requirement: Contrast follows the system`",
      "- TO: `### Requirement: Contrast follows the platform`")
  }),
  { valid: true, violations: [] });

// 5. One name, two intents: OpenSpec rejects it, so refuse to guess.
const ambiguous = verifySpecSync({
  before: spec(...remembered),
  after: spec(...renamedBlock),
  delta: lines(
    "## REMOVED Requirements", "",
    "### Requirement: The choice is remembered", "",
    "The system SHALL remember the choice.", "",
    "## ADDED Requirements", "", ...renamedBlock)
});
assert.deepEqual(kinds(ambiguous), ["delta-name-ambiguous"]);
assert.match(detailFor(ambiguous, "delta-name-ambiguous"), /'REMOVED', 'ADDED'/);

// The rename form OpenSpec accepts: distinct names in the two sections.
assert.deepEqual(
  verifySpecSync({
    before: spec(...remembered),
    after: spec("### Requirement: The choice is remembered across four values", "",
      "The system SHALL remember the choice.", "",
      "#### Scenario: A choice survives a reload", "",
      "- **WHEN** the page reloads", "- **THEN** the choice is kept", ""),
    delta: lines(
      "## REMOVED Requirements", "",
      "### Requirement: The choice is remembered", "",
      "The system SHALL remember the choice.", "",
      "## ADDED Requirements", "",
      "### Requirement: The choice is remembered across four values", "",
      "The system SHALL remember the choice.", "",
      "#### Scenario: A choice survives a reload", "",
      "- **WHEN** the page reloads", "- **THEN** the choice is kept", "")
  }),
  { valid: true, violations: [] });

// A delta requirement outside any delta section is never merged at all.
assert.deepEqual(
  kinds(verifySpecSync({ before: null, after: spec(), delta: lines(...contrast) })),
  ["delta-section-unrecognized"]);

// Missing inputs degrade to empty documents rather than throwing.
assert.deepEqual(verifySpecSync(), { valid: true, violations: [] });

// Every violation carries an actionable requirement name and detail.
const everyKind = verifySpecSync({
  before: spec(...remembered, ...contrast),
  after: spec(),
  delta: lines("## MODIFIED Requirements", "", ...modifiedBlock)
});
assert.equal(everyKind.valid, false);
for (const violation of everyKind.violations) {
  assert.equal(typeof violation.requirement, "string");
  assert.ok(violation.detail.length > 20, `terse detail for ${violation.kind}`);
}

console.log("spec sync verify: ALL PASS (35/35 assertions)");
