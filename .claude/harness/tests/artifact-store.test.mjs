import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  artifactSourceCandidates,
  createArtifactStore
} from "../runtime/evidence/artifact-store.mjs";

const container = realpathSync(mkdtempSync(join(tmpdir(), "foundation-artifact-store-")));
const root = join(container, "project");
const workspace = join(container, "workspace");
const outside = join(container, "outside.txt");
mkdirSync(root);
mkdirSync(workspace);
writeFileSync(outside, "outside\n");

const pathInside = (parent, candidate) => {
  const child = relative(resolve(parent), resolve(candidate));
  return child === "" || (!child.startsWith("..") && !child.startsWith("/"));
};
const fileDigest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const fail = (message) => { throw new Error(message); };
const store = createArtifactStore({
  root,
  prototypesRoot: join(root, ".foundation", "prototypes"),
  evidenceVault: join(root, ".foundation", "evidence"),
  canonicalPath: resolve,
  providerWorkspace: () => workspace,
  proofRunRoot: (id, run) => join(root, ".foundation", "evidence", id, run),
  pathInside,
  fileDigest,
  fail
});

try {
  assert.deepEqual(
    artifactSourceCandidates(root, workspace, { path: "report.json" }),
    [join(workspace, "report.json"), join(root, "report.json")]
  );
  assert.deepEqual(
    artifactSourceCandidates(root, workspace, { path: "log.txt", type: "command-log" }),
    [join(root, "log.txt"), join(workspace, "log.txt")]
  );
  assert.deepEqual(
    artifactSourceCandidates(root, workspace, { path: ".foundation/log.txt" }),
    [join(root, ".foundation", "log.txt"), join(workspace, ".foundation", "log.txt")]
  );

  assert.throws(() => store.durableArtifact("c", "test", "r", null), /requires a path/);
  assert.throws(() => store.durableArtifact("c", "test", "r", { path: 1 }), /requires a path/);
  assert.deepEqual(
    store.durableArtifact("c", "test", "r", { path: "optional.json", required: false }),
    { path: "optional.json", required: false, missing: true }
  );
  assert.throws(
    () => store.durableArtifact("c", "test", "r", { path: "missing.json" }),
    /required artifact is missing/
  );

  writeFileSync(join(workspace, "report file.json"), "workspace\n");
  writeFileSync(join(root, "report file.json"), "project\n");
  const artifact = store.durableArtifact("c", "test", "r", { path: "report file.json" });
  assert.equal(artifact.sourcePath, "report file.json");
  assert.equal(artifact.type, "artifact");
  assert.equal(artifact.required, true);
  assert.equal(artifact.size, 10);
  assert.match(artifact.path, /artifacts\/test\/[a-f0-9]{12}-report-file.json$/);
  assert.equal(readFileSync(join(root, artifact.path), "utf8"), "workspace\n");
  assert.deepEqual(store.durableArtifact("c", "test", "r", { path: "report file.json" }), artifact);

  writeFileSync(join(root, "control.log"), "project control\n");
  writeFileSync(join(workspace, "control.log"), "workspace control\n");
  const control = store.durableArtifact("c", "test", "r", {
    path: "control.log",
    type: "service-log",
    required: false
  });
  assert.equal(control.sourcePath, "control.log");
  assert.equal(control.type, "service-log");
  assert.equal(control.required, false);
  assert.equal(readFileSync(join(root, control.path), "utf8"), "project control\n");

  mkdirSync(join(workspace, "directory"));
  assert.throws(
    () => store.durableArtifact("c", "test", "r", { path: "directory" }),
    /not a regular file/
  );
  symlinkSync(outside, join(workspace, "escape.txt"));
  assert.throws(
    () => store.durableArtifact("c", "test", "r", { path: "escape.txt" }),
    /escapes the project workspace/
  );
} finally {
  rmSync(container, { recursive: true, force: true });
}
