#!/usr/bin/env sh

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/.claude/tests/lib/assert.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/project/.claude/commands" "$TMP/project/.claude/rules" \
  "$TMP/project/.claude/skills/review"
printf 'orchestrate\n' > "$TMP/project/.claude/orchestrator.md"
printf 'build\n' > "$TMP/project/.claude/commands/build.md"
printf 'safe\n' > "$TMP/project/.claude/rules/safety.md"
printf '%s\n' '---' 'name: review' '---' 'review carefully' \
  > "$TMP/project/.claude/skills/review/SKILL.md"

ROOT="$ROOT" FIXTURE="$TMP/project" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const {
  canonicalJson, createInstructionManifest, instructionProvenance,
  instructionManifestShapeReason, verifyInstructionManifest
} = await import(`${process.env.ROOT}/.claude/harness/runtime/core/instruction-manifest.mjs`);

const fixture = process.env.FIXTURE;
const options = {
  root: fixture,
  foundationVersion: "test",
  command: "build",
  commandPath: ".claude/commands/build.md",
  orchestratorPath: ".claude/orchestrator.md",
  rulePaths: [".claude/rules/safety.md"],
  skills: [{ name: "review", path: ".claude/skills/review/SKILL.md" }],
  requestedModel: "standard"
};
const first = createInstructionManifest(options);
const second = createInstructionManifest({ ...options, rulePaths: [...options.rulePaths].reverse() });
assert.deepEqual(first, second);
assert.equal(verifyInstructionManifest(first).valid, true);
assert.equal(instructionProvenance(null).available, false);
assert.equal(instructionProvenance(first).valid, true);
assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
assert.equal(JSON.stringify(first).includes("review carefully"), false);
assert.equal(instructionManifestShapeReason(null), "unsupported-schema");
assert.equal(instructionManifestShapeReason({ schemaVersion: 2 }), "unsupported-schema");
assert.equal(instructionManifestShapeReason({ schemaVersion: 1, dispatch: {} }),
  "missing-dispatch-instruction");
assert.equal(instructionManifestShapeReason({
  schemaVersion: 1,
  dispatch: { command: "build", commandInstruction: { digest: "sha256:x" }, rules: {} },
  execution: { skills: [] }
}), "invalid-instruction-collections");
assert.equal(instructionManifestShapeReason({
  schemaVersion: 1,
  dispatch: { command: "build", commandInstruction: { digest: "sha256:x" }, rules: [] },
  execution: { skills: {} }
}), "invalid-instruction-collections");
assert.equal(verifyInstructionManifest(null).reason, "unsupported-schema");
assert.equal(verifyInstructionManifest({ schemaVersion: 1, dispatch: {} }).reason,
  "missing-dispatch-instruction");

assert.throws(() => createInstructionManifest({ ...options, root: "" }),
  /requires root/);
assert.throws(() => createInstructionManifest({ ...options, command: "" }),
  /requires command and commandPath/);
assert.throws(() => createInstructionManifest({ ...options, commandPath: "" }),
  /requires command and commandPath/);
assert.throws(() => createInstructionManifest({ ...options, commandPath: "../outside.md" }),
  /escapes root/);
assert.throws(() => createInstructionManifest({
  ...options, rulePaths: [".claude/rules/missing.md"]
}), /missing rule instruction/);
for (const skill of [null, {}, { name: "review" }, { path: options.skills[0].path }])
  assert.throws(() => createInstructionManifest({ ...options, skills: [skill] }),
    /skill instructions require name and path/);
assert.throws(() => createInstructionManifest({
  ...options, skills: [{ name: "missing", path: ".claude/skills/missing/SKILL.md" }]
}), /missing skill instruction/);
assert.throws(() => createInstructionManifest({
  ...options, skills: [{ name: "other", path: options.skills[0].path }]
}), /skill name mismatch/);

const command = join(fixture, ".claude/commands/build.md");
writeFileSync(command, readFileSync(command, "utf8") + "changed\n");
const changed = createInstructionManifest(options);
assert.notEqual(changed.manifestDigest, first.manifestDigest);
const tampered = structuredClone(first);
tampered.execution.actualModel = "different";
assert.equal(verifyInstructionManifest(tampered).reason, "digest-mismatch");
assert.throws(() => createInstructionManifest({
  ...options,
  skills: [...options.skills, options.skills[0]]
}), /duplicate skill instruction/);
writeFileSync(join(fixture, ".claude/skills/review/SKILL.md"), "not frontmatter\n");
assert.throws(() => createInstructionManifest(options), /invalid skill frontmatter/);
NODE
pass "instruction manifest is canonical, content-addressed, and payload-free"

ROOT="$ROOT" FIXTURE="$TMP/project" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const {
  createHostExecutionStore, hostExecutionTelemetryRows, normalizeHostExecution
} = await import(`${process.env.ROOT}/.claude/harness/runtime/observability/host-execution-contract.mjs`);

const raw = {
  schemaVersion: 1,
  dispatchId: "dispatch-1",
  requestedModel: "standard",
  actualModel: "model-b",
  instructionManifestDigest: "sha256:abc",
  prompt: "TOP SECRET PROMPT",
  messages: [{ content: "TOP SECRET MESSAGE" }],
  attempts: [
    { attempt: 2, model: "model-b", status: "completed", usage: {} },
    { attempt: 1, model: "model-a", status: "timeout", durationMs: 10,
      fallbackReason: "timeout", toolArguments: { secret: "TOP SECRET TOOL" } }
  ],
  usage: {},
  tools: { calls: 2, failures: 1, payload: "TOP SECRET TOOL" },
  result: { status: "completed", output: "TOP SECRET OUTPUT" }
};
const normalized = normalizeHostExecution(raw, {
  changeId: "change-a", importedAt: "2026-01-01T00:00:00.000Z"
});
assert.equal(normalized.usage.inputTokens, null);
assert.deepEqual(normalized.attempts.map((row) => row.attempt), [1, 2]);
assert.equal(JSON.stringify(normalized).includes("TOP SECRET"), false);
const rows = hostExecutionTelemetryRows(normalized);
assert.equal(rows[0].requestId, "dispatch-1:attempt:1");
assert.equal(rows[0].instructionManifestDigest, "sha256:abc");

const store = createHostExecutionStore({
  root: process.env.FIXTURE,
  now: () => "2026-01-01T00:00:00.000Z"
});
const first = store.importExecution("change-a", raw);
const duplicate = store.importExecution("change-a", raw);
assert.equal(first.imported, true);
assert.equal(duplicate.imported, false);
assert.equal(duplicate.duplicate, true);
assert.equal(readFileSync(first.path, "utf8").includes("TOP SECRET"), false);
assert.throws(() => normalizeHostExecution({ ...raw, dispatchId: "" }), /dispatchId is required/);
assert.throws(() => normalizeHostExecution({ ...raw, attempts: [
  { attempt: 1, status: "completed" }, { attempt: 1, status: "completed" }
] }), /attempt numbers must be unique/);
assert.throws(() => normalizeHostExecution({ ...raw, tools: { calls: 1.5 } }),
  /tools.calls must be an integer/);
assert.throws(() => normalizeHostExecution({ ...raw, host: { prompt: "hidden" } }),
  /host must be a string/);
NODE
pass "host result imports idempotently without persisting prompt or tool payloads"

finish "provenance and host execution contracts"
