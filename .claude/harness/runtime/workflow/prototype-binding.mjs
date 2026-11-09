// A selected prototype becomes part of the approved agreement: the file is
// copied into the packet, so the approval identity (which hashes every packet
// byte) binds it, and a binding record names the requirements, claims, and
// tasks it constrains. Build reads the copy; Prove compares against it.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

export const PROTOTYPE_DIR = "prototype";
export const PROTOTYPE_BINDING = `${PROTOTYPE_DIR}/binding.json`;
export const PROTOTYPE_MODES = Object.freeze(["strict", "advisory"]);

const text = (value) => typeof value === "string" && value.trim() ? value.trim() : "";
const unique = (values) => [...new Set(values)];

export function prototypeMode(selection) {
  return text(selection?.mode) || "strict";
}

export function prototypeCovers(selection) {
  return Array.isArray(selection?.covers) ? unique(selection.covers.map(text).filter(Boolean)) : [];
}

// Shape and link issues. Existence and containment of the reference are
// checked with the other referenced files.
export function prototypeSelectionIssues(selection, requirementKeys = []) {
  if (selection === undefined) return [];
  const issues = [];
  if (selection?.mode !== undefined && !PROTOTYPE_MODES.includes(selection.mode))
    issues.push(`semantic draft prototypeSelection.mode must be ${PROTOTYPE_MODES.join("|")}`);
  if (selection?.covers !== undefined && (!Array.isArray(selection.covers) ||
      selection.covers.some((value) => !text(value))))
    issues.push("semantic draft prototypeSelection.covers must be an array of requirement keys");
  else {
    const known = new Set(requirementKeys);
    const unknown = prototypeCovers(selection).filter((key) => !known.has(key));
    if (unknown.length)
      issues.push(`semantic draft prototypeSelection.covers names unknown requirement keys: ${unknown.join(", ")}`);
  }
  return issues;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function containedFile(root, reference) {
  const refused = () =>
    new Error("prototypeSelection.reference must be an existing regular file inside the project");
  let canonical;
  let project;
  try {
    project = realpathSync(root);
    canonical = realpathSync(isAbsolute(reference) ? reference : resolve(root, reference));
  } catch { throw refused(); }
  const rel = relative(project, canonical);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || !statSync(canonical).isFile()) throw refused();
  return canonical;
}

// Copies the reference into <packet>/prototype/ and writes the binding record.
// Without a selection, any earlier copy is removed so a revision that drops
// the prototype leaves no stale binding.
export function materializePrototype({ root, basePath, selection, claims = [], tasks = [] }) {
  const dir = join(basePath, PROTOTYPE_DIR);
  if (!selection || !text(selection.reference)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    return null;
  }
  const source = containedFile(root, selection.reference);
  const name = basename(source) === "binding.json" ? "prototype-binding.json" : basename(source);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const target = join(dir, name);
  copyFileSync(source, target);
  const requirements = prototypeCovers(selection);
  const wanted = new Set(requirements);
  const claimIds = unique(claims.filter((claim) => wanted.has(text(claim?.requirementKey)))
    .map((claim) => claim.id)).sort();
  const claimSet = new Set(claimIds);
  const taskIds = unique(tasks.filter((task) => (task?.claims || []).some((id) => claimSet.has(id)))
    .map((task) => task.id)).sort();
  const binding = {
    version: 1,
    file: `${PROTOTYPE_DIR}/${name}`,
    source: relative(realpathSync(root), source).split("\\").join("/"),
    sha256: sha256(target),
    mode: prototypeMode(selection),
    requirements,
    claims: claimIds,
    tasks: taskIds
  };
  writeFileSync(join(basePath, PROTOTYPE_BINDING), `${JSON.stringify(binding, null, 2)}\n`);
  return binding;
}

// The binding of a compiled packet, or null. A copy whose bytes no longer match
// the recorded digest is reported, never silently trusted.
export function readPrototypeBinding(basePath) {
  const path = join(basePath, PROTOTYPE_BINDING);
  if (!existsSync(path)) return null;
  let binding;
  try { binding = JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
  if (!binding || binding.version !== 1 || !text(binding.file)) return null;
  const file = join(basePath, binding.file);
  const present = existsSync(file);
  return {
    ...binding,
    path: file,
    present,
    intact: present && sha256(file) === binding.sha256
  };
}
