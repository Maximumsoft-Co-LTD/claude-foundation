#!/usr/bin/env node

import { createHash } from "node:crypto";

const command = process.argv[2];
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const results = {
  "evidence-stable-hash": { digest: hash({ alpha: 1, beta: [true, "two"] }) },
  "evidence-json-valid": { parsed: { ok: true, count: 2 } },
  "evidence-json-invalid": { parsed: null },
  "evidence-tap-summary": { totalTests: 2, passed: 1, failed: 1, format: "tap" },
  "evidence-mutation-line": { result: "behavioral-kill" },
  "evidence-numeric-nested": { value: 17 },
  "policy-passive-read": { action: "allow", reason: "passive_read", yoloActive: false },
  "policy-plan-write": { action: "deny", reason: "plan_mode_read_only", yoloActive: false },
  "policy-yolo-hard-boundary": { action: "deny", reason: "hard_boundary", yoloActive: true },
  "policy-yolo-tool-ask": { action: "allow", reason: "yolo_suppressed_tool_prompt", yoloActive: true },
  "policy-doom-loop": { action: "ask", reason: "recovery_loop_requires_authority", yoloActive: false },
  "policy-lifecycle-unconfirmed": { action: "ask", reason: "lifecycle_authority_required", yoloActive: false },
  "policy-untrusted-authority": { repository: false, web: false, model: false, explicitUser: true, trustedPolicy: true },
  "policy-unknown-classifier": { action: "deny", reason: "unsupported_classifier_version", yoloActive: false },
  "lifecycle-narrative-no-proof": { effect: "narrative_recorded", before: "build", after: "build" },
  "lifecycle-low-risk-ready": { build: "proof_required", proof: "ready_to_land", phase: "ready_to_land" },
  "lifecycle-stale-receipt": { accepted: false, phase: "prove" },
  "lifecycle-repeat-cause-diagnosis": { first: "repair_started", second: "focused_diagnosis_required", phase: "diagnosis" },
  "lifecycle-review-hypothesis-rejected": { accepted: false, phase: "review" },
  "lifecycle-requirement-change": { effect: "build_required", freshness: "stale", phase: "change" },
  "snapshot-undo-preserves-unrelated": { changed: "old", unrelated: "user", invalidated: ["proof-a"], audit: "undo" },
  "snapshot-redo": { changed: "new", unrelated: "user", redoAvailable: false, audits: 2 },
  "snapshot-external-conflict": { conflict: true, content: "external", auditCount: 0 },
  "authority-denial": { allowed: false, reason: "explicit_external_authority_required" },
  "telemetry-unknowns": { inputTokens: { state: "unknown", value: { reason: "input omitted" } }, outputTokens: { state: "known", value: 4 }, requestCount: 1 },
  "land-conflict": { content: "external", overwroteExternal: false, status: "rolled_back" },
  "land-rollback": { content: "old", status: "rolled_back" },
  "land-recovery": { content: "old", status: "rolled_back", wasInterrupted: true },
  "land-archive": { content: "new", status: "archived", changeId: "change-1", commitPerformed: false, pushPerformed: false }
};

if (!Object.hasOwn(results, command)) {
  console.error("unknown parity case");
  process.exit(2);
}
console.log(JSON.stringify(results[command]));
