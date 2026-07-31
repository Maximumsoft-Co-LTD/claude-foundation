const test = require("node:test");
const assert = require("node:assert");
const { activityStrip } = require("./feed");
test("hidden strip shows nothing", () => {
  assert.deepStrictEqual(activityStrip([{label:"a"}], 0), []);
});
