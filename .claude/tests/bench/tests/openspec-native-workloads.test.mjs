import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runBenchmarkOracle } from "../openspec-native/run.mjs";

const TASKS = fileURLToPath(new URL("../tasks", import.meta.url));
const MATRIX = JSON.parse(readFileSync(
  fileURLToPath(new URL("../config/openspec-native-matrix.json", import.meta.url)), "utf8"));

// Every declared critical case must be reported and passing after the repair.
// A silent oracle yields only the shell-side cases, which once let a broken
// check.mjs pass with a perfect score.
function criticalCases(name) {
  const scenario = MATRIX.scenarios.find((row) =>
    String(row.fixture || "").endsWith(`/tasks/${name}/seed`));
  return scenario?.critical_case_ids || [];
}

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function verifyWorkload(name, repair) {
  const task = join(TASKS, name);
  const project = mkdtempSync(join(tmpdir(), `foundation-${name}-`));
  try {
    cpSync(join(task, "seed"), project, { recursive: true });
    const before = runBenchmarkOracle({ project, oraclePath: join(task, "oracle/run.sh") });
    assert.equal(before.verdict, "fail", "the frozen seed must expose the scenario defect");
    repair(project);
    const after = runBenchmarkOracle({ project, oraclePath: join(task, "oracle/run.sh") });
    assert.equal(after.verdict, "pass", JSON.stringify(after));
    assert.equal(after.score, after.max);
    // Oracles may suffix an id (`AC1_regression_first`); match exact or prefix.
    for (const id of criticalCases(name)) {
      const keys = Object.keys(after.results || {}).filter((key) =>
        key === id || key.startsWith(`${id}_`));
      assert.ok(keys.length && keys.every((key) => after.results[key] === "pass"),
        `${name}: critical case ${id} missing or failing`);
    }
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

test("TypeScript/React state fixture has a mutation-killing acceptance oracle", () => {
  verifyWorkload("16-typescript-react-state", (project) => {
    const path = join(project, "src/panel-state.js");
    write(path, readFileSync(path, "utf8").replace("open: true", "open: !state.open"));
    write(join(project, "panel-state.test.mjs"), `
import assert from "node:assert/strict";
import test from "node:test";
import { initialPanelState, reducePanelState } from "./src/panel-state.js";
test("toggle opens and closes without dropping state", () => {
  const open = reducePanelState(initialPanelState(), { type: "toggle" });
  const closed = reducePanelState({ ...open, query: "Ada", selectedId: "c1" }, { type: "toggle" });
  assert.deepEqual(closed, { open: false, query: "Ada", selectedId: "c1" });
});
`);
  });
});

test("recent-window fixture kills the zero/fractional boundary mutant", () => {
  verifyWorkload("11-recent-window", (project) => {
    const path = join(project, "window.js");
    write(path, readFileSync(path, "utf8").replace(
      "return items.slice(-n);",
      "const count = Math.trunc(Number(n));\n  return count > 0 ? items.slice(-count) : [];"
    ));
    write(join(project, "window.test.js"), `
const assert = require("node:assert/strict");
const test = require("node:test");
const { lastN } = require("./window");
test("bug 412 zero, negative, and fractional windows stay empty", () => {
  assert.deepEqual(lastN(["a", "b"], 0), []);
  assert.deepEqual(lastN(["a", "b"], -1), []);
  assert.deepEqual(lastN(["a", "b"], 0.4), []);
});
`);
  });
});

test("Python validation fixture kills bool-as-int representation acceptance", () => {
  verifyWorkload("15-python-api-validation", (project) => {
    const path = join(project, "user_api.py");
    write(path, readFileSync(path, "utf8").replace(
      "not isinstance(seat_count, int)", "type(seat_count) is not int"));
    const testPath = join(project, "tests/test_user_api.py");
    write(testPath, `${readFileSync(testPath, "utf8")}\n
class WorkspaceBooleanBoundaryTests(unittest.TestCase):
    def test_boolean_is_not_an_integer_seat_count(self):
        self.assertIn("seat_count", validate_workspace({"seat_count": True}))
        self.assertEqual(create_workspace({"seat_count": True})["status"], 422)
`);
  });
});

test("migration fixture proves lossless rollback and regression-first coverage", () => {
  verifyWorkload("17-database-migration-rollback", (project) => {
    const path = join(project, "migration.mjs");
    write(path, readFileSync(path, "utf8").replace(
      "disabled: false", "disabled: row.status === \"disabled\""));
    write(join(project, "migration.test.mjs"), `
import assert from "node:assert/strict";
import test from "node:test";
import { up, down } from "./migration.mjs";
test("rollback preserves disabled accounts", () => {
  const rows = [{ id: "a", name: "Ada", disabled: false }, { id: "b", name: "Grace", disabled: true }];
  assert.deepEqual(down(up(rows)), rows);
});
`);
  });
});

test("refactor fixture requires shared structure and preserved behavior", () => {
  verifyWorkload("18-refactor-no-reproduction", (project) => {
    write(join(project, "classify.mjs"), `
function normalizeText(value) {
  return String(value ?? "").trim().replace(/\\s+/g, " ").toLowerCase();
}
export const normalizeCustomerName = normalizeText;
export const normalizeSupplierName = normalizeText;
export function sameCustomer(left, right) { return normalizeCustomerName(left) === normalizeCustomerName(right); }
export function sameSupplier(left, right) { return normalizeSupplierName(left) === normalizeSupplierName(right); }
`);
    write(join(project, "classify.test.mjs"), `
import assert from "node:assert/strict";
import test from "node:test";
import * as names from "./classify.mjs";
test("characterizes public normalization", () => {
  assert.equal(names.normalizeCustomerName("  Ada  "), "ada");
  assert.equal(names.normalizeSupplierName(null), "");
  assert.equal(names.sameCustomer("GRACE HOPPER", " grace  hopper "), true);
});
`);
  });
});

test("multi-service fixture binds producer and consumer contract semantics", () => {
  verifyWorkload("19-multi-service-event-flow", (project) => {
    const path = join(project, "services/orders/order-event.mjs");
    write(path, readFileSync(path, "utf8")
      .replace("version: 1", "version: 2")
      .replace("String(order.totalCents)", "Number(order.totalCents)"));
    write(join(project, "contract.test.mjs"), `
import assert from "node:assert/strict";
import test from "node:test";
import { orderCharged } from "./services/orders/order-event.mjs";
import { applyOrderCharged } from "./services/billing/apply-event.mjs";
test("v2 producer payload is accepted exactly once", () => {
  const event = orderCharged({ eventId: "e1", id: "o1", totalCents: 1299 });
  const first = applyOrderCharged({ processed: [], balances: {} }, event);
  assert.deepEqual(applyOrderCharged(first, event), first);
});
`);
  });
});

test("tiny-feature fixture requires a range-checked discount and covering tests", () => {
  verifyWorkload("20-tiny-feature", (project) => {
    const path = join(project, "src/cart.js");
    write(path, readFileSync(path, "utf8").replace("module.exports = { total };", `
function discount(amount, percent) {
  if (!(percent >= 0 && percent <= 100)) throw new RangeError("percent must be 0-100");
  return amount * (1 - percent / 100);
}

module.exports = { total, discount };`));
    write(join(project, "test/discount.test.js"), `
const assert = require("node:assert/strict");
const test = require("node:test");
const { discount } = require("../src/cart");
test("discount applies a percent and rejects out-of-range values", () => {
  assert.equal(discount(200, 25), 150);
  assert.throws(() => discount(100, -1), RangeError);
  assert.throws(() => discount(100, 101), RangeError);
});
`);
  });
});

test("notes-api fixture requires the full REST contract, persistence, and tests", () => {
  verifyWorkload("21-notes-api", (project) => {
    write(join(project, "src/server.js"), `
const http = require("node:http");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

class HttpError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}

function load(dataFile) {
  try { return JSON.parse(fs.readFileSync(dataFile, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

function title(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 120) throw new HttpError(400, "title must be 1-120 characters", "title");
  return text;
}
function body(value) {
  if (typeof value !== "string" || value.length > 10000)
    throw new HttpError(400, "body must be a string of at most 10000 characters", "body");
  return value;
}
function tags(value) {
  if (!Array.isArray(value)) throw new HttpError(400, "tags must be an array", "tags");
  const out = [];
  for (const tag of value) {
    const text = typeof tag === "string" ? tag.trim().toLowerCase() : "";
    if (!text) throw new HttpError(400, "tags must be non-empty strings", "tags");
    if (!out.includes(text)) out.push(text);
  }
  if (out.length > 10) throw new HttpError(400, "at most 10 tags", "tags");
  return out;
}
function integer(raw, fallback, min, max, field) {
  if (raw === null) return fallback;
  if (!/^\\d+$/.test(raw) || Number(raw) < min || Number(raw) > max)
    throw new HttpError(400, \`\${field} is out of range\`, field);
  return Number(raw);
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let value;
  try { value = JSON.parse(raw); } catch { throw new HttpError(400, "invalid JSON body"); }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "body must be a JSON object");
  return value;
}

function send(res, status, value) {
  if (status === 204) { res.writeHead(204); res.end(); return; }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function createServer({ dataFile } = {}) {
  const notes = load(dataFile);
  const save = () => fs.writeFileSync(dataFile, JSON.stringify(notes));
  const find = (id) => {
    const note = notes.find((n) => n.id === id);
    if (!note) throw new HttpError(404, "note not found");
    return note;
  };
  async function route(req, res) {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
    if (parts[0] !== "notes" || parts.length > 2) throw new HttpError(404, "not found");
    if (parts.length === 1 && req.method === "POST") {
      const input = await readJson(req);
      const now = new Date().toISOString();
      const note = { id: randomUUID(), title: title(input.title),
        body: input.body === undefined ? "" : body(input.body),
        tags: input.tags === undefined ? [] : tags(input.tags), createdAt: now, updatedAt: now };
      notes.push(note); save();
      return send(res, 201, note);
    }
    if (parts.length === 1 && req.method === "GET") {
      const q = url.searchParams;
      const limit = integer(q.get("limit"), 20, 1, 100, "limit");
      const offset = integer(q.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER, "offset");
      const term = (q.get("q") || "").toLowerCase();
      const tag = q.has("tag") ? q.get("tag").trim().toLowerCase() : null;
      const items = notes.filter((n) =>
        (!term || n.title.toLowerCase().includes(term) || n.body.toLowerCase().includes(term)) &&
        (tag === null || n.tags.includes(tag)));
      return send(res, 200, { items: items.slice(offset, offset + limit), total: items.length, limit, offset });
    }
    if (parts.length === 2) {
      const note = find(parts[1]);
      if (req.method === "GET") return send(res, 200, note);
      if (req.method === "DELETE") { notes.splice(notes.indexOf(note), 1); save(); return send(res, 204); }
      if (req.method === "PATCH") {
        const input = await readJson(req);
        const next = { ...note };
        if (input.title !== undefined) next.title = title(input.title);
        if (input.body !== undefined) next.body = body(input.body);
        if (input.tags !== undefined) next.tags = tags(input.tags);
        next.updatedAt = new Date().toISOString();
        Object.assign(note, next); save();
        return send(res, 200, note);
      }
    }
    throw new HttpError(404, "not found");
  }
  return http.createServer((req, res) => {
    route(req, res).catch((error) => {
      if (!(error instanceof HttpError)) return send(res, 500, { error: "internal error" });
      send(res, error.status, error.field ? { error: error.message, field: error.field } : { error: error.message });
    });
  });
}

module.exports = { createServer };

if (require.main === module) {
  createServer({ dataFile: process.env.NOTES_DATA_FILE || "notes.json" }).listen(Number(process.env.PORT || 3000));
}
`);
    write(join(project, "test/notes.test.js"), `
const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { createServer } = require("../src/server");

async function api(dataFile = join(mkdtempSync(join(tmpdir(), "notes-")), "n.json")) {
  const server = createServer({ dataFile });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = \`http://127.0.0.1:\${server.address().port}\`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { connection: "close" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };
  return { call, dataFile, close: () => new Promise((done) => server.close(done)) };
}

test("creates a normalized note", async () => {
  const { call, close } = await api();
  const res = await call("POST", "/notes", { title: " Hi ", tags: ["A", "a"] });
  assert.equal(res.status, 201);
  assert.equal(res.json.title, "Hi");
  assert.deepEqual(res.json.tags, ["a"]);
  await close();
});

test("rejects an invalid title", async () => {
  const { call, close } = await api();
  const res = await call("POST", "/notes", { title: "" });
  assert.equal(res.status, 400);
  assert.equal(res.json.field, "title");
  await close();
});

test("patches and deletes", async () => {
  const { call, close } = await api();
  const note = (await call("POST", "/notes", { title: "a" })).json;
  assert.equal((await call("PATCH", \`/notes/\${note.id}\`, { title: "b" })).json.title, "b");
  assert.equal((await call("DELETE", \`/notes/\${note.id}\`)).status, 204);
  assert.equal((await call("GET", \`/notes/\${note.id}\`)).status, 404);
  await close();
});

test("paginates, caps the limit, and filters", async () => {
  const { call, close } = await api();
  for (let i = 0; i < 3; i += 1) await call("POST", "/notes", { title: \`n\${i}\`, tags: i ? [] : ["x"] });
  const page = (await call("GET", "/notes?limit=2&offset=1")).json;
  assert.deepEqual(page.items.map((n) => n.title), ["n1", "n2"]);
  assert.equal(page.total, 3);
  assert.equal((await call("GET", "/notes?limit=101")).status, 400);
  assert.equal((await call("GET", "/notes?tag=X")).json.total, 1);
  assert.equal((await call("GET", "/notes?q=N2")).json.total, 1);
  await close();
});

test("persists across servers", async () => {
  const first = await api();
  await first.call("POST", "/notes", { title: "kept" });
  await first.close();
  const second = await api(first.dataFile);
  assert.equal((await second.call("GET", "/notes")).json.total, 1);
  await second.close();
});
`);
  });
});

test("cart-coupons fixture requires stacked coupons without changing totals", () => {
  verifyWorkload("22-cart-coupons", (project) => {
    write(join(project, "src/coupons.js"), `
class CouponError extends Error {
  constructor(code, message = code) { super(message); this.name = "CouponError"; this.code = code; }
}

const DAY_MS = 86400000;
const positiveInt = (value) => Number.isInteger(value) && value > 0;

function validate(def) {
  const ok = def && typeof def.code === "string" && def.code &&
    (def.minSubtotalCents === undefined ||
      (Number.isInteger(def.minSubtotalCents) && def.minSubtotalCents >= 0)) &&
    (def.expiresAt === undefined || (/^\\d{4}-\\d{2}-\\d{2}$/.test(def.expiresAt) &&
      !Number.isNaN(Date.parse(\`\${def.expiresAt}T00:00:00Z\`)))) &&
    ((def.type === "PERCENT" && Number.isInteger(def.percent) && def.percent >= 1 && def.percent <= 100) ||
     (def.type === "FIXED" && positiveInt(def.amountCents)) ||
     (def.type === "BOGO" && typeof def.category === "string" && def.category));
  if (!ok) throw new CouponError("INVALID_COUPON", \`invalid coupon: \${def?.code}\`);
  return { ...def };
}

function createCouponStore(definitions, { now = () => new Date() } = {}) {
  const coupons = new Map();
  for (const def of definitions) {
    const coupon = validate(def);
    if (coupons.has(coupon.code)) throw new CouponError("INVALID_COUPON", \`duplicate coupon: \${coupon.code}\`);
    coupons.set(coupon.code, coupon);
  }
  return { coupons, redeemed: new Set(), now };
}

function resolveCoupons(store, codes, subtotal) {
  const found = codes.map((code) => {
    const coupon = store.coupons.get(code);
    if (!coupon) throw new CouponError("UNKNOWN_CODE", \`unknown coupon: \${code}\`);
    if (store.redeemed.has(code)) throw new CouponError("ALREADY_USED", \`coupon already used: \${code}\`);
    if (coupon.expiresAt && store.now().getTime() >= Date.parse(\`\${coupon.expiresAt}T00:00:00Z\`) + DAY_MS)
      throw new CouponError("EXPIRED", \`coupon expired: \${code}\`);
    if (subtotal < (coupon.minSubtotalCents || 0))
      throw new CouponError("MIN_SUBTOTAL_NOT_MET", \`subtotal too low for \${code}\`);
    return coupon;
  });
  const bogo = found.filter((c) => c.type === "BOGO");
  const order = found.filter((c) => c.type !== "BOGO");
  if (bogo.length > 1 || order.length > 1) throw new CouponError("NOT_STACKABLE", "coupons cannot be combined");
  return { bogo: bogo[0], order: order[0] };
}

function bogoDiscount(units) {
  const sorted = [...units].sort((a, b) => b - a);
  let free = 0;
  for (let i = 1; i < sorted.length; i += 2) free += sorted[i];
  return free;
}

function discountCents(store, codes, subtotal, lines) {
  const { bogo, order } = resolveCoupons(store, codes, subtotal);
  let discount = 0;
  if (bogo) discount += bogoDiscount(lines.filter((l) => l.category === bogo.category)
    .flatMap((l) => Array(l.quantity).fill(l.priceCents)));
  const base = subtotal - discount;
  if (order?.type === "PERCENT") discount += Math.floor((base * order.percent + 50) / 100);
  if (order?.type === "FIXED") discount += Math.min(order.amountCents, base);
  return discount;
}

function redeem(store, codes) { for (const code of codes) store.redeemed.add(code); }

module.exports = { CouponError, createCouponStore, discountCents, redeem };
`);
    write(join(project, "src/checkout.js"), `
const { subtotalCents } = require("./cart");
const { getProduct } = require("./catalog");
const { taxCents } = require("./tax");
const { discountCents, redeem } = require("./coupons");

function checkout(cart, { coupons, codes = [] } = {}) {
  const subtotal = subtotalCents(cart);
  const lines = cart.lines.map((line) => ({ ...getProduct(line.sku), quantity: line.quantity }));
  const discount = codes.length ? discountCents(coupons, codes, subtotal, lines) : 0;
  const tax = taxCents(subtotal - discount);
  if (codes.length) redeem(coupons, codes);
  return { subtotalCents: subtotal, discountCents: discount, taxCents: tax,
    totalCents: subtotal - discount + tax };
}

module.exports = { checkout };
`);
    write(join(project, "test/coupons.test.js"), `
const assert = require("node:assert/strict");
const test = require("node:test");
const { createCart, addItem } = require("../src/cart");
const { checkout } = require("../src/checkout");
const { createCouponStore } = require("../src/coupons");

const cart = (...skus) => skus.reduce((c, sku) => addItem(c, sku), createCart());

test("percent discount applies before tax", () => {
  const store = createCouponStore([{ code: "P15", type: "PERCENT", percent: 15 }]);
  assert.deepEqual(checkout(cart("LAMP"), { coupons: store, codes: ["P15"] }),
    { subtotalCents: 4550, discountCents: 683, taxCents: 271, totalCents: 4138 });
});

test("bogo frees the cheaper unit of each pair and codes are single-use", () => {
  const store = createCouponStore([{ code: "B", type: "BOGO", category: "apparel" }]);
  assert.equal(checkout(cart("TEE", "CAP", "SOCKS"), { coupons: store, codes: ["B"] }).discountCents, 1250);
  assert.throws(() => checkout(cart("TEE"), { coupons: store, codes: ["B"] }), { code: "ALREADY_USED" });
});
`);
  });
});

test("project-tracker-api fixture requires auth, roles, workflow, lists, activity, and tests", () => {
  // Reference solution only: proves the hidden oracle is satisfiable. Kept
  // free of backticks and interpolation so String.raw embeds it verbatim.
  verifyWorkload("23-project-tracker-api", (project) => {
    write(join(project, "src/server.js"), String.raw`const http = require("node:http");
const fs = require("node:fs");
const crypto = require("node:crypto");

const DAY_MS = 24 * 60 * 60 * 1000;
const STATUSES = ["todo", "doing", "done"];
const TRANSITIONS = { todo: ["doing"], doing: ["done"], done: ["todo"] };
const TASK_FIELDS = ["title", "description", "status", "priority", "assigneeId", "dueDate", "labels"];

class HttpError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}
const fail = (status, message, field) => { throw new HttpError(status, message, field); };

function emptyState() {
  return { seq: 0, users: [], sessions: [], projects: [], members: [], tasks: [], activity: [] };
}

function text(value, field, min, max, trim = true) {
  if (typeof value !== "string") fail(400, field + " must be a string", field);
  const out = trim ? value.trim() : value;
  if (out.length < min || out.length > max)
    fail(400, field + " must be " + min + "-" + max + " characters", field);
  return out;
}
function email(value) {
  if (typeof value !== "string") fail(400, "email must be a string", "email");
  const out = value.trim().toLowerCase();
  const parts = out.split("@");
  if (out.length > 254 || /\s/.test(out) || parts.length !== 2 || !parts[0] ||
      !parts[1] || !parts[1].includes("."))
    fail(400, "email is invalid", "email");
  return out;
}
function priority(value) {
  if (!Number.isInteger(value) || value < 1 || value > 5)
    fail(400, "priority must be an integer 1-5", "priority");
  return value;
}
function dueDate(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail(400, "dueDate must be YYYY-MM-DD", "dueDate");
  const date = new Date(value + "T00:00:00Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    fail(400, "dueDate is not a real date", "dueDate");
  return value;
}
function labels(value) {
  if (!Array.isArray(value)) fail(400, "labels must be an array", "labels");
  const out = [];
  for (const label of value) {
    const clean = typeof label === "string" ? label.trim().toLowerCase() : "";
    if (!clean || clean.length > 30) fail(400, "labels must be 1-30 characters", "labels");
    if (!out.includes(clean)) out.push(clean);
  }
  if (out.length > 5) fail(400, "at most 5 labels", "labels");
  return out;
}
function integer(raw, fallback, min, max, field) {
  if (raw === null) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max)
    fail(400, field + " is out of range", field);
  return Number(raw);
}
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt });
const tokenKey = (token) => crypto.createHash("sha256").update(token).digest("hex");

const ROUTES = [
  ["GET", ["health"], "health", false],
  ["POST", ["users"], "register", false],
  ["POST", ["sessions"], "login", false],
  ["DELETE", ["sessions"], "logout", true],
  ["GET", ["users", "me"], "me", true],
  ["GET", ["projects"], "listProjects", true],
  ["POST", ["projects"], "createProject", true],
  ["GET", ["projects", ":p"], "getProject", true],
  ["PATCH", ["projects", ":p"], "patchProject", true],
  ["DELETE", ["projects", ":p"], "deleteProject", true],
  ["GET", ["projects", ":p", "members"], "listMembers", true],
  ["POST", ["projects", ":p", "members"], "addMember", true],
  ["DELETE", ["projects", ":p", "members", ":m"], "removeMember", true],
  ["GET", ["projects", ":p", "tasks"], "listTasks", true],
  ["POST", ["projects", ":p", "tasks"], "createTask", true],
  ["GET", ["projects", ":p", "tasks", ":t"], "getTask", true],
  ["PATCH", ["projects", ":p", "tasks", ":t"], "patchTask", true],
  ["DELETE", ["projects", ":p", "tasks", ":t"], "deleteTask", true],
  ["GET", ["projects", ":p", "activity"], "activity", true]
];

function match(method, parts) {
  for (const [verb, pattern, name, auth] of ROUTES) {
    if (verb !== method || pattern.length !== parts.length) continue;
    const params = {};
    let ok = true;
    pattern.forEach((piece, i) => {
      if (piece.startsWith(":")) params[piece.slice(1)] = parts[i];
      else if (piece !== parts[i]) ok = false;
    });
    if (ok) return { name, auth, params };
  }
  return null;
}

function createServer({ dataFile, now = () => new Date() } = {}) {
  const clock = () => new Date(now()).getTime();
  const iso = () => new Date(clock()).toISOString();
  let state;
  try { state = JSON.parse(fs.readFileSync(dataFile, "utf8")); }
  catch (error) { if (error.code === "ENOENT") state = emptyState(); else throw error; }

  function save() {
    const temp = dataFile + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(state));
    fs.renameSync(temp, dataFile);
  }
  const nextId = (prefix) => prefix + "_" + (++state.seq) + "_" + crypto.randomBytes(4).toString("hex");
  function record(project, actor, type, extra) {
    state.activity.push({ id: nextId("e"), projectId: project.id, type, actorId: actor.id,
      at: iso(), ...extra });
  }
  const memberOf = (project, userId) =>
    state.members.find((m) => m.projectId === project.id && m.userId === userId);

  function authenticate(req) {
    const header = req.headers.authorization || "";
    const found = /^Bearer (\S+)$/.exec(header);
    if (!found) fail(401, "authentication required");
    const key = tokenKey(found[1]);
    const session = state.sessions.find((s) => s.key === key);
    if (!session || Date.parse(session.expiresAt) <= clock()) fail(401, "invalid or expired token");
    const user = state.users.find((u) => u.id === session.userId);
    if (!user) fail(401, "invalid token");
    return { user, session };
  }
  function visibleProject(id, user) {
    const project = state.projects.find((p) => p.id === id);
    const member = project && memberOf(project, user.id);
    if (!member) fail(404, "project not found");
    return { project, role: member.role };
  }
  function findTask(project, id) {
    const task = state.tasks.find((t) => t.projectId === project.id && t.id === id);
    if (!task) fail(404, "task not found");
    return task;
  }
  const canWrite = (role) => role === "owner" || role === "editor";

  function validateTask(input, project, creating) {
    const out = {};
    if (creating || "title" in input) out.title = text(input.title, "title", 1, 200);
    if ("description" in input) out.description = text(input.description, "description", 0, 5000, false);
    if ("status" in input) {
      if (!STATUSES.includes(input.status)) fail(400, "status is invalid", "status");
      if (creating && input.status !== "todo") fail(400, "new tasks start as todo", "status");
      out.status = input.status;
    }
    if ("priority" in input) out.priority = priority(input.priority);
    if ("assigneeId" in input) {
      if (input.assigneeId !== null &&
          (typeof input.assigneeId !== "string" || !memberOf(project, input.assigneeId)))
        fail(400, "assignee must be a project member", "assigneeId");
      out.assigneeId = input.assigneeId;
    }
    if ("dueDate" in input) out.dueDate = dueDate(input.dueDate);
    if ("labels" in input) out.labels = labels(input.labels);
    return out;
  }

  const handlers = {
    health: () => [200, { ok: true }],
    register: (ctx) => {
      const input = ctx.body();
      const address = email(input.email);
      const password = text(input.password, "password", 8, 128, false);
      const name = text(input.name, "name", 1, 100);
      if (state.users.some((u) => u.email === address)) fail(409, "email already registered", "email");
      const salt = crypto.randomBytes(16).toString("hex");
      const user = { id: nextId("u"), email: address, name, createdAt: iso(),
        salt, hash: hashPassword(password, salt) };
      state.users.push(user);
      save();
      return [201, publicUser(user)];
    },
    login: (ctx) => {
      const input = ctx.body();
      const address = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
      const user = state.users.find((u) => u.email === address);
      const ok = user && typeof input.password === "string" && crypto.timingSafeEqual(
        Buffer.from(hashPassword(input.password, user.salt), "hex"), Buffer.from(user.hash, "hex"));
      if (!ok) fail(401, "invalid email or password");
      const token = crypto.randomBytes(32).toString("base64url");
      const expiresAt = new Date(clock() + DAY_MS).toISOString();
      state.sessions.push({ key: tokenKey(token), userId: user.id, expiresAt });
      save();
      return [201, { token, expiresAt, user: publicUser(user) }];
    },
    logout: (ctx) => {
      state.sessions = state.sessions.filter((s) => s !== ctx.session);
      save();
      return [204];
    },
    me: (ctx) => [200, publicUser(ctx.user)],
    listProjects: (ctx) => [200, { items: state.projects.filter((p) => memberOf(p, ctx.user.id)) }],
    createProject: (ctx) => {
      const input = ctx.body();
      const name = text(input.name, "name", 1, 100);
      const description = "description" in input
        ? text(input.description, "description", 0, 2000, false) : "";
      const at = iso();
      const project = { id: nextId("p"), name, description, ownerId: ctx.user.id,
        createdAt: at, updatedAt: at };
      state.projects.push(project);
      state.members.push({ projectId: project.id, userId: ctx.user.id, role: "owner" });
      record(project, ctx.user, "project.created", {});
      save();
      return [201, project];
    },
    getProject: (ctx) => [200, visibleProject(ctx.params.p, ctx.user).project],
    patchProject: (ctx) => {
      const { project, role } = visibleProject(ctx.params.p, ctx.user);
      const input = ctx.body();
      if (!canWrite(role)) fail(403, "insufficient role");
      const changes = {};
      if ("name" in input) changes.name = text(input.name, "name", 1, 100);
      if ("description" in input)
        changes.description = text(input.description, "description", 0, 2000, false);
      Object.assign(project, changes, { updatedAt: iso() });
      record(project, ctx.user, "project.updated", { fields: Object.keys(changes) });
      save();
      return [200, project];
    },
    deleteProject: (ctx) => {
      const { project, role } = visibleProject(ctx.params.p, ctx.user);
      if (role !== "owner") fail(403, "only the owner can delete a project");
      state.projects = state.projects.filter((p) => p !== project);
      for (const key of ["members", "tasks", "activity"])
        state[key] = state[key].filter((row) => row.projectId !== project.id);
      save();
      return [204];
    },
    listMembers: (ctx) => {
      const { project } = visibleProject(ctx.params.p, ctx.user);
      const rows = state.members.filter((m) => m.projectId === project.id);
      rows.sort((a, b) => (a.role === "owner" ? -1 : 0) - (b.role === "owner" ? -1 : 0));
      return [200, { items: rows.map((m) => {
        const u = state.users.find((user) => user.id === m.userId);
        return { userId: m.userId, role: m.role, name: u.name, email: u.email };
      }) }];
    },
    addMember: (ctx) => {
      const { project, role } = visibleProject(ctx.params.p, ctx.user);
      const input = ctx.body();
      if (role !== "owner") fail(403, "only the owner manages members");
      if (typeof input.userId !== "string" || !state.users.some((u) => u.id === input.userId))
        fail(400, "userId must be an existing user", "userId");
      if (input.role !== "editor" && input.role !== "viewer")
        fail(400, "role must be editor or viewer", "role");
      if (memberOf(project, input.userId)) fail(409, "user is already a member", "userId");
      state.members.push({ projectId: project.id, userId: input.userId, role: input.role });
      record(project, ctx.user, "member.added", { userId: input.userId, role: input.role });
      save();
      return [201, { userId: input.userId, role: input.role }];
    },
    removeMember: (ctx) => {
      const { project, role } = visibleProject(ctx.params.p, ctx.user);
      const member = memberOf(project, ctx.params.m);
      if (!member) fail(404, "member not found");
      if (role !== "owner") fail(403, "only the owner manages members");
      if (member.role === "owner") fail(400, "the owner cannot be removed", "userId");
      state.members = state.members.filter((m) => m !== member);
      for (const task of state.tasks)
        if (task.projectId === project.id && task.assigneeId === member.userId) task.assigneeId = null;
      record(project, ctx.user, "member.removed", { userId: member.userId });
      save();
      return [204];
    },
    listTasks: (ctx) => {
      const { project } = visibleProject(ctx.params.p, ctx.user);
      const q = ctx.url.searchParams;
      const status = q.get("status");
      if (status !== null && !STATUSES.includes(status)) fail(400, "status is invalid", "status");
      const overdue = q.get("overdue");
      if (overdue !== null && overdue !== "true" && overdue !== "false")
        fail(400, "overdue must be true or false", "overdue");
      const sort = q.get("sort") ?? "createdAt";
      if (!["createdAt", "priority", "dueDate"].includes(sort)) fail(400, "sort is invalid", "sort");
      const order = q.get("order") ?? "asc";
      if (order !== "asc" && order !== "desc") fail(400, "order is invalid", "order");
      const limit = integer(q.get("limit"), 20, 1, 100, "limit");
      const offset = integer(q.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER, "offset");
      const today = new Date(clock()).toISOString().slice(0, 10);
      const label = q.get("label");
      const wanted = label === null ? null : label.trim().toLowerCase();
      const assignee = q.get("assigneeId");
      const rows = state.tasks.map((task, index) => ({ task, index })).filter(({ task }) => {
        if (task.projectId !== project.id) return false;
        if (status !== null && task.status !== status) return false;
        if (assignee !== null && task.assigneeId !== assignee) return false;
        if (wanted !== null && !task.labels.includes(wanted)) return false;
        if (overdue !== null) {
          const late = task.dueDate !== null && task.dueDate < today && task.status !== "done";
          if (late !== (overdue === "true")) return false;
        }
        return true;
      });
      const sign = order === "desc" ? -1 : 1;
      rows.sort((a, b) => {
        let delta = 0;
        if (sort === "createdAt") delta = sign * (a.index - b.index);
        else if (sort === "priority") delta = sign * (a.task.priority - b.task.priority);
        else if (a.task.dueDate === null || b.task.dueDate === null)
          delta = (a.task.dueDate === null) - (b.task.dueDate === null);
        else delta = sign * a.task.dueDate.localeCompare(b.task.dueDate);
        return delta || a.index - b.index;
      });
      return [200, { items: rows.slice(offset, offset + limit).map((row) => row.task),
        total: rows.length, limit, offset }];
    },
    createTask: (ctx) => {
      const { project, role } = visibleProject(ctx.params.p, ctx.user);
      const input = ctx.body();
      if (!canWrite(role)) fail(403, "insufficient role");
      const fields = validateTask(input, project, true);
      const at = iso();
      const task = { id: nextId("t"), projectId: project.id, title: fields.title,
        description: fields.description ?? "", status: "todo", priority: fields.priority ?? 3,
        assigneeId: fields.assigneeId ?? null, dueDate: fields.dueDate ?? null,
        labels: fields.labels ?? [], createdBy: ctx.user.id, createdAt: at, updatedAt: at };
      state.tasks.push(task);
      record(project, ctx.user, "task.created", { taskId: task.id });
      save();
      return [201, task];
    },
    getTask: (ctx) => {
      const { project } = visibleProject(ctx.params.p, ctx.user);
      return [200, findTask(project, ctx.params.t)];
    },
    patchTask: (ctx) => {
      const { project, role } = visibleProject(ctx.params.p, ctx.user);
      const task = findTask(project, ctx.params.t);
      const input = ctx.body();
      const provided = TASK_FIELDS.filter((field) => field in input);
      if (!canWrite(role)) {
        const allowed = role === "viewer" && task.assigneeId === ctx.user.id &&
          provided.length === 1 && provided[0] === "status" &&
          (input.status === "doing" || input.status === "done");
        if (!allowed) fail(403, "insufficient role");
      }
      const changes = validateTask(input, project, false);
      if ("status" in changes && changes.status !== task.status &&
          !TRANSITIONS[task.status].includes(changes.status))
        fail(409, "cannot move from " + task.status + " to " + changes.status, "status");
      const from = task.status;
      Object.assign(task, changes, { updatedAt: iso() });
      const others = provided.filter((field) => field !== "status");
      if (others.length) record(project, ctx.user, "task.updated", { taskId: task.id, fields: others });
      if (task.status !== from)
        record(project, ctx.user, "task.status_changed", { taskId: task.id, from, to: task.status });
      save();
      return [200, task];
    },
    deleteTask: (ctx) => {
      const { project, role } = visibleProject(ctx.params.p, ctx.user);
      const task = findTask(project, ctx.params.t);
      if (!canWrite(role)) fail(403, "insufficient role");
      state.tasks = state.tasks.filter((t) => t !== task);
      record(project, ctx.user, "task.deleted", { taskId: task.id });
      save();
      return [204];
    },
    activity: (ctx) => {
      const { project } = visibleProject(ctx.params.p, ctx.user);
      const items = state.activity.filter((e) => e.projectId === project.id).reverse()
        .map(({ projectId, ...event }) => event);
      return [200, { items }];
    }
  };

  async function handle(req) {
    const url = new URL(req.url, "http://localhost");
    const route = match(req.method, url.pathname.split("/").filter(Boolean));
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (!route) fail(404, "route not found");
    // Everything below is synchronous, so each request is applied atomically.
    const ctx = { url, params: route.params };
    if (route.auth) Object.assign(ctx, authenticate(req));
    ctx.body = () => {
      let value;
      try { value = JSON.parse(raw); } catch { fail(400, "invalid JSON body"); }
      if (!value || typeof value !== "object" || Array.isArray(value))
        fail(400, "body must be a JSON object");
      return value;
    };
    return handlers[route.name](ctx);
  }

  return http.createServer((req, res) => {
    handle(req).then(([status, body]) => {
      if (status === 204) { res.writeHead(204); res.end(); return; }
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    }, (error) => {
      const status = error instanceof HttpError ? error.status : 500;
      const body = { error: error instanceof HttpError ? error.message : "internal error" };
      if (error instanceof HttpError && error.field) body.field = error.field;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
}

module.exports = { createServer };

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const dataFile = process.env.TRACKER_DATA_FILE || require("node:path").join(process.cwd(), "tracker.json");
  createServer({ dataFile }).listen(port);
}
`);
    write(join(project, "test/tracker.test.js"), String.raw`const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../src/server");

const T0 = Date.parse("2026-03-10T12:00:00.000Z");

async function api(dataFile, clock) {
  dataFile = dataFile || path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tracker-")), "db.json");
  clock = clock || { t: T0 };
  const server = createServer({ dataFile, now: () => new Date(clock.t) });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = "http://127.0.0.1:" + server.address().port;
  const call = async (method, url, body, token) => {
    const headers = { connection: "close" };
    if (token) headers.authorization = "Bearer " + token;
    const res = await fetch(base + url, { method, headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };
  let n = 0;
  const user = async (name) => {
    const email = name.toLowerCase() + (++n) + "@example.com";
    const reg = await call("POST", "/users", { email, password: "password-1", name });
    const login = await call("POST", "/sessions", { email, password: "password-1" });
    return { id: reg.json.id, token: login.json.token, email };
  };
  const close = () => new Promise((done) => { server.closeAllConnections(); server.close(done); });
  return { call, user, close, dataFile, clock };
}

async function project(a, owner) {
  return (await a.call("POST", "/projects", { name: "P" }, owner.token)).json;
}

test("registers a user without exposing the password", async () => {
  const a = await api();
  const res = await a.call("POST", "/users", { email: " X@Example.com", password: "12345678", name: "X" });
  assert.equal(res.status, 201);
  assert.equal(res.json.email, "x@example.com");
  assert.equal(Object.keys(res.json).some((k) => /pass|hash|salt/i.test(k)), false);
  assert.equal(fs.readFileSync(a.dataFile, "utf8").includes("12345678"), false);
  await a.close();
});

test("rejects invalid and duplicate registrations", async () => {
  const a = await api();
  assert.equal((await a.call("POST", "/users", { email: "bad", password: "12345678", name: "x" })).json.field, "email");
  assert.equal((await a.call("POST", "/users", { email: "a@b.io", password: "1234567", name: "x" })).json.field, "password");
  await a.call("POST", "/users", { email: "a@b.io", password: "12345678", name: "x" });
  assert.equal((await a.call("POST", "/users", { email: "A@B.io", password: "12345678", name: "y" })).status, 409);
  await a.close();
});

test("logs in and rejects wrong passwords", async () => {
  const a = await api();
  const u = await a.user("Lin");
  assert.ok(u.token.length >= 20);
  assert.equal((await a.call("POST", "/sessions", { email: u.email, password: "nope-nope" })).status, 401);
  assert.equal((await a.call("GET", "/users/me", undefined, u.token)).json.id, u.id);
  await a.close();
});

test("requires a valid bearer token", async () => {
  const a = await api();
  assert.equal((await a.call("GET", "/projects")).status, 401);
  assert.equal((await a.call("GET", "/projects", undefined, "garbage")).status, 401);
  await a.close();
});

test("logout invalidates the token", async () => {
  const a = await api();
  const u = await a.user("Bo");
  assert.equal((await a.call("DELETE", "/sessions", undefined, u.token)).status, 204);
  assert.equal((await a.call("GET", "/users/me", undefined, u.token)).status, 401);
  await a.close();
});

test("sessions expire after 24 hours", async () => {
  const a = await api();
  const u = await a.user("Cy");
  a.clock.t = T0 + 86400000 - 1;
  assert.equal((await a.call("GET", "/users/me", undefined, u.token)).status, 200);
  a.clock.t = T0 + 86400000;
  assert.equal((await a.call("GET", "/users/me", undefined, u.token)).status, 401);
  await a.close();
});

test("non-members get 404 and viewers get 403 on writes", async () => {
  const a = await api();
  const owner = await a.user("O");
  const viewer = await a.user("V");
  const outsider = await a.user("X");
  const p = await project(a, owner);
  await a.call("POST", "/projects/" + p.id + "/members", { userId: viewer.id, role: "viewer" }, owner.token);
  assert.equal((await a.call("GET", "/projects/" + p.id, undefined, outsider.token)).status, 404);
  assert.equal((await a.call("GET", "/projects/" + p.id, undefined, viewer.token)).status, 200);
  assert.equal((await a.call("POST", "/projects/" + p.id + "/tasks", { title: "t" }, viewer.token)).status, 403);
  await a.close();
});

test("editors cannot delete projects or manage members", async () => {
  const a = await api();
  const owner = await a.user("O");
  const editor = await a.user("E");
  const p = await project(a, owner);
  await a.call("POST", "/projects/" + p.id + "/members", { userId: editor.id, role: "editor" }, owner.token);
  assert.equal((await a.call("DELETE", "/projects/" + p.id, undefined, editor.token)).status, 403);
  assert.equal((await a.call("POST", "/projects/" + p.id + "/tasks", { title: "t" }, editor.token)).status, 201);
  await a.close();
});

test("removing a member unassigns their tasks", async () => {
  const a = await api();
  const owner = await a.user("O");
  const editor = await a.user("E");
  const p = await project(a, owner);
  await a.call("POST", "/projects/" + p.id + "/members", { userId: editor.id, role: "editor" }, owner.token);
  const t = (await a.call("POST", "/projects/" + p.id + "/tasks", { title: "t", assigneeId: editor.id }, owner.token)).json;
  assert.equal((await a.call("DELETE", "/projects/" + p.id + "/members/" + editor.id, undefined, owner.token)).status, 204);
  assert.equal((await a.call("GET", "/projects/" + p.id + "/tasks/" + t.id, undefined, owner.token)).json.assigneeId, null);
  await a.close();
});

test("creates tasks with defaults and validates fields", async () => {
  const a = await api();
  const owner = await a.user("O");
  const p = await project(a, owner);
  const t = (await a.call("POST", "/projects/" + p.id + "/tasks", { title: " T ", labels: ["A", "a"] }, owner.token)).json;
  assert.equal(t.title, "T");
  assert.equal(t.priority, 3);
  assert.deepEqual(t.labels, ["a"]);
  const bad = await a.call("POST", "/projects/" + p.id + "/tasks", { title: "t", dueDate: "2026-02-30" }, owner.token);
  assert.equal(bad.json.field, "dueDate");
  await a.close();
});

test("enforces status transitions", async () => {
  const a = await api();
  const owner = await a.user("O");
  const p = await project(a, owner);
  const t = (await a.call("POST", "/projects/" + p.id + "/tasks", { title: "t" }, owner.token)).json;
  const url = "/projects/" + p.id + "/tasks/" + t.id;
  assert.equal((await a.call("PATCH", url, { status: "done" }, owner.token)).status, 409);
  assert.equal((await a.call("PATCH", url, { status: "doing" }, owner.token)).status, 200);
  assert.equal((await a.call("PATCH", url, { status: "done" }, owner.token)).status, 200);
  assert.equal((await a.call("PATCH", url, { status: "todo" }, owner.token)).status, 200);
  await a.close();
});

test("filters by status, label, and overdue", async () => {
  const a = await api();
  const owner = await a.user("O");
  const p = await project(a, owner);
  const base = "/projects/" + p.id + "/tasks";
  await a.call("POST", base, { title: "late", dueDate: "2026-03-01", labels: ["x"] }, owner.token);
  await a.call("POST", base, { title: "soon", dueDate: "2026-03-20" }, owner.token);
  assert.equal((await a.call("GET", base + "?overdue=true", undefined, owner.token)).json.items[0].title, "late");
  assert.equal((await a.call("GET", base + "?label=X", undefined, owner.token)).json.total, 1);
  assert.equal((await a.call("GET", base + "?status=done", undefined, owner.token)).json.total, 0);
  await a.close();
});

test("sorts and paginates tasks", async () => {
  const a = await api();
  const owner = await a.user("O");
  const p = await project(a, owner);
  const base = "/projects/" + p.id + "/tasks";
  for (const priority of [2, 5, 1]) await a.call("POST", base, { title: "p" + priority, priority }, owner.token);
  const sorted = (await a.call("GET", base + "?sort=priority&order=desc&limit=2&offset=1", undefined, owner.token)).json;
  assert.deepEqual(sorted.items.map((t) => t.title), ["p2", "p1"]);
  assert.equal(sorted.total, 3);
  assert.equal((await a.call("GET", base + "?limit=101", undefined, owner.token)).status, 400);
  await a.close();
});

test("records activity newest first", async () => {
  const a = await api();
  const owner = await a.user("O");
  const p = await project(a, owner);
  await a.call("POST", "/projects/" + p.id + "/tasks", { title: "t" }, owner.token);
  const log = (await a.call("GET", "/projects/" + p.id + "/activity", undefined, owner.token)).json;
  assert.deepEqual(log.items.map((e) => e.type), ["task.created", "project.created"]);
  await a.close();
});

test("persists across restarts and rejects bad JSON", async () => {
  const first = await api();
  const owner = await first.user("O");
  const p = await project(first, owner);
  assert.equal((await first.call("POST", "/projects/" + p.id + "/tasks", "{bad", owner.token)).status, 400);
  await first.close();
  const second = await api(first.dataFile, first.clock);
  assert.equal((await second.call("GET", "/projects/" + p.id, undefined, owner.token)).json.name, "P");
  assert.equal((await second.call("GET", "/nope")).status, 404);
  await second.close();
});

test("concurrent patches do not lose updates", async () => {
  const a = await api();
  const owner = await a.user("O");
  const p = await project(a, owner);
  const t = (await a.call("POST", "/projects/" + p.id + "/tasks", { title: "t" }, owner.token)).json;
  const url = "/projects/" + p.id + "/tasks/" + t.id;
  await Promise.all([
    a.call("PATCH", url, { title: "new" }, owner.token),
    a.call("PATCH", url, { priority: 1 }, owner.token)
  ]);
  const now = (await a.call("GET", url, undefined, owner.token)).json;
  assert.equal(now.title, "new");
  assert.equal(now.priority, 1);
  await a.close();
});
`);
  });
});

test("budget decision workload has a zero-cost deterministic sentinel", () => {
  const result = spawnSync(process.execPath, ["--test", resolve(
    TASKS, "../../../harness/tests/budget-continuation.test.mjs")], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
