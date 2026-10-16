const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { toCsv } = require("../src/csv");
const { run } = require("../src/cli");

test("converts rows and quotes special values", () => {
  assert.equal(toCsv([{ a: 1, b: "x,y" }, { a: 2, b: 'say "hi"' }]), 'a,b\n1,"x,y"\n2,"say ""hi"""\n');
  assert.equal(toCsv([{ a: "x;y" }], { sep: ";" }), 'a\n"x;y"\n');
  assert.equal(toCsv([]), "");
});

test("the CLI writes every file and keeps exit codes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rows2csv-"));
  const file = path.join(dir, "rows.json");
  fs.writeFileSync(file, JSON.stringify([{ id: 1, name: "Ann" }]));
  assert.deepEqual(run([file, file]), { code: 0, stdout: "id,name\n1,Ann\nid,name\n1,Ann\n", stderr: "" });
  assert.equal(run(["--sep", ";", file]).stdout, "id;name\n1;Ann\n");
  assert.equal(run([]).code, 1);
  assert.equal(run([file + ".missing"]).code, 2);
});
