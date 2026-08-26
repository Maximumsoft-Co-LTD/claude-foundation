import assert from "node:assert/strict";
import test from "node:test";
import {
  createReviewProtocol,
  legacySubjectProvenance,
  structuredSubjectProvenance,
  subjectProvenanceOperation
} from "../runtime/evidence/review-protocol.mjs";

const fail = (message) => { throw new Error(message); };

function flagValues(flags, name) {
  const value = flags[name];
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

test("structured provenance accepts one or repeated JSON tuples", () => {
  const human = { type: "human", identity: "alice" };
  const ai = {
    type: "ai", identity: "agent", sessionId: "session-1",
    providerFamily: "openai", modelFamily: "gpt", modelId: "gpt-5"
  };
  assert.deepEqual(structuredSubjectProvenance({ fail }, JSON.stringify(human)), [human]);
  assert.deepEqual(structuredSubjectProvenance({ fail }, [
    JSON.stringify(human), JSON.stringify(ai)
  ]), [human, ai]);
  assert.deepEqual(structuredSubjectProvenance({ fail }, undefined), []);
});

test("structured provenance rejects malformed JSON with the established message", () => {
  assert.throws(() => structuredSubjectProvenance({ fail }, "{broken"),
    /invalid --subject-provenance JSON/);
});

test("legacy provenance infers human when only identity is present", () => {
  assert.deepEqual(legacySubjectProvenance({ flagValues, fail }, {
    "subject-actor": " Alice "
  }), [{
    type: "human",
    identity: "Alice",
    sessionId: null,
    providerFamily: null,
    modelFamily: null,
    modelId: null
  }]);
  assert.deepEqual(legacySubjectProvenance({ flagValues, fail }, {}), []);
});

test("legacy provenance infers AI and normalizes provider/model families", () => {
  assert.deepEqual(legacySubjectProvenance({ flagValues, fail }, {
    "subject-actor": "agent",
    "subject-session": "session-1",
    "subject-provider-family": "OpenAI",
    "subject-model-family": "GPT",
    "subject-model": "gpt-5.6"
  }), [{
    type: "ai",
    identity: "agent",
    sessionId: "session-1",
    providerFamily: "openai",
    modelFamily: "gpt",
    modelId: "gpt-5.6"
  }]);
});

test("legacy provenance rejects multiple values in every legacy field", () => {
  for (const name of [
    "subject-actor", "subject-session", "subject-provider-family",
    "subject-model-family", "subject-model"
  ])
    assert.throws(() => legacySubjectProvenance({ flagValues, fail }, {
      "subject-actor": "agent",
      [name]: ["one", "two"]
    }), /multiple implementers require repeated --subject-provenance JSON tuples/);
});

test("structured provenance takes precedence over conflicting legacy flags", () => {
  const structured = { type: "human", identity: "structured" };
  assert.deepEqual(subjectProvenanceOperation({ flagValues, fail }, {
    "subject-provenance": JSON.stringify(structured),
    "subject-actor": ["legacy-one", "legacy-two"]
  }), [structured]);
});

test("review protocol exposes the decomposed provenance operation", () => {
  const protocol = createReviewProtocol({ stableHash: JSON.stringify, fail });
  assert.deepEqual(protocol.subjectProvenance({
    "subject-actor": "agent",
    "subject-provider-family": "Anthropic"
  }), [{
    type: "ai",
    identity: "agent",
    sessionId: null,
    providerFamily: "anthropic",
    modelFamily: null,
    modelId: null
  }]);
});
