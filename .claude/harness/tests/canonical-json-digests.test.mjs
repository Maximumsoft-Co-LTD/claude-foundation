import assert from "node:assert/strict";
import test from "node:test";

import { gateDigest } from "../runtime/core/convergent-gate.mjs";
import { canonicalJson as manifestJson } from "../runtime/core/instruction-manifest.mjs";
import { canonicalJson, sortedJson } from "../runtime/core/trust.mjs";
import { operationInputFingerprint } from "../runtime/observability/operation-profile.mjs";
import { configDigest } from "../runtime/quality/quality-protocol.mjs";
import { semanticDraftDigest } from "../runtime/workflow/semantic-intake-state.mjs";

// Persisted receipts, signatures, and fingerprints depend on these exact bytes.
// The two serializer variants are not interchangeable: they order integer-like
// keys differently and treat undefined and non-finite values differently.
const sample = {
  z: [3, { b: null, a: "é" }], a: { y: 2.5, b: true }, 10: "n", 2: "m", s: "line\n\"q\""
};
const withGaps = {
  ...sample, gone: undefined, nan: NaN, nested: { inf: Infinity, keep: [1, null] }
};

test("canonical JSON variants keep their exact bytes", () => {
  assert.equal(canonicalJson(sample),
    "{\"10\":\"n\",\"2\":\"m\",\"a\":{\"b\":true,\"y\":2.5},\"s\":\"line\\n\\\"q\\\"\",\"z\":[3,{\"a\":\"é\",\"b\":null}]}");
  const sorted = "{\"2\":\"m\",\"10\":\"n\",\"a\":{\"b\":true,\"y\":2.5},\"nan\":null," +
    "\"nested\":{\"inf\":null,\"keep\":[1,null]},\"s\":\"line\\n\\\"q\\\"\",\"z\":[3,{\"a\":\"é\",\"b\":null}]}";
  assert.equal(sortedJson(withGaps), sorted);
  assert.equal(manifestJson(withGaps), sorted);
});

test("domain digests stay byte-identical", () => {
  assert.equal(gateDigest(withGaps),
    "6cc9b0c798ab4ce1877ab5ab927e5a43943ba4c28cfd9f9c418d6faab598a627");
  assert.equal(configDigest(sample),
    "sha256:7ca99324de87e377cb279e1423b4c10762379fbccc1d1d1629a136eac5e4c92e");
  assert.equal(operationInputFingerprint({
    operation: "validate", values: ["c", "--reason", "x"], changeDigest: "d"
  }), "sha256:4e13b0a7cdd41e6e4f2b3eb5c210d744941836833649820f24e92627ddbc0aa2");
  assert.equal(semanticDraftDigest(withGaps),
    "986864aaf3a16a744d4fca488c5d703c26dcefc1e22a37bfa49a5f19658e0866");
});
