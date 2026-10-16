import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTRACT_FIELDS,
  renderApiContracts,
  renderConfigContract,
  renderDataModel,
  renderEventContracts,
  renderUi,
  validateApiContracts,
  validateConfigContract,
  validateDataModel,
  validateEventContracts,
  validateUi,
} from "../runtime/workflow/validation/contract-fields.mjs";

const fullApi = [{
  method: "POST", path: "/orders", resource: "Order", source: "openapi/orders.yaml#/paths/~1orders",
  breakingCheck: "oasdiff breaking in CI", auth: "session; foreign orders answer 404",
  request: { body: { sku: "string, max 64", quantity: "integer 1..100" } },
  response: { status: 201, body: "Order" },
  errorEnvelope: { code: "STABLE_CODE", message: "human text", errors: [{ field: "quantity" }], requestId: "req_123" },
  errors: [
    { status: 400, code: "VALIDATION_FAILED", when: "body fails schema", retryable: false },
    { status: 409, code: "IN_FLIGHT", when: "same key still running", retryable: true },
    { status: 422, code: "KEY_REUSED", when: "same key, different payload", retryable: false },
  ],
  idempotency: { header: "Idempotency-Key", required: true, scope: ["client", "endpoint"],
    retention: "24h", replay: "verbatim", inFlight: 409, mismatch: 422 },
  pagination: { style: "cursor", order: "createdAt desc, id desc", defaultLimit: 20, maxLimit: 100,
    filters: ["status"] },
  rateLimit: "60/min per client with Retry-After",
  versioning: "URL major version", compatibility: "additive only",
  deprecation: { announce: "2026-11-01", sunset: "2027-05-01", headers: "Deprecation, Sunset",
    usageMetric: "api_calls{route=/orders,consumer}", removeWhen: "usage is zero for 30 days" },
  consumers: ["web", "mobile"],
}];

const oldApi = [{ method: "GET", path: "/results", auth: "session", request: "none",
  response: { status: 200, body: "list" },
  errors: [{ status: 404, when: "missing" }, "rate limited", { code: "CONFLICT_STATE" }],
  idempotency: "safe GET", compatibility: "additive" }];

const event = [{
  name: "order.placed", version: 2, channel: "orders", action: "send",
  payload: { orderId: "uuid", total: "minor units" }, headers: ["traceparent"],
  delivery: "at-least-once", dedupKey: "eventId", orderingKey: "orderId", correlation: "x-request-id",
  retry: "5x exponential then DLQ orders.dlq", compatibility: "backward (add optional fields only)",
  consumers: ["billing", "email"],
  consumerHandling: { duplicates: "ignore seen eventId", late: "apply if newer version",
    outOfOrder: "drop when sequence <= stored" },
}];

test("a full API contract validates and renders the error table, envelope, idempotency, deprecation", () => {
  assert.deepEqual(validateApiContracts(fullApi), []);
  const md = renderApiContracts(fullApi, { language: "en" });
  assert.match(md, /^### POST \/orders/);
  assert.match(md, /\| Part \| Contract \|/);
  assert.match(md, /\| Idempotency \| header: Idempotency-Key; required; scope: client; endpoint; retention: 24h; replay: verbatim; in-flight: 409; payload mismatch: 422 \|/);
  assert.match(md, /\| Pagination \| style: cursor; order: createdAt desc, id desc; default limit: 20; max limit: 100; filters: status \|/);
  assert.match(md, /\| Status \| Code \| When \| Retryable \|/);
  assert.match(md, /\| 409 \| IN_FLIGHT \| same key still running \| yes \|/);
  assert.match(md, /\| 400 \| VALIDATION_FAILED \| body fails schema \| no \|/);
  assert.match(md, /```json\n\{\n {2}"code": "STABLE_CODE"/);
  assert.match(md, /\| Remove when \| usage is zero for 30 days \|/);
  assert.match(md, /\| Consumers \| web; mobile \|/);
  assert.doesNotMatch(md, /\[object Object\]/);
});

test("the older apiContracts shape validates with no new issues and still renders", () => {
  assert.deepEqual(validateApiContracts(oldApi), []);
  const md = renderApiContracts(oldApi);
  assert.match(md, /### GET \/results/);
  assert.match(md, /\| Auth \| session \|/);
  assert.match(md, /\| Response \| status: 200, body: list \|/);
  assert.match(md, /\| Idempotency \| safe GET \|/);
  assert.match(md, /\| 404 \| — \| missing \| — \|/);
  assert.match(md, /\| — \| — \| rate limited \| — \|/);
  assert.doesNotMatch(md, /\[object Object\]/);
  assert.match(renderApiContracts([{ method: "GET", path: "/x", errors: "none" }]), /\| — \| — \| none \| — \|/);
});

test("idempotency without scope or retention names the exact path", () => {
  const issues = validateApiContracts([{ ...oldApi[0], idempotency: { header: "Idempotency-Key", replay: "again", inFlight: "busy" } }]);
  assert.deepEqual(issues, [
    "apiContracts[0].idempotency.scope is required",
    "apiContracts[0].idempotency.retention is required",
    "apiContracts[0].idempotency.replay must be one of verbatim",
    "apiContracts[0].idempotency.inFlight must be an HTTP status",
  ]);
});

test("new optional API subfields are typed", () => {
  const issues = validateApiContracts([{ ...oldApi[0],
    errors: [{ status: 503, when: "down", retryable: "maybe" }],
    errorEnvelope: { code: "C" },
    pagination: { style: "cursor", defaultLimit: 200, maxLimit: 100 },
    deprecation: { announce: "soon" }, consumers: "web" }]);
  assert.ok(issues.includes("apiContracts[0].errors[0].retryable must be true or false"));
  assert.ok(issues.includes("apiContracts[0].errorEnvelope.message is required"));
  assert.ok(issues.includes("apiContracts[0].errorEnvelope.requestId is required"));
  assert.ok(issues.includes("apiContracts[0].pagination.order is required"));
  assert.ok(issues.includes("apiContracts[0].pagination.defaultLimit must not exceed maxLimit"));
  assert.ok(issues.includes("apiContracts[0].deprecation.sunset is required"));
  assert.ok(issues.includes("apiContracts[0].consumers must be a list of strings"));
  assert.deepEqual(validateApiContracts({}), []);
  assert.deepEqual(validateApiContracts("x"), ["apiContracts must be a list"]);
});

test("an event contract validates and renders delivery, dedup, ordering, and consumer handling", () => {
  assert.deepEqual(validateEventContracts(event), []);
  const md = renderEventContracts(event);
  assert.match(md, /^### order\.placed v2/);
  assert.match(md, /\| Delivery \| at-least-once \|/);
  assert.match(md, /\| Dedup key \| eventId \|/);
  assert.match(md, /\| Ordering key \| orderId \|/);
  assert.match(md, /\| Retry\/DLQ \| 5x exponential then DLQ orders\.dlq \|/);
  assert.match(md, /\| Consumer handling \| duplicates: ignore seen eventId; late: apply if newer version; out-of-order: drop when sequence <= stored \|/);
  assert.match(md, /\| Payload \| orderId: uuid, total: minor units \|/);
  assert.doesNotMatch(md, /\[object Object\]/);
});

test("an incomplete event contract names each missing path", () => {
  assert.deepEqual(validateEventContracts([{ name: "x", channel: "c" }]), [
    "eventContracts[0].version is required",
    "eventContracts[0].delivery is required",
    "eventContracts[0].dedupKey is required",
    "eventContracts[0].retry is required",
    "eventContracts[0].compatibility is required",
    "eventContracts[0].consumers is required",
  ]);
});

test("Thai labels render for language th", () => {
  const api = renderApiContracts(fullApi, { language: "th" });
  assert.match(api, /\| ส่วน \| สัญญา \|/);
  assert.match(api, /\| Status \| Code \| เมื่อ \| ลองใหม่ได้ \|/);
  assert.match(api, /\| 409 \| IN_FLIGHT \| same key still running \| ได้ \|/);
  assert.match(api, /ขอบเขต: client; endpoint/);
  assert.match(api, /\*\*การเลิกใช้:\*\*/);
  assert.doesNotMatch(api, /\| Part \| Contract \|/);
  const events = renderEventContracts(event, { language: "th" });
  assert.match(events, /\| การส่ง \| at-least-once \|/);
  assert.match(events, /\| คีย์กันซ้ำ \| eventId \|/);
  assert.match(events, /ซ้ำ: ignore seen eventId/);
});

test("empty values render nothing and CONTRACT_FIELDS exposes every contract key", () => {
  assert.equal(renderApiContracts([]), "");
  assert.equal(renderApiContracts(undefined), "");
  assert.equal(renderEventContracts([]), "");
  assert.equal(renderDataModel(undefined), "");
  assert.equal(renderUi({}), "");
  assert.equal(renderConfigContract([]), "");
  assert.deepEqual(Object.keys(CONTRACT_FIELDS),
    ["apiContracts", "eventContracts", "dataModel", "ui", "configContract"]);
  assert.equal(CONTRACT_FIELDS.dataModel.validate, validateDataModel);
  assert.equal(CONTRACT_FIELDS.ui.render, renderUi);
  assert.equal(CONTRACT_FIELDS.configContract.validate, validateConfigContract);
  assert.equal(CONTRACT_FIELDS.apiContracts.validate, validateApiContracts);
  assert.equal(CONTRACT_FIELDS.eventContracts.render, renderEventContracts);
});


const oldData = [{ entity: "Card", fields: [{ name: "title", type: "text", constraints: "not null" }],
  migration: "add column", rollback: "drop column" }];

const fullData = {
  store: "postgres orders db", owner: "orders team",
  entities: [{
    name: "Order", relations: [{ to: "OrderLine", cardinality: "one-to-many", label: "contains" }],
    columns: [
      { name: "id", type: "uuid", nullable: false, constraint: "primary key", change: "existing" },
      { name: "email", type: "text", nullable: true, dataClass: "PII", change: "add" },
    ],
    indexes: [{ name: "orders_email_idx", columns: ["email"], unique: false, online: true, reason: "lookup by email" }],
    invariants: ["total equals sum of lines"], volume: "2M rows, +50k/day", retention: "7 years",
  }, { name: "OrderLine", columns: [{ name: "order_id", type: "uuid", nullable: false, change: "existing" }] }],
  migration: [
    { phase: "expand", action: "add nullable email", reversible: true, task: "T001" },
    { phase: "migrate", action: "backfill email", reversible: true },
    { phase: "contract", action: "drop legacy column", reversible: false, task: "T009" },
  ],
  recovery: { backup: "daily snapshot", rpo: "1h", rto: "4h", restoreTest: "quarterly" },
  dataContract: { freshness: "15 min", frequency: "hourly", qualityRules: ["email unique per tenant"],
    retention: "7 years", endOfLife: "2030-01-01" },
};

const fullUi = {
  surface: "Checkout", users: ["shopper"], platforms: ["web"], languages: ["en", "th"],
  designRef: "figma.com/file/abc", entryInfo: ["cart total", "delivery date"],
  flow: ["cart", "address", "pay"],
  states: [
    { key: "loading", shows: "skeleton", next: "wait" },
    { key: "invalid", shows: "field errors", next: "fix and resubmit", scenario: "checkout rejects bad card" },
  ],
  preserveInput: true,
  i18n: { formats: "number, currency THB, date", timezone: "user tz shown, UTC stored", bidi: false, source: "Crowdin" },
  accessibility: {
    standard: "WCAG 2.2 AA",
    rows: [
      { criterion: "2.4.7 Focus visible", kind: "standard", how: "outline token", check: "axe + keyboard pass" },
      { criterion: "Escape closes dialog", kind: "convention", how: "key handler", check: "e2e" },
      { criterion: "Errors near field", kind: "heuristic", how: "inline message", check: "usability test" },
    ],
    untested: ["VoiceOver iOS"],
  },
  acr: "update VPAT row 2.4.7", responsive: "single column under 600px",
  components: [{ name: "PaymentForm", change: "new" }],
  validation: { method: "moderated test", participants: 5, task: "buy one item", pass: "4 of 5 succeed", severity: "Nielsen 0-4" },
};

test("the older dataModel and configContract shapes validate and render", () => {
  assert.deepEqual(validateDataModel(oldData), []);
  const data = renderDataModel(oldData);
  assert.match(data, /^### Card/);
  assert.match(data, /\| Field \| Type \| Constraints \|\n\|---\|---\|---\|\n\| title \| text \| not null \|/);
  assert.match(data, /- \*\*Migration:\*\* add column/);
  assert.match(data, /- \*\*Rollback:\*\* drop column/);
  assert.match(renderDataModel([{ entity: "Tag", fields: ["name"], migration: "none" }]), /### Tag\n\n- name/);
  const config = [{ key: "LIMIT", default: "10", validation: "1-100" }];
  assert.deepEqual(validateConfigContract(config), []);
  assert.match(renderConfigContract(config),
    /\| Key \| Type \| Default \| Validation \| Secret \| Per-environment \| Reload \| Owner \| Removal task \|\n\|---\|---\|---\|---\|---\|---\|---\|---\|---\|\n\| LIMIT \| — \| 10 \| 1-100 \| — \| — \| — \| — \| — \|/);
});

test("a full data model renders the ER diagram, schema, indexes, migration phases, recovery, and data contract", () => {
  assert.deepEqual(validateDataModel(fullData), []);
  const md = renderDataModel(fullData);
  assert.match(md, /- \*\*Store:\*\* postgres orders db/);
  assert.match(md, /```mermaid\nerDiagram\n {2}Order \|\|--o\{ OrderLine : "contains"\n```/);
  assert.match(md, /\| Column \| Type \| Nullable \| Constraint \| Data class \| Change \|/);
  assert.match(md, /\| email \| text \| yes \| — \| PII \| add \|/);
  assert.match(md, /\| Index \| Columns \| Unique \| Online \| Reason \|/);
  assert.match(md, /\| orders_email_idx \| email \| no \| yes \| lookup by email \|/);
  assert.match(md, /- \*\*Invariants:\*\* total equals sum of lines/);
  assert.match(md, /- \*\*Retention:\*\* 7 years/);
  assert.match(md, /\*\*Migration phases:\*\*\n\n\| Phase \| Action \| Reversible \| Task \|/);
  assert.match(md, /\| contract \| drop legacy column \| no \| T009 \|/);
  assert.match(md, /- \*\*RPO:\*\* 1h/);
  assert.match(md, /\*\*Data contract:\*\*\n\n- \*\*Freshness:\*\* 15 min\n- \*\*Update frequency:\*\* hourly/);
  assert.match(md, /- \*\*End of life:\*\* 2030-01-01/);
  assert.doesNotMatch(md, /\[object Object\]/);
  assert.doesNotMatch(renderDataModel(oldData), /erDiagram/);
});

test("data model subfields name their exact paths", () => {
  const issues = validateDataModel({
    entities: [{ columns: [{ name: "x", nullable: "no" }], indexes: [{ name: "i" }],
      relations: [{ to: "Y", cardinality: "lots" }] }],
    migration: [{ phase: "shrink", action: "a", reversible: "maybe" }],
    dataContract: { freshness: "1h" },
  });
  assert.deepEqual(issues, [
    "dataModel.entities[0].name is required",
    "dataModel.entities[0].relations[0].cardinality must be one of one-to-one, one-to-many, many-to-one, many-to-many",
    "dataModel.entities[0].columns[0].type is required",
    "dataModel.entities[0].columns[0].change is required",
    "dataModel.entities[0].columns[0].nullable must be true or false",
    "dataModel.entities[0].indexes[0].columns is required",
    "dataModel.migration[0].phase must be one of expand, migrate, contract",
    "dataModel.migration[0].reversible must be true or false",
    "dataModel.dataContract.frequency is required",
    "dataModel.dataContract.retention is required",
  ]);
  assert.deepEqual(validateDataModel("x"), ["dataModel must be a list or an object"]);
});

test("a full UI contract renders states, i18n, accessibility kinds, components, and the validation plan", () => {
  assert.deepEqual(validateUi(fullUi), []);
  const md = renderUi(fullUi);
  assert.match(md, /- \*\*Flow:\*\* cart → address → pay/);
  assert.match(md, /\| State \| User sees \| Can do next \| Scenario \|/);
  assert.match(md, /\| invalid \| field errors \| fix and resubmit \| checkout rejects bad card \|/);
  assert.match(md, /- \*\*Input preserved on error:\*\* yes/);
  assert.match(md, /\*\*i18n:\*\*\n\n- \*\*Locale formats:\*\* number, currency THB, date/);
  assert.match(md, /- \*\*Bidi text:\*\* no/);
  assert.match(md, /\*\*Accessibility:\*\* WCAG 2\.2 AA/);
  assert.match(md, /\| Criterion \| Kind \| How \| Check \|/);
  assert.match(md, /\| 2\.4\.7 Focus visible \| standard \| outline token \| axe \+ keyboard pass \|/);
  assert.match(md, /\| Escape closes dialog \| convention \|/);
  assert.match(md, /\| Errors near field \| heuristic \|/);
  assert.match(md, /- \*\*Untested assistive technology:\*\* VoiceOver iOS/);
  assert.match(md, /- \*\*Accessibility conformance report:\*\* update VPAT row 2\.4\.7/);
  assert.match(md, /\| PaymentForm \| new \|/);
  assert.match(md, /\*\*Validation plan:\*\* method: moderated test; participants: 5; task: buy one item; pass: 4 of 5 succeed; severity: Nielsen 0-4/);
  assert.doesNotMatch(md, /\[object Object\]/);
});

test("UI contract gaps name their exact paths", () => {
  const issues = validateUi({
    states: [{ key: "error", shows: "banner" }],
    accessibility: { rows: [{ criterion: "1.4.3", kind: "law", how: "tokens", check: "axe" },
      { criterion: "2.1.1", kind: "standard", how: "tab order" }] },
    i18n: { formats: "date" },
    components: [{ name: "Form" }],
    validation: { method: "test" },
  });
  assert.ok(issues.includes("ui.states[0].next is required"));
  assert.ok(issues.includes("ui.accessibility.rows[0].kind must be one of standard, convention, heuristic"));
  assert.ok(issues.includes("ui.accessibility.rows[1].check is required"));
  assert.ok(issues.includes("ui.accessibility.standard is required when a row is kind standard"));
  assert.ok(issues.includes("ui.i18n.timezone is required"));
  assert.ok(issues.includes("ui.i18n.bidi is required"));
  assert.ok(issues.includes("ui.components[0].change is required"));
  assert.ok(issues.includes("ui.validation.severity is required"));
  assert.deepEqual(validateUi(["x"]), ["ui must be an object"]);
});

test("a secret config value renders with every column and new subfields are typed", () => {
  const config = [{ key: "PAYMENT_API_KEY", type: "string", default: "none", validation: "non-empty",
    secret: true, perEnvironment: { dev: "vault:dev/pay", prod: "vault:prod/pay" }, reload: "restart",
    owner: "payments", removalTask: "T012" }];
  assert.deepEqual(validateConfigContract(config), []);
  assert.match(renderConfigContract(config),
    /\| PAYMENT_API_KEY \| string \| none \| non-empty \| yes \| dev: vault:dev\/pay, prod: vault:prod\/pay \| restart \| payments \| T012 \|/);
  assert.deepEqual(validateConfigContract([{ key: "X", secret: "yes", perEnvironment: 3, owner: 1 }]), [
    "configContract[0].owner must be a string",
    "configContract[0].secret must be true or false",
    "configContract[0].perEnvironment must be an object or text",
  ]);
});

test("data, UI, and config render Thai labels for language th", () => {
  const data = renderDataModel(fullData, { language: "th" });
  assert.match(data, /\| คอลัมน์ \| ชนิด \| ว่างได้ \|/);
  assert.match(data, /\*\*ระยะของ migration:\*\*/);
  assert.match(data, /\*\*สัญญาข้อมูล:\*\*/);
  const ui = renderUi(fullUi, { language: "th" });
  assert.match(ui, /\| เกณฑ์ \| ประเภท \| วิธีทำ \| วิธีตรวจ \|/);
  assert.match(ui, /\| Escape closes dialog \| ธรรมเนียมแพลตฟอร์ม \|/);
  assert.match(ui, /\*\*แผนทดสอบกับผู้ใช้:\*\* วิธี: moderated test/);
  assert.doesNotMatch(ui, /\| Criterion \| Kind \|/);
  const config = renderConfigContract([{ key: "K", default: "1", validation: "int", secret: false }], { language: "th" });
  assert.match(config, /\| Key \| ชนิด \| ค่าเริ่มต้น \| การตรวจค่า \| ความลับ \|/);
  assert.match(config, /\| K \| — \| 1 \| int \| ไม่ใช่ \|/);
});
