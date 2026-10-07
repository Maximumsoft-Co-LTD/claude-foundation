import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  createChangeLifecycle,
  initialChangeState,
  priorChangeResidue
} from "../runtime/workflow/change-lifecycle.mjs";

const root = mkdtempSync(join(tmpdir(), "foundation-change-creation-"));
const changesRoot = join(root, "openspec", "changes");
const templateNames = [
  "proposal.md", "tasks.md", "evidence.yaml", "execution.yaml",
  "repositories.yaml", "handoffs.yaml", "grounding.yaml", "design.md", "spec.md"
];
for (const schema of ["foundation-standard", "foundation-rapid"]) {
  const templateRoot = join(root, "openspec", "schemas", schema, "templates");
  mkdirSync(templateRoot, { recursive: true });
  for (const name of templateNames)
    writeFileSync(join(templateRoot, name), `${name}: <title> replace-with-stable-claim-id\n`);
}

let groundingRequired = true;
let states = [];
const operationIds = [];
const bindings = [];
const fail = (message) => { throw new Error(message); };
const lifecycle = createChangeLifecycle({
  root,
  policy: () => ({
    workflow: { grounding: groundingRequired ? "required" : "optional" },
    land: { riskBasedCi: true }
  }),
  securityTerms: [],
  fail,
  pathInside: () => true,
  readJson: () => ({}),
  writeJson: () => {},
  slugify: (value) => value.toLowerCase().replaceAll(" ", "-"),
  changePath: (id) => join(changesRoot, id),
  loadRuntime: () => ({}),
  saveRuntime: (state) => { states.push(state); },
  setOperationChangeId: (id) => { operationIds.push(id); },
  initialBudget: (schema, id) => ({ schema, id }),
  gitHead: () => "head",
  preexistingDirty: () => ({ tracked: ["existing"] }),
  now: (() => {
    let tick = 0;
    return () => `time-${++tick}`;
  })(),
  bindClaudeSession: (id, phase) => { bindings.push({ id, phase }); },
  validate: () => {},
  createSandbox: () => {},
  showPacket: () => {}
});

const priorLog = console.log;
const logs = [];
console.log = (message) => logs.push(String(message));
try {
  const standard = lifecycle.createChange("Standard Change", {});
  assert.equal(standard, "standard-change");
  assert.equal(states[0].schema, "foundation-standard");
  assert.equal(states[0].groundingRequired, true);
  assert.equal(states[0].groundingVersion, 2);
  assert.equal(states[0].riskBasedCiRequired, true);
  assert.equal(states[0].resolutionRequired, true);
  assert.equal(states[0].resolvedAt, null);
  assert.equal(states[0].acceptance.decision, "undecided");
  assert.equal(states[0].createdAt, "time-1");
  assert.equal(states[0].updatedAt, "time-2");
  assert.deepEqual(states[0].workspace.preexisting, { tracked: ["existing"] });
  assert.equal(existsSync(join(changesRoot, standard, "design.md")), true);
  assert.equal(existsSync(join(changesRoot, standard, "grounding.yaml")), true);
  assert.match(readFileSync(join(changesRoot, standard, "proposal.md"), "utf8"),
    /Standard Change standard-change-outcome/);
  assert.match(readFileSync(join(changesRoot, standard, ".openspec.yaml"), "utf8"),
    /^schema: foundation-standard/);
  assert.match(logs[0],
    /resolve decisions with change resolve standard-change before authoring or validation/);

  groundingRequired = false;
  const rapid = lifecycle.createChange("Rapid Change", { rapid: true, id: "rapid-id" });
  assert.equal(rapid, "rapid-id");
  assert.equal(states[1].schema, "foundation-rapid");
  assert.equal(states[1].impact, "low");
  assert.equal(states[1].coupling, "isolated");
  assert.equal(states[1].riskBasedCiRequired, false);
  assert.equal(states[1].resolutionRequired, false);
  assert.equal(states[1].resolvedAt, null);
  assert.equal(states[1].acceptance.decision, "not-required");
  assert.equal(existsSync(join(changesRoot, rapid, "design.md")), false);
  assert.equal(existsSync(join(changesRoot, rapid, "grounding.yaml")), false);
  assert.match(readFileSync(join(changesRoot, rapid, ".openspec.yaml"), "utf8"),
    /skip_specs: true/);
  assert.match(logs[1], /complete artifacts, validate, then \/build rapid-id/);
  assert.deepEqual(operationIds, ["standard-change", "rapid-id"]);
  assert.deepEqual(bindings, [
    { id: "standard-change", phase: "change" },
    { id: "rapid-id", phase: "change" }
  ]);

  assert.throws(() => lifecycle.createChange("Standard Change", {}), /already exists/);
  const residuePath = join(root, ".foundation", "runtime", "old.json");
  mkdirSync(dirname(residuePath), { recursive: true });
  writeFileSync(residuePath, "{}\n");
  assert.deepEqual(priorChangeResidue(root, "old"), [residuePath]);
  assert.throws(() => lifecycle.createChange("Old", {}), /recorded history remains.*runtime\/old.json/);
  // Review requests with no abandon record may belong to a live change: refuse.
  const leakedRequest = join(root, ".foundation", "authority", "leaked", "review-1.json");
  mkdirSync(dirname(leakedRequest), { recursive: true });
  writeFileSync(leakedRequest, "{}\n");
  assert.deepEqual(priorChangeResidue(root, "leaked"), [dirname(leakedRequest)]);
  assert.throws(() => lifecycle.createChange("Leaked", {}),
    /recorded history remains.*authority\/leaked/);
  assert.equal(existsSync(leakedRequest), true);
  // Review requests and reports a pre-fix abandon leaked beside its abandon
  // record are quarantined into that record, and the id is reused freshly.
  const abandoned = join(root, ".foundation", "recovery", "abandoned", "reabandoned");
  mkdirSync(abandoned, { recursive: true });
  writeFileSync(join(abandoned, "abandon.json"), "{}\n");
  mkdirSync(join(abandoned, "authority"), { recursive: true });
  const staleRequest = join(root, ".foundation", "authority", "reabandoned", "review-1.json");
  const staleReport = join(root, ".foundation", "reviews", "reabandoned", "r.json");
  for (const path of [staleRequest, staleReport]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{}\n");
  }
  lifecycle.createChange("Reabandoned", {});
  assert.equal(existsSync(join(changesRoot, "reabandoned")), true);
  assert.equal(existsSync(dirname(staleRequest)), false);
  assert.equal(existsSync(dirname(staleReport)), false);
  assert.equal(existsSync(join(abandoned, "authority", "review-1.json")), true);
  assert.equal(existsSync(join(abandoned, "reviews", "r.json")), true);
  assert.equal(readdirSync(abandoned).some((name) =>
    name.startsWith("authority.previous-")), true);

  // Instruction manifests, an open attestation challenge, and delivery state
  // are per-change bookkeeping too: without a retirement record they block
  // reuse, and with one they are settled into it (the delivery record kept).
  const strayManifest = join(root, ".foundation", "instruction-manifests", "stray", "build-T1.json");
  const strayChallenge = join(root, ".foundation", "attestations", "challenges", "stray.json");
  const strayDelivery = join(root, ".foundation", "deliveries", "stray", "state.json");
  for (const path of [strayManifest, strayChallenge, strayDelivery]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{}\n");
  }
  assert.deepEqual(priorChangeResidue(root, "stray"),
    [dirname(strayManifest), strayChallenge, dirname(strayDelivery)]);
  assert.throws(() => lifecycle.createChange("Stray", {}),
    /recorded history remains.*instruction-manifests\/stray.*challenges\/stray\.json.*deliveries\/stray/);
  assert.equal(existsSync(strayDelivery), true);
  const usedNonce = join(root, ".foundation", "attestations", "used", "digest.json");
  mkdirSync(dirname(usedNonce), { recursive: true });
  writeFileSync(usedNonce, "{}\n");
  const settled = join(root, ".foundation", "recovery", "abandoned", "stray");
  mkdirSync(settled, { recursive: true });
  writeFileSync(join(settled, "abandon.json"), "{}\n");
  writeFileSync(strayDelivery, "{\"url\":\"https://git.example/pr/7\"}\n");
  lifecycle.createChange("Stray", {});
  assert.equal(existsSync(join(changesRoot, "stray")), true);
  assert.deepEqual(priorChangeResidue(root, "stray"), []);
  assert.equal(existsSync(join(settled, "instruction-manifests", "build-T1.json")), true);
  assert.equal(existsSync(join(settled, "attestation-challenge.json")), true);
  assert.match(readFileSync(join(settled, "deliveries", "state.json"), "utf8"), /pr\/7/);
  assert.equal(existsSync(usedNonce), true, "the global nonce ledger is never settled");
  // A Land undo retires the id too: its record settles the same residue.
  const undone = join(root, ".foundation", "recovery", "land-undone", "redone");
  mkdirSync(undone, { recursive: true });
  writeFileSync(join(undone, "undo.json"), "{}\n");
  const undoneManifest = join(root, ".foundation", "instruction-manifests", "redone", "land-global.json");
  mkdirSync(dirname(undoneManifest), { recursive: true });
  writeFileSync(undoneManifest, "{}\n");
  lifecycle.createChange("Redone", {});
  assert.equal(existsSync(dirname(undoneManifest)), false);
  assert.equal(existsSync(join(undone, "instruction-manifests", "land-global.json")), true);
  // Live change state beside the bookkeeping is never settled.
  const liveManifest = join(root, ".foundation", "instruction-manifests", "live", "build-T1.json");
  const liveRuntime = join(root, ".foundation", "runtime", "live.json");
  for (const path of [liveManifest, liveRuntime]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{}\n");
  }
  mkdirSync(join(root, ".foundation", "recovery", "abandoned", "live"), { recursive: true });
  writeFileSync(join(root, ".foundation", "recovery", "abandoned", "live", "abandon.json"), "{}\n");
  assert.throws(() => lifecycle.createChange("Live", {}), /recorded history remains/);
  assert.equal(existsSync(liveManifest), true);

  const rapidState = initialChangeState({
    root, id: "direct", intent: "Direct", schema: "foundation-rapid",
    groundingRequired: false, riskBasedCi: true,
    gitHead: () => null, preexistingDirty: () => [],
    initialBudget: () => ({}), now: () => "now"
  });
  assert.equal(rapidState.nfrAssessmentRequired, false);
  assert.equal(rapidState.workspace.baseHead, null);
} finally {
  console.log = priorLog;
  rmSync(root, { recursive: true, force: true });
}
