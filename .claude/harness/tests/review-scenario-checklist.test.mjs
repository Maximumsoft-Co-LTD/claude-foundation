import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  parseScenarioCoverage, parseSpecScenarios, reviewChecklistInstruction, reviewScenarioChecklist
} from "../runtime/evidence/review-diff.mjs";

function packet(files) {
  const dir = mkdtempSync(join(tmpdir(), "scenario-checklist-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const access = (packetDir) => ({
  packetDir, readFile: readFileSync, readDirectory: readdirSync,
  isDirectory: (path) => lstatSync(path).isDirectory()
});

const SPEC = `# Export

## ADDED Requirements

### Requirement: CSV export

Users export rows.

#### Scenario: Export all rows

- **GIVEN** a table with rows
- **AND** the user is signed in
- **WHEN** the user clicks export
- **THEN** a CSV downloads
- **AND** it has a header row

#### Scenario: Empty table

- **WHEN** the table is empty
- **THEN** export is disabled

## REMOVED Requirements

### Requirement: XLS export

#### Scenario: Old path

- **WHEN** xls is requested
- **THEN** it downloads
`;

test("standard packet: parses specs with stable claim-bound and slug ids", (t) => {
  const dir = packet({
    "specs/export/spec.md": SPEC,
    "evidence.yaml": JSON.stringify({ version: 2, claims: [
      { id: "csv-export-all", requirementKey: "csv-export", scenario: "Export all rows" }] })
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = reviewScenarioChecklist(access(dir));
  assert.equal(result.source, "specs");
  assert.equal(result.truncated, false);
  assert.deepEqual(result.items, [
    { id: "csv-export-all", requirement: "CSV export", scenario: "Export all rows",
      given: "a table with rows; the user is signed in", when: "the user clicks export",
      then: "a CSV downloads; it has a header row" },
    { id: "csv-export-s2", requirement: "CSV export", scenario: "Empty table",
      when: "the table is empty", then: "export is disabled" }
  ]);
  assert.deepEqual(reviewScenarioChecklist(access(dir)), result, "deterministic");
});

test("rapid packet: proposal scenarios, else evidence claims", (t) => {
  const withProposal = packet({ "proposal.md": `# Change: x\n\n## Why\n\nbecause\n\n${SPEC.split("## REMOVED")[0]}` });
  const withClaims = packet({
    "proposal.md": "# Change: x\n\n## Why\n\nbecause\n",
    "evidence.yaml": JSON.stringify({ version: 2, claims: [
      { id: "sidebar-order", requirementKey: "sidebar", scenario: "Reader meets vocabulary first" },
      { id: "no-scenario" }] })
  });
  const empty = packet({ "proposal.md": "# Change\n" });
  t.after(() => [withProposal, withClaims, empty].forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const fromProposal = reviewScenarioChecklist(access(withProposal));
  assert.equal(fromProposal.source, "proposal");
  assert.equal(fromProposal.items.length, 2);
  assert.deepEqual(reviewScenarioChecklist(access(withClaims)), {
    source: "claims", truncated: false,
    items: [{ id: "sidebar-order", requirement: "sidebar",
      scenario: "Reader meets vocabulary first", when: null, then: null }]
  });
  assert.deepEqual(reviewScenarioChecklist(access(empty)), { items: [], source: "none", truncated: false });
  assert.deepEqual(reviewScenarioChecklist({}), { items: [], source: "none", truncated: false });
});

test("listDir/exists access shape works without isDirectory", (t) => {
  const dir = packet({ "specs/a/spec.md": SPEC });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = reviewScenarioChecklist({ packetDir: dir, readFile: readFileSync,
    listDir: readdirSync, exists: () => true });
  assert.equal(result.items.length, 2);
});

test("caps items and bytes with a truncated flag", (t) => {
  const many = Array.from({ length: 60 }, (_, index) =>
    `#### Scenario: Case ${index}\n\n- **WHEN** input ${index}\n- **THEN** output ${index}\n`).join("\n");
  const dir = packet({ "specs/big/spec.md": `## ADDED Requirements\n\n### Requirement: Big\n\n${many}` });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const byCount = reviewScenarioChecklist(access(dir));
  assert.equal(byCount.items.length, 40);
  assert.equal(byCount.truncated, true);
  const byBytes = reviewScenarioChecklist(access(dir), { items: 100, bytes: 500 });
  assert.ok(byBytes.items.length > 0 && byBytes.items.length < 60);
  assert.ok(Buffer.byteLength(JSON.stringify(byBytes.items)) <= 500);
  assert.equal(byBytes.truncated, true);
});

test("plain GIVEN/WHEN/THEN bullets and unbolded keywords parse", () => {
  const rows = parseSpecScenarios("### Requirement: R\n#### Scenario: S\n- WHEN: a\n- THEN b\n- AND c\n");
  assert.deepEqual(rows, [{ requirement: "R", scenario: "S", when: "a", then: "b; c" }]);
});

test("instruction lists every id, statuses, and the result shape", () => {
  assert.equal(reviewChecklistInstruction([]), "");
  const text = reviewChecklistInstruction([
    { id: "a-s1", requirement: "A", scenario: "One", when: "w", then: "t" }], { truncated: true });
  for (const needle of ["a-s1", "covered-by-test", "covered-by-code-only", "missing", "unsure",
    "finding", '"scenarioCoverage"', "truncated"])
    assert.ok(text.includes(needle), needle);
});

test("parser: fenced json, bare json, objects, missing block", () => {
  const fenced = "Findings...\n```json\n{\"scenarioCoverage\":[" +
    "{\"id\":\"a\",\"status\":\"covered-by-test\",\"evidence\":\"t.test.mjs:12\"}," +
    "{\"id\":\"b\",\"status\":\"missing\",\"evidence\":null}," +
    "{\"id\":\"c\",\"status\":\"UNSURE\"}," +
    "{\"id\":\"d\",\"status\":\"probably fine\"}]}\n```\n";
  assert.deepEqual(parseScenarioCoverage(fenced), {
    items: [
      { id: "a", status: "covered-by-test", evidence: "t.test.mjs:12" },
      { id: "b", status: "missing", evidence: null },
      { id: "c", status: "unsure", evidence: null },
      { id: "d", status: null, evidence: null }
    ],
    missing: ["b"], unsure: ["c", "d"]
  });
  const bare = 'text {"verdict":"pass","scenarioCoverage":[{"id":"x","status":"covered-by-code-only","evidence":"a.js:1 {brace}"}]} tail';
  assert.deepEqual(parseScenarioCoverage(bare).items,
    [{ id: "x", status: "covered-by-code-only", evidence: "a.js:1 {brace}" }]);
  assert.deepEqual(parseScenarioCoverage({ scenarioCoverage: [{ id: "y", status: "missing" }] }).missing, ["y"]);
  assert.equal(parseScenarioCoverage("no block here"), null);
  assert.equal(parseScenarioCoverage('{"scenarioCoverage": [ broken'), null);
  assert.equal(parseScenarioCoverage(null), null);
  const partial = parseScenarioCoverage(fenced, { expectedIds: ["a", "e"] });
  assert.deepEqual(partial.items.at(-1), { id: "e", status: null, evidence: null });
  assert.ok(partial.unsure.includes("e"));
  const last = parseScenarioCoverage(`${fenced}\nrevised:\n{"scenarioCoverage":[{"id":"a","status":"missing"}]}`);
  assert.deepEqual(last.missing, ["a"], "last block wins");
});

test("parser stays bounded on large brace-heavy reports", () => {
  const noise = "{".repeat(20000) + ' "scenarioCoverage": [ ' + "}".repeat(5);
  const started = Date.now();
  assert.equal(parseScenarioCoverage(noise), null);
  assert.ok(Date.now() - started < 2000);
});
