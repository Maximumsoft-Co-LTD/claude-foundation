const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createStaticHandler } = require("../src/static");

const handle = createStaticHandler(path.join(__dirname, "..", "public"));

test("serves files with a content type", async () => {
  const page = await handle("/index.html");
  assert.equal(page.status, 200);
  assert.equal(page.contentType, "text/html");
  assert.match(String(page.body), /<h1>Docs<\/h1>/);
  assert.equal((await handle("/assets/app.js?v=3")).contentType, "text/javascript");
});

test("missing files and directories are 404", async () => {
  assert.equal((await handle("/nope.html")).status, 404);
  assert.equal((await handle("/assets")).status, 404);
});
