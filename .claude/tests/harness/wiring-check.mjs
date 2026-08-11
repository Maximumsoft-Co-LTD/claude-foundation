#!/usr/bin/env node
// Static wiring check for the harness composition root.
//
// For every `export function create*({ ...keys })` under runtime/**, find the
// matching `createX({ ... })` call in foundation.mjs and report any
// destructured key the call does not supply. Brace-depth aware, so nested
// object literals inside an argument do not end the argument early.
//
// Usage: wiring-check.mjs <repo-root> [--unreferenced]
// Prints "OK", or one finding per line, and always exits 0 — the shell suite
// decides pass/fail so a crash here is distinguishable from a finding.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.argv[2];
const mode = process.argv[3] === "--unreferenced" ? "unreferenced"
  : process.argv[3] === "--late-bindings" ? "late-bindings" : "params";
const harness = join(root, ".claude", "harness");
const runtimeRoot = join(harness, "runtime");
// Comments sit inside these argument objects and would otherwise tokenize as
// property names ("does not receive not"). Only whole-line comments are
// removed: this source is full of strings like ":(exclude)coverage/**", so
// anything cleverer starts eating code.
const stripComments = (source) => source.replace(/^[ \t]*\/\/[^\n]*$/gm, "");
const entrypoint = stripComments(readFileSync(join(harness, "foundation.mjs"), "utf8"));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
}

const modules = walk(runtimeRoot).filter((path) => path.endsWith(".mjs"));
const moduleSources = new Map(modules.map((path) =>
  [path, stripComments(readFileSync(path, "utf8"))]));

// Read a balanced brace-delimited span starting at `open`.
function balanced(source, open, [start, end]) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === start) depth += 1;
    else if (source[index] === end) {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return null;
}

// Destructured key names at depth 1 only: nested patterns and defaults belong
// to the caller of the nested shape, not to this argument object.
function destructuredKeys(pattern) {
  const keys = [];
  let depth = 0;
  let token = "";
  // The leading identifier is the property name in every form that matters:
  // `key`, `key: renamed`, `key = default`, and the method shorthand
  // `key(a, b) { … }` the composition root uses for inline adapters.
  const flush = () => {
    const name = token.trim().match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)/)?.[1];
    if (name && !token.trim().startsWith("...")) keys.push(name);
    token = "";
  };
  for (const character of pattern) {
    if ("{[(".includes(character)) { depth += 1; token += character; continue; }
    if ("}])".includes(character)) { depth -= 1; token += character; continue; }
    if (character === "," && depth === 0) { flush(); continue; }
    token += character;
  }
  flush();
  return [...new Set(keys)];
}

// Keys the call supplies, at depth 1 of the argument object.
function suppliedKeys(argument) {
  return destructuredKeys(argument);
}

const findings = [];

if (mode === "params") {
  for (const path of modules) {
    const source = moduleSources.get(path);
    const factory = /export function (create[A-Za-z0-9_]*)\s*\(\s*\{/g;
    let match;
    while ((match = factory.exec(source)) !== null) {
      const name = match[1];
      const pattern = balanced(source, source.indexOf("{", match.index + match[0].length - 1), ["{", "}"]);
      if (pattern === null) continue;
      const required = destructuredKeys(pattern)
        // A destructured key with a default is optional by construction.
        .filter((key) => !new RegExp(`\\b${key}\\s*=`).test(pattern));
      const callers = [[join(harness, "foundation.mjs"), entrypoint],
        ...[...moduleSources].filter(([candidate]) => candidate !== path)];
      const caller = callers.find(([, callerSource]) => callerSource.includes(`${name}({`));
      if (!caller) {
        findings.push(`${relative(root, path)}: ${name} is never called by shipped runtime code`);
        continue;
      }
      const [callerPath, callerSource] = caller;
      const callAt = callerSource.indexOf(`${name}({`);
      const argument = balanced(callerSource, callerSource.indexOf("{", callAt), ["{", "}"]);
      if (argument === null) continue;
      const supplied = new Set(suppliedKeys(argument));
      const missing = required.filter((key) => !supplied.has(key));
      if (missing.length)
        findings.push(`${relative(root, callerPath)}: ${name} does not receive ${missing.join(", ")}`);
    }
  }
} else if (mode === "unreferenced") {
  // Modules that ship deliberately unwired. Each is offered to project-owned
  // provider code rather than called by the runtime, and its contract is
  // documented; keeping the list explicit is what makes an *accidental* orphan
  // visible instead of blending into the same silence.
  const standalone = new Set(["reliability/bounded-retry.mjs", "version.mjs"]);
  const imported = new Set();
  const collect = (source) => {
    for (const match of source.matchAll(/from\s+"([^"]+\.mjs)"/g)) imported.add(match[1]);
  };
  collect(entrypoint);
  for (const path of modules) collect(readFileSync(path, "utf8"));
  for (const path of modules) {
    const name = relative(runtimeRoot, path);
    if (standalone.has(name)) continue;
    const base = name.split("/").pop();
    if (![...imported].some((specifier) => specifier.endsWith(`/${base}`) || specifier.endsWith(base)))
      findings.push(`runtime/${name}`);
  }
} else {
  for (const match of entrypoint.matchAll(/^let\s+([A-Za-z_$][\w$]*(?:Runtime|Topology))\s*;/gm))
    findings.push(`foundation.mjs:${match.index}: delayed runtime binding '${match[1]}'`);
}

console.log(findings.length ? findings.join("\n") : "OK");
