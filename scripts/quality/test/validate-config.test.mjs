import assert from "node:assert/strict";
import test from "node:test";
import { validateDocument } from "../validate-config.mjs";

test("schema validation reports missing required properties", () => {
  const errors = validateDocument({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["version"],
    properties: { version: { const: 1 } }
  }, {});
  assert.equal(errors.length, 1);
  assert.match(errors[0], /version/);
});
