import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROCESS_FIELDS, complianceAction, renderCommunication, renderComplianceRecord, renderDecisionLog,
  renderDemo, renderReleaseNote, validateCommunication, validateCompliance, validateDecisionLog,
  validateDemo, validateReleaseNote,
} from "../runtime/workflow/validation/process-fields.mjs";

const decisions = [
  { date: "2026-10-01", question: "Which lane?", options: ["standard", "rapid"], recommendation: "standard", answer: "standard", by: "alice" },
  { date: "2026-10-02", question: "Keep v1 route?", options: ["yes", "no"], answer: "no", by: "bob" },
];

test("decision log with two rows renders a date/question/options/answer/by table", () => {
  assert.deepEqual(validateDecisionLog(decisions), []);
  const body = renderDecisionLog(decisions, { language: "en" });
  const lines = body.split("\n");
  assert.equal(lines[0], "| Date | Question | Options | Answer | By |");
  assert.equal(lines.length, 4);
  assert.match(lines[2], /^\| 2026-10-01 \| Which lane\? \| standard \(recommended\); rapid \| standard \| alice \|$/);
  assert.match(lines[3], /\| bob \|$/);
  assert.doesNotMatch(body, /\[object Object\]/);
});

test("decision log rows require options and the answering person", () => {
  const issues = validateDecisionLog([{ date: "2026-10-01", question: "Q?", options: [], answer: "a" }]);
  assert.ok(issues.includes("decisionLog[0].by is required"));
  assert.ok(issues.includes("decisionLog[0].options must not be empty"));
});

test("compliance approver equal to implementer is an issue and an agent edit", () => {
  const value = { requester: "carol", approver: "dave", implementer: "Dave", approvedBefore: "build" };
  const issues = validateCompliance(value, "compliance", { enabled: true });
  assert.deepEqual(issues, ["compliance.approver must differ from compliance.implementer"]);
  const action = complianceAction(value, { enabled: true });
  assert.equal(action.owner, "agent");
  assert.equal(action.kind, "edit");
  assert.ok(action.issues.some((issue) => issue.startsWith("compliance.approver")));
});

test("missing approver with compliance enabled asks the user once for compliance.approver", () => {
  const action = complianceAction({ requester: "carol", approvedBefore: "build" }, { enabled: true });
  assert.equal(action.owner, "user");
  assert.equal(action.kind, "ask");
  assert.equal(action.field, "compliance.approver");
  assert.ok(action.question.length > 0);
  assert.equal(complianceAction(undefined, { enabled: true }).field, "compliance.approver");
});

test("compliance disabled and absent yields no issues and no action", () => {
  assert.deepEqual(validateCompliance(undefined, "compliance", { enabled: false }), []);
  assert.equal(complianceAction(undefined, { enabled: false }), null);
  assert.equal(renderComplianceRecord(undefined), "");
});

test("compliance requires approval before build unless emergency with retrospective approval", () => {
  const base = { requester: "carol", approver: "erin", implementer: "dave" };
  assert.ok(validateCompliance({ ...base, approvedBefore: "land" }, "compliance", { enabled: true })
    .includes('compliance.approvedBefore must be "build" unless compliance.emergency is true'));
  assert.deepEqual(validateCompliance({ ...base, emergency: true }, "compliance", { enabled: true }),
    ["compliance.retrospectiveApproval is required for an emergency change"]);
  assert.deepEqual(validateCompliance({ ...base, emergency: true, retrospectiveApproval: "CAB 2026-10-03" },
    "compliance", { enabled: true }), []);
  assert.equal(complianceAction({ ...base, approvedBefore: "build" }, { enabled: true }), null);
});

test("compliance record renders a two-column table", () => {
  const body = renderComplianceRecord({ requester: "carol", approver: "erin", implementer: "dave", approvedBefore: "build", emergency: false });
  assert.match(body, /^\| Item \| Value \|/);
  assert.match(body, /\| Approver \| erin \|/);
  assert.match(body, /\| Emergency \| no \|/);
});

test("categorized release note renders Keep a Changelog bullets", () => {
  const note = { added: ["Export CSV"], fixed: "Login redirect loop" };
  assert.deepEqual(validateReleaseNote(note), []);
  assert.equal(renderReleaseNote(note, { language: "en" }),
    "**Added**\n\n- Export CSV\n\n**Fixed**\n\n- Login redirect loop");
  assert.equal(renderReleaseNote("Plain note."), "Plain note.");
  assert.deepEqual(validateReleaseNote(""), ["releaseNote must not be empty"]);
  assert.ok(validateReleaseNote({ news: "x" }).some((issue) => issue.startsWith("releaseNote.news")));
});

test("empty demo is an issue; steps render as a numbered list", () => {
  assert.deepEqual(validateDemo([]), ["demo must not be empty"]);
  assert.equal(renderDemo(["Open settings", "Click export"]), "1. Open settings\n2. Click export");
});

test("communication accepts array and object forms", () => {
  const rows = [{ audience: "admins", channel: "email", when: "launch day" }];
  assert.deepEqual(validateCommunication(rows), []);
  const object = { rows, owner: "support team", supportRunbook: "docs/runbook.md", userDocs: ["docs/export.md"] };
  assert.deepEqual(validateCommunication(object), []);
  assert.ok(validateCommunication({ rows: [{ audience: "a" }] }).includes("communication.rows[0].channel is required"));
  const body = renderCommunication(object, { language: "en" });
  assert.match(body, /\| Audience \| Channel \| When \|/);
  assert.match(body, /- Support owner: support team/);
  assert.match(body, /- User docs: docs\/export\.md/);
});

test("Thai labels are used for th", () => {
  assert.match(renderDecisionLog(decisions, { language: "th" }), /^\| วันที่ \| คำถาม \| ตัวเลือก \| คำตอบ \| ผู้ตอบ \|/);
  assert.match(renderReleaseNote({ added: ["x"] }, { language: "th" }), /\*\*เพิ่ม\*\*/);
  assert.match(renderComplianceRecord({ approver: "erin" }, { language: "th" }), /\| ผู้อนุมัติ \| erin \|/);
});

test("PROCESS_FIELDS exposes validate and render for every process field", () => {
  assert.deepEqual(Object.keys(PROCESS_FIELDS), ["decisionLog", "communication", "releaseNote", "demo", "compliance"]);
  for (const field of Object.values(PROCESS_FIELDS)) {
    assert.equal(typeof field.validate, "function");
    assert.equal(typeof field.render, "function");
  }
});
