#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function read(path) { return readFileSync(resolve(ROOT, path), "utf8"); }
function git(args) { return spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }); }
function value(source, pattern) { return source.match(pattern)?.[1] || null; }

export function classifyReleasePath(path) {
  if (/^(?:\.claude\/harness\/runtime|\.claude\/harness\/foundation\.mjs|cli\.sh)/.test(path))
    return "runtime";
  if (/^(?:\.claude\/(?:commands|skills|rules|hooks)|README|WORKFLOW)/.test(path))
    return "instruction";
  if (/^(?:install|Formula\/|\.github\/workflows\/|scripts\/release\/|VERSION|package(?:-lock)?\.json)/.test(path))
    return "shipping";
  if (/^(?:\.claude\/tests|scripts\/quality|docs\/reports)/.test(path))
    return "repository-only";
  return "release-review";
}

export function protocolPinIssues({ protocol, foundationSource }) {
  const pins = {
    runtime: value(foundationSource, /const VERSION = "([^"]+)"/),
    runtimeApi: value(foundationSource, /const RUNTIME_API_VERSION = "([^"]+)"/),
    providerProtocol: value(foundationSource, /const PROVIDER_PROTOCOL_VERSION = "([^"]+)"/),
    adapterProtocol: value(foundationSource, /const ADAPTER_PROTOCOL_VERSION = "([^"]+)"/),
    proofProtocol: value(foundationSource, /const PROOF_PROTOCOL_VERSION = "([^"]+)"/),
    packetSchema: value(foundationSource, /const PACKET_SCHEMA_VERSION = "([^"]+)"/),
    agentPlanSchema: value(foundationSource, /const AGENT_PLAN_SCHEMA_VERSION = "([^"]+)"/),
    contextEventSchema: value(foundationSource, /const CONTEXT_EVENT_SCHEMA_VERSION = "([^"]+)"/),
    reviewProtocol: value(foundationSource, /const REVIEW_PROTOCOL_VERSION = "([^"]+)"/),
    acceptanceProtocol: value(foundationSource, /const ACCEPTANCE_PROTOCOL_VERSION = "([^"]+)"/),
    semanticAcceptanceProtocol: value(foundationSource,
      /const SEMANTIC_ACCEPTANCE_PROTOCOL_VERSION = "([^"]+)"/),
    reviewPacketSchema: value(foundationSource, /const REVIEW_PACKET_SCHEMA_VERSION = "([^"]+)"/),
    attestationProtocol: value(foundationSource, /const ATTESTATION_PROTOCOL_VERSION = "([^"]+)"/),
    authorityProtocol: value(foundationSource, /const AUTHORITY_PROTOCOL_VERSION = "([^"]+)"/),
    ciEvidenceProtocol: value(foundationSource, /const CI_EVIDENCE_PROTOCOL_VERSION = "([^"]+)"/),
    qualityCapabilitiesProtocol: value(foundationSource,
      /const QUALITY_CAPABILITIES_PROTOCOL_VERSION = "([^"]+)"/),
    crapProtocol: value(foundationSource, /const CRAP_PROTOCOL_VERSION = "([^"]+)"/),
    automatedMutationProtocol: value(foundationSource,
      /const AUTOMATED_MUTATION_PROTOCOL_VERSION = "([^"]+)"/)
  };
  return Object.entries(pins).flatMap(([name, observed]) => observed === protocol[name]
    ? [] : [`${name}: runtime=${observed ?? "missing"} protocol=${protocol[name] ?? "missing"}`]);
}

export function structuralReleaseChecks({ version, protocol, foundationSource,
  changelog, formula, workflow, packageJson }) {
  const checks = [];
  const add = (id, pass, detail) => checks.push({ id, status: pass ? "pass" : "fail", detail });
  add("semantic-version", /^\d+\.\d+\.\d+$/.test(version), version);
  add("runtime-version-pin", protocol.runtime === version,
    `VERSION=${version} protocol.runtime=${protocol.runtime}`);
  const pinIssues = protocolPinIssues({ protocol, foundationSource });
  add("wire-protocol-pins", pinIssues.length === 0,
    pinIssues.length ? pinIssues.join("; ") : "all runtime constants match protocol.json");
  add("single-unreleased-heading", (changelog.match(/^## \[Unreleased\]$/gm) || []).length === 1,
    "CHANGELOG.md must contain exactly one canonical heading");
  const unreleased = changelog.match(/^## \[Unreleased\]\n([\s\S]*?)(?=^## \[)/m)?.[1] || "";
  add("unreleased-not-empty", /\S/.test(unreleased), "release notes are present");
  add("formula-version", formula.includes(`/v${version}.tar.gz`), "stable URL matches VERSION");
  add("formula-sha256", /^  sha256 "[a-f0-9]{64}"$/m.test(formula), "stable SHA is pinned");
  add("formula-head", /head ".+\.git", branch: "main"/.test(formula), "HEAD remains available");
  add("workflow-dry-run", workflow.includes("dry_run") && workflow.includes("DRY"),
    "release workflow exposes a non-publishing rehearsal");
  add("workflow-main-bound", workflow.includes('"$GITHUB_REF" = "refs/heads/main"') &&
    workflow.includes("git ls-remote --heads origin refs/heads/main") &&
    workflow.includes('"$REMOTE_MAIN" = "$GITHUB_SHA"'),
  "release workflow rejects non-main and stale dispatch revisions");
  add("workflow-rehearsal-reuse", workflow.includes("rehearsal_run_id") &&
    workflow.includes("rehearsal-evidence.mjs verify") && workflow.includes("actions: read") &&
    workflow.includes('.head_branch == "main"'),
  "release workflow verifies source-bound rehearsal evidence before reuse");
  add("workflow-node-supported", /node-version: "24"/.test(workflow) &&
    /^>=20\.19\.0$/.test(packageJson.engines?.node || ""),
  "CI Node and minimum supported Node are declared");
  return checks;
}

export function publicationReadiness({ structuralReady, clean, evidenceReady }) {
  const publicationReady = structuralReady && clean;
  return {
    publicationReady,
    // Compatibility alias for callers that consumed the original v1 field.
    // Release publication is intentionally independent from paid assurance.
    releaseReady: publicationReady,
    assuranceReady: evidenceReady,
    blockers: [
      ...(!structuralReady ? ["structural-release-check-failed"] : []),
      ...(!clean ? ["source-tree-not-immutable"] : [])
    ],
    advisories: !evidenceReady ? ["release-portfolio-not-ready"] : []
  };
}

export function releasePreflight({ evidenceReady = false } = {}) {
  const version = read("VERSION").trim();
  const protocol = JSON.parse(read(".claude/harness/protocol.json"));
  const tracked = git(["diff", "--name-only", "HEAD"]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  const paths = [...new Set(`${tracked.stdout || ""}\n${untracked.stdout || ""}`
    .split(/\r?\n/).filter(Boolean))].sort();
  const lanes = paths.reduce((groups, path) => {
    const lane = classifyReleasePath(path);
    (groups[lane] ||= []).push(path);
    return groups;
  }, {});
  const checks = structuralReleaseChecks({
    version, protocol, foundationSource: read(".claude/harness/foundation.mjs"),
    changelog: read("CHANGELOG.md"), formula: read("Formula/claude-foundation.rb"),
    workflow: read(".github/workflows/release.yml"),
    packageJson: JSON.parse(read("package.json"))
  });
  const structuralReady = checks.every((row) => row.status === "pass");
  const clean = paths.length === 0;
  const readiness = publicationReadiness({ structuralReady, clean, evidenceReady });
  return {
    version: 1, protocol: "foundation-release-preflight-v1",
    candidateVersion: version, checks, lanes,
    source: { clean, changedPaths: paths.length },
    evidence: { ready: evidenceReady, requiredForPublication: false },
    structuralReady,
    ...readiness
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = releasePreflight({ evidenceReady: process.argv.includes("--evidence-ready") });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.publicationReady) process.exitCode = 2;
}
