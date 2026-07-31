const test = require("node:test");
const assert = require("node:assert");
const { searchContacts } = require("./contacts");
test("finds Ada", () => { assert.ok(searchContacts("Ada").some((c) => c.id === 1)); });
