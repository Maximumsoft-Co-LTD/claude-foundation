import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { ESLint } from "eslint";
import { attachFunctionRanges, complexityRecords, sourceFunctionRanges } from "../collect-complexity.mjs";

test("ESLint complexity messages normalize into stable records", () => {
  const records = complexityRecords([{
    filePath: "/repo/src/example.mjs",
    messages: [
      { ruleId: "complexity", message: "Function 'decide' has a complexity of 4. Maximum allowed is 0.", line: 3, column: 1, endLine: 9, endColumn: 2 },
      { ruleId: "other", message: "ignored", line: 1, column: 1 }
    ]
  }], "/repo");
  assert.deepEqual(records, [{
    path: "src/example.mjs", name: "decide", line: 3, column: 1,
    endLine: 9, endColumn: 2, cyclomatic: 4
  }]);
});

test("AST ranges extend complexity findings across the complete function body", () => {
  const ranges = sourceFunctionRanges([
    "function decide(value) {",
    "  if (value) return 1;",
    "  return 0;",
    "}"
  ].join("\n"));
  const records = attachFunctionRanges([{
    path: "src/example.mjs", name: "decide", line: 1, column: 1,
    endLine: 1, endColumn: 7, cyclomatic: 2
  }], new Map([["src/example.mjs", ranges]]));
  assert.equal(records[0].endLine, 4);
});

test("classic complexity pins methods, arrows, switch cases and logical expressions", async () => {
  const source = `
    class Example {
      decide = (value) => {
        if (value?.ready && value.enabled) return 1;
        switch (value?.kind) {
          case "a": return 2;
          case "b": return 3;
          default: return 0;
        }
      };
      method(value) { return value ? 1 : 0; }
      static { if (globalThis.ready) globalThis.started = true; }
    }
  `;
  const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [{
    files: ["**/*.mjs"], languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: { complexity: ["error", { max: 0, variant: "classic" }] }
  }] });
  const root = process.cwd();
  const records = complexityRecords(await eslint.lintText(source, { filePath: resolve(root, "example.mjs") }), root);
  const complexities = Object.fromEntries(records.map((record) => [record.name, record.cyclomatic]));
  assert.equal(complexities.decide, 7);
  assert.equal(complexities.method, 2);
  assert.ok(records.some((record) => record.cyclomatic === 1 && record.name.startsWith("<anonymous")));
  assert.ok(records.some((record) => record.cyclomatic === 2 && record.name.startsWith("<anonymous")));
});
