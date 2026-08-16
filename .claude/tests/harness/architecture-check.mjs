#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DOMAINS = new Set([
  "composition", "contracts", "core", "evidence", "observability",
  "reliability", "workflow"
]);

// Dependencies point upward through this table. Stateful cross-domain behavior
// is still injected by the composition root; the direct edges below are for
// stable contracts and pure helpers only.
const ALLOWED = {
  composition: new Set([...DOMAINS]),
  contracts: new Set(["contracts"]),
  core: new Set(["contracts", "core", "reliability"]),
  evidence: new Set(["contracts", "core", "evidence", "reliability"]),
  observability: new Set(["contracts", "core", "observability", "reliability"]),
  reliability: new Set(["contracts", "core", "reliability"]),
  workflow: new Set(["contracts", "core", "evidence", "reliability", "workflow"])
};

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function runtimeDomain(runtimeRoot, path) {
  const rel = relative(runtimeRoot, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  const first = rel.split(sep)[0];
  return DOMAINS.has(first) ? first : null;
}

function importedModules(source) {
  const modules = [];
  const collect = (pattern) => {
    for (const match of source.matchAll(pattern))
      modules.push({ specifier: match[1], index: match.index });
  };
  collect(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g);
  collect(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g);
  collect(/\bcreateRequire\s*\([^)]*\)\s*\(\s*["']([^"']+)["']\s*\)/g);

  // createRequire is commonly assigned to a project-specific identifier, so a
  // literal call through that alias must be treated like require("...").
  const loaders = [...source.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[A-Za-z_$][\w$]*\.)?createRequire\s*\(/g
  )].map((match) => match[1]);
  for (const loader of loaders) {
    const escaped = loader.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    collect(new RegExp(`\\b${escaped}\\s*\\(\\s*["']([^"']+)["']\\s*\\)`, "g"));
  }
  return [...new Map(modules.map((module) =>
    [`${module.index}:${module.specifier}`, module])).values()];
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

export function dependencyFindings(runtimeRoot) {
  const findings = [];
  for (const path of walk(runtimeRoot).filter((candidate) => candidate.endsWith(".mjs"))) {
    const sourceDomain = runtimeDomain(runtimeRoot, path);
    if (!sourceDomain) continue;
    const source = readFileSync(path, "utf8");
    for (const imported of importedModules(source)) {
      if (!imported.specifier.startsWith(".")) continue;
      const target = resolve(dirname(path), imported.specifier);
      const targetDomain = runtimeDomain(runtimeRoot, target);
      if (!targetDomain || ALLOWED[sourceDomain].has(targetDomain)) continue;
      findings.push({
        path: relative(runtimeRoot, path).replaceAll("\\", "/"),
        line: lineAt(source, imported.index),
        sourceDomain,
        targetDomain,
        specifier: imported.specifier
      });
    }
  }
  return findings;
}

function main() {
  const root = resolve(process.argv[2] || process.cwd());
  const runtimeRoot = join(root, ".claude", "harness", "runtime");
  const findings = dependencyFindings(runtimeRoot);
  if (!findings.length) {
    console.log("OK");
    return;
  }
  for (const finding of findings)
    console.log(`${finding.path}:${finding.line}: ${finding.sourceDomain} must not import ${finding.targetDomain} (${finding.specifier})`);
  process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  main();
