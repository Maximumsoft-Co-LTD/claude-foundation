const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createServer } = require("../src/server");

function ledgerWith(payments) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payments-"));
  const file = path.join(dir, "ledger.json");
  fs.writeFileSync(file, JSON.stringify({ payments }));
  return file;
}

async function withServer(ledgerFile, fn) {
  const server = createServer({ ledgerFile });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try { await fn(call); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test("reads a payment with zero refunds", async () => {
  const file = ledgerWith({ pay_1: { amountCents: 5000, capturedCents: 5000 } });
  await withServer(file, async (call) => {
    assert.deepEqual((await call("GET", "/payments/pay_1")).body,
      { id: "pay_1", amountCents: 5000, capturedCents: 5000, refundedCents: 0 });
    assert.equal((await call("GET", "/payments/nope")).status, 404);
  });
});

test("captures up to the authorized amount and persists", async () => {
  const file = ledgerWith({ pay_1: { amountCents: 5000, capturedCents: 0 } });
  await withServer(file, async (call) => {
    assert.equal((await call("POST", "/payments/pay_1/capture", { amountCents: 3000 })).status, 200);
    assert.equal((await call("POST", "/payments/pay_1/capture", { amountCents: 2001 })).status, 409);
    assert.equal((await call("POST", "/payments/pay_1/capture", { amountCents: 0 })).status, 400);
  });
  await withServer(file, async (call) => {
    assert.equal((await call("GET", "/payments/pay_1")).body.capturedCents, 3000);
  });
});
