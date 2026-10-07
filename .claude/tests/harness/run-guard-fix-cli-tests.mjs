// Regression seams for two Model Router V1 defects:
// - `sandbox apply --refresh` must route to applySandbox (it used to die on
//   any flag), while unknown flags and extra positionals still die.
// - `change validate` must run the OpenSpec strict lint when the CLI is
//   present, fail with its findings, and degrade to a warning when absent.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { routeRuntimeCommand } from "../../harness/runtime/core/cli-router.mjs";
import { createFlagParser } from "../../harness/runtime/core/cli-flags.mjs";
import {
  assertOpenSpecStrictValid, groundingTaskOverlapFindings,
  groundingInteractionRequirements, groundingMissingReadSourceRecovery,
  groundingPathRowShapeIssue,
  hasObservableSecurityControl,
  plannedGroundingPathEligible,
  plannedGroundingPathRecovery
} from "../../harness/runtime/workflow/change-validation.mjs";

const fail = (message) => { throw new Error(message); };
const { parseFlags, parseStrictCommandFlags } = createFlagParser({ fail });

{
  const schema = { boolean: ["force"], value: ["owner", "reason"] };
  assert.deepEqual(parseStrictCommandFlags([
    "change", "--force", "--owner", "agent", "--reason=contains=equals"
  ], "agents release", schema), {
    flags: { force: true, owner: "agent", reason: "contains=equals" },
    rest: ["change"]
  });
  assert.throws(() => parseStrictCommandFlags(
    ["--unknown"], "agents release", schema),
  /does not support --unknown[\s\S]*supported: --force, --owner <value>, --reason <value>/);
  assert.throws(() => parseStrictCommandFlags(
    ["--"], "agents release", {}), /does not support --<empty>[\s\S]*no flags/);
  assert.throws(() => parseStrictCommandFlags(
    ["--force", "--force"], "agents release", schema), /duplicate --force/);
  assert.throws(() => parseStrictCommandFlags(
    ["--force=yes"], "agents release", schema), /does not accept a value/);
  assert.throws(() => parseStrictCommandFlags(
    ["--owner"], "agents release", schema), /requires a value/);
  assert.throws(() => parseStrictCommandFlags(
    ["--owner", "--force"], "agents release", schema), /requires a value/);
}

async function route(command, values, overrides) {
  await routeRuntimeCommand(command, values, {
    parseFlags, parseStrictCommandFlags, fail, ...overrides
  });
}

for (const [command, method] of [["advance", "showAdvance"], ["land-advance", "advanceLand"]]) {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  let routed = false;
  const routing = route(command, ["change"], { [method]: () => pending })
    .then(() => { routed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(routed, false, `${command} must await its lifecycle operation`);
  finish();
  await routing;
  await assert.rejects(route(command, ["change"], {
    [method]: async () => { throw new Error("lifecycle failed asynchronously"); }
  }), /lifecycle failed asynchronously/);
}

{
  let observed = null;
  await route("handoff-list", [
    "--open", "--owner", "ops", "--environment", "production", "--json"
  ], {
    showHandoffStatus: (id, flags) => { observed = { id, flags }; }
  });
  assert.deepEqual(observed, {
    id: null,
    flags: {
      open: true, owner: "ops", environment: "production", json: true, list: true
    }
  });
  await assert.rejects(route("handoff-list", ["unexpected"], {
    showHandoffStatus: () => {}
  }), /takes no change id/);
}

// --- complete command-registry dispatch coverage ---
// Every registry entry is invoked through the public router. This makes a
// command that is lost while decomposing the router fail as a contract defect,
// and ensures a newly extracted handler is not accepted with zero coverage.
{
  const cases = [
    ["new", ["intent"], "createChange"],
    ["start", ["draft.json"], "startAtomic"],
    ["amend", ["change", "amendment.json"], "amendChange"],
    ["revise", ["change", "draft.json"], "reviseChange"],
    ["resolve", ["change"], "resolveChange"],
    ["abandon", ["change"], "abandonChange"],
    ["waive", ["change"], "waiveGate"],
    ["describe", ["change"], "describeCommand"],
    ["changes", [], "showChanges"],
    ["providers", [], "showProviders"],
    ["repos", ["change"], "showRepositories"],
    ["agent-plan", ["change"], "showAgentPlan"],
    ["agent-dispatch", ["change"], "showAgentDispatch"],
    ["agent-task", ["change", "task"], "showAgentTask"],
    ["agent-acquire", ["change", "resource"], "acquireAgentLease"],
    ["agent-release", ["change", "resource"], "releaseAgentLease"],
    ["packet", ["change"], "showPacket"],
    ["metrics", ["change"], "showMetrics"],
    ["advance", ["change"], "showAdvance"],
    ["exec", ["change", "--", "true"], "execObserved"],
    ["budget-checkpoint", ["change"], "checkpointBudget"],
    ["budget-continue", ["change"], "continueBudget"],
    ["doctor", [], "doctor"],
    ["validate", ["change"], "validate"],
    ["audit-change", ["change"], "showTraceabilityAudit"],
    ["proof-plan", ["change"], "proofPlan"],
    ["proof-readiness", ["change"], "proofReadiness"],
    ["proof-advance", ["change"], "proofAdvance"],
    ["proof-run", ["change"], "proofRun"],
    ["proof-collect", ["change"], "proofCollect"],
    ["proof-preflight", ["change"], "proofPreflight"],
    ["proof-execute", ["change"], "proofExecute"],
    ["evidence-detect", ["change"], "showEvidenceDetection"],
    ["evidence-init", ["change"], "initializeEvidence"],
    ["evidence-doctor", ["change"], "showEvidenceDoctor"],
    ["evidence-verify-ci", ["change", "provider", "ci"], "recordVerifiedCi"],
    ["authority-request", ["change"], "requestAuthority"],
    ["authority-dispatch", ["change"], "dispatchAuthority"],
    ["authority-run", ["change"], "runAuthorityReviewer"],
    ["authority-abort", ["change"], "abortAuthority"],
    ["authority-status", ["change"], "showAuthorityStatus"],
    ["authority-reset-infra", ["change"], "resetInfrastructureAuthority"],
    ["authority-reset-base-move", ["change"], "resetBaseMoveAuthority"],
    ["authority-record", ["change"], "recordAuthority"],
    ["evidence-upgrade", ["change"], "upgradeEvidence"],
    ["receipt", ["change", "provider", "pass"], "recordReceipt"],
    ["run-provider", ["change", "provider"], "runProvider"],
    ["prove", ["change"], "proofFinalize"],
    ["handoff-status", ["change"], "showHandoffStatus"],
    ["handoff-list", [], "showHandoffStatus"],
    ["handoff-packet", ["change"], "showHandoffPacket"],
    ["handoff-record", ["change"], "recordHandoff"],
    ["land-check", ["change"], "landCheck"],
    ["land-advance", ["change"], "advanceLand"],
    ["land-recover", ["change"], "recoverLand"],
    ["land-plan", ["change"], "showLandPlan"],
    ["land-record", ["change"], "recordRepositoryLand"],
    ["land-pointers", ["change"], "stageRootPointers"],
    ["land-resume", ["change"], "resumeLand"],
    ["archive", ["change"], "archive"],
    ["event", ["change"], "recordEvent"],
    ["telemetry-sync", ["change"], "syncClaudeTelemetry"],
    ["telemetry-import", ["change", "source"], "importTelemetry"],
    ["host-execution-import", ["change", "result.json"], "importHostExecution"],
    ["migrate", ["change"], "migrate"]
  ];
  for (const [command, values, method] of cases) {
    const calls = [];
    const implementation = (...args) => {
      calls.push(args);
      if (method === "execObserved") return 0;
    };
    await route(command, values, { [method]: implementation });
    assert.equal(calls.length, 1, `${command} must invoke ${method} exactly once`);
  }

  const policyCalls = [];
  await route("models", [], {
    foundationPolicy: () => { policyCalls.push(true); return { models: {} }; }
  });
  assert.equal(policyCalls.length, 1, "models must read foundation policy once");

  const hashCalls = [];
  await route("hash", ["change"], {
    relevantHash: (id) => { hashCalls.push(id); return "hash"; }
  });
  assert.deepEqual(hashCalls, ["change"]);

  const auditCalls = [];
  await route("proof-audit", ["change"], {
    proofAudit: (id) => { auditCalls.push(id); return { valid: true }; }
  });
  assert.deepEqual(auditCalls, ["change"]);

  await route("api-version", [], { runtimeApiVersion: "1" });
  await route("version", [], { version: "1.0.0" });

  const sandboxCases = [
    ["challenge", "createAttestationChallenge"],
    ["inspect", "showSandboxInspection"],
    ["create", "createSandbox"],
    ["sync", "syncSandbox"]
  ];
  for (const [operation, method] of sandboxCases) {
    const calls = [];
    await route("sandbox", [operation, "change"], {
      [method]: (...args) => calls.push(args)
    });
    assert.equal(calls.length, 1, `sandbox ${operation} must invoke ${method}`);
  }
  await assert.rejects(route("sandbox", ["unknown", "change"], {}),
    /sandbox requires challenge\|inspect\|create\|sync\|apply/);

  const packetCalls = [];
  const packetApi = {
    prepareClaudeTelemetry: (...args) => packetCalls.push(["prepare", ...args]),
    recordPhaseContext: (...args) => packetCalls.push(["phase", ...args]),
    showAgentTask: (...args) => packetCalls.push(["task", ...args]),
    showPacket: (...args) => packetCalls.push(["packet", ...args])
  };
  await route("packet", ["change", "--phase", "build"], packetApi);
  await route("packet", ["change", "--phase", "review"], packetApi);
  await route("packet", ["change", "--task", "T001"], packetApi);
  await route("packet", ["change", "--task", "T001", "--repo", "root"], packetApi);
  assert(packetCalls.some(([kind]) => kind === "prepare"));
  assert(packetCalls.some(([kind]) => kind === "task"));
  assert(packetCalls.some(([kind]) => kind === "packet"));
  await assert.rejects(route("packet", ["change", "--phase", "unknown"], packetApi),
    /packet --phase must be/);

  const execCalls = [];
  const execApi = { execObserved: (...args) => { execCalls.push(args); return 0; } };
  await route("exec", ["change"], execApi);
  await route("exec", ["change", "--phase", "build", "--", "true"], execApi);
  assert.equal(execCalls.length, 2);
  // A multi-repository change names the repository (or task) sandbox to run in.
  await route("exec", ["change", "--repo", "api", "--task", "T001", "--", "npm", "test",
    "--repo", "inner"], execApi);
  assert.deepEqual(execCalls[2], ["change", ["npm", "test", "--repo", "inner"], {
    phase: undefined, repository: "api", task: "T001"
  }]);
  await route("exec", ["change", "--repository", "web", "--", "true"], execApi);
  assert.equal(execCalls[3][2].repository, "web");
  await assert.rejects(route("exec", ["change", "--repo", "a", "--repository", "b"], execApi),
    /one of --repo and --repository/);
  await assert.rejects(route("exec", ["change", "--repo", " ", "--", "true"], execApi),
    /--repo requires a repository id/);
  await assert.rejects(route("exec", ["change", "--task", "  ", "--", "true"], execApi),
    /--task requires a task id/);
  await assert.rejects(route("exec", ["change", "--phase", "unknown"], execApi),
    /exec --phase must be/);
  await assert.rejects(route("exec", [], execApi), /exec requires a change id/);

  const invalidArity = [
    ["new", []], ["start", []], ["resolve", []], ["abandon", []],
    ["waive", []], ["agent-dispatch", []], ["budget-checkpoint", []],
    ["budget-continue", []],
    ["doctor", ["unexpected"]], ["audit-change", []], ["proof-advance", []],
    ["evidence-detect", []], ["evidence-init", []],
    ["evidence-verify-ci", ["change", "provider"]],
    ["authority-request", []], ["authority-dispatch", []],
    ["authority-run", []], ["authority-abort", []], ["authority-status", []],
    ["authority-reset-infra", []], ["authority-reset-base-move", []],
    ["authority-record", []], ["handoff-status", []], ["handoff-packet", []],
    ["handoff-record", []], ["host-execution-import", ["change"]]
  ];
  for (const [command, values] of invalidArity)
    await assert.rejects(route(command, values, {}), /requires|unexpected/,
      `${command} must reject invalid arity`);

  const templates = [];
  await route("start", ["--template"], {
    rapidStartTemplate: () => { templates.push(true); return {}; }
  });
  assert.equal(templates.length, 1);
  let consumedStart = null;
  await route("start", ["draft.json", "--consume-draft"], {
    startAtomic: (...args) => { consumedStart = args; }
  });
  assert.deepEqual(consumedStart, ["draft.json", { consumeDraft: true }]);
  let inspectedDraft = null;
  await route("start", ["draft.json", "--inspect"], {
    inspectDraft: (...args) => { inspectedDraft = args; }
  });
  assert.deepEqual(inspectedDraft, ["draft.json"]);
  await assert.rejects(route("start", ["draft.json", "--inspect", "--consume-draft"], {}),
    /cannot be combined/);
  let consumedAmendment = null;
  await route("amend", ["change", "amendment.json", "--consume-amendment"], {
    amendChange: (...args) => { consumedAmendment = args; }
  });
  assert.deepEqual(consumedAmendment,
    ["change", "amendment.json", { consumeAmendment: true }]);
  let inspectedAmendment = null;
  await route("amend", ["change", "amendment.json", "--inspect"], {
    inspectAmendment: (...args) => { inspectedAmendment = args; }
  });
  assert.deepEqual(inspectedAmendment, ["change", "amendment.json"]);
  await assert.rejects(route("amend", [
    "change", "amendment.json", "--inspect", "--consume-amendment"
  ], {}), /cannot be combined/);
  // The direct verify correction needs no amendment JSON.
  let correctedVerify = null;
  await route("amend", ["change", "--task", "T001", "--verify", "npm test -- --runInBand",
    "--reason", "typo"], {
    amendTaskVerify: (...args) => { correctedVerify = args; }
  });
  assert.deepEqual(correctedVerify, ["change",
    { task: "T001", verify: "npm test -- --runInBand", reason: "typo" }]);
  // --reopen unticks a completed task so the corrected check must pass again.
  await route("amend", ["change", "--task", "T001", "--verify", "go test -v ./...", "--reopen"], {
    amendTaskVerify: (...args) => { correctedVerify = args; }
  });
  assert.deepEqual(correctedVerify, ["change",
    { task: "T001", verify: "go test -v ./...", reason: undefined, reopen: true }]);
  await assert.rejects(route("amend", ["change", "--reopen"], {
    amendTaskVerify: () => {}
  }), /requires <change> --task <task-key\|task-id> --verify <command>/);
  await assert.rejects(route("amend", ["change", "--task", "T001"], {
    amendTaskVerify: () => {}
  }), /requires <change> --task <task-key\|task-id> --verify <command>/);
  await assert.rejects(route("amend", ["change", "amendment.json", "--task", "T001",
    "--verify", "npm test"], { amendTaskVerify: () => {} }), /requires <change> --task/);
  await assert.rejects(route("amend", ["change", "--task", "T001", "--verify", "npm test",
    "--inspect"], { amendTaskVerify: () => {} }), /cannot be combined/);
  let consumedRevision = null;
  await route("revise", ["change", "draft.json", "--consume-draft"], {
    reviseChange: (...args) => { consumedRevision = args; }
  });
  assert.deepEqual(consumedRevision, ["change", "draft.json", { consumeDraft: true }]);
  let inspectedRevision = null;
  await route("revise", ["change", "draft.json", "--inspect"], {
    inspectRevision: (...args) => { inspectedRevision = args; }
  });
  assert.deepEqual(inspectedRevision, ["change", "draft.json"]);
  // --merge reads the file as a partial draft, in both the inspect and revise forms.
  await route("revise", ["change", "patch.json", "--merge"], {
    reviseChange: (...args) => { consumedRevision = args; }
  });
  assert.deepEqual(consumedRevision, ["change", "patch.json", { consumeDraft: undefined, merge: true }]);
  await route("revise", ["change", "patch.json", "--merge", "--inspect"], {
    inspectRevision: (...args) => { inspectedRevision = args; }
  });
  assert.deepEqual(inspectedRevision, ["change", "patch.json", { merge: true }]);
  await assert.rejects(route("revise", [
    "change", "draft.json", "--inspect", "--consume-draft"
  ], {}), /cannot be combined/);
  await assert.rejects(route("revise", ["change"], {}), /requires <change> <draft.json>/);

  // One call: the agreement call records the user's approval and continues.
  for (const [command, values, method, result] of [
    ["start", ["draft.json"], "startAtomic", "change"],
    ["revise", ["change", "draft.json"], "reviseChange", { added: [] }],
    ["amend", ["change", "amendment.json"], "amendChange", { issues: [] }]
  ]) {
    const calls = [];
    await route(command, [...values, "--approve-spec", "--decision-ref", "chat://ok",
      "--through", "build"], {
      [method]: () => { calls.push(method); return result; },
      approvalQuestionAction: () => null,
      resolveChange: (id, flags) => { calls.push(["resolve", id, flags]); },
      showAdvance: (id, flags) => { calls.push(["advance", id, flags]); }
    });
    assert.deepEqual(calls, [method,
      ["resolve", "change", { "approve-spec": true, "decision-ref": "chat://ok" }],
      ["advance", "change", { through: "build" }]], `${command} approves in one call`);
    // An intake stop approves nothing.
    const stopped = [];
    await route(command, [...values, "--approve-spec", "--decision-ref", "chat://ok"], {
      [method]: () => ({ action: "EDIT", intakeState: { path: "x" } }),
      approvalQuestionAction: () => null,
      resolveChange: () => { stopped.push("resolve"); },
      showAdvance: () => { stopped.push("advance"); }
    });
    assert.deepEqual(stopped, [], `${command} does not approve an incomplete intake`);
    // Open questions become the user's questions instead of an approval.
    const asked = [];
    const priorLog = console.log;
    console.log = (line) => { asked.push(String(line)); };
    try {
      await route(command, [...values, "--approve-spec", "--decision-ref", "chat://ok"], {
        [method]: () => result,
        approvalQuestionAction: () => ({ action: "ASK_USER", code: "OPEN_QUESTIONS" }),
        resolveChange: () => { asked.push("resolve"); }
      });
    } finally { console.log = priorLog; }
    assert.deepEqual(asked, [JSON.stringify({ action: "ASK_USER", code: "OPEN_QUESTIONS" })]);
    await assert.rejects(route(command, [...values, "--approve-spec"], {
      [method]: () => result
    }), /--approve-spec requires --decision-ref/);
    await assert.rejects(route(command, [...values, "--decision-ref", "chat://ok"], {
      [method]: () => result
    }), /--decision-ref requires --approve-spec/);
    await assert.rejects(route(command, [...values, "--through", "build"], {
      [method]: () => result
    }), /--through requires --approve-spec/);
    await assert.rejects(route(command, [...values, "--approve-spec", "--decision-ref", "r",
      "--through", "land"], { [method]: () => result }), /--through must be build\|proven\|archived/);
    await assert.rejects(route(command, [...values, "--inspect", "--approve-spec",
      "--decision-ref", "r"], {}), /cannot be combined/);
  }
  // Without --approve-spec the existing single-call forms record nothing.
  {
    const calls = [];
    await route("revise", ["change", "draft.json"], {
      reviseChange: () => { calls.push("revise"); return { added: [] }; },
      resolveChange: () => { calls.push("resolve"); }
    });
    assert.deepEqual(calls, ["revise"]);
  }
  await assert.rejects(route("amend", ["change", "--task", "T001", "--verify", "npm test",
    "--approve-spec", "--decision-ref", "r"], { amendTaskVerify: () => {} }), /cannot be combined/);
  let advanced = null;
  await route("advance", ["change", "--through", "archived", "--pretty"], {
    showAdvance: (...args) => { advanced = args; }
  });
  assert.deepEqual(advanced, ["change", { through: "archived", pretty: true }]);
  await route("advance", ["change", "--inspect"], {
    showAdvance: (...args) => { advanced = args; }
  });
  assert.deepEqual(advanced, ["change", { inspect: true }]);
  await assert.rejects(route("advance", ["change", "--through", "invalid"], {}),
    /advance --through must be build\|proven\|archived/);
  // Approval and the requested target are one call, not two commands.
  const approvals = [];
  await route("advance", ["change", "--approve-spec", "--decision-ref", "user://ok",
    "--through", "build"], {
    resolveChange: (id, flags) => approvals.push([id, flags]),
    showAdvance: (...args) => { advanced = args; }
  });
  assert.deepEqual(approvals, [["change", { "approve-spec": true, "decision-ref": "user://ok" }]]);
  assert.deepEqual(advanced, ["change", { through: "build" }]);
  advanced = null;
  await route("advance", ["change", "--approve-spec", "--decision-ref", "user://ok"], {
    resolveChange: () => {}, showAdvance: (...args) => { advanced = args; }
  });
  assert.equal(advanced, null, "approval alone records and stops");
  // An interrupted Land apply is settled through advance under the user's
  // decision and Land continues in the same call.
  const recoveries = [];
  advanced = null;
  await route("advance", ["change", "--through", "archived", "--recover-apply", "keep-current",
    "--decision-ref", "user://keep"], {
    recoverLand: (id, flags) => recoveries.push([id, flags]),
    showAdvance: (...args) => { advanced = args; }
  });
  assert.deepEqual(recoveries, [["change", { "decision-ref": "user://keep", resolution: "keep-current" }]]);
  assert.deepEqual(advanced, ["change", { through: "archived" }]);
  await route("advance", ["change", "--recover-apply", "settle", "--decision-ref", "user://ok"], {
    recoverLand: (id, flags) => recoveries.push([id, flags]),
    showAdvance: () => assert.fail("recovery alone records and stops")
  });
  assert.deepEqual(recoveries.at(-1), ["change", { "decision-ref": "user://ok" }]);
  await assert.rejects(route("advance", ["change", "--recover-apply", "wipe"], { recoverLand: () => {} }),
    /settle\|keep-current\|restore-backup/);
  // Open questions turn an approval into the user's questions, never a refusal.
  const asked = [];
  const originalLog = console.log;
  console.log = (line) => asked.push(String(line));
  try {
    await route("advance", ["change", "--approve-spec", "--decision-ref", "user://ok",
      "--through", "build"], {
      approvalQuestionAction: (id, through) => ({ action: "ASK_USER", changeId: id, through }),
      resolveChange: () => assert.fail("approval is not recorded over open questions"),
      showAdvance: () => assert.fail("Build does not start over open questions")
    });
  } finally { console.log = originalLog; }
  assert.deepEqual(JSON.parse(asked[0]), { action: "ASK_USER", changeId: "change", through: "build" });
  await assert.rejects(route("advance", ["change", "--approve-spec", "--decision-ref", "r",
    "--inspect"], { resolveChange: () => {} }), /combines only with --decision-ref and --through/);
  await route("describe", ["--json"], { describeCommand: () => {} });
  await route("repos", [], { showRepositories: (value) => assert.equal(value, null) });
  await route("hash", ["change", "provider"], {
    providerWorkspaceHash: () => "provider-hash"
  });
  await assert.rejects(route("proof-audit", ["change"], {
    proofAudit: () => ({ valid: false, reason: "invalid" })
  }), /proof audit failed: invalid/);

  const originalExit = process.exit;
  try {
    process.exit = (code) => { throw new Error(`exit:${code}`); };
    await assert.rejects(route("not-a-command", [], { usage: () => {} }), /exit:1/);
  } finally {
    process.exit = originalExit;
  }
  const usageCalls = [];
  await route(undefined, [], { usage: () => usageCalls.push(true) });
  assert.equal(usageCalls.length, 1);
}

// --- sandbox apply routing ---
{
  const applied = [];
  await route("sandbox", ["apply", "--refresh", "my-change"], {
    applySandbox: (id, flags) => applied.push([id, flags])
  });
  assert.deepEqual(applied, [["my-change", { refresh: true }]],
    "--refresh must reach applySandbox as options.refresh");

  applied.length = 0;
  await route("sandbox", ["apply", "my-change"], {
    applySandbox: (id, flags) => applied.push([id, flags])
  });
  assert.deepEqual(applied, [["my-change", {}]],
    "plain apply still routes with no options");

  await assert.rejects(
    route("sandbox", ["apply", "--controlPlane", "x", "my-change"], {
      applySandbox: () => fail("must not route")
    }), /unknown|sandbox apply/i,
    "controlPlane stays internal and unparseable");

  await assert.rejects(
    route("sandbox", ["apply", "my-change", "extra"], {
      applySandbox: () => fail("must not route")
    }), /exactly one change/,
    "extra positionals still die");

  // The arity errors are about the argument, not about lifecycle state. Worded
  // as "requires exactly one change" they read as a precondition the project
  // has already met, so a run with exactly one active change was told it did
  // not have one. Every one of them has to name the id it is missing.
  await assert.rejects(
    route("evidence-doctor", [], { showEvidenceDoctor: () => fail("must not route") }),
    /requires exactly one change id/,
    "an arity error names the argument, not a project state");
}

// --- authority reset-infra routing ---
{
  const resets = [];
  await route("authority-reset-infra", ["my-change", "--decision-ref", "ref-1"], {
    resetInfrastructureAuthority: (id, flags) => resets.push([id, flags])
  });
  assert.deepEqual(resets, [["my-change", { "decision-ref": "ref-1" }]],
    "reset-infra must route the decision reference");
  await assert.rejects(
    route("authority-reset-infra", [], {
      resetInfrastructureAuthority: () => fail("must not route")
    }), /exactly one change/);
}

// --- validate-time OpenSpec strict lint ---
{
  const root = mkdtempSync(join(tmpdir(), "foundation-spec-lint-"));
  const changeDir = join(root, "openspec", "changes", "lint-change");
  mkdirSync(changeDir, { recursive: true });
  const stubDir = join(root, "bin");
  mkdirSync(stubDir, { recursive: true });
  const stub = join(stubDir, "openspec");
  const lintLog = join(root, "lint.log");
  const writeStub = (validateExit, message) => {
    writeFileSync(stub, `#!/bin/sh
if [ "$1" = "--version" ]; then echo "1.7.0"; exit 0; fi
printf 'lint\\n' >> "${lintLog}"
echo "${message}"
exit ${validateExit}
`);
    chmodSync(stub, 0o755);
  };
  const priorPath = process.env.PATH;
  try {
    process.env.PATH = `${stubDir}${delimiter}${priorPath}`;

    writeStub(1, "Requirement must contain SHALL or MUST");
    assert.throws(() =>
      assertOpenSpecStrictValid("lint-change", changeDir, fail),
    /strict validation failed[\s\S]*SHALL or MUST/,
    "a strict-lint failure must fail validate with the findings");

    writeStub(0, "Change 'lint-change' is valid");
    assertOpenSpecStrictValid("lint-change", changeDir, fail);

    // A pass is memoized per process by lint-input bytes and CLI identity:
    // identical bytes do not re-lint, any packet byte change does.
    const lints = () => readFileSync(lintLog, "utf8").split("\n").filter(Boolean).length;
    const before = lints();
    writeFileSync(join(changeDir, "proposal.md"), "# Proposal\n");
    assertOpenSpecStrictValid("lint-change", changeDir, fail);
    assertOpenSpecStrictValid("lint-change", changeDir, fail);
    assert.equal(lints(), before + 1, "unchanged lint inputs reuse one strict pass");
    writeFileSync(join(changeDir, "proposal.md"), "# Proposal\n\nRevised.\n");
    assertOpenSpecStrictValid("lint-change", changeDir, fail);
    assert.equal(lints(), before + 2, "a packet byte change re-runs strict lint");
    writeFileSync(join(root, "openspec", "config.yaml"), "schema: spec-driven\n");
    assertOpenSpecStrictValid("lint-change", changeDir, fail);
    assert.equal(lints(), before + 3, "a project OpenSpec input change re-runs strict lint");
    writeStub(1, "Requirement must contain SHALL or MUST");
    assert.throws(() => assertOpenSpecStrictValid("lint-change", changeDir, fail),
      /strict validation failed/, "a changed CLI re-lints and can fail the memoized bytes");
    assert.throws(() => assertOpenSpecStrictValid("lint-change", changeDir, fail),
      /strict validation failed/, "a failing lint is never memoized");
    assert.equal(lints(), before + 5, "every failing lint re-runs the CLI");

    // Absent CLI: PATH without the stub (and without any system openspec)
    // degrades to a warning instead of failing.
    process.env.PATH = stubDir === "/nonexistent" ? "" : "/nonexistent";
    assertOpenSpecStrictValid("lint-change", changeDir, fail);

    // Prove requires the lint: an absent CLI fails closed instead of letting
    // an unlinted agreement travel to archive.
    assert.throws(() =>
      assertOpenSpecStrictValid("lint-change", changeDir, fail, { requireCli: true }),
    /OpenSpec CLI is required for strict spec validation of 'lint-change' before Prove/,
    "a required strict lint must not skip silently when the CLI is absent");
  } finally {
    process.env.PATH = priorPath;
  }
}

// --- immutable grounding sources cannot also be implementation targets ---
{
  const findings = groundingTaskOverlapFindings([
    { repository: "root", path: ".claude/harness/AGENT.md", role: "requirement" },
    { repository: "root", path: ".claude/harness/README.md", role: "architecture" },
    { repository: "root", path: "src/runtime.mjs", role: "production-path" }
  ], [
    {
      id: "T001",
      done: false,
      text: "T001 update agent surfaces [kind:implementation] " +
        "[paths:.claude/harness/AGENT.md,.claude/harness/**]"
    }
  ]);
  assert.deepEqual(findings.map((row) => row.path), [
    ".claude/harness/AGENT.md", ".claude/harness/README.md"
  ]);
  assert.equal(findings.some((row) => row.path === "src/runtime.mjs"), false,
    "writable grounding roles must not conflict with implementation paths");
  const wildcard = groundingTaskOverlapFindings([
    {
      repository: "root",
      path: ".claude/harness/runtime/workflow/authority-runtime.mjs",
      role: "architecture"
    }
  ], [{
    id: "T002",
    done: false,
    text: "T002 edit authority [kind:implementation] " +
      "[paths:.claude/harness/runtime/workflow/authority*.mjs]"
  }]);
  assert.equal(wildcard.length, 1,
    "interior file wildcards must not bypass immutable grounding overlap checks");
}

// --- greenfield paths are declared, not created prematurely during Change ---
{
  const tasks = [{
    id: "T003", done: false,
    text: "T003 create app [kind:implementation] [paths:src/**,package.json]"
  }];
  const planned = {
    repository: "root", path: "src/index.js", role: "production-path",
    sha256: "planned"
  };
  assert.equal(plannedGroundingPathEligible(planned, false, tasks, true), true);
  assert.equal(plannedGroundingPathEligible(planned, true, tasks, true), false,
    "an existing path cannot evade its first-lock baseline digest");
  assert.equal(plannedGroundingPathEligible(planned, true, tasks, false), true,
    "the same declaration remains valid after Build creates the owned path");
  assert.equal(plannedGroundingPathEligible({
    ...planned, path: "other/index.js"
  }, false, tasks, true), false, "a task must own every planned path");
  assert.equal(plannedGroundingPathEligible({
    ...planned, role: "requirement"
  }, false, tasks, true), false, "immutable requirements still require a digest");
  assert.equal(plannedGroundingPathEligible({
    ...planned, path: "package.json", role: "dependency-source"
  }, false, tasks, true), false,
  "dependency sources cannot be both immutable evidence and planned writable paths");
  assert.equal(plannedGroundingPathRecovery(planned, false, [], true),
    "path is marked planned but no implementation or migration task owns it; " +
    "add [kind:implementation] [repo:root] [paths:src/index.js] to the owning " +
    "task (a matching glob is also valid), then keep sha256 as planned",
  "recovery must give authors the missing task annotation in one pass");
  assert.equal(plannedGroundingPathRecovery(planned, false, tasks, true), null,
    "owned planned paths need no recovery hint");
  assert.equal(plannedGroundingPathRecovery(planned, true, [], true), null,
    "existing paths need baseline-digest guidance instead");
  assert.equal(plannedGroundingPathRecovery({
    ...planned, path: "package.json", role: "requirement"
  }, false, [], true),
  "path is marked planned but role 'requirement' cannot own a new path; change role " +
    "to production-path|runtime-path|test-topology and add " +
    "[kind:implementation] [repo:root] [paths:package.json] to its owning task",
  "planned rows with immutable roles receive the complete role and task recovery");
  assert.equal(groundingPathRowShapeIssue("productionEntry.paths[0]", "src/index.js"),
    "productionEntry.paths[0] must be an object with repository and path, for example " +
    "{\"repository\":\"root\",\"path\":\"src/index.js\"}",
  "string rows must receive a concrete object-shape recovery");
  assert.equal(groundingPathRowShapeIssue("productionEntry.paths[0]", planned), null);
  assert.equal(groundingMissingReadSourceRecovery(
    "test/cli.test.js", "root", "test-topology"),
  "for a new path add {\"repository\":\"root\",\"path\":\"test/cli.test.js\"," +
    "\"role\":\"test-topology\",\"mode\":\"full\",\"sha256\":\"planned\"} to " +
    "readSet and add [kind:implementation] [repo:root] [paths:test/cli.test.js] " +
    "to its owning task",
  "missing readSet rows must receive both declarations needed for a greenfield path");
  assert.equal(hasObservableSecurityControl({
    id: "request-validation",
    scenario: "Malformed and oversized request bodies are refused with 400 or 413"
  }), true, "refused malformed input is an observable security negative path");
  assert.equal(hasObservableSecurityControl({
    id: "static-confinement",
    scenario: "Traversal requests are blocked before any file is read"
  }), true, "blocked traversal is an observable security control");
  assert.equal(hasObservableSecurityControl({
    id: "happy-path", scenario: "A todo is created and listed"
  }), false, "ordinary success claims must not satisfy security control grounding");
}

// --- local resilience is not misclassified as a distributed interaction ---
{
  assert.deepEqual(groundingInteractionRequirements({
    capabilities: ["test", "resilience"], semantics: "local atomic file recovery"
  }), { service: false, wire: false });
  assert.equal(groundingInteractionRequirements({
    capabilities: ["integration"]
  }).service, true);
  assert.equal(groundingInteractionRequirements({
    capabilities: ["resilience"], repositoryCount: 2
  }).service, true);
  assert.equal(groundingInteractionRequirements({
    capabilities: ["resilience"], semantics: "Kafka consumer retry"
  }).service, true);
  assert.equal(groundingInteractionRequirements({
    capabilities: ["compatibility"]
  }).wire, true);
}

console.log("guard-fix CLI seams: all cases passed");
