import assert from "node:assert/strict";
import test from "node:test";
import {
  WORK_TYPE_FIELDS,
  renderBugfix,
  renderDependencyChange,
  renderDeprecationPlan,
  renderExperimentDesign,
  renderInfraPlan,
  renderModelCard,
  renderPrivacyAssessment,
  renderReleasePlan,
  renderIntegrations,
  renderLibraryContract,
  renderMigrationPlan,
  renderPerformanceAnalysis,
  renderRefactor,
  validateBugfix,
  validateDependencyChange,
  validateDeprecationPlan,
  validateExperimentDesign,
  validateInfraPlan,
  validateModelCard,
  validatePrivacyAssessment,
  validateReleasePlan,
  validateIntegrations,
  validateLibraryContract,
  validateMigrationPlan,
  validatePerformanceAnalysis,
  validateRefactor,
} from "../runtime/workflow/validation/work-type-fields.mjs";
import { workTypeSignalIssues } from "../runtime/workflow/validation/dev-document.mjs";

// The webhook lane declared feature for an outbound integration and so got no
// integration contract; typed signals now name the missing type.
test("a declared work type missing the type its typed signals require is an issue", () => {
  const issues = workTypeSignalIssues({ workType: ["feature"], riskSignals: ["external-integration"] });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /workType \[feature\] lacks 'integration'.*riskSignals external-integration/);
  assert.match(issues[0], /workTypeExamples/);
  assert.match(workTypeSignalIssues({ workType: ["feature"], integrations: [{ name: "stripe" }] })[0],
    /lacks 'integration'/);
  assert.match(workTypeSignalIssues({ workType: ["api"], riskSignals: ["performance-slo"] })[0],
    /lacks 'performance'/);
  // Declared correctly: nothing to repair.
  assert.deepEqual(workTypeSignalIssues({ workType: ["feature", "integration"],
    riskSignals: ["external-integration"], integrations: [{ name: "stripe" }] }), []);
  // Undeclared work keeps path inference and is never asked to declare.
  assert.deepEqual(workTypeSignalIssues({ riskSignals: ["external-integration"] }), []);
  // Other signals name no type.
  assert.deepEqual(workTypeSignalIssues({ workType: ["feature"], riskSignals: ["access-control"] }), []);
});

const oldBugfix = {
  reproduction: "POST /orders twice within 1s", rootCause: "missing unique index on order key",
  regression: "orders.test.js duplicate submit fails before fix",
};
const disclosure = {
  vulnerabilityClass: "IDOR", affectedVersions: "<2.4.1", exploitability: "authenticated user",
  owner: "security", embargo: "until 2026-11-01", advisory: "GHSA pending", backport: ["release/2.3"],
};
const library = {
  package: "@acme/parser", semver: "minor", runtimes: ["node 20", "node 22"],
  symbols: [{ name: "parse", signature: "parse(text: string): Ast", errors: "ParseError", change: "added" }],
  exitCodes: [{ code: 0, meaning: "ok" }, { code: 2, meaning: "invalid input" }],
  changelog: "Adds parse",
};
const migration = {
  from: "v1 jobs", to: "queue service", seam: "JobPort", dualRun: "shadow traffic 7 days",
  parity: { check: "same results", tolerance: "0" }, cutover: "7 days parity",
  rollbackWindow: "14 days", decommissionTask: "T009",
};
const performance = {
  baseline: { value: "p95 480ms", method: "k6 5 runs" }, profile: "flamegraph shows ORM", hypothesis: "N+1 query",
  target: "p95 < 200ms", benchmark: { runs: 5, variance: "±3%", environment: "staging m5.large" },
  tradeoffs: "+20MB cache", regressionBudget: "p95 +5%",
};

test("WORK_TYPE_FIELDS exposes validate and render for each field", () => {
  assert.deepEqual(Object.keys(WORK_TYPE_FIELDS),
    ["bugfix", "refactor", "libraryContract", "migrationPlan", "integrations", "performanceAnalysis",
      "dependencyChange", "deprecationPlan", "infraPlan", "privacyAssessment", "experimentDesign", "releasePlan",
      "modelCard"]);
  for (const field of Object.values(WORK_TYPE_FIELDS)) {
    assert.equal(typeof field.validate, "function");
    assert.equal(typeof field.render, "function");
    assert.equal(field.render(undefined, { language: "en" }), "");
  }
});

test("old bugfix shape passes and renders its content", () => {
  assert.deepEqual(validateBugfix(oldBugfix), []);
  const body = renderBugfix(oldBugfix, { language: "en" });
  assert.match(body, /\| Part \| Detail \|/);
  assert.match(body, /\| Reproduction \| POST \/orders twice within 1s \|/);
  assert.match(body, /\| Root cause \| missing unique index on order key \|/);
  assert.match(body, /\| Regression proof \| orders\.test\.js duplicate submit fails before fix \|/);
  assert.doesNotMatch(body, /Disclosure|Hotfix|object Object/);
});

test("security bugfix renders Disclosure after the analysis", () => {
  const value = { ...oldBugfix, variant: "security", disclosure };
  assert.deepEqual(validateBugfix(value), []);
  const body = renderBugfix(value, { language: "en" });
  assert.ok(body.indexOf("### Disclosure") > body.indexOf("Root cause"));
  assert.match(body, /\| Vulnerability class \| IDOR \|/);
  assert.match(body, /\| Backport targets \| release\/2\.3 \|/);
});

test("security bugfix without disclosure is an issue", () => {
  assert.deepEqual(validateBugfix({ ...oldBugfix, variant: "security" }),
    ["bugfix.disclosure is required for a security bugfix"]);
  assert.deepEqual(validateBugfix({ ...oldBugfix, variant: "security", disclosure: { owner: "sec" } }), [
    "bugfix.disclosure.vulnerabilityClass is required", "bugfix.disclosure.affectedVersions is required",
    "bugfix.disclosure.exploitability is required", "bugfix.disclosure.backport is required",
  ]);
  // The SECTION_HELP spelling (class, backports) is accepted.
  assert.deepEqual(validateBugfix({ ...oldBugfix, variant: "security", disclosure: {
    class: "IDOR", affectedVersions: "<2", exploitability: "low", owner: "sec", backports: ["r/1"] } }), []);
  assert.deepEqual(validateBugfix({ ...oldBugfix, variant: "cosmetic" }), ["bugfix.variant must be security|hotfix"]);
});

test("hotfix bugfix requires incident and backport and renders a Hotfix block", () => {
  assert.deepEqual(validateBugfix({ ...oldBugfix, variant: "hotfix" }), [
    "bugfix.incident is required for a hotfix bugfix", "bugfix.backport is required for a hotfix bugfix",
  ]);
  const value = { ...oldBugfix, variant: "hotfix", incident: { link: "INC-212", mitigation: "flag off",
    followUp: "full fix change" }, backport: ["release/2.3", "release/2.4"] };
  assert.deepEqual(validateBugfix(value), []);
  const body = renderBugfix(value, { language: "en" });
  assert.match(body, /### Hotfix/);
  assert.match(body, /\| Incident \| INC-212 \|/);
  assert.match(body, /\| Mitigation already applied \| flag off \|/);
  assert.match(body, /\| Backport targets \| release\/2\.3; release\/2\.4 \|/);
});

test("refactor keeps its old shape and renders steps", () => {
  assert.deepEqual(validateRefactor({ invariants: ["same output"], characterization: "golden tests" }), []);
  assert.deepEqual(validateRefactor({ invariants: "x", steps: "one" }), ["refactor.steps must be a list of strings"]);
  const body = renderRefactor({ invariants: ["same output"], characterization: "golden tests",
    steps: ["extract module", "inline adapter"], performanceNeutral: "benchmark within 2%" }, { language: "en" });
  assert.match(body, /\| Invariants \| same output \|/);
  assert.match(body, /1\. extract module\n2\. inline adapter/);
});

test("library contract renders a symbol table and exit codes", () => {
  assert.deepEqual(validateLibraryContract(library), []);
  // The SECTION_HELP example shape passes.
  assert.deepEqual(validateLibraryContract({ exports: [{ symbol: "parse", signature: "parse(t)" }],
    semver: "minor", changelog: "Adds parse" }), []);
  assert.deepEqual(validateLibraryContract({ semver: "huge", symbols: [{ name: "x" }] }), [
    "libraryContract.semver must be major|minor|patch", "libraryContract.changelog is required",
    "libraryContract.symbols[0].signature is required",
  ]);
  const body = renderLibraryContract(library, { language: "en" });
  assert.match(body, /### Public symbols\n\n\| Symbol \| Signature \| Errors \| Change \|/);
  assert.match(body, /\| `parse` \| parse\(text: string\): Ast \| ParseError \| added \|/);
  assert.match(body, /\| 2 \| invalid input \|/);
  assert.match(body, /\| Semver \| minor \|/);
});

test("migration plan validates parity and renders its parts", () => {
  assert.deepEqual(validateMigrationPlan(migration), []);
  assert.deepEqual(validateMigrationPlan({ ...migration, parity: { check: "same" }, decommissionTask: undefined }), [
    "migrationPlan.decommissionTask is required", "migrationPlan.parity.tolerance is required",
  ]);
  const body = renderMigrationPlan(migration, { language: "en" });
  assert.match(body, /\| Seam \| JobPort \|/);
  assert.match(body, /\| Parity check \| same results; tolerance 0 \|/);
  assert.match(body, /\| Decommission task \| T009 \|/);
});

test("integrations keep the old shape and render webhook details", () => {
  const old = [{ key: "stripe", kind: "payments", documentation: { source: "https://docs.stripe.com", version: "2024-06-20" },
    concerns: ["timeouts"], relatesTo: ["pay"] }];
  assert.deepEqual(validateIntegrations(old), []);
  const rich = [{ ...old[0], owner: "payments team", docs: { source: "https://docs.stripe.com/api", version: "2024-06-20" },
    secretRef: "vault:stripe/key", webhook: { signature: "Stripe-Signature HMAC", replayWindow: "5 min",
      dedup: "event id" }, outage: "queue charges and retry" }];
  assert.deepEqual(validateIntegrations(rich), []);
  assert.deepEqual(validateIntegrations([{ ...old[0], docs: { source: "http://x.test", version: "latest" },
    webhook: { signature: "hmac" } }]), [
    "integrations[0].docs.source must be an HTTPS URL", "integrations[0].docs.version must identify a fixed version",
    "integrations[0].webhook.replayWindow is required", "integrations[0].webhook.dedup is required",
  ]);
  const body = renderIntegrations(rich, { language: "en" });
  assert.match(body, /\| stripe \| payments \| https:\/\/docs\.stripe\.com \| 2024-06-20 \| timeouts \|/);
  assert.match(body, /### stripe/);
  assert.match(body, /\| Webhook signature \| Stripe-Signature HMAC \|/);
  assert.match(body, /\| Webhook replay window \| 5 min \|/);
  assert.match(body, /\| Outage behavior \| queue charges and retry \|/);
});

test("performance analysis validates benchmark and renders", () => {
  assert.deepEqual(validatePerformanceAnalysis(performance), []);
  assert.deepEqual(validatePerformanceAnalysis({ baseline: { value: "1s" }, target: "x",
    benchmark: { runs: 0, variance: "1%", environment: "ci" } }), [
    "performanceAnalysis.baseline.method is required", "performanceAnalysis.hypothesis is required",
    "performanceAnalysis.benchmark.runs must be a positive whole number",
  ]);
  const body = renderPerformanceAnalysis(performance, { language: "en" });
  assert.match(body, /\| Baseline \| p95 480ms — method: k6 5 runs \|/);
  assert.match(body, /\| Benchmark \| runs: 5, variance: ±3%, environment: staging m5\.large \|/);
  assert.doesNotMatch(body, /object Object/);
});

test("Thai labels render when language is th", () => {
  const bugfix = renderBugfix({ ...oldBugfix, variant: "security", disclosure }, { language: "th" });
  assert.match(bugfix, /\| ส่วน \| รายละเอียด \|/);
  assert.match(bugfix, /\| สาเหตุที่แท้จริง \|/);
  assert.match(bugfix, /### การเปิดเผยช่องโหว่/);
  assert.match(renderLibraryContract(library, { language: "th" }), /### symbol สาธารณะ/);
  assert.match(renderMigrationPlan(migration, { language: "th" }), /\| จุดต่อ \(seam\) \| JobPort \|/);
  assert.match(renderPerformanceAnalysis(performance, { language: "th" }), /\| สมมติฐาน \| N\+1 query \|/);
  assert.doesNotMatch(bugfix, /Root cause|Disclosure/);
});

const dependency = {
  package: "express", from: "4.19.2", to: "4.21.0", breakingChanges: "none in changelog",
  cve: "fixes CVE-2024-43796", license: "MIT", transitive: "path-to-regexp 0.1.10", lockfile: "3 lines",
  rollbackPin: "4.19.2", provenance: "npm provenance attested", sbom: "sbom/cyclonedx.json updated",
};
const modelCard = {
  intendedUse: "summarize tickets", outOfScope: "legal advice", model: { provider: "anthropic", version: "claude-x-2026-01-01" },
  data: "ticket text only", evaluation: { set: "evals/tickets-200.jsonl",
    thresholds: [{ metric: "quality", threshold: ">= 0.85" }, "safety: 0 harmful outputs"] },
  limitations: ["long threads truncate", "non-English weaker"], oversight: "agent reviews before send",
  costLatency: "$0.002 / 1.2s per call", monitoring: "weekly drift sample", fallback: "show the raw ticket",
};
const privacy = {
  personalData: [{ data: "email", class: "personal" }], purpose: "login", lawfulBasis: "contract",
  minimization: "no name stored", retention: "account life + 30 days", deletion: "account delete job",
  subjectRequests: "export and delete endpoints", crossBorder: "none", telemetryPii: "email hashed in logs",
  threats: [{ linddun: "linking", threat: "email joins analytics", control: "hash with salt" }],
};
const experiment = {
  hypothesis: "one-step checkout lifts conversion", primaryMetric: "checkout conversion",
  guardrails: ["refund rate", "p95 latency"], unit: "user", allocation: "50/50", sampleOrDuration: "14 days",
  stopRules: ["error rate > 2%", "guardrail drop > 5%"], exposureEvent: "checkout_viewed",
  decisionRule: "ship if +1% at 95%", cleanupTask: "T012",
};
const release = {
  minimumVersion: "5.2", coexistence: "4.x and 5.x read the same API", serverWindow: "90 days",
  storeReview: "submit 3 days early", stages: ["1%", "10%", "100%"], forcedUpgrade: "below 4.0",
  gate: "crash-free >= 99.5%",
};

test("dependency change requires provenance and SBOM at their exact paths", () => {
  assert.deepEqual(validateDependencyChange(dependency), []);
  const { provenance, ...withoutProvenance } = dependency;
  assert.ok(provenance);
  assert.deepEqual(validateDependencyChange(withoutProvenance), ["dependencyChange.provenance is required"]);
  assert.deepEqual(validateDependencyChange([{ package: "express", from: "4", to: "latest", rollbackPin: "4" }]), [
    "dependencyChange[0].to must identify a fixed version", "dependencyChange[0].provenance is required",
    "dependencyChange[0].sbom is required",
  ]);
  // The SECTION_HELP spellings (breaking, cves) render.
  const body = renderDependencyChange([{ ...dependency, breakingChanges: undefined, breaking: "none", cve: undefined,
    cves: "CVE-1" }], { language: "en" });
  assert.match(body, /\| Breaking changes \| none \|/);
  assert.match(body, /\| CVE \| CVE-1 \|/);
  assert.match(renderDependencyChange(dependency, { language: "en" }), /\| Provenance \| npm provenance attested \|/);
  assert.match(renderDependencyChange(dependency, { language: "en" }), /\| SBOM \| sbom\/cyclonedx\.json updated \|/);
});

test("deprecation and infra plans validate and render lists as bullets", () => {
  const deprecation = { what: "GET /v1/items", replacement: "GET /v2/items", consumers: ["mobile", "partner-x"],
    announce: "2026-11-01", warning: "Deprecation header", usageMetric: "v1 calls per consumer",
    removalCondition: "usage zero for 30 days" };
  assert.deepEqual(validateDeprecationPlan(deprecation), []);
  assert.deepEqual(validateDeprecationPlan({ what: "x", consumers: "all" }), [
    "deprecationPlan.replacement is required", "deprecationPlan.warning is required",
    "deprecationPlan.removeWhen is required", "deprecationPlan.consumers must be a list of strings",
  ]);
  const body = renderDeprecationPlan(deprecation, { language: "en" });
  assert.match(body, /\| Removal condition \| usage zero for 30 days \|/);
  assert.match(body, /\*\*Consumers:\*\*\n\n- mobile\n- partner-x/);
  const infra = { iac: "terraform", planDiff: "+1 aws_sqs_queue", environments: ["staging", "prod"],
    capacity: "1k msg/s", costDelta: "+$4/month", blastRadius: "jobs only", secrets: "none new",
    provisioningOrder: ["queue", "IAM policy"], drift: "nightly plan", externalOperations: "DNS by ops" };
  assert.deepEqual(validateInfraPlan(infra), []);
  assert.deepEqual(validateInfraPlan({ planDiff: "x" }), [
    "infraPlan.blastRadius is required", "infraPlan.environments is required",
  ]);
  const infraBody = renderInfraPlan(infra, { language: "en" });
  assert.match(infraBody, /\| Plan diff \| \+1 aws_sqs_queue \|/);
  assert.match(infraBody, /\*\*Provisioning order:\*\*\n\n- queue\n- IAM policy/);
});

test("privacy assessment renders the personal data and LINDDUN tables", () => {
  assert.deepEqual(validatePrivacyAssessment(privacy), []);
  // The SECTION_HELP shape (data[{ field, class }], transfers) passes.
  assert.deepEqual(validatePrivacyAssessment({ data: [{ field: "email", class: "personal" }], purpose: "login",
    retention: "30 days", transfers: "none" }), []);
  assert.deepEqual(validatePrivacyAssessment({ personalData: [{ data: "email" }], purpose: "x", retention: "y",
    threats: [{ linddun: "spoofing", threat: "t" }] }), [
    "privacyAssessment.personalData[0].class is required", "privacyAssessment.threats[0].control is required",
    "privacyAssessment.threats[0].linddun must be a LINDDUN category (linking, identifying, non-repudiation, " +
      "detecting, data disclosure, unawareness, non-compliance)",
  ]);
  const body = renderPrivacyAssessment(privacy, { language: "en" });
  assert.match(body, /### Personal data\n\n\| Data \| Class \|\n\|---\|---\|\n\| email \| personal \|/);
  assert.match(body, /### Privacy threats \(LINDDUN\)\n\n\| LINDDUN \| Threat \| Control \|/);
  assert.match(body, /\| linking \| email joins analytics \| hash with salt \|/);
  assert.match(body, /\| Telemetry PII check \| email hashed in logs \|/);
});

test("experiment design renders stop rules and guardrails", () => {
  assert.deepEqual(validateExperimentDesign(experiment), []);
  assert.deepEqual(validateExperimentDesign({ hypothesis: "h", stopRules: "never" }), [
    "experimentDesign.primaryMetric is required", "experimentDesign.allocation is required",
    "experimentDesign.decisionRule is required", "experimentDesign.stopRules must be a list of strings",
  ]);
  const body = renderExperimentDesign(experiment, { language: "en" });
  assert.match(body, /\*\*Stop rules:\*\*\n\n- error rate > 2%\n- guardrail drop > 5%/);
  assert.match(body, /\*\*Guardrail metrics:\*\*\n\n- refund rate/);
  assert.match(body, /\| Exposure event \| checkout_viewed \|/);
  // SECTION_HELP spellings render.
  assert.match(renderExperimentDesign({ hypothesis: "h", sampleSize: "10k", exposureLogging: "ev", cleanup: "T1" },
    { language: "en" }), /\| Sample size or duration \| 10k \|[\s\S]*\| Exposure event \| ev \|[\s\S]*\| Cleanup task \| T1 \|/);
});

test("release plan validates and renders its stages", () => {
  assert.deepEqual(validateReleasePlan(release), []);
  assert.deepEqual(validateReleasePlan({ minimumVersion: "5.2", stagedRollout: ["1%"], crashGate: "99.5%" }), []);
  assert.deepEqual(validateReleasePlan({ stages: [] }), [
    "releasePlan.minimumVersion is required", "releasePlan.stages must name at least one entry",
    "releasePlan.gate is required",
  ]);
  const body = renderReleasePlan(release, { language: "en" });
  assert.match(body, /\*\*Staged rollout:\*\*\n\n- 1%\n- 10%\n- 100%/);
  assert.match(body, /\| Crash-rate gate \| crash-free >= 99\.5% \|/);
});

test("model card renders evaluation thresholds", () => {
  assert.deepEqual(validateModelCard(modelCard), []);
  assert.deepEqual(validateModelCard({ intendedUse: "x", model: { provider: "p", version: "latest" },
    fallback: "f", evaluation: { thresholds: ["vague"] } }), [
    "modelCard.versionPin must identify a fixed version", "modelCard.evaluation.set is required",
    "modelCard.evaluation.thresholds[0] must name a metric and its threshold",
  ]);
  assert.deepEqual(validateModelCard({ intendedUse: "x" }), [
    "modelCard.model is required", "modelCard.fallback is required", "modelCard.versionPin is required",
  ]);
  const body = renderModelCard(modelCard, { language: "en" });
  assert.match(body, /### Evaluation/);
  assert.match(body, /\*\*Evaluation set:\*\* evals\/tickets-200\.jsonl/);
  assert.match(body, /\| Metric \| Threshold \|\n\|---\|---\|\n\| quality \| >= 0\.85 \|\n\| safety \| 0 harmful outputs \|/);
  assert.match(body, /\| Version pin \| claude-x-2026-01-01 \|/);
  assert.match(body, /\*\*Limitations:\*\*\n\n- long threads truncate/);
  assert.doesNotMatch(body, /object Object/);
});

test("operational work-type fields are registered and render Thai labels", () => {
  for (const key of ["dependencyChange", "deprecationPlan", "infraPlan", "privacyAssessment", "experimentDesign",
    "releasePlan", "modelCard"]) {
    assert.equal(typeof WORK_TYPE_FIELDS[key]?.validate, "function", key);
    assert.equal(typeof WORK_TYPE_FIELDS[key]?.render, "function", key);
    assert.equal(WORK_TYPE_FIELDS[key].render(undefined, { language: "en" }), "", key);
    assert.deepEqual(WORK_TYPE_FIELDS[key].validate(undefined), [], key);
  }
  const model = renderModelCard(modelCard, { language: "th" });
  assert.match(model, /\| ส่วน \| รายละเอียด \|/);
  assert.match(model, /### การประเมิน/);
  assert.match(model, /\| ตัวชี้วัด \| เกณฑ์ \|/);
  assert.match(renderDependencyChange(dependency, { language: "th" }), /\| ที่มาของแพ็กเกจ \(provenance\) \|/);
  assert.match(renderPrivacyAssessment(privacy, { language: "th" }), /### ภัยด้านความเป็นส่วนตัว \(LINDDUN\)/);
  assert.match(renderExperimentDesign(experiment, { language: "th" }), /\*\*เงื่อนไขหยุดการทดลอง:\*\*/);
  assert.match(renderReleasePlan(release, { language: "th" }), /\*\*การปล่อยแบบเป็นขั้น:\*\*/);
  assert.doesNotMatch(model, /Intended use|Evaluation|Threshold/);
});
