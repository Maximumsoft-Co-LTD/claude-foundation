#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SOURCE_IGNORED = new Set([
  ".claude", ".foundation", ".git", "node_modules", "coverage", "quality", "test", "tests"
]);

function walkFiles(root, directory, accept, ignored = new Set()) {
  const files = [];
  function walk(current) {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (accept(entry.name)) files.push(absolute);
    }
  }
  walk(directory);
  return files.map((file) => path.relative(root, file).replaceAll("\\", "/")).sort();
}

export function discoverNodeTestFiles(root) {
  const nested = ["test", "tests"].flatMap((directory) =>
    walkFiles(root, path.join(root, directory), (name) => /\.(?:cjs|mjs|js)$/.test(name)));
  const rootTests = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /(?:^|\.)(?:test|spec)\.(?:cjs|mjs|js)$/.test(entry.name))
    .map((entry) => entry.name);
  return [...new Set([...nested, ...rootTests])].sort();
}

function sourceFiles(root) {
  return walkFiles(root, root, (name) => /\.(?:cjs|mjs|js)$/.test(name), SOURCE_IGNORED);
}

function measuredCoverage(root, tests) {
  if (!tests.length) return { kind: "function", percent: 0, output: "no tests discovered\n" };
  const run = spawnSync(process.execPath,
    ["--test", "--experimental-test-coverage", ...tests], {
      cwd: root, encoding: "utf8", timeout: 120000
    });
  const output = `${run.stdout || ""}${run.stderr || ""}`;
  const all = output.split("\n").find((line) => /all files\s*\|/i.test(line));
  const values = all?.split("|").slice(1, 4).map((value) => Number.parseFloat(value)) || [];
  if (Number.isFinite(values[2])) return { kind: "function", percent: values[2], output };
  if (Number.isFinite(values[0])) return { kind: "statement", percent: values[0], output };
  return { kind: "unavailable", percent: null, output };
}

export function createConsumerCrapReport(root = process.cwd()) {
  const tests = discoverNodeTestFiles(root);
  const coverage = measuredCoverage(root, tests);
  const digest = crypto.createHash("sha256");
  const functions = sourceFiles(root).map((relative) => {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    digest.update(relative).update("\0").update(source).update("\0");
    const decisions = source.match(/\b(?:if|for|while|case|catch)\b|&&|\|\||\?\?/g)?.length || 0;
    const complexity = Math.max(1, 1 + decisions);
    const crap = coverage.percent === null ? null :
      complexity ** 2 * (1 - coverage.percent / 100) ** 3 + complexity;
    return {
      id: `${relative}#file`, path: relative, line: 1,
      endLine: Math.max(1, source.split("\n").length), complexity,
      coverageKind: coverage.kind, coverageClass: "unit", coveragePercent: coverage.percent,
      crap: crap === null ? null : Number(crap.toFixed(4)),
      mapping: coverage.percent === null ? "unmapped" : "function-fallback"
    };
  });
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return {
    report: {
      protocol: "foundation-crap-v1", repository: "root",
      repositoryCommit: commit.status === 0 ? commit.stdout.trim() : null,
      workspaceDigest: `sha256:${digest.digest("hex")}`, language: "javascript",
      tool: {
        name: "foundation-consumer-e2e-crap", version: "2.0.0", adapterVersion: "2",
        configDigest: `sha256:${crypto.createHash("sha256").update("foundation-consumer-e2e-crap-v2").digest("hex")}`
      },
      functions
    },
    tests,
    coverageLog: coverage.output
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.cwd();
  const result = createConsumerCrapReport(root);
  const output = path.join(root, ".foundation", "quality");
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "coverage.log"), result.coverageLog);
  fs.writeFileSync(path.join(output, "crap.json"), `${JSON.stringify(result.report, null, 2)}\n`);
  const scores = result.report.functions.map((row) => row.crap).filter(Number.isFinite);
  console.log(JSON.stringify({
    tests: result.tests.length,
    files: result.report.functions.length,
    maxCrap: scores.length ? Math.max(...scores) : null,
    meanCrap: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null
  }));
}
