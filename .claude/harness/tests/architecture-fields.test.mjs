import assert from "node:assert/strict";
import test from "node:test";
import {
  ARCHITECTURE_FIELDS,
  renderBoundaries,
  renderDomain,
  renderTenancy,
  validateBoundaries,
  validateDomain,
  validateTenancy,
} from "../runtime/workflow/validation/architecture-fields.mjs";

const boundaries = [
  { from: "web", to: "orders-api", mode: "sync", why: "user waits for the answer", timeout: "800ms",
    retry: "2x jittered backoff, idempotent GET only", consistency: "strong", owner: "orders team",
    correlation: "x-request-id" },
  { from: "orders-api", to: "billing", mode: "async", why: "billing may lag", retry: "DLQ after 5",
    consistency: "eventual", staleness: "5 min", owner: "billing team", via: "orders.placed",
    correlation: "x-request-id" },
];

const domain = {
  types: [{ name: "Money", rule: "non-negative, one currency", constructedAt: "parseMoney" },
    { name: "OrderId", rule: "ULID" }],
  illegalStates: ["paid order without payment", "refund above total"],
  modules: [{ name: "pricing", exposes: "quote(cart)", hides: ["tax tables", "rounding"], pure: true },
    { name: "checkout", exposes: "place(order)", hides: ["retry policy"] }],
  injected: ["clock", "id generator"],
  errors: { expected: ["out of stock"], infrastructure: ["db timeout"], bug: ["negative total"] },
};

const tenancy = {
  key: "tenant_id", source: "JWT claim, propagated in headers",
  layers: ["api: per-tenant rate limit", "data: row-level security", { layer: "cache", isolation: "key prefix" }],
  noisyNeighbor: "100 rps per tenant", metering: "requests per tenant to billing",
  crossTenantTest: "tenant A cannot read tenant B order",
};

test("ARCHITECTURE_FIELDS exposes validate and render for each field", () => {
  assert.deepEqual(Object.keys(ARCHITECTURE_FIELDS), ["boundaries", "tenancy", "domain"]);
  for (const field of Object.values(ARCHITECTURE_FIELDS)) {
    assert.equal(typeof field.validate, "function");
    assert.equal(typeof field.render, "function");
  }
});

test("two boundaries render a table with two rows and a correlation line", () => {
  assert.deepEqual(validateBoundaries(boundaries), []);
  const out = renderBoundaries(boundaries, { language: "en" });
  const lines = out.split("\n");
  assert.equal(lines[0], "| Boundary | Mode | Why | Timeout/retry | Consistency | Owner |");
  assert.equal(lines.filter((line) => line.startsWith("| ") && !line.startsWith("| Boundary")).length, 2);
  assert.match(out, /\| web → orders-api \| sync \| user waits for the answer \| 800ms; retry: 2x jittered/);
  assert.match(out, /orders-api → billing \(via orders\.placed\) \| async/);
  assert.match(out, /eventual; staleness: 5 min \| billing team \|/);
  assert.match(out, /\n\nCorrelation: x-request-id$/);
  assert.doesNotMatch(out, /\[object Object\]/);
});

test("a sync boundary without timeout reports the exact path", () => {
  const issues = validateBoundaries([boundaries[1], { ...boundaries[0], timeout: undefined }]);
  assert.deepEqual(issues, ["boundaries[1].timeout is required for a sync boundary"]);
});

test("boundary validation covers mode, staleness, and required fields", () => {
  const issues = validateBoundaries([{ from: "a", to: "b", mode: "rpc", why: "x", retry: "none",
    consistency: "eventual", owner: "o" }, { mode: "async" }]);
  assert.ok(issues.includes("boundaries[0].mode must be one of sync, async"));
  assert.ok(issues.includes("boundaries[0].staleness is required for eventual consistency"));
  assert.ok(issues.includes("boundaries[1].from is required"));
  assert.ok(issues.includes("boundaries[1].owner is required"));
  assert.deepEqual(validateBoundaries("x"), ["boundaries must be a list"]);
});

test("domain renders types, illegal states, modules, injected, and three error groups", () => {
  assert.deepEqual(validateDomain(domain), []);
  const out = renderDomain(domain, { language: "en" });
  assert.match(out, /^\| Type \| Rule \| Constructed at \|/);
  assert.match(out, /\| Money \| non-negative, one currency \| parseMoney \|/);
  assert.match(out, /\| OrderId \| ULID \| — \|/);
  assert.match(out, /Illegal states: paid order without payment; refund above total/);
  assert.match(out, /\| Module \| Interface \| Hides \|/);
  assert.match(out, /\| pricing \(pure\) \| quote\(cart\) \| tax tables; rounding \|/);
  assert.match(out, /\| checkout \| place\(order\) \| retry policy \|/);
  assert.match(out, /Injected: clock; id generator/);
  assert.match(out, /- Expected errors: out of stock\n- Infrastructure errors: db timeout\n- Bug errors: negative total/);
});

test("a module without exposes reports the exact path", () => {
  const value = { ...domain, modules: [domain.modules[0], { name: "checkout", hides: [] }] };
  assert.deepEqual(validateDomain(value), ["domain.modules[1].exposes is required"]);
});

test("domain validation rejects malformed lists and errors", () => {
  const issues = validateDomain({ types: [{ name: "Money" }], illegalStates: "x",
    modules: [{ name: "m", exposes: "f", hides: "all", pure: "yes" }], errors: { bug: [1] } });
  assert.deepEqual(issues, [
    "domain.types[0].rule is required",
    "domain.illegalStates must be a list of strings",
    "domain.modules[0].hides must be a list of strings",
    "domain.modules[0].pure must be true or false",
    "domain.errors.bug[0] must be a non-empty string",
  ]);
});

test("tenancy validates required fields and renders a layer table", () => {
  assert.deepEqual(validateTenancy(tenancy), []);
  assert.deepEqual(validateTenancy({ key: "t", layers: [] }), [
    "tenancy.source is required",
    "tenancy.noisyNeighbor is required",
    "tenancy.metering is required",
    "tenancy.layers must list at least one layer",
  ]);
  const out = renderTenancy(tenancy, { language: "en" });
  assert.match(out, /- Tenant key: tenant_id/);
  assert.match(out, /\| Layer \| Isolation \|\n\|---\|---\|\n\| api \| per-tenant rate limit \|\n\| data \| row-level security \|\n\| cache \| key prefix \|/);
  assert.match(out, /- Cross-tenant test: tenant A cannot read tenant B order/);
});

test("Thai labels render when language is th", () => {
  assert.match(renderBoundaries(boundaries, { language: "th" }),
    /^\| ขอบเขต \| รูปแบบ \| เหตุผล \| Timeout\/การลองใหม่ \| ความสอดคล้อง \| เจ้าของ \|/);
  const thDomain = renderDomain(domain, { language: "th" });
  assert.match(thDomain, /สถานะที่ห้ามเกิด:/);
  assert.match(thDomain, /\| Module \| Interface \| สิ่งที่ซ่อน \|/);
  assert.match(thDomain, /- Error ที่คาดไว้: out of stock/);
  assert.match(renderTenancy(tenancy, { language: "th" }), /\| ชั้น \| การแยก \|/);
});

test("empty values render empty strings and validate cleanly", () => {
  for (const [key, field] of Object.entries(ARCHITECTURE_FIELDS)) {
    for (const empty of [undefined, null, key === "boundaries" ? [] : {}]) {
      assert.equal(field.render(empty, { language: "en" }), "", `${key} render`);
      assert.deepEqual(field.validate(empty), [], `${key} validate`);
    }
  }
});
