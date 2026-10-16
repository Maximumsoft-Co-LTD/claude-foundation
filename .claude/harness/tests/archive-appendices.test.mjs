import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync,
  writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { archiveAppendixMarkdown, createApplyRuntime } from "../runtime/workflow/apply-runtime.mjs";
import { postReleaseRolloutGates } from "../runtime/workflow/change-validation.mjs";
import {
  complianceEnabledFromConfig, renderReviewRecord
} from "../runtime/workflow/validation/process-fields.mjs";

const ID = "ship-widget";
const ARCHIVED = join("openspec", "changes", "archive", `2026-10-15-${ID}`);
const PROPOSAL = "# Proposal\n\n## Why\n\nShip the widget.\n\n## Definition of done\n\n- archived\n";
const fail = (message) => { throw new Error(message); };

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function quiet(fn) {
  const { log, error } = console;
  console.log = () => {};
  console.error = () => {};
  try { return fn(); } finally { console.log = log; console.error = error; }
}

const reviewAttempts = [
  { attempt: 1, status: "completed", reviewerIdentity: "codex-reviewer", resultStatus: "fail",
    findings: [
      { id: "F1", severity: "major", message: "missing null check", path: "src/a.mjs", line: 12 },
      { id: "F2", severity: "minor", message: "unclear name" }
    ] },
  { attempt: 2, status: "completed", reviewerIdentity: "foundation-repair-closure",
    resultStatus: "pass", findings: [], verifiedFindingIds: ["F1"] }
];

function fixture({ config = "schema: foundation-standard\n", draft = {}, attempts = [],
  providers = {}, specApproval = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "archive-appendices-"));
  const change = join(root, "openspec", "changes", ID);
  write(join(change, "proposal.md"), PROPOSAL);
  write(join(root, "openspec", "config.yaml"), config);
  write(join(root, ".foundation", "proof", `${ID}.json`), JSON.stringify({ proofRunId: "run" }));
  const bin = join(root, "bin");
  write(join(bin, "openspec"), [
    "#!/bin/sh",
    "mkdir -p openspec/changes/archive",
    `mv "openspec/changes/$2" "openspec/changes/archive/2026-10-15-$2"`
  ].join("\n"));
  chmodSync(join(bin, "openspec"), 0o755);
  const state = {
    id: ID, status: "proven", workspace: { mode: "direct" },
    draftSource: { contractRevision: 0, draft },
    ...(specApproval ? { specApproval } : {})
  };
  let activeAtArchive = null;
  const evidence = () => ({ providers });
  const providerCapability = (_name, config) => config.capability;
  const runtime = createApplyRuntime({
    root,
    loadRuntime: () => state,
    saveRuntime: () => {},
    changePath: (id) => join(root, "openspec", "changes", id),
    proofPath: (id) => join(root, ".foundation", "proof", `${id}.json`),
    readJson: (path, fallback) => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback,
    syncClaudeTelemetry: () => {},
    modelUsageRecorded: () => true,
    verifyAppliedProjection: () => ({ valid: true }),
    cleanupApplyTransaction: () => ({ status: "committed" }),
    cleanupAppliedSandbox: () => ({ status: "removed" }),
    cleanupRepositorySandboxes: () => ({ status: "removed" }),
    recoverPendingApply: () => {},
    landCheck: () => ({ archived: false, state, hash: "hash",
      assurance: { status: "passed", workspaceHash: "hash", acceptedBy: "explicit-land-authority" } }),
    assertMultiRepositoryArchiveReady: () => {},
    archivedChangeRelativePath: () => existsSync(join(root, ARCHIVED)) ? ARCHIVED : null,
    pendingTasks: () => [],
    assertOpenSpecCli: () => {},
    proofAudit: () => ({ valid: true }),
    cleanupChangeLeases: () => {},
    now: () => "2026-10-15T00:00:00.000Z",
    fail,
    reviewAttemptRecords: () => attempts,
    rolloutGates: (id) => postReleaseRolloutGates({ evidence, providerCapability }, id),
    archiveCheckpoint: (name) => {
      if (name === "before-archive-command")
        activeAtArchive = readFileSync(join(change, "proposal.md"), "utf8");
    }
  });
  return {
    root, state,
    activeAtArchive: () => activeAtArchive,
    archived: () => readFileSync(join(root, ARCHIVED, "proposal.md"), "utf8"),
    run() {
      const path = process.env.PATH;
      process.env.PATH = `${bin}:${path}`;
      try { return quiet(() => runtime.archive(ID)); } finally { process.env.PATH = path; }
    }
  };
}

test("archived proposal gains a review appendix with one row per finding", () => {
  const land = fixture({ attempts: reviewAttempts });
  land.run();
  assert.equal(land.state.status, "archived");
  const archived = land.archived();
  assert.ok(archived.startsWith(PROPOSAL), "the agreed proposal text is kept byte for byte");
  const appendix = archived.slice(archived.indexOf("## Appendix: Review record"));
  assert.match(appendix, /\| Round \| Finding \| Severity \| Fix \| Reviewer \|/);
  const rows = appendix.split("\n").filter((line) => /^\| 1 \|/.test(line));
  assert.equal(rows.length, 2);
  assert.match(rows[0], /F1: missing null check \(src\/a\.mjs:12\) \| major \| verified in round 2 \| codex-reviewer/);
  assert.match(rows[1], /F2: unclear name \| minor \| resolved by round 2 \| codex-reviewer/);
});

test("the active packet holds no volatile appendix before Land", () => {
  const land = fixture({ attempts: reviewAttempts,
    config: "schema: foundation-standard\ncompliance: change-record\n",
    draft: { compliance: { requester: "pm", approver: "lead", implementer: "agent", approvedBefore: "build" } },
    providers: { "release-health": { capability: "release-health" } } });
  land.run();
  assert.equal(land.activeAtArchive(), PROPOSAL);
  assert.match(land.archived(), /## Appendix: Review record/);
});

test("compliance appendix only when openspec/config.yaml enables it", () => {
  const compliance = { requester: "pm", approver: "lead", implementer: "agent", approvedBefore: "build" };
  const off = fixture({ draft: { compliance }, attempts: reviewAttempts });
  off.run();
  assert.doesNotMatch(off.archived(), /Compliance change record/);

  const on = fixture({ draft: { compliance },
    config: "schema: foundation-standard\ncompliance: change-record\n",
    specApproval: { required: true, decisionRef: "decision:approve-spec-1" } });
  on.run();
  const archived = on.archived();
  assert.match(archived, /## Appendix: Compliance change record/);
  assert.match(archived, /\| Approver \| lead \|/);
  assert.match(archived, /Spec approval decision: `decision:approve-spec-1`/);
});

test("post-release release-health archives and is listed as a deferred rollout gate", () => {
  const land = fixture({ providers: {
    "release-health": { capability: "release-health" },
    unit: { capability: "unit" }
  } });
  land.run();
  assert.equal(land.state.status, "archived");
  const archived = land.archived();
  assert.match(archived, /## Appendix: Rollout gates/);
  assert.match(archived, /\| release-health \| release-health \| post-release \| deferred \|/);
  assert.doesNotMatch(archived, /\| unit \|/);
});

test("no review, no compliance, no rollout gate leaves the archived proposal untouched", () => {
  const land = fixture();
  land.run();
  assert.equal(land.archived(), PROPOSAL);
});

test("a resumed Land restores the archived packet before re-appending once", () => {
  const land = fixture({ attempts: reviewAttempts });
  land.run();
  const once = land.archived();
  // Simulate a crash after the append but before delivery integrity was bound.
  delete land.state.deliveryIntegrity;
  land.state.specSyncInputs = [];
  const runtime = createApplyRuntime({
    root: land.root, loadRuntime: () => land.state, saveRuntime: () => {},
    changePath: (id) => join(land.root, "openspec", "changes", id),
    archivedChangeRelativePath: () => ARCHIVED,
    pathIdentity: (path) => statSync(path).isDirectory() ? "dir"
      : createHash("sha256").update(readFileSync(path)).digest("hex"),
    cleanupAppliedSandbox: () => ({ status: "removed" }),
    cleanupApplyTransaction: () => ({ status: "committed" }),
    cleanupChangeLeases: () => {}, now: () => "t", fail
  });
  land.state.workspace.cleanup = { status: "removed" };
  quiet(() => runtime.archive(ID));
  assert.equal(land.archived(), once);
  assert.equal(land.archived().split("## Appendix: Review record").length, 2);
});

test("Thai packets get Thai appendix headings and labels", () => {
  const markdown = archiveAppendixMarkdown({ language: "th", reviewAttempts,
    rolloutGates: [{ provider: "release-health", capability: "release-health" }] });
  assert.match(markdown, /## ภาคผนวก: ผล review/);
  assert.match(markdown, /\| รอบ \| ข้อค้นพบ \| ความรุนแรง \| การแก้ไข \| ผู้ review \|/);
  assert.match(markdown, /## ภาคผนวก: gate ของ rollout/);
});

test("compliance config key and review rendering edge cases", () => {
  assert.equal(complianceEnabledFromConfig("compliance: change-record\n"), true);
  assert.equal(complianceEnabledFromConfig("compliance: true # on\n"), true);
  assert.equal(complianceEnabledFromConfig("compliance: off\n"), false);
  assert.equal(complianceEnabledFromConfig("rules:\n  compliance: change-record\n"), false);
  assert.equal(complianceEnabledFromConfig(""), false);
  assert.equal(renderReviewRecord([]), "");
  assert.match(renderReviewRecord([{ attempt: 1, status: "completed", reviewerType: "ai", findings: [] }]),
    /\| 1 \| No findings \|/);
  assert.equal(renderReviewRecord([{ attempt: 1, status: "dispatched", findings: [] }]), "");
});
