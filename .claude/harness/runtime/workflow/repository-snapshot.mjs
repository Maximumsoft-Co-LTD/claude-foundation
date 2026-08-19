import { existsSync } from "node:fs";

export function createRepositorySnapshot({
  root, runtimePath, snapshotPath, readJson, writeJson, singleRelevantSnapshot,
  selectedRepositories, gitHead, stableHash, now
}) {
  function relevantSnapshot(id, workspaceOverride = null, force = false) {
    const state = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {};
    const contractRevision = Number(state.contractRevision ?? state.revision ?? 0);
    if (workspaceOverride || !state.repositories ||
        Object.keys(state.repositories).length === 0)
      return singleRelevantSnapshot(id, workspaceOverride, force);
    const selection = selectedRepositories(id, state);
    // A registered child repository is represented by its own content
    // snapshot below. Keeping its root gitlink in the control snapshot bound
    // the same product twice and made staging only the delivery pointer expire
    // review receipts.
    const childPaths = selection.filter((repository) => repository.id !== "root" &&
      repository.relativePath && repository.relativePath !== "." &&
      !repository.relativePath.startsWith("../"))
      .map((repository) => repository.relativePath);
    const control = singleRelevantSnapshot(
      id, state.workspace?.path || root, force, childPaths);
    const repositories = {};
    for (const repository of selection) {
      if (repository.id === "root") {
        repositories.root = {
          id: control.id,
          workspaceHash: control.workspaceHash,
          codeHash: control.codeHash,
          reviewHash: control.reviewHash,
          workspace: control.workspace,
          baseHead: repository.baseHead || gitHead(root)
        };
        continue;
      }
      const workspace = repository.workspacePath || repository.path;
      const snapshot = singleRelevantSnapshot(id, workspace, force);
      repositories[repository.id] = {
        id: snapshot.id,
        workspaceHash: snapshot.workspaceHash,
        codeHash: snapshot.codeHash,
        reviewHash: snapshot.reviewHash,
        workspace: snapshot.workspace,
        baseHead: repository.baseHead || gitHead(repository.path)
      };
    }
    // Composed twice from the same entries. The packet lives in the control
    // repository, so every other entry's two hashes are equal by construction —
    // but composing the code hash from the code halves is what keeps a packet
    // edit out of the composite an executable provider binds.
    const composite = (field) => stableHash({
      version: 2,
      contractRevision,
      control: control[field],
      repositories: Object.entries(repositories).sort(([left], [right]) =>
        left.localeCompare(right)).map(([repository, value]) => ({
        // Commit identity is Land/recovery state, not content identity. The
        // snapshot already hashes every tracked byte and the contract revision;
        // explicit target-head guards separately refuse an unreconciled base.
        repository, workspaceHash: value[field]
      }))
    });
    const workspaceHash = composite("workspaceHash");
    const value = {
      version: 3,
      id: `snapshot-${workspaceHash.slice(0, 20)}`,
      changeId: id,
      workspace: control.workspace,
      workspaceHash,
      codeHash: composite("codeHash"),
      reviewHash: composite("reviewHash"),
      revision: contractRevision,
      fileCount: control.fileCount,
      control,
      repositories,
      createdAt: now()
    };
    writeJson(snapshotPath(id), value);
    return value;
  }

  function relevantHash(id, workspaceOverride = null, force = false) {
    return relevantSnapshot(id, workspaceOverride, force).workspaceHash;
  }

  return { relevantSnapshot, relevantHash };
}
