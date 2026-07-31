const test = require("node:test");
const assert = require("node:assert");
const { searchContacts, listContacts } = require("./contacts");
test("case-insensitive both ways", () => {
  assert.ok(searchContacts("ada").some((c) => c.id === 1));
  assert.ok(searchContacts("ALAN").some((c) => c.id === 3));
});
test("survives the null-name row", () => {
  assert.doesNotThrow(() => searchContacts("a"));
  assert.ok(Array.isArray(searchContacts("zuse")));
});
test("empty query returns everything", () => {
  assert.strictEqual(searchContacts("").length, listContacts().length);
});
