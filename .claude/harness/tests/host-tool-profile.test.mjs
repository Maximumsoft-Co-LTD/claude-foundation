import assert from "node:assert/strict";
import test from "node:test";

import { hostToolProfile } from "../runtime/observability/metrics-runtime.mjs";
import {
  TOOL_CALL_CATEGORIES, messageToolCalls, normalizeTelemetryRow, toolCallCategory,
  toolCallProfile
} from "../runtime/observability/telemetry.mjs";
import { normalizeTelemetryBatch } from "../runtime/observability/telemetry-runtime.mjs";

test("tool calls map to a closed set of overhead categories", () => {
  const cases = [
    ["Bash", { command: "node .claude/harness/foundation.mjs advance c1" }, "harnessCli"],
    ["Bash", { command: "claude-foundation change start c1 --draft d.json" }, "harnessCli"],
    ["Bash", { command: "bash .claude/harness/cli.sh changes" }, "harnessCli"],
    ["Bash", { command: "cd /tmp/x && node --test" }, "testRuns"],
    ["Bash", { command: "node --experimental-vm-modules --test test/" }, "testRuns"],
    ["Bash", { command: "npm test" }, "testRuns"],
    ["Bash", { command: "python3 -m pytest -q" }, "testRuns"],
    ["Bash", { command: "cat .claude/skills/build/SKILL.md" }, "harnessDocReads"],
    ["Bash", { command: "sed -n 1,40p WORKFLOW.md" }, "harnessDocReads"],
    ["Bash", { command: "cat .foundation/runtime/c1.json" }, "stateReads"],
    ["Bash", { command: "ls openspec/changes/c1" }, "stateReads"],
    ["Bash", { command: "git status" }, "other"],
    ["Read", { file_path: "/repo/.claude/harness/README.md" }, "harnessDocReads"],
    ["Read", { file_path: "/repo/openspec/changes/c1/tasks.md" }, "stateReads"],
    ["Read", { file_path: "/repo/src/cart.js" }, "other"],
    ["Grep", { pattern: "advance", path: ".claude/commands" }, "harnessDocReads"],
    ["Skill", { skill: "build" }, "harnessDocReads"],
    ["Write", { file_path: "/repo/openspec/changes/c1/draft.json" }, "harnessArtifactWrites"],
    ["Edit", { file_path: "/repo/.foundation/notes.md" }, "harnessArtifactWrites"],
    ["Write", { file_path: "/repo/src/cart.js" }, "productWrites"],
    ["Edit", { file_path: "/repo/test/cart.test.js" }, "productWrites"],
    ["TodoWrite", { todos: [] }, "other"],
    ["mcp__browseros-neo__run", {}, "other"],
    [undefined, undefined, "other"]
  ];
  for (const [name, input, expected] of cases) {
    const category = toolCallCategory(name, input);
    assert.equal(category, expected, `${name} ${JSON.stringify(input)}`);
    assert.ok(TOOL_CALL_CATEGORIES.includes(category));
  }
});

test("tool call profiles de-duplicate ids and keep unknown as null", () => {
  assert.equal(messageToolCalls({}), null, "no inspectable content is unknown");
  assert.deepEqual(messageToolCalls({ content: [{ type: "text", text: "hi" }] }), []);
  const calls = messageToolCalls({ content: [
    { type: "tool_use", id: "a", name: "Bash", input: { command: "npm test" } },
    { type: "tool_use", id: "b", name: "Write", input: { file_path: "src/x.js" } }
  ] });
  const profile = toolCallProfile([...calls, calls[0]]);
  assert.equal(profile.total, 2);
  assert.deepEqual(profile.byTool, { Bash: 1, Write: 1 });
  assert.equal(profile.byCategory.testRuns, 1);
  assert.equal(profile.byCategory.productWrites, 1);
  assert.equal(profile.byCategory.harnessCli, 0);
  const unknown = toolCallProfile(null);
  assert.equal(unknown.total, null);
  assert.equal(unknown.byTool, null);
  assert.ok(Object.values(unknown.byCategory).every((value) => value === null));
});

test("transcript import keeps every tool_use of a request split across rows", () => {
  const usage = { input_tokens: 1, output_tokens: 1 };
  const row = (content) => ({
    type: "assistant", requestId: "req-1",
    message: { role: "assistant", id: "msg-1", usage, content }
  });
  const { normalized } = normalizeTelemetryBatch({
    id: "c1", format: "claude", context: {}, known: new Set(),
    knownTransitions: new Set(), now: () => "2026-09-30T00:00:00.000Z",
    rows: [
      row([{ type: "tool_use", id: "t1", name: "Bash",
        input: { command: "node .claude/harness/foundation.mjs advance c1" } }]),
      row([{ type: "tool_use", id: "t2", name: "Read",
        input: { file_path: ".claude/skills/build/SKILL.md" } }]),
      row([{ type: "tool_use", id: "t2", name: "Read",
        input: { file_path: ".claude/skills/build/SKILL.md" } }])
    ]
  });
  assert.equal(normalized.length, 1, "one request remains one usage event");
  assert.deepEqual(normalized[0].toolCalls.map((call) => call.id), ["t1", "t2"]);
});

test("metrics expose host tool calls only when the transcript observed them", () => {
  assert.deepEqual(hostToolProfile([]), {
    measurement: "unavailable", source: null, total: null, byTool: null,
    byCategory: Object.fromEntries(TOOL_CALL_CATEGORIES.map((key) => [key, null]))
  });
  const generic = normalizeTelemetryRow("c1", {
    requestId: "g1", usage: { input_tokens: 1 }
  }, "generic");
  assert.equal(generic.toolCalls, undefined, "non-transcript sources carry no tool calls");
  assert.equal(hostToolProfile([generic]).measurement, "unavailable");
  const claude = normalizeTelemetryRow("c1", {
    type: "assistant", message: {
      role: "assistant", id: "m1", usage: { input_tokens: 1 },
      content: [{ type: "tool_use", id: "t1", name: "Bash",
        input: { command: "claude-foundation advance c1" } }]
    }
  }, "claude");
  const measured = hostToolProfile([claude]);
  assert.equal(measured.measurement, "measured");
  assert.equal(measured.total, 1);
  assert.equal(measured.byCategory.harnessCli, 1);
  const legacy = { ...claude, requestId: "m0" };
  delete legacy.toolCalls;
  const partial = hostToolProfile([legacy, claude]);
  assert.equal(partial.measurement, "partial",
    "rows imported before tool counting make the profile partial");
  assert.equal(partial.total, 1);
});
