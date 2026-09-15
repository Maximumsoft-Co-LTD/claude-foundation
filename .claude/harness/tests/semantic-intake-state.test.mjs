import assert from "node:assert/strict";
import test from "node:test";

import {
  reduceSemanticIntakeState,
  semanticDraftDigest,
  semanticIntakeResumeProjection,
  semanticIntakeStateIssues,
  SEMANTIC_INTAKE_STATE_VERSION
} from "../runtime/workflow/semantic-intake-state.mjs";

const route = "claude-foundation change start .foundation/drafts/contact.json --inspect";
const inventory = (digest = "a".repeat(64)) => ({
  version: 1, algorithm: "sha256", sources: [], digest: `sha256:${digest}`
});

function draft(overrides = {}) {
  return {
    version: 4,
    intent: "Add contact search",
    requirements: [{ key: "search", capability: "contacts", operation: "added" }],
    discovery: { coverage: [], decisions: [] },
    ...overrides
  };
}

function askAction(overrides = {}) {
  return {
    outcomeVersion: 2,
    action: "ASK_USER",
    owner: "user",
    boundary: "consequential-semantics",
    reason: "A product decision is ready.",
    decision: {
      kind: "requirement-semantics",
      items: [{
        key: "scope", question: "Which scope?",
        alternatives: ["one", "all"], recommended: "one"
      }]
    },
    resume: route,
    ...overrides
  };
}

test("draft digest is stable across object key ordering and changes with semantics", () => {
  const first = draft();
  const reordered = {
    discovery: { decisions: [], coverage: [] },
    requirements: [{ operation: "added", capability: "contacts", key: "search" }],
    intent: "Add contact search",
    version: 4
  };
  assert.equal(semanticDraftDigest(first), semanticDraftDigest(reordered));
  assert.notEqual(semanticDraftDigest(first), semanticDraftDigest(draft({
    intent: "Add bounded contact search"
  })));
});

test("state binds the current typed action and bounded frontier to the draft", () => {
  const state = reduceSemanticIntakeState(null, {
    draft: draft(), action: askAction(), resumeRoute: route
  });
  assert.equal(state.version, SEMANTIC_INTAKE_STATE_VERSION);
  assert.equal(state.status, "current");
  assert.equal(state.revision, 1);
  assert.deepEqual(state.frontier, ["scope"]);
  assert.equal(state.lastAction.action, "ASK_USER");
  assert.equal(state.resumeRoute, route);

  const resumed = semanticIntakeResumeProjection(state, draft());
  assert.equal(resumed.status, "current");
  assert.deepEqual(resumed.frontier, ["scope"]);
  assert.equal(resumed.action.decision.items[0].question, "Which scope?");
});

test("reducer is idempotent for the same draft, action, and route", () => {
  const first = reduceSemanticIntakeState(null, {
    draft: draft(), action: askAction(), resumeRoute: route
  });
  const second = reduceSemanticIntakeState(first, {
    draft: draft(), action: askAction(), resumeRoute: route
  });
  assert.deepEqual(second, first);
});

test("state keeps compact effectiveness counters without an interaction ledger", () => {
  const first = reduceSemanticIntakeState(null, {
    draft: draft(), action: askAction(), resumeRoute: route,
    effectiveness: {
      version: 1,
      depth: { tier: "focused" },
      coverage: { completed: 4, required: 9 },
      questions: { open: 1, accepted: 1, rejected: 0, findings: [] }
    }
  });
  assert.equal(first.effectiveness.depth.tier, "focused");
  assert.deepEqual(first.effectiveness.history, {
    observed: true, inspections: 1, questionRounds: 1,
    sourceRefreshes: 0, draftRepairs: 0
  });
  assert.equal("events" in first.effectiveness, false);
  assert.deepEqual(reduceSemanticIntakeState(first, {
    draft: draft(), action: askAction(), resumeRoute: route
  }), first);
});

test("version-1 intake snapshots remain readable and upgrade on inspection", () => {
  const current = reduceSemanticIntakeState(null, {
    draft: draft(), action: askAction(), resumeRoute: route
  });
  const legacy = structuredClone(current);
  legacy.version = 1;
  delete legacy.effectiveness;
  assert.deepEqual(semanticIntakeStateIssues(legacy), []);
  const upgraded = reduceSemanticIntakeState(legacy, {
    draft: draft(), action: askAction(), resumeRoute: route
  });
  assert.equal(upgraded.version, SEMANTIC_INTAKE_STATE_VERSION);
  assert.equal(upgraded.effectiveness.history.inspections, 1);
});

test("draft movement invalidates the prior action and never replays its frontier", () => {
  const first = reduceSemanticIntakeState(null, {
    draft: draft(), action: askAction(), resumeRoute: route
  });
  const changedDraft = draft({ intent: "Search contacts across organizations" });
  const projected = semanticIntakeResumeProjection(first, changedDraft);
  assert.equal(projected.status, "stale");
  assert.equal(projected.reason, "draft-changed");
  assert.equal(projected.action, null);
  assert.deepEqual(projected.frontier, []);
  assert.equal(projected.resumeRoute, route);

  const stale = reduceSemanticIntakeState(first, {
    draft: changedDraft, resumeRoute: route
  });
  assert.equal(stale.status, "stale");
  assert.equal(stale.lastAction, null);
  assert.deepEqual(stale.frontier, []);
  assert.equal(stale.invalidated.action, "ASK_USER");
  assert.equal(stale.invalidated.draftDigest, first.draftDigest);
  assert.match(stale.invalidated.actionDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(reduceSemanticIntakeState(stale, {
    draft: changedDraft, resumeRoute: route
  }), stale);
});

test("a fresh inspection replaces invalidated state without retaining chat history", () => {
  const first = reduceSemanticIntakeState(null, {
    draft: draft(), action: askAction(), resumeRoute: route
  });
  const changedDraft = draft({ intent: "Search contacts across organizations" });
  const done = {
    outcomeVersion: 2, action: "DONE", owner: "harness",
    boundary: "semantic-intake", reached: "intake-ready",
    reason: "Requirement discovery is complete.", resume: route
  };
  const stale = reduceSemanticIntakeState(first, {
    draft: changedDraft, resumeRoute: route
  });
  const next = reduceSemanticIntakeState(stale, {
    draft: changedDraft, action: { ...done, transcript: ["ambient chat"] }, resumeRoute: route
  });
  assert.equal(next.status, "current");
  assert.equal(next.revision, 3);
  assert.equal(next.lastAction.action, "DONE");
  assert.deepEqual(next.frontier, []);
  assert.equal(next.invalidated.action, "ASK_USER");
  assert.equal("history" in next, false);
  assert.equal("transcript" in next.lastAction, false);
});

test("state rejects mismatched routes and oversized or unsupported actions", () => {
  assert.throws(() => reduceSemanticIntakeState(null, {
    draft: draft(), action: askAction(), resumeRoute: "different --inspect"
  }), /resume route does not match/);
  assert.throws(() => reduceSemanticIntakeState(null, {
    draft: draft(), resumeRoute: route,
    action: askAction({ decision: {
      kind: "requirement-semantics",
      items: ["a", "b", "c", "d"].map((key) => ({ key }))
    } })
  }), /cannot exceed three/);
  assert.throws(() => reduceSemanticIntakeState(null, {
    draft: draft(), resumeRoute: route,
    action: { action: "RUN_EXTERNAL", owner: "external", resume: route }
  }), /cannot persist action/);
});

test("corrupt state fails closed and retains only a caller-supplied recovery route", () => {
  assert.deepEqual(semanticIntakeResumeProjection({ version: 99 }, draft(), {
    resumeRoute: route
  }), {
    version: SEMANTIC_INTAKE_STATE_VERSION,
    status: "invalid",
    reason: "invalid-state",
    action: null,
    frontier: [],
    resumeRoute: route
  });
  assert.deepEqual(semanticIntakeStateIssues({
    version: SEMANTIC_INTAKE_STATE_VERSION,
    kind: "semantic-intake",
    revision: 1,
    draftDigest: "a".repeat(64),
    status: "current",
    resumeRoute: route,
    lastAction: null,
    frontier: []
  }), [
    "semantic intake state v2 requires measured effectiveness history",
    "current semantic intake state requires lastAction"
  ]);
  const current = reduceSemanticIntakeState(null, {
    draft: draft(), action: askAction(), resumeRoute: route
  });
  assert.match(semanticIntakeStateIssues({
    ...current, frontier: ["different"]
  }).join("\n"), /frontier does not match lastAction/);
});

test("resume projection invalidates a completed action when grounded sources move", () => {
  const done = {
    outcomeVersion: 2, action: "DONE", owner: "harness",
    boundary: "semantic-intake", reached: "intake-ready", resume: route
  };
  const state = reduceSemanticIntakeState(null, {
    draft: draft(), action: done, resumeRoute: route, sourceInventory: inventory()
  });
  assert.equal(state.sourceInventory.digest, `sha256:${"a".repeat(64)}`);
  const projection = semanticIntakeResumeProjection(state, draft(), {
    sourceInventory: inventory("b".repeat(64))
  });
  assert.equal(projection.status, "stale");
  assert.equal(projection.reason, "sources-changed");
  assert.equal(projection.action, null);
});
