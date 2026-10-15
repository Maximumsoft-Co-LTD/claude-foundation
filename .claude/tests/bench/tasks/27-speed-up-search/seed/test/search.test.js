const assert = require("node:assert/strict");
const test = require("node:test");
const { createCatalog } = require("../src/search");

const catalog = createCatalog([
  { id: "a", title: "Blue Lamp", tags: ["home"] },
  { id: "b", title: "Lampshade", tags: ["home", "decor"] },
  { id: "c", title: "Café Table" },
  { id: "a", title: "Duplicate blue lamp" }
]);

test("exact words outrank prefixes and ties keep catalog order", () => {
  assert.deepEqual(catalog.search("lamp"), [
    { id: "a", title: "Blue Lamp", score: 2 },
    { id: "b", title: "Lampshade", score: 1 }
  ]);
});

test("matching ignores case and accents", () => {
  assert.deepEqual(catalog.search("CAFE"), [{ id: "c", title: "Café Table", score: 2 }]);
});

test("an empty query returns nothing", () => {
  assert.deepEqual(catalog.search("  "), []);
});
