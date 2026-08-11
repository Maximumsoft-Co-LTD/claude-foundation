import { existsSync } from "node:fs";

export function createRepositorySnapshot({
  root, runtimePath, snapshotPath, readJson, writeJson, singleRelevantSnapshot,
  selectedRepositories, gitHead, stableHash, now
}) {
  function relevantSnapshot(id, workspaceOverride = null, force = false) {
    const state = existsSync(runtimePath(id)) ? readJson(runtimePath(id)) : {};
    if (workspaceOverride || !state.repositories ||
        Object.keys(state.repositories).length === 0)
      return singleRelevantSnapshot(id, workspaceOverride, force);
    const control = singleRelevantSnapshot(id, state.workspace?.path || root, force);
    const repositories = {};
    for (const repository of selectedRepositories(id, state)) {
      if (repository.id === "root") {
        repositories.root = {
          id: control.id,
          workspaceHash: control.workspaceHash,
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
        workspace: snapshot.workspace,
        baseHead: repository.baseHead || gitHead(repository.path)
      };
    }
    const workspaceHash = stableHash({
      version: 1,
      contractRevision: Number(state.contractRevision || state.revision || 0),
      control: control.workspaceHash,
      repositories: Object.entries(repositories).sort(([left], [right]) =>
        left.localeCompare(right)).map(([repository, value]) => ({
        repository, workspaceHash: value.workspaceHash, baseHead: value.baseHead
      }))
    });
    const value = {
      version: 2,
      id: `snapshot-${workspaceHash.slice(0, 20)}`,
      changeId: id,
      workspace: control.workspace,
      workspaceHash,
      revision: Number(state.contractRevision || state.revision || 0),
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
