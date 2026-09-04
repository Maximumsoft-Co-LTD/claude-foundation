#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const REHEARSAL_EVIDENCE_PROTOCOL = "foundation-release-rehearsal-evidence-v1";

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sourceIdentity(root, sourceHead) {
  return {
    head: sourceHead,
    workflowSha256: digest(resolve(root, ".github/workflows/release.yml")),
    packageLockSha256: digest(resolve(root, "package-lock.json"))
  };
}

export function rehearsalEvidence({ root = ROOT, candidateVersion, sourceHead }) {
  if (!/^\d+\.\d+\.\d+$/.test(candidateVersion || ""))
    throw new Error("candidate version must be X.Y.Z");
  if (!/^[0-9a-f]{40,64}$/.test(sourceHead || ""))
    throw new Error("source head must be a full hexadecimal commit id");
  return {
    version: 1,
    protocol: REHEARSAL_EVIDENCE_PROTOCOL,
    candidateVersion,
    source: sourceIdentity(root, sourceHead),
    checks: {
      deterministicAndSemantic: "pass",
      automatedMutation: "pass",
      rewrittenCandidate: "pass",
      bottleRehearsal: "pass"
    }
  };
}

export function rehearsalEvidenceIssues(actual, expected) {
  const issues = [];
  const compare = (label, left, right) => {
    if (left !== right) issues.push(`${label}: expected ${right}, observed ${left ?? "missing"}`);
  };
  compare("version", actual?.version, expected.version);
  compare("protocol", actual?.protocol, expected.protocol);
  compare("candidateVersion", actual?.candidateVersion, expected.candidateVersion);
  compare("source.head", actual?.source?.head, expected.source.head);
  compare("source.workflowSha256", actual?.source?.workflowSha256,
    expected.source.workflowSha256);
  compare("source.packageLockSha256", actual?.source?.packageLockSha256,
    expected.source.packageLockSha256);
  for (const [name, status] of Object.entries(expected.checks))
    compare(`checks.${name}`, actual?.checks?.[name], status);
  return issues;
}

function argsValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1] || args[index + 1].startsWith("--"))
    throw new Error(`${name} requires a value`);
  return args[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [operation, ...args] = process.argv.slice(2);
    if (!["create", "verify"].includes(operation))
      throw new Error("usage: rehearsal-evidence.mjs create|verify --version X.Y.Z --source-head SHA --file PATH");
    const candidateVersion = argsValue(args, "--version");
    const sourceHead = argsValue(args, "--source-head");
    const file = resolve(argsValue(args, "--file"));
    const expected = rehearsalEvidence({ candidateVersion, sourceHead });
    if (operation === "create") {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(expected, null, 2)}\n`);
      process.stdout.write(`release rehearsal evidence: ${file}\n`);
    } else {
      const actual = JSON.parse(readFileSync(file, "utf8"));
      const issues = rehearsalEvidenceIssues(actual, expected);
      if (issues.length) {
        for (const issue of issues) process.stderr.write(`${issue}\n`);
        process.exitCode = 2;
      } else process.stdout.write("release rehearsal evidence: verified\n");
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
