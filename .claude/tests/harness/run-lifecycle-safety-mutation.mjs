import { spawnSync } from "node:child_process";
import {
  cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../../..");
const HOOK_DETECTOR = ["node", "--test", ".claude/tests/hooks/phase-guard-policy.test.mjs"];
const EXEC_DETECTOR = ["node", "--test", ".claude/harness/tests/exec-runtime.test.mjs"];
const SEMANTIC_DETECTOR = ["node", "--test", ".claude/harness/tests/semantic-draft.test.mjs"];
const TOPOLOGY_DETECTOR = ["node", "--test", ".claude/harness/tests/repository-topology.test.mjs"];
const SNAPSHOT_DETECTOR = ["node", "--test", ".claude/harness/tests/repository-snapshot.test.mjs"];
const INFRASTRUCTURE_DETECTOR = ["node", "--test", ".claude/harness/tests/repository-infrastructure-issues.test.mjs"];
const PROOF_VALUE_DETECTOR = ["node", "--test", ".claude/harness/tests/proof-readiness-value.test.mjs"];
const ADVANCE_DETECTOR = ["node", "--test", ".claude/harness/tests/advance-runtime.test.mjs"];
const SANDBOX_DETECTOR = ["node", "--test", ".claude/harness/tests/sandbox-create-phases.test.mjs"];
const PACKET_DETECTOR = ["node", ".claude/harness/tests/packet-value.test.mjs"];
const LAND_DETECTOR = ["node", "--test", ".claude/harness/tests/land-check-phases.test.mjs"];
const LAND_GRANT_DETECTOR = ["node", "--test", ".claude/harness/tests/land-grant.test.mjs"];
const APPLY_DETECTOR = ["node", ".claude/harness/tests/apply-sandbox-operation.test.mjs"];
const INSPECTION_DETECTOR = ["node", "--test", ".claude/harness/tests/workspace-inspection.test.mjs"];
const DIAGNOSTICS_DETECTOR = ["node", ".claude/harness/tests/diagnostics-runtime.test.mjs"];

const CASES = [
  {
    id: "MUT-LAND-GRANT-READINESS-SKIPPED",
    sourcePath: ".claude/harness/runtime/core/land-grant.mjs",
    expectedKiller: "CASE-LAND-GRANT-READINESS",
    detector: LAND_GRANT_DETECTOR,
    before: "landCheck(id);",
    after: "void id;"
  },
  {
    id: "MUT-LAND-DELIVERY-AUTHORITY-INFERRED",
    sourcePath: ".claude/harness/runtime/core/shell-mutation-policy.mjs",
    expectedKiller: "CASE-LAND-DELIVERY-AUTHORITY",
    detector: HOOK_DETECTOR,
    before: "if (phase === \"land\" && environment.FOUNDATION_LAND_TRANSACTION !== \"1\")\n    return \"Land shell mutations require the runtime transaction marker\";",
    after: "if (phase === \"land\" && environment.FOUNDATION_LAND_TRANSACTION !== \"1\" && command === null)\n    return \"Land shell mutations require the runtime transaction marker\";"
  },
  {
    id: "MUT-BUILD-ABSOLUTE-OPERAND-ALLOWED",
    sourcePath: ".claude/harness/runtime/core/shell-mutation-policy.mjs",
    expectedKiller: "CASE-BUILD-SHELL-CONTAINMENT",
    detector: HOOK_DETECTOR,
    before: "if (!within(workspace, absolute)) return true;",
    after: "if (!within(workspace, absolute)) return false;"
  },
  {
    id: "MUT-EXEC-WORKSPACE-CWD-REMOVED",
    sourcePath: ".claude/harness/runtime/observability/exec-runtime.mjs",
    expectedKiller: "CASE-EXEC-WORKSPACE-CWD",
    detector: EXEC_DETECTOR,
    before: "stdio: \"inherit\", cwd,",
    after: "stdio: \"inherit\","
  },
  {
    id: "MUT-AMENDMENT-TASK-CONTRACT-REPLACED",
    sourcePath: ".claude/harness/runtime/workflow/semantic-amendment.mjs",
    expectedKiller: "CASE-AMENDMENT-TASK-CONTRACT",
    detector: SEMANTIC_DETECTOR,
    before: "const unsupported = [\"outcome\", \"verify\"].filter((field) =>",
    after: "const unsupported = [].filter((field) =>"
  },
  {
    id: "MUT-SEMANTIC-REFERENCE-REALPATH-DROPPED",
    sourcePath: ".claude/harness/runtime/workflow/change-lifecycle.mjs",
    expectedKiller: "CASE-SEMANTIC-REFERENCE-CONTAINMENT",
    detector: SEMANTIC_DETECTOR,
    before: "const canonical = realpathSync(path);",
    after: "const canonical = resolve(path);"
  },
  {
    id: "MUT-SEMANTIC-REFERENCE-HTTPS-DROPPED",
    sourcePath: ".claude/harness/runtime/workflow/change-lifecycle.mjs",
    expectedKiller: "CASE-SEMANTIC-REFERENCE-HTTPS",
    detector: SEMANTIC_DETECTOR,
    before: "if (url.protocol !== \"https:\")",
    after: "if (false && url.protocol !== \"https:\")"
  },
  {
    id: "MUT-ISOLATED-REPOSITORY-TARGET-FALLBACK",
    sourcePath: ".claude/harness/runtime/workflow/repository-topology.mjs",
    expectedKiller: "CASE-ISOLATED-REPOSITORY-BINDING",
    detector: TOPOLOGY_DETECTOR,
    before: "if (options.useTargetPaths || !isolatedRepositoryState(state) ||\n      repository.id === \"root\") return null;",
    after: "if (true || options.useTargetPaths || !isolatedRepositoryState(state) ||\n      repository.id === \"root\") return null;"
  },
  {
    id: "MUT-MULTI-REPOSITORY-SNAPSHOT-COLLAPSED",
    sourcePath: ".claude/harness/runtime/workflow/repository-snapshot.mjs",
    expectedKiller: "CASE-MULTI-REPOSITORY-SNAPSHOT",
    detector: SNAPSHOT_DETECTOR,
    before: "if (!compositeRepositorySelection(selection))",
    after: "if (true || !compositeRepositorySelection(selection))"
  },
  {
    id: "MUT-PROOF-REPOSITORY-INFRASTRUCTURE-SKIPPED",
    sourcePath: ".claude/harness/runtime/evidence/proof-readiness.mjs",
    expectedKiller: "CASE-PROOF-REPOSITORY-INFRASTRUCTURE",
    detector: INFRASTRUCTURE_DETECTOR,
    before: "if (!gitHead(runtime.path))",
    after: "if (false && !gitHead(runtime.path))"
  },
  {
    id: "MUT-REPOSITORY-WORKTREE-OWNER-INVERTED",
    sourcePath: ".claude/harness/runtime/core/repository-binding.mjs",
    expectedKiller: "CASE-REPOSITORY-WORKTREE-OWNERSHIP",
    detector: TOPOLOGY_DETECTOR,
    before: "return Boolean(worktreeOwner && targetOwner && worktreeOwner === targetOwner);",
    after: "return Boolean(worktreeOwner && targetOwner && worktreeOwner !== targetOwner);"
  },
  {
    id: "MUT-PROOF-INCOMPLETE-REPOSITORY-BINDING-ALLOWED",
    sourcePath: ".claude/harness/runtime/evidence/proof-readiness.mjs",
    expectedKiller: "CASE-PROOF-COMPLETE-REPOSITORY-BINDING",
    detector: INFRASTRUCTURE_DETECTOR,
    before: "for (const field of [\"targetPath\", \"baseHead\", \"access\"])",
    after: "for (const field of [])"
  },
  {
    id: "MUT-PROOF-PRIMARY-BINDING-RESULT-OVERWRITTEN",
    sourcePath: ".claude/harness/runtime/evidence/proof-readiness.mjs",
    expectedKiller: "CASE-PROOF-PRIMARY-BINDING-ORDER",
    detector: INFRASTRUCTURE_DETECTOR,
    before: "if (issues.length) return [...new Set(issues)];",
    after: "if (false && issues.length) return [...new Set(issues)];"
  },
  {
    id: "MUT-PROOF-PREHASH-INFRASTRUCTURE-RECOVERY-DROPPED",
    sourcePath: ".claude/harness/runtime/evidence/proof-readiness.mjs",
    expectedKiller: "CASE-PROOF-INFRASTRUCTURE-BEFORE-HASH",
    detector: PROOF_VALUE_DETECTOR,
    before: "if (repositoryIssues.length)\n      return repositoryInfrastructureReadiness(\n        context, id, stage, repositoryIssues, error);",
    after: "if (false && repositoryIssues.length)\n      return repositoryInfrastructureReadiness(\n        context, id, stage, repositoryIssues, error);"
  },
  {
    id: "MUT-ADVANCE-FAILURE-ENVELOPE-GENERIC",
    sourcePath: ".claude/harness/runtime/workflow/advance-runtime.mjs",
    expectedKiller: "CASE-ADVANCE-EXACT-FAILURE-ENVELOPE",
    detector: ADVANCE_DETECTOR,
    before: "const dispatch = agentDispatchValue(id, options);",
    after: "const dispatch = (() => {\n          try { return agentDispatchValue(id, options); }\n          catch { return { action: \"unavailable\", reason: \"build-dispatch-unavailable\" }; }\n        })();"
  },
  {
    id: "MUT-ADVANCE-PREFLIGHT-HASH-REPEATED",
    sourcePath: ".claude/harness/runtime/workflow/advance-runtime.mjs",
    expectedKiller: "CASE-ADVANCE-PREFLIGHT-HASH-OWNERSHIP",
    detector: ADVANCE_DETECTOR,
    before: "const workspaceHash = dispatch.action === \"build-complete\" && proofPreflight\n          ? proofPreflight.workspaceHash : relevantHash(id);",
    after: "const workspaceHash = relevantHash(id);"
  },
  {
    id: "MUT-ADVANCE-FIXED-CYCLE-LIMIT",
    sourcePath: ".claude/harness/runtime/workflow/advance-runtime.mjs",
    expectedKiller: "CASE-ADVANCE-SEMANTIC-CONVERGENCE",
    detector: ADVANCE_DETECTOR,
    before: "while (true) {",
    after: "for (let cycle = 0; cycle < 32; cycle += 1) {"
  },
  {
    id: "MUT-PARTIAL-SANDBOX-RECOVERY-SKIPPED",
    sourcePath: ".claude/harness/runtime/workflow/sandbox-runtime.mjs",
    expectedKiller: "CASE-PARTIAL-SANDBOX-RECOVERY",
    detector: SANDBOX_DETECTOR,
    before: "if (existsSync(expectedPath)) {",
    after: "if (false && existsSync(expectedPath)) {"
  },
  {
    id: "MUT-REVIEW-PACKET-BASE-DIVERGED",
    sourcePath: ".claude/harness/runtime/workflow/packet-runtime.mjs",
    expectedKiller: "CASE-REVIEW-PACKET-REPOSITORY-BASE",
    detector: PACKET_DETECTOR,
    before: "baseHead: repositoryBaseHead(repository, state),",
    after: "baseHead: state.repositories?.[repositoryId]?.baseHead || null,"
  },
  {
    id: "MUT-SINGLE-CHILD-LAND-DOWNGRADED",
    sourcePath: ".claude/harness/runtime/workflow/land-runtime.mjs",
    expectedKiller: "CASE-SINGLE-CHILD-LAND-SAGA",
    detector: LAND_DETECTOR,
    before: "const state = loadRuntime(id);\n  const multiRepository = compositeRepositorySelection(selectedRepositories(id, state));",
    after: "const state = loadRuntime(id);\n  const multiRepository = Object.keys(state.repositories || {}).length > 1;"
  },
  {
    id: "MUT-SINGLE-CHILD-LOCAL-APPLY-ALLOWED",
    sourcePath: ".claude/harness/runtime/workflow/apply-runtime.mjs",
    expectedKiller: "CASE-SINGLE-CHILD-LOCAL-APPLY",
    detector: APPLY_DETECTOR,
    before: "if (emptyRootDiffPermitted(initialState) && !options.controlPlane)",
    after: "if (Object.keys(initialState.repositories || {}).length > 1 && !options.controlPlane)"
  },
  {
    id: "MUT-REPOSITORY-INSPECTION-OMITS-MISSING",
    sourcePath: ".claude/harness/runtime/workflow/sandbox-runtime.mjs",
    expectedKiller: "CASE-REPOSITORY-INSPECTION-COMPLETENESS",
    detector: INSPECTION_DETECTOR,
    before: "const ids = new Set([...Object.keys(records), ...expected]);",
    after: "const ids = new Set(Object.keys(records));"
  },
  {
    id: "MUT-EXTERNAL-NON-GIT-DIAGNOSTIC-PASSES",
    sourcePath: ".claude/harness/runtime/core/diagnostics-runtime.mjs",
    expectedKiller: "CASE-EXTERNAL-REPOSITORY-REQUIRES-GIT",
    detector: DIAGNOSTICS_DETECTOR,
    before: "const initialized = available && Boolean(gitHead(repository.path));",
    after: "const initialized = available && (repository.type === \"external\" || Boolean(gitHead(repository.path)));"
  }
];

function execute([command, ...args], cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8", timeout: 300000 });
}

function exactReplace(source, before, after) {
  const pieces = source.split(before);
  return pieces.length === 2 ? `${pieces[0]}${after}${pieces[1]}` : null;
}

const fixture = mkdtempSync(join(tmpdir(), "foundation-lifecycle-mutants-"));
const output = resolve(process.env.FOUNDATION_RESULT_REPORT ||
  ".foundation/test-results/quality/semantic-suites/SEM-LIFECYCLE-SAFETY.json");
try {
  cpSync(join(ROOT, ".claude"), join(fixture, ".claude"), { recursive: true });
  const baselines = new Map();
  for (const detector of [
    HOOK_DETECTOR, EXEC_DETECTOR, SEMANTIC_DETECTOR, TOPOLOGY_DETECTOR,
    SNAPSHOT_DETECTOR, INFRASTRUCTURE_DETECTOR, PROOF_VALUE_DETECTOR,
    ADVANCE_DETECTOR, SANDBOX_DETECTOR,
    PACKET_DETECTOR, LAND_DETECTOR, LAND_GRANT_DETECTOR, APPLY_DETECTOR, INSPECTION_DETECTOR,
    DIAGNOSTICS_DETECTOR
  ]) {
    const key = detector.join("\0");
    if (!baselines.has(key)) baselines.set(key, execute(detector, fixture));
    if (baselines.get(key).status !== 0)
      throw new Error(`clean baseline failed: ${detector.join(" ")}\n${baselines.get(key).stderr}`);
  }

  const mutants = [];
  for (const item of CASES) {
    const sourcePath = join(fixture, item.sourcePath);
    const original = readFileSync(sourcePath, "utf8");
    const mutated = exactReplace(original, item.before, item.after);
    const applied = mutated !== null;
    let compiled = false;
    let result = "survived";
    let killedBy = "";
    try {
      if (applied) {
        writeFileSync(sourcePath, mutated);
        compiled = execute(["node", "--check", item.sourcePath], fixture).status === 0;
        if (compiled && execute(item.detector, fixture).status !== 0) {
          result = "killed";
          killedBy = item.expectedKiller;
        }
      }
    } finally {
      writeFileSync(sourcePath, original);
    }
    mutants.push({
      id: item.id,
      description: `${item.id} deliberate lifecycle-safety fault`,
      sourcePath: item.sourcePath,
      applied,
      compiled,
      result,
      expectedKiller: item.expectedKiller,
      killedBy,
      restored: readFileSync(sourcePath, "utf8") === original
    });
  }

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({
    protocol: "foundation-mutation-v2",
    criticalCases: CASES.map((item) => ({ id: item.expectedKiller, status: "passed" })),
    mutants
  }, null, 2)}\n`);
  const killed = mutants.filter((mutant) => mutant.result === "killed").length;
  process.stdout.write(`lifecycle safety mutation: ${killed}/${mutants.length} killed\n`);
  if (!mutants.every((mutant) => mutant.applied && mutant.compiled && mutant.restored &&
      mutant.result === "killed" && mutant.killedBy === mutant.expectedKiller))
    process.exitCode = 1;
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
