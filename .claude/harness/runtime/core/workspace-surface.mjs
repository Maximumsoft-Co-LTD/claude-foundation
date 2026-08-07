// What counts as workspace surface, decided in one place.
//
// The rule used to be "drop any path with an excluded name in any segment".
// That reads as conservative and is not: `.workflow` names the harness's own
// legacy migration source *at the project root*, but a repository is free to
// commit a fixture directory of that name anywhere else — and one did. The
// segment match dropped it from the change surface and from the copy sandbox
// at once, so the file vanished from the hash and reappeared to git as a
// deletion the change never made.
//
// Depth alone cannot decide it either. `node_modules` legitimately nests in
// every monorepo, so root-only matching would pull an entire dependency tree
// into the hash. The axis that actually separates the two is what git already
// knows: generated output is untracked, and committed content is content — no
// matter what the directory is called.
//
// Pure by construction. Callers supply the exclusion set they own and whether
// git tracks the path; nothing here reads the filesystem.

// Names that identify the harness's own directories at the project root and
// carry no meaning below it. Excluded at depth 0 only.
export const ROOT_ONLY_EXCLUDED_DIRS = new Set([".foundation", ".workflow"]);

export function isExcludedPath(rel, { excluded, tracked = false }) {
  if (!rel) return false;
  const segments = rel.split("/");
  // `.git` is the one name a caller may legitimately want at the root and
  // never anywhere else, so the caller's set decides: the change surface
  // excludes it outright, while the copy sandbox omits it from the set in
  // order to carry the root repository and stay a git repository itself.
  if (excluded.has(".git") && segments.includes(".git")) return true;
  if (ROOT_ONLY_EXCLUDED_DIRS.has(segments[0])) return true;
  // Tracked content is content. Whatever it is called, someone committed it.
  if (tracked) return false;
  return segments.some((segment) =>
    segment !== ".git" &&
    !ROOT_ONLY_EXCLUDED_DIRS.has(segment) &&
    excluded.has(segment));
}

// Every ancestor directory of a tracked file is itself worth descending into,
// which a directory-level filter has to know before it reaches the file.
export function trackedPathSet(relativePaths) {
  const set = new Set();
  for (const path of relativePaths) {
    if (!path) continue;
    set.add(path);
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1)
      set.add(segments.slice(0, index).join("/"));
  }
  return set;
}
