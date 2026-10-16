"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain", ".json": "application/json" };

function createStaticHandler(root) {
  const base = path.resolve(root);
  return async function handle(urlPath) {
    const pathname = decodeURIComponent(urlPath.split("?")[0]);
    const file = path.join(base, pathname);
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) return { status: 404, contentType: "text/plain", body: "not found" };
      const body = await fs.readFile(file);
      return { status: 200, contentType: TYPES[path.extname(file)] || "application/octet-stream", body };
    } catch {
      return { status: 404, contentType: "text/plain", body: "not found" };
    }
  };
}

module.exports = { createStaticHandler };
