// Oracle calibration answers for the evidence-gate scenarios (tasks 25-28).
// Repository-only; never copied into a lab seed. Each repair is the smallest
// delivery that satisfies the hidden oracle, and each mutant is a plausible
// wrong delivery that the named oracle case must reject.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function replace(project, file, before, after) {
  const path = join(project, file);
  const original = readFileSync(path, 'utf8');
  if (!original.includes(before)) throw new Error(`repair anchor missing in ${file}`);
  write(path, original.replace(before, after));
}

export function repairOwnerOnlyDelete(project) {
  replace(project, 'src/server.js', `      if (!notes.has(match[1])) return sendJson(res, 404, { error: "not_found" });
      notes.delete(match[1]);`, `      if (!user) return sendJson(res, 401, { error: "unauthenticated" });
      const note = notes.get(match[1]);
      if (!note) return sendJson(res, 404, { error: "not_found" });
      if (note.owner !== user.name && user.role !== "admin")
        return sendJson(res, 403, { error: "forbidden" });
      notes.delete(match[1]);`);
  write(join(project, 'test/delete-authorization.test.js'), `
const assert = require("node:assert/strict");
const test = require("node:test");
const { createServer } = require("../src/server");

async function withServer(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const base = \`http://127.0.0.1:\${server.address().port}\`;
  const call = async (method, path, user, body) => {
    const headers = { "content-type": "application/json" };
    if (user) headers["x-user"] = user;
    const res = await fetch(base + path, { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body) });
    await res.text();
    return res.status;
  };
  try { await fn(call); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("only the owner or an admin may delete a note", () => withServer(async (call) => {
  await call("POST", "/notes", "alice", { title: "a" });
  await call("POST", "/notes", "alice", { title: "b" });
  assert.equal(await call("DELETE", "/notes/1"), 401);
  assert.equal(await call("DELETE", "/notes/1", "bob"), 403);
  assert.equal(await call("GET", "/notes/1"), 200);
  assert.equal(await call("DELETE", "/notes/1", "alice"), 204);
  assert.equal(await call("DELETE", "/notes/2", "ada"), 204);
  assert.equal(await call("GET", "/notes/2"), 404);
}));
`);
}

export const OWNER_ONLY_DELETE_MUTANTS = [
  ['CASE_OTHER_USER_403', 'allow everyone',
    [['note.owner !== user.name && user.role !== "admin"', 'false']]],
  ['CASE_OWNER_DELETE', 'deny everyone',
    [['note.owner !== user.name && user.role !== "admin"', 'true']]],
  ['CASE_ADMIN_DELETE', 'owner only, no admin override',
    [['note.owner !== user.name && user.role !== "admin"', 'note.owner !== user.name']]],
  ['CASE_ANONYMOUS_401', 'anonymous treated as forbidden',
    [['if (!user) return sendJson(res, 401, { error: "unauthenticated" });\n      const note',
      'if (!user) return sendJson(res, 403, { error: "forbidden" });\n      const note']]]
];

const REFUND_SERVER = `const http = require("node:http");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { loadLedger, saveLedger } = require("./ledger");

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

const positiveInt = (value) => Number.isInteger(value) && value > 0;

function view(id, payment) {
  return { id, amountCents: payment.amountCents, capturedCents: payment.capturedCents,
    refundedCents: payment.refundedCents || 0 };
}

function createServer({ ledgerFile }) {
  const ledger = loadLedger(ledgerFile);
  ledger.idempotency ||= {};
  let queue = Promise.resolve();
  const exclusive = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

  function refund(paymentId, key, amountCents) {
    const fingerprint = \`\${paymentId}:\${amountCents}\`;
    const prior = ledger.idempotency[key];
    if (prior) return prior.fingerprint === fingerprint ? prior
      : { status: 422, body: { error: "idempotency_key_reused" } };
    const payment = ledger.payments[paymentId];
    if (!payment) return { status: 404, body: { error: "not_found" } };
    const refunded = payment.refundedCents || 0;
    if (refunded + amountCents > payment.capturedCents)
      return { status: 409, body: { error: "exceeds_captured" } };
    payment.refundedCents = refunded + amountCents;
    const record = { fingerprint, status: 201, body: { refundId: randomUUID(), paymentId,
      amountCents, refundedCents: payment.refundedCents } };
    ledger.idempotency[key] = record;
    return record;
  }

  async function handle(req, res) {
    const { pathname } = new URL(req.url, "http://localhost");
    const one = pathname.match(/^\\/payments\\/([^/]+)$/);
    const capture = pathname.match(/^\\/payments\\/([^/]+)\\/capture$/);
    const refunds = pathname.match(/^\\/payments\\/([^/]+)\\/refunds$/);

    if (req.method === "GET" && one) {
      const payment = ledger.payments[one[1]];
      return payment ? sendJson(res, 200, view(one[1], payment))
        : sendJson(res, 404, { error: "not_found" });
    }
    if (req.method === "POST" && refunds) {
      let body;
      try { body = await readJson(req); } catch { return sendJson(res, 400, { error: "invalid_json" }); }
      const key = req.headers["idempotency-key"];
      if (typeof key !== "string" || !key)
        return sendJson(res, 400, { error: "idempotency_key_required" });
      if (!positiveInt(body?.amountCents)) return sendJson(res, 400, { error: "invalid_amount" });
      const result = await exclusive(async () => {
        const outcome = refund(refunds[1], key, body.amountCents);
        if (outcome.status === 201) await saveLedger(ledgerFile, ledger);
        return outcome;
      });
      return sendJson(res, result.status, result.body);
    }
    if (req.method === "POST" && capture) {
      let body;
      try { body = await readJson(req); } catch { return sendJson(res, 400, { error: "invalid_json" }); }
      const payment = ledger.payments[capture[1]];
      if (!payment) return sendJson(res, 404, { error: "not_found" });
      if (!positiveInt(body?.amountCents)) return sendJson(res, 400, { error: "invalid_amount" });
      if (payment.capturedCents + body.amountCents > payment.amountCents)
        return sendJson(res, 409, { error: "exceeds_authorized" });
      payment.capturedCents += body.amountCents;
      await exclusive(() => saveLedger(ledgerFile, ledger));
      return sendJson(res, 200, view(capture[1], payment));
    }
    return sendJson(res, 404, { error: "not_found" });
  }

  return http.createServer((req, res) => {
    handle(req, res).catch(() => sendJson(res, 500, { error: "internal" }));
  });
}

module.exports = { createServer };

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const ledgerFile = process.env.LEDGER_FILE || path.join(process.cwd(), "ledger.json");
  createServer({ ledgerFile }).listen(port, () => process.stdout.write(\`payments on \${port}\\n\`));
}
`;

export function repairIdempotentRefund(project) {
  write(join(project, 'src/server.js'), REFUND_SERVER);
  write(join(project, 'test/refunds.test.js'), `
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../src/server");

async function withServer(ledgerFile, fn) {
  const server = createServer({ ledgerFile });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = \`http://127.0.0.1:\${server.address().port}\`;
  const refund = async (key, amountCents) => {
    const res = await fetch(\`\${base}/payments/pay_1/refunds\`, { method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ amountCents }) });
    return { status: res.status, body: await res.json() };
  };
  try { return await fn(refund); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("a retried refund pays out once, also after a restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refunds-"));
  const file = path.join(dir, "ledger.json");
  fs.writeFileSync(file, JSON.stringify({ payments: { pay_1: { amountCents: 100, capturedCents: 100 } } }));
  const first = await withServer(file, async (refund) => {
    const burst = await Promise.all([refund("k", 60), refund("k", 60)]);
    assert.deepEqual(burst[1], burst[0]);
    assert.equal((await refund("k", 61)).status, 422);
    assert.equal((await refund("other", 41)).status, 409);
    return burst[0];
  });
  assert.equal(first.status, 201);
  await withServer(file, async (refund) => assert.deepEqual(await refund("k", 60), first));
});
`);
}

export const IDEMPOTENT_REFUND_MUTANTS = [
  ['CASE_REPLAY_SAME_RESPONSE', 'replay mints a new response',
    [['if (prior) return prior.fingerprint === fingerprint ? prior',
      'if (prior) return prior.fingerprint === fingerprint ? { ...prior, body: { ...prior.body, refundId: randomUUID() } }']]],
  ['CASE_RESTART_DEDUPES', 'idempotency records are lost on restart',
    [['ledger.idempotency ||= {};', 'ledger.idempotency = {};']]],
  ['CASE_OVER_REFUND_REJECTED', 'limit checks authorized instead of captured',
    [['refunded + amountCents > payment.capturedCents', 'refunded + amountCents > payment.amountCents']]],
  ['CASE_CONCURRENT_DUPLICATES', 'check-then-await-then-record without serialization',
    [['const exclusive = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };',
      'const exclusive = (fn) => fn();'],
     ['    ledger.idempotency[key] = record;\n    return record;',
      '    return record;'],
     ['        if (outcome.status === 201) await saveLedger(ledgerFile, ledger);',
      '        if (outcome.status === 201) { await saveLedger(ledgerFile, ledger).catch(() => {}); ledger.idempotency[key] = outcome; }']]]
];

const FAST_SEARCH = `// Product catalog search. Words are computed once per record.

function normalize(text) {
  return String(text ?? "").normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
}

function words(text) {
  return normalize(text).split(/[^\\p{L}\\p{N}]+/u).filter(Boolean);
}

function createCatalog(records) {
  const items = records.map((record, index) => {
    const list = words(\`\${record.title} \${(record.tags || []).join(" ")}\`);
    return { record, index, list, set: new Set(list) };
  });
  return {
    search(query, { limit = 20 } = {}) {
      const terms = words(query);
      if (terms.length === 0) return [];
      const hits = [];
      const seen = new Set();
      for (const item of items) {
        let score = 0;
        for (const term of terms) {
          if (item.set.has(term)) score += 2;
          else if (item.list.some((word) => word.startsWith(term))) score += 1;
          else { score = 0; break; }
        }
        if (score === 0 || seen.has(item.record.id)) continue;
        seen.add(item.record.id);
        hits.push({ id: item.record.id, title: item.record.title, score, index: item.index });
      }
      hits.sort((left, right) => right.score - left.score || left.index - right.index);
      return hits.slice(0, limit).map(({ id, title, score }) => ({ id, title, score }));
    }
  };
}

module.exports = { createCatalog };
`;

export function repairSpeedUpSearch(project) {
  write(join(project, 'src/search.js'), FAST_SEARCH);
  write(join(project, 'test/search-characterization.test.js'), `
const assert = require("node:assert/strict");
const test = require("node:test");
const { createCatalog } = require("../src/search");

test("duplicate ids keep the first matching record", () => {
  const catalog = createCatalog([{ id: "a", title: "chair" }, { id: "a", title: "lamp" }]);
  assert.deepEqual(catalog.search("lamp"), [{ id: "a", title: "lamp", score: 2 }]);
  assert.deepEqual(catalog.search("lamp", { limit: 0 }), []);
});
`);
}

export const SPEED_UP_SEARCH_MUTANTS = [
  ['CASE_CASE_AND_ACCENTS', 'accents are no longer folded',
    [['String(text ?? "").normalize("NFKD")', 'String(text ?? "")']]],
  ['CASE_TIE_ORDER', 'ties ordered by id instead of catalog order',
    [['right.score - left.score || left.index - right.index',
      'right.score - left.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)']]],
  ['CASE_DUPLICATE_IDS', 'ids deduplicated before matching',
    [['if (score === 0 || seen.has(item.record.id)) continue;\n        seen.add(item.record.id);',
      'if (seen.has(item.record.id)) continue;\n        seen.add(item.record.id);\n        if (score === 0) continue;']]],
  ['CASE_SPEEDUP_3X', 'words recomputed on every search',
    [['item.set.has(term)',
      'words(`${item.record.title} ${(item.record.tags || []).join(" ")}`).includes(term)']]]
];

export function repairRegressionFix(project) {
  replace(project, 'src/pricing.js', 'if (points > 5000) return 10;', 'if (points >= 5000) return 10;');
  replace(project, 'src/pricing.js', 'if (points > 1000) return 5;', 'if (points >= 1000) return 5;');
  write(join(project, 'test/loyalty-boundaries.test.js'), `
const assert = require("node:assert/strict");
const test = require("node:test");
const { loyaltyPercent } = require("../src/pricing");

test("tiers start exactly at 1000 and 5000 points", () => {
  assert.deepEqual([999, 1000, 4999, 5000].map(loyaltyPercent), [0, 5, 5, 10]);
});
`);
}

export const REGRESSION_FIX_MUTANTS = [
  ['CASE_UPPER_BOUNDARY', 'only the reported boundary fixed',
    [['if (points >= 5000) return 10;', 'if (points > 5000) return 10;']]],
  ['CASE_BELOW_BOUNDARIES', 'boundary over-corrected',
    [['if (points >= 1000) return 5;', 'if (points >= 999) return 5;']]],
  ['CASE_ROUNDING_INTACT', 'rounding changed while fixing',
    [['Math.floor((subtotal * discountPercent + 50) / 100)',
      'Math.floor((subtotal * discountPercent) / 100)']]]
];
