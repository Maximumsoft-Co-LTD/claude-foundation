#!/usr/bin/env node

// Differential probe for the Node evidence semantics being ported to Rust.
// Artifact handling is exercised through the production Node artifact store;
// receipt ordering is the same ordering used by foundation.mjs::receiptValidity.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { createArtifactStore } from "../../.claude/harness/runtime/evidence/artifact-store.mjs";

let root = resolve(process.argv[2] || ".evidence-parity");
mkdirSync(root, { recursive: true });
root = realpathSync(root);
const vault = join(root, ".foundation", "evidence");
mkdirSync(vault, { recursive: true });
writeFileSync(join(root, "result.log"), "verified output\n");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fileDigest = (path) => sha256(readFileSync(path));
const pathInside = (parent, candidate) => {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
const store = createArtifactStore({
  root,
  prototypesRoot: join(root, ".foundation", "prototypes"),
  evidenceVault: vault,
  canonicalPath: resolve,
  providerWorkspace: () => root,
  proofRunRoot: (_id, run) => join(vault, "change-1", run),
  pathInside,
  fileDigest,
  fail: (message) => { throw new Error(message); }
});
const artifact = store.durableArtifact("change-1", "test", "run-1", {
  path: "result.log", type: "command-log", required: true
});

const expected = {
  providerProtocolVersion: "provider-v1",
  contractFingerprint: "contract-a",
  providerFingerprint: "provider-a",
  workspaceHash: "workspace-a",
  inputIdentity: { mode: "global", fingerprint: "inputs-a" },
  requiredClaims: ["claim-a"]
};
const receipt = {
  providerProtocolVersion: "provider-v1",
  contractFingerprint: "contract-a",
  providerFingerprint: "provider-a",
  workspaceHash: "workspace-a",
  inputIdentity: { mode: "global", fingerprint: "inputs-a" },
  claims: ["claim-a"], status: "pass", adapter: "external",
  observed: "command passed", provenance: { source: "command:test" },
  references: [], artifacts: [artifact]
};

function validity(value, wanted) {
  if (value.providerProtocolVersion !== wanted.providerProtocolVersion) return "provider-version-stale";
  if (value.contractFingerprint !== wanted.contractFingerprint) return "contract-stale";
  if (value.providerFingerprint !== wanted.providerFingerprint) return "provider-fingerprint-stale";
  let reusable = false;
  if (value.workspaceHash !== wanted.workspaceHash) {
    if (wanted.inputIdentity.mode === "declared" && value.inputIdentity?.mode === "declared" &&
        value.inputIdentity.fingerprint === wanted.inputIdentity.fingerprint) reusable = true;
    else return "stale";
  }
  if (value.inputIdentity?.fingerprint !== wanted.inputIdentity.fingerprint) return "provider-inputs-stale";
  if (value.status !== "pass") return value.status;
  if (wanted.requiredClaims.some((claim) => !new Set(value.claims || []).has(claim))) return "incomplete-claims";
  if ((value.artifacts || []).some((item) => item.required !== false && !store.validateArtifact(item))) return "invalid-artifacts";
  if ((value.adapter || "external") === "external") {
    if (!String(value.observed || "").trim()) return "external-observation-missing";
    if (!String(value.provenance?.source || "").trim()) return "external-provenance-missing";
    if (!(value.artifacts || []).length && !(value.references || []).length) return "external-evidence-missing";
  }
  return reusable ? "reusable-inputs" : "valid";
}

const results = [
  { name: "valid", validity: validity(receipt, expected) },
  { name: "stale", validity: validity({ ...receipt, workspaceHash: "workspace-old" }, expected) }
];
writeFileSync(resolve(root, artifact.path), "tampered\n");
results.push({ name: "tampered", validity: validity(receipt, expected) });
process.stdout.write(`${JSON.stringify(results)}\n`);
