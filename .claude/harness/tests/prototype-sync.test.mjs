import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { factsDigest, pageFile, snapshotFor, syncStatus, syncWarnings } from "../runtime/workflow/prototype-sync.mjs";

const draft = (path = "prototype.html") => ({ workType: ["ui"], examples: [{ type: "prototype", title: "p", path }] });
const FACTS = { level: "Medium", proof: 0, lanes: [] };

function fixture(t) {
  const previewsDir = mkdtempSync(join(tmpdir(), "foundation-prototype-sync-"));
  t.after(() => rmSync(previewsDir, { recursive: true, force: true }));
  const put = (name, text) => {
    const path = join(previewsDir, "demo", name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  return { previewsDir, put, args: (extra = {}) => ({ previewsDir, id: "demo", draft: draft(), facts: FACTS, ...extra }) };
}

test("the facts digest is stable across key order and changes when a fact changes", () => {
  assert.equal(factsDigest({ a: 1, b: [1, { c: 2, d: 3 }] }), factsDigest({ b: [1, { d: 3, c: 2 }], a: 1 }));
  assert.notEqual(factsDigest({ proof: 0 }), factsDigest({ proof: 1 }));
  assert.match(factsDigest(FACTS), /^[0-9a-f]{16}$/);
});

test("a page edited after the recorded revision is reported as drift, and does not block", (t) => {
  const { put, args } = fixture(t);
  put("prototype.html", `v1 ${factsDigest(FACTS)}`);
  const recorded = snapshotFor({ ...args(), revision: 2 });
  assert.equal(syncStatus(recorded, args()).drift, false, "unchanged file");
  put("prototype.html", `v2 edited ${factsDigest(FACTS)}`);
  const status = syncStatus(recorded, args());
  assert.equal(status.drift, true);
  assert.equal(status.recordedRevision, 2);
  assert.equal(status.advisory, true);
  assert.match(syncWarnings(status)[0], /edited after revision 2/);
});

test("recording again after a revise clears the drift", (t) => {
  const { put, args } = fixture(t);
  put("prototype.html", `v1 ${factsDigest(FACTS)}`);
  const first = snapshotFor({ ...args(), revision: 2 });
  put("prototype.html", `v2 ${factsDigest(FACTS)}`);
  assert.equal(syncStatus(first, args()).drift, true);
  const second = snapshotFor({ ...args(), revision: 3 });
  const status = syncStatus(second, args());
  assert.equal(status.drift, false);
  assert.equal(status.recordedRevision, 3);
});

test("a page without the current facts digest is stale, and an updated one is not", (t) => {
  const { put, args } = fixture(t);
  put("prototype.html", "page with an old facts digest 0123456789abcdef");
  const recorded = snapshotFor({ ...args(), revision: 1 });
  const stale = syncStatus(recorded, args());
  assert.equal(stale.factsStale, true);
  assert.match(syncWarnings(stale).join("\n"), new RegExp(factsDigest(FACTS)));
  put("prototype.html", `page with ${factsDigest(FACTS)}`);
  assert.equal(syncStatus(recorded, args()).factsStale, false);
});

test("facts that changed since the snapshot are reported even when the page was not edited", (t) => {
  const { put, args } = fixture(t);
  put("prototype.html", `page ${factsDigest(FACTS)}`);
  const recorded = snapshotFor({ ...args(), revision: 1 });
  const status = syncStatus(recorded, args({ facts: { ...FACTS, proof: 2 } }));
  assert.equal(status.factsChanged, true);
  assert.equal(status.factsStale, true, "the page carries the old digest");
  assert.equal(status.drift, false);
});

test("a missing page raises no drift or facts warning", (t) => {
  const { args } = fixture(t);
  const recorded = snapshotFor({ ...args(), revision: 1 });
  assert.equal(recorded.pageDigest, null);
  const status = syncStatus(recorded, args());
  assert.equal(status.file, "missing");
  assert.equal(status.drift, false);
  assert.equal(status.factsStale, false);
  assert.deepEqual(syncWarnings(status), []);
});

test("a change with no prototype example, or with nothing recorded yet, raises nothing", (t) => {
  const { put, args } = fixture(t);
  assert.equal(syncStatus(null, args({ draft: { workType: ["ui"] } })).file, "none");
  put("prototype.html", "page");
  const status = syncStatus(null, args());
  assert.equal(status.drift, false, "nothing recorded to compare with");
  assert.equal(status.recordedRevision, null);
});

test("the page path must stay inside the change's previews folder", (t) => {
  const { put, previewsDir } = fixture(t);
  put("prototype.html", "inside");
  writeFileSync(join(previewsDir, "outside.html"), "outside");
  for (const path of ["../outside.html", "/etc/hosts", "https://example.com/p.html", ""]) {
    assert.equal(pageFile({ previewsDir, id: "demo", draft: draft(path) }).status, "missing", path || "(empty)");
  }
  symlinkSync(join(previewsDir, "outside.html"), join(previewsDir, "demo", "link.html"));
  assert.equal(pageFile({ previewsDir, id: "demo", draft: draft("link.html") }).status, "missing", "a symlink out is refused");
  assert.equal(pageFile({ previewsDir, id: "demo", draft: draft("prototype.html") }).status, "ok");
});

test("the status only reports; it exposes no gate for Prove or Land to read", (t) => {
  const { put, args } = fixture(t);
  put("prototype.html", "x");
  const status = syncStatus(snapshotFor({ ...args(), revision: 1 }), args());
  assert.equal(status.advisory, true);
  assert.equal(typeof status.blocked, "undefined");
});
