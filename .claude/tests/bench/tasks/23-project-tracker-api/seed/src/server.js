const http = require("node:http");
const path = require("node:path");

function sendJson(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function createServer({ dataFile, now = () => new Date() } = {}) {
  void dataFile;
  void now;
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, "http://localhost");
    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 404, { error: "not_found" });
  });
}

module.exports = { createServer };

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const dataFile = process.env.TRACKER_DATA_FILE || path.join(process.cwd(), "tracker.json");
  createServer({ dataFile }).listen(port, () => {
    process.stdout.write(`tracker api listening on ${port}\n`);
  });
}
