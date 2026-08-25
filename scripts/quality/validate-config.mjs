import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { resolve } from "node:path";
import { ROOT, isMain, readJson } from "./lib.mjs";

export function validateDocument(schema, document) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return validate(document) ? [] : (validate.errors || []).map((error) =>
    `${error.instancePath || "/"} ${error.message}`);
}

async function main() {
  const targets = [
    ["quality/schemas/quality-policy-v1.schema.json", "quality/policy.json"],
    ["quality/schemas/quality-exceptions-v1.schema.json", "quality/exceptions.json"],
    ["quality/schemas/coverage-lanes-v1.schema.json", "quality/coverage-lanes.json"],
    ["quality/schemas/semantic-mutants-v1.schema.json", "quality/semantic-mutants.json"],
    ["quality/schemas/quality-surfaces-v1.schema.json", "quality/surfaces.json"],
    ["quality/schemas/mutation-baseline-v1.schema.json", "quality/baselines/dashboard-mutation-v1.json"],
    ["quality/schemas/mutation-baseline-v1.schema.json", "quality/baselines/runtime-mutation-v1.json"],
    ["quality/schemas/mutation-baseline-v1.schema.json", "quality/baselines/examples-mutation-v1.json"],
    ["quality/schemas/mutation-baseline-v1.schema.json", "quality/baselines/website-mutation-v1.json"]
  ];
  const errors = [];
  for (const [schemaPath, documentPath] of targets) {
    for (const error of validateDocument(readJson(resolve(ROOT, schemaPath)), readJson(resolve(ROOT, documentPath)))) {
      errors.push(`${documentPath}: ${error}`);
    }
  }
  if (errors.length) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
  } else process.stdout.write(`quality config: ${targets.length} document(s) valid\n`);
}

if (isMain(import.meta.url)) await main();
