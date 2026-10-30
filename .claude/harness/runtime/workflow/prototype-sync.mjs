import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";

import { prototypeExample } from "./prototype-checklist.mjs";

// Keeping the approval page honest without owning it. The page is a file the
// prototype skill writes; the harness records its digest and the digest of the
// facts it computes (risk, proof, roles) every time the agreement is started,
// revised, or amended, and later says whether the file was edited since, or
// whether the page lacks the current facts digest. Both are advisory: they
// never fail `change start`, Build, Prove, or Land, and neither is evidence.

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// Stable JSON: keys sorted at every depth, so equal facts give equal digests.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

// Short on purpose: the skill pastes it into the page it writes.
export function factsDigest(facts) {
  return sha256(canonical(facts)).slice(0, 16);
}

// The page the draft names: the prototype example's path, kept inside
// `.foundation/previews/<id>/`. `status` is none (no example), missing (named
// but absent or outside the folder), or ok.
export function pageFile({ previewsDir, id, draft }) {
  const example = prototypeExample(draft);
  if (!example) return { status: "none", path: null, digest: null, text: "" };
  const path = String(example.path || "").trim();
  const base = join(previewsDir, id);
  const missing = { status: "missing", path: path || null, digest: null, text: "" };
  if (!path || isAbsolute(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) return missing;
  let real;
  try {
    real = realpathSync(resolve(base, path));
    const realBase = realpathSync(base);
    if (real !== realBase && !real.startsWith(realBase + sep)) return missing;
    if (!statSync(real).isFile()) return missing;
  } catch { return missing; }
  const buffer = readFileSync(real);
  return { status: "ok", path, digest: sha256(buffer), text: buffer.toString("utf8") };
}

// What `change start`, `revise`, and `amend` store in the change's runtime state.
export function snapshotFor({ previewsDir, id, draft, facts, revision, now = () => new Date().toISOString() }) {
  const page = pageFile({ previewsDir, id, draft });
  return {
    revision: Number(revision || 0),
    path: page.path,
    pageDigest: page.digest,
    factsDigest: facts === undefined ? null : factsDigest(facts),
    at: now()
  };
}

// Compare the recorded snapshot with the page and facts as they are now.
//   drift          the file differs from the digest recorded at the last start, revise, or amend
//   factsStale     the page does not contain the current facts digest
//   factsChanged   the facts themselves changed since the snapshot (new receipt, lane, ...)
// A page that is absent, or never recorded, raises none of them.
export function syncStatus(recorded, { previewsDir, id, draft, facts }) {
  const page = pageFile({ previewsDir, id, draft });
  const current = facts === undefined ? null : factsDigest(facts);
  const base = {
    advisory: true,
    file: page.status,
    path: page.path,
    recordedRevision: recorded ? Number(recorded.revision) : null,
    factsDigest: current,
    drift: false,
    factsStale: false,
    factsChanged: false
  };
  if (page.status !== "ok") return base;
  const drift = Boolean(recorded?.pageDigest) && recorded.pageDigest !== page.digest;
  const factsStale = current !== null && !page.text.includes(current);
  const factsChanged = Boolean(recorded?.factsDigest) && current !== null && recorded.factsDigest !== current;
  return { ...base, drift, factsStale, factsChanged };
}

// Text for the approval question and the data: one line per warning, or "".
export function syncWarnings(status) {
  const lines = [];
  if (status.drift)
    lines.push(`the approval page was edited after revision ${status.recordedRevision}; check it still matches the change, then run change revise (or change amend during Build)`);
  if (status.factsStale)
    lines.push(`the approval page does not carry the current facts digest ${status.factsDigest}; update its risk, proof, and role strip from the harness's current facts`);
  return lines;
}
