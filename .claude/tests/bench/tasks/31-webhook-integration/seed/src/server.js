"use strict";

const http = require("node:http");

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function createServer({
  secrets = (process.env.PAYRAIL_WEBHOOK_SECRETS || "").split(",").filter(Boolean),
  clock = Date.now
} = {}) {
  const events = [];
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
      if (req.method === "GET" && req.url === "/events") return send(res, 200, { events });
      if (req.method === "POST" && req.url === "/webhooks/payrail") {
        const raw = await readBody(req);
        let event;
        try { event = JSON.parse(raw.toString("utf8")); } catch { return send(res, 400, { error: "invalid_json" }); }
        events.push(event);
        return send(res, 200, { status: "processed" });
      }
      return send(res, 404, { error: "not_found" });
    } catch {
      return send(res, 500, { error: "internal" });
    }
  });
}

if (require.main === module) {
  createServer().listen(Number(process.env.PORT) || 3000);
}

module.exports = { createServer };
