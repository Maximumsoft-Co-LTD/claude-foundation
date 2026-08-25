import { ESLint } from "eslint";
import { parse } from "espree";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, isMain, parseArgs, readJson, repoPath, writeJson } from "./lib.mjs";

const COMPLEXITY = /complexity of (\d+)\./i;
const NAME = /(?:function|method|constructor|field initializer|class static block)\s+'([^']+)'/i;

export function complexityRecords(results, root = ROOT) {
  const records = [];
  for (const result of results) {
    for (const message of result.messages) {
      if (message.ruleId !== "complexity") continue;
      const match = message.message.match(COMPLEXITY);
      if (!match) throw new Error(`unexpected ESLint complexity message: ${message.message}`);
      const named = message.message.match(NAME);
      records.push({
        path: repoPath(result.filePath, root),
        name: named?.[1] || `<anonymous@${message.line}:${message.column}>`,
        line: message.line,
        column: message.column,
        endLine: message.endLine || message.line,
        endColumn: message.endColumn || message.column,
        cyclomatic: Number(match[1])
      });
    }
  }
  return records.sort((left, right) =>
    left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column);
}

const FUNCTION_LIKE = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "PropertyDefinition",
  "StaticBlock"
]);

export function sourceFunctionRanges(source) {
  const ast = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    loc: true,
    allowHashBang: true
  });
  const ranges = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (FUNCTION_LIKE.has(value.type) && value.loc) ranges.push(value.loc);
    for (const [key, child] of Object.entries(value)) {
      if (["loc", "range", "tokens", "comments", "parent"].includes(key)) continue;
      visit(child);
    }
  };
  visit(ast);
  return ranges;
}

export function attachFunctionRanges(records, sources) {
  return records.map((record) => {
    const ranges = sources.get(record.path) || [];
    const sameLine = ranges.filter((range) => range.start.line === record.line)
      .sort((left, right) =>
        Math.abs(left.start.column + 1 - record.column) - Math.abs(right.start.column + 1 - record.column));
    const selected = sameLine[0];
    return selected ? {
      ...record,
      endLine: selected.end.line,
      endColumn: selected.end.column + 1
    } : record;
  });
}

export async function collectComplexity({ root = ROOT, policyPath = "quality/policy.json" } = {}) {
  const policy = readJson(resolve(root, policyPath));
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      { ignores: policy.javascript.exclude },
      {
        files: ["**/*.js", "**/*.mjs"],
        languageOptions: { ecmaVersion: "latest", sourceType: "module" },
        rules: {
          complexity: ["error", { max: 0, variant: policy.complexity.variant }]
        }
      }
    ]
  });
  const results = await eslint.lintFiles(policy.javascript.include);
  const fatal = results.flatMap((result) => result.messages
    .filter((message) => message.fatal)
    .map((message) => `${repoPath(result.filePath, root)}:${message.line}:${message.column} ${message.message}`));
  if (fatal.length) throw new Error(`complexity parsing failed:\n${fatal.join("\n")}`);
  const records = complexityRecords(results, root);
  const sources = new Map(results.map((result) => [
    repoPath(result.filePath, root),
    sourceFunctionRanges(readFileSync(result.filePath, "utf8"))
  ]));
  return {
    protocol: "foundation-complexity-v1",
    generatedAt: new Date().toISOString(),
    variant: policy.complexity.variant,
    functions: attachFunctionRanges(records, sources)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root || ROOT);
  const output = resolve(ROOT, args.output || ".foundation/test-results/quality/complexity.json");
  const report = await collectComplexity({ root, policyPath: args.policy || "quality/policy.json" });
  writeJson(output, report);
  process.stdout.write(`complexity: ${report.functions.length} function(s) -> ${repoPath(output)}\n`);
}

if (isMain(import.meta.url)) await main();
