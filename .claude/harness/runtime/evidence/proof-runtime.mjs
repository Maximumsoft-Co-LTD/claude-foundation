import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export function createProofRuntime({
  root, protocolVersion, loadRuntime, saveRuntime, validate, changedSurfaceIssues,
  activeChangeLeases, pendingTasks, clearSnapshotCache, relevantSnapshot,
  requiredProviders, receiptValidity, proofRunRoot, receiptPath, fileDigest,
  protocolDescriptor, contractFingerprint, executionFingerprint, proofPath,
  writeJson, readJson, pathInside, validateArtifact, now, fail
}) {
  function finalize(id, requestedProofRunId = null) {
    const stateBefore = loadRuntime(id);
    if (stateBefore.status === "archived") fail(`change '${id}' is already archived`);
    validate(id, "active", { quiet: true });
    const surfaceIssues = changedSurfaceIssues(id);
    if (surfaceIssues.length) fail(`changed-surface authority failed: ${surfaceIssues.join("; ")}`);
    const leases = activeChangeLeases(id);
    if (leases.length)
      fail(`active agent leases block proof: ${leases.map((lease) => lease.taskId).join(", ")}`);
    const pending = pendingTasks(id);
    if (pending.length) fail(`${pending.length} implementation task(s) remain unchecked`);
    clearSnapshotCache(id);
    const snapshot = relevantSnapshot(id, null, true);
    const hash = snapshot.workspaceHash;
    const checks = requiredProviders(id).map((provider) => receiptValidity(id, provider, hash));
    const blockers = checks.filter((row) => row.validity !== "valid");
    if (blockers.length) fail(blockers.map((row) => `${row.provider}:${row.validity}`).join(", "));
    const proofRunId = requestedProofRunId || stateBefore.activeProofRun?.id || `proof-${Date.now()}`;
    const runRoot = proofRunRoot(id, proofRunId);
    const receiptEntries = checks.map((row) => {
      const source = receiptPath(id, row.provider);
      const destination = join(runRoot, "receipts", `${row.provider}.json`);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(source, destination);
      return {
        provider: row.provider,
        repositoryId: row.receipt?.repositoryId || null,
        path: relative(root, destination).replaceAll("\\", "/"),
        sha256: fileDigest(destination),
        size: statSync(destination).size
      };
    });
    const proof = {
      version: 2,
      proofProtocolVersion: protocolVersion,
      protocols: protocolDescriptor(),
      changeId: id,
      proofRunId,
      status: "pass",
      workspaceHash: hash,
      workspaceSnapshotId: snapshot.id,
      repositories: snapshot.repositories || null,
      contractFingerprint: contractFingerprint(id),
      executionFingerprint: executionFingerprint(id),
      providers: checks.map((row) => row.provider),
      receipts: receiptEntries,
      artifacts: stateBefore.activeProofRun?.serviceArtifacts || [],
      createdAt: now()
    };
    writeJson(proofPath(id), proof);
    writeJson(join(runRoot, "manifest.json"), proof);
    const state = loadRuntime(id);
    state.status = "proven";
    state.provenHash = hash;
    saveRuntime(state);
    console.log(`PROVEN ${id}\n  workspace: ${hash}\n  providers: ${proof.providers.join(", ")}\n  next: /land ${id}`);
  }

  function audit(id, quiet = false) {
    const proof = existsSync(proofPath(id)) ? readJson(proofPath(id)) : null;
    if (!proof || proof.status !== "pass") return { valid: false, reason: "missing-proof" };
    if (String(proof.proofProtocolVersion || "") !== protocolVersion)
      return { valid: false, reason: "proof-version-stale" };
    if (!Array.isArray(proof.receipts) || proof.receipts.length === 0)
      return { valid: false, reason: "missing-receipt-manifest" };
    for (const entry of proof.receipts) {
      const path = resolve(root, entry.path || "");
      if (!pathInside(proofRunRoot(id, proof.proofRunId), path) ||
          !existsSync(path) || !statSync(path).isFile() ||
          fileDigest(path) !== entry.sha256 || statSync(path).size !== Number(entry.size))
        return { valid: false, reason: `receipt-tampered:${entry.provider || "unknown"}` };
      const receipt = readJson(path);
      const invalidArtifact = (receipt.artifacts || []).find((artifact) =>
        artifact.required !== false && !validateArtifact(artifact));
      if (invalidArtifact)
        return { valid: false, reason: `artifact-tampered:${entry.provider || "unknown"}` };
    }
    if ((proof.artifacts || []).some((artifact) =>
      artifact.required !== false && !validateArtifact(artifact)))
      return { valid: false, reason: "proof-artifact-tampered" };
    if (!quiet) console.log(`PROOF AUDIT ${id}: valid\n  run: ${proof.proofRunId}`);
    return { valid: true, proof };
  }

  return { finalize, audit };
}
