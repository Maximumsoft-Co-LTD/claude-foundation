import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import test from "node:test";

import { createReceiptValidity, receiptIsPreview, validityRecovery } from "../runtime/evidence/receipt-validity.mjs";
import { createArtifactStore } from "../runtime/evidence/artifact-store.mjs";

function project(t) {
  const root = mkdtempSync(join(tmpdir(), "foundation-preview-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("a preview receipt copied into the receipt store is refused as preview-evidence", (t) => {
  const root = project(t);
  const receiptPath = (id, provider) => join(root, ".foundation", "receipts", id, `${provider}.json`);
  mkdirSync(join(root, ".foundation", "receipts", "demo"), { recursive: true });
  writeFileSync(receiptPath("demo", "test"), JSON.stringify({
    kind: "preview", provider: "test", status: "pass", providerProtocolVersion: "13"
  }));
  const { receiptValidity } = createReceiptValidity({
    providerProtocolVersion: "13", receiptPath,
    readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
    receiptPrototypeEvidence: () => false,
    relevantHash: () => "workspace"
  });
  const result = receiptValidity("demo", "test");
  assert.equal(result.validity, "preview-evidence");
  assert.match(validityRecovery("preview-evidence", "demo", "test"), /never proof/);
  assert.equal(receiptIsPreview({ kind: "preview" }), true);
  assert.equal(receiptIsPreview({ status: "pass" }), false);
});

test("artifacts or references under .foundation/previews cannot satisfy evidence", (t) => {
  const root = project(t);
  const workspace = join(root, ".foundation", "sandboxes", "demo");
  mkdirSync(join(root, ".foundation", "previews", "demo", "workspace"), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  const store = createArtifactStore({
    root, prototypesRoot: join(root, ".foundation", "prototypes"),
    evidenceVault: join(root, ".foundation", "evidence"),
    canonicalPath: (path) => resolve(path),
    providerWorkspace: () => workspace,
    proofRunRoot: () => join(root, ".foundation", "runs"),
    pathInside: (parent, child) => { const rel = relative(parent, child); return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep)); },
    fileDigest: () => "digest",
    fail: (message) => { throw new Error(message); }
  });
  assert.equal(store.evidenceInputTargetsPrototype(".foundation/previews/demo/workspace/log.txt", workspace), true);
  assert.equal(store.evidenceInputTargetsPrototype(join(root, ".foundation", "previews", "demo"), workspace), true);
  assert.equal(store.evidenceInputTargetsPrototype("src/app.js", workspace), false);
  assert.throws(() => store.rejectPrototypeEvidenceInputs("demo", "test",
    [{ path: ".foundation/previews/demo/receipts/test.json" }], []), /preview/);
});
