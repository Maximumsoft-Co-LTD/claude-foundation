const http = require("node:http");
const path = require("node:path");
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

  async function handle(req, res) {
    const { pathname } = new URL(req.url, "http://localhost");
    const one = pathname.match(/^\/payments\/([^/]+)$/);
    const capture = pathname.match(/^\/payments\/([^/]+)\/capture$/);

    if (req.method === "GET" && one) {
      const payment = ledger.payments[one[1]];
      return payment ? sendJson(res, 200, view(one[1], payment))
        : sendJson(res, 404, { error: "not_found" });
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
      await saveLedger(ledgerFile, ledger);
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
  createServer({ ledgerFile }).listen(port, () => process.stdout.write(`payments on ${port}\n`));
}
