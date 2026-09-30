import { join } from "node:path";

// Diff-scoped review input. The configured reviewer receives the changed
// hunks and the agreement's requirements instead of being told to open whole
// files. Everything here is derived from the dispatched scope rows and the
// bound contract workspace, so the packet digest binds exactly what was shown.
export const REVIEW_DIFF_LIMITS = Object.freeze({
  fileBytes: 12 * 1024, totalBytes: 40 * 1024, agreementBytes: 12 * 1024
});

function clip(text, limit) {
  const value = String(text || "");
  if (Buffer.byteLength(value) <= limit) return { text: value, truncated: false };
  let cut = value.slice(0, limit);
  while (Buffer.byteLength(cut) > limit) cut = cut.slice(0, -1);
  const newline = cut.lastIndexOf("\n");
  return { text: newline > 0 ? cut.slice(0, newline + 1) : cut, truncated: true };
}

// `git` is the injected runner `(args, cwd) => spawnSync result`. External diff
// drivers and textconv filters are disabled: repository config must not run
// programs or rewrite what the reviewer sees.
export function reviewRowDiff({ git, pathExists }, row, workspacePath, baseHead) {
  if (!workspacePath || !baseHead) return { status: "unavailable" };
  const base = ["-c", "core.quotepath=off", "diff", "--no-color", "--no-ext-diff",
    "--no-textconv", "--no-renames", "-U3"];
  const tracked = git([...base, baseHead, "--", row.path], workspacePath);
  if (tracked.status !== 0) return { status: "unavailable" };
  if (String(tracked.stdout || "").trim()) return { status: "diff", diff: String(tracked.stdout) };
  if (!pathExists(join(workspacePath, row.path))) return { status: "unchanged" };
  const inBase = git(["cat-file", "-e", `${baseHead}:${row.path}`], workspacePath);
  if (inBase.status === 0) return { status: "unchanged" };
  // Untracked additions are invisible to `diff <base>`; show them as new files.
  const added = git([...base, "--no-index", "--", "/dev/null", row.path], workspacePath);
  return [0, 1].includes(added.status) && String(added.stdout || "").trim()
    ? { status: "diff", diff: String(added.stdout) } : { status: "unavailable" };
}

export function reviewDiffValue(context, rows, inspection, limits = REVIEW_DIFF_LIMITS) {
  const locations = new Map((inspection || []).map((entry) => [entry.repositoryId, entry]));
  let remaining = limits.totalBytes;
  const files = (rows || []).filter((row) => row.kind !== "contract-artifact")
    .map((row) => {
      const path = `${row.repositoryId}/${row.path}`;
      if (row.identity === "reverted-to-base") return { path, status: "reverted-to-base" };
      if (remaining <= 0) return { path, status: "omitted" };
      const location = locations.get(row.repositoryId) || {};
      let value;
      try {
        value = reviewRowDiff(context, row,
          row.workspacePath || location.workspacePath || null, location.baseHead || null);
      } catch { value = { status: "unavailable" }; }
      if (value.status !== "diff") return { path, status: value.status };
      const budget = Math.min(limits.fileBytes, remaining);
      const clipped = clip(value.diff, budget);
      // Clipping against the shared budget exhausts it; a per-file clip does not.
      remaining = clipped.truncated && budget === remaining
        ? 0 : remaining - Buffer.byteLength(clipped.text);
      return { path, status: clipped.truncated ? "truncated" : "diff", diff: clipped.text };
    });
  return { version: 1, files };
}

function specFiles(context, directory, prefix = "specs") {
  let names;
  try { names = context.readDirectory(join(directory, prefix)).sort(); }
  catch { return []; }
  return names.flatMap((name) => {
    const relativePath = `${prefix}/${name}`;
    if (context.isDirectory(join(directory, relativePath)))
      return specFiles(context, directory, relativePath);
    return relativePath.endsWith(".md") ? [relativePath] : [];
  });
}

// The agreement summary: claim scenarios, the acceptance decision, and the
// delta requirements with their scenarios. Specs are the canonical agreement;
// their identities are already in the dispatched manifest.
export function reviewAgreementValue(context, packet, limits = REVIEW_DIFF_LIMITS) {
  const directory = packet?.contractWorkspacePath;
  let remaining = limits.agreementBytes;
  const requirements = directory ? specFiles(context, directory).map((path) => {
    if (remaining <= 0) return { path: `contract/${path}`, status: "omitted" };
    let content;
    try { content = context.readFile(join(directory, path), "utf8"); }
    catch { return { path: `contract/${path}`, status: "unavailable" }; }
    const clipped = clip(content, remaining);
    remaining -= Buffer.byteLength(clipped.text);
    return { path: `contract/${path}`, status: clipped.truncated ? "truncated" : "included",
      text: clipped.text };
  }) : [];
  return {
    version: 1,
    intent: packet?.intent || null,
    claims: packet?.claims ?? null,
    acceptance: packet?.acceptance ?? null,
    requirements
  };
}

// Only the risk tier decides review depth. Low risk before any delivered AI
// attempt reviews the diff alone on the fast model tier; a promoted second
// round, medium, high, and legacy routing keep the configured depth and model.
export function reviewDepthForTier(tier, deliveredAiCount = 0) {
  return tier === "low" && Number(deliveredAiCount) === 0 ? "diff-only" : "diff-first";
}

export function reviewModelTierForDepth(depth) {
  return depth === "diff-only" ? "fast" : "configured";
}
