const test = require("node:test");
const assert = require("node:assert");
const { lastN } = require("./window");
test("a window of 0 over a non-empty list yields no rows (bug #412)", () => {
  assert.deepStrictEqual(lastN(["a", "b", "c"], 0), []);
});
