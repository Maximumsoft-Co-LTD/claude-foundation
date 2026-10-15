const http = require("node:http");
const { authenticate } = require("./users");

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

function createServer() {
  const notes = new Map();
  let nextId = 1;

  async function handle(req, res) {
    const { pathname } = new URL(req.url, "http://localhost");
    const user = authenticate(req);
    const match = pathname.match(/^\/notes\/([^/]+)$/);

    if (req.method === "POST" && pathname === "/notes") {
      if (!user) return sendJson(res, 401, { error: "unauthenticated" });
      let body;
      try { body = await readJson(req); } catch { return sendJson(res, 400, { error: "invalid_json" }); }
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      if (!title) return sendJson(res, 400, { error: "invalid_title" });
      const note = { id: String(nextId++), title, owner: user.name };
      notes.set(note.id, note);
      return sendJson(res, 201, note);
    }
    if (req.method === "GET" && pathname === "/notes")
      return sendJson(res, 200, [...notes.values()]);
    if (req.method === "GET" && match) {
      const note = notes.get(match[1]);
      return note ? sendJson(res, 200, note) : sendJson(res, 404, { error: "not_found" });
    }
    if (req.method === "DELETE" && match) {
      if (!notes.has(match[1])) return sendJson(res, 404, { error: "not_found" });
      notes.delete(match[1]);
      res.writeHead(204);
      return res.end();
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
  createServer().listen(port, () => process.stdout.write(`notes listening on ${port}\n`));
}
