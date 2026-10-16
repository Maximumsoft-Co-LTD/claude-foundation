const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { countText } = require("../src/index");
const { run } = require("../src/cli");

test("counts words, lines and code points", () => {
  assert.deepEqual(countText("hello wörld\nsecond line"), { words: 4, lines: 2, chars: 23 });
  assert.deepEqual(countText(""), { words: 0, lines: 0, chars: 0 });
});

test("prints the plain report and keeps exit codes", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wordstat-")), "a.txt");
  fs.writeFileSync(file, "one two\nthree\n");
  assert.deepEqual(run([file]), { code: 0, stdout: "words: 3\nlines: 2\nchars: 14\n", stderr: "" });
  assert.equal(run([]).code, 1);
  assert.equal(run([file + ".missing"]).code, 2);
});
