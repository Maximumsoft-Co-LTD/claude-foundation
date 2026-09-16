import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { join } from "node:path";

export function deliveryProjectionEntry(root, path, pathIdentity) {
  const absolute = join(root, path);
  const identity = pathIdentity(absolute);
  if (identity === null) return { path, identity };
  const stat = lstatSync(absolute);
  const mode = stat.isSymbolicLink() ? "120000"
    : stat.isFile() ? (stat.mode & 0o111 ? "100755" : "100644") : null;
  return { path, identity, ...(mode ? { mode } : {}) };
}

function drift(message, code = "DELIVERY_PROJECTION_DRIFT") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function createDeliveryIntegrity({ git, run, runChecked, gitOutput }) {
  function assertTree(workspace, projection, tree, gitlinks = []) {
    const links = new Map(gitlinks.map((row) => [row.path, row.commit]));
    const underLink = (path) => [...links.keys()].some((link) =>
      path === link || path.startsWith(`${link}/`));
    const expected = new Map(projection.entries.filter((row) => !underLink(row.path))
      .map((row) => [row.path, row]));
    const changed = gitOutput(git,
      ["diff", "--no-renames", "--name-only", "-z", projection.baseHead, tree, "--"],
      workspace, "cannot inspect delivery tree").split("\0").filter(Boolean);
    if (changed.some((path) => !links.has(path) && !projection.roots.some((root) =>
      path === root || path.startsWith(`${root}/`))))
      drift("delivery tree contains changes outside the proven projection");

    const source = gitOutput(git,
      ["ls-tree", "-r", "-z", tree, "--", ...projection.roots, ...links.keys()],
      workspace, "cannot read delivery tree");
    const observed = new Map(source.split("\0").filter(Boolean).map((line) => {
      const tab = line.indexOf("\t");
      const [mode, type, oid] = line.slice(0, tab).split(" ");
      return [line.slice(tab + 1), { mode, type, oid }];
    }));
    for (const [path, row] of observed) {
      if (links.has(path)) {
        if (row.mode !== "160000" || row.oid !== links.get(path))
          drift(`delivery gitlink differs from its verified child commit: ${path}`);
        continue;
      }
      const entry = expected.get(path);
      if (!entry?.identity || row.type !== "blob" || (entry.mode && entry.mode !== row.mode))
        drift(`delivery tree has an unexpected path or mode: ${path}`);
      // Read the Git object, not the worktree: hooks and interrupted attempts
      // can leave those bytes different. Buffer output preserves binary files.
      const blob = runChecked(run, "git", ["cat-file", "blob", row.oid],
        { cwd: workspace, encoding: null, maxBuffer: 64 * 1024 * 1024 },
        `cannot verify delivery blob '${path}'`).stdout;
      const identity = row.mode === "120000" ? `symlink:${blob.toString("utf8")}`
        : createHash("sha256").update(blob).digest("hex");
      if (identity !== entry.identity)
        drift(`delivery tree differs from the proven content: ${path}`);
    }
    for (const [path, entry] of expected) {
      // Git does not represent empty directories. Nonempty directory roots
      // were expanded into their individual entries when the projection bound.
      if (entry.identity && !entry.identity.startsWith("directory:") && !observed.has(path))
        drift(`delivery tree is missing a proven path: ${path}`);
    }
    for (const path of links.keys())
      if (!observed.has(path)) drift(`delivery tree is missing a child gitlink: ${path}`);
  }

  function assertPullRequestBase(workspace, provider, projection) {
    // Local branches and remote-tracking refs can be stale. Fetch only the
    // proposed PR base, without changing the target checkout's HEAD or index.
    runChecked(run, "git", ["fetch", "--no-tags", provider.remoteName,
      `refs/heads/${provider.baseBranch}`],
    { cwd: workspace, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 60_000 },
    "cannot fetch pull request base");
    const base = gitOutput(git, ["rev-parse", "FETCH_HEAD^{commit}"], workspace,
      "cannot resolve fetched pull request base");
    if (git(["merge-base", "--is-ancestor", projection.baseHead, base], workspace).status !== 0)
      drift("The remote PR base does not contain the proven Land base; delivery would include unapproved branch history. Reconcile the base through a new proven change before delivery.",
        "DELIVERY_PR_BASE_DRIFT");
  }

  return { assertTree, assertPullRequestBase };
}
