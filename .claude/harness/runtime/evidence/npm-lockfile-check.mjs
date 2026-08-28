#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function npmLockfileConsistency(packageJson, lockfile) {
  const root = lockfile?.packages?.[""] || lockfile || {};
  const issues = [];
  if (packageJson.name && root.name !== packageJson.name)
    issues.push(`package name '${packageJson.name}' is missing or differs in package-lock.json`);
  if (packageJson.version && root.version !== packageJson.version)
    issues.push(`package version '${packageJson.version}' is missing or differs in package-lock.json`);
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const expected = packageJson[field] || {};
    const actual = root[field] || {};
    for (const [name, spec] of Object.entries(expected))
      if (actual[name] !== spec)
        issues.push(`${field}.${name} '${spec}' is missing or differs in package-lock.json`);
    for (const name of Object.keys(actual))
      if (!(name in expected)) issues.push(`${field}.${name} remains only in package-lock.json`);
  }
  return issues;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function checkNpmWorkspace(workspace = process.cwd()) {
  const packagePath = join(workspace, "package.json");
  const lockPath = join(workspace, "package-lock.json");
  if (!existsSync(packagePath) || !existsSync(lockPath))
    return { status: "not-applicable", issues: [], packagePath, lockPath };
  const issues = npmLockfileConsistency(readJson(packagePath), readJson(lockPath));
  return { status: issues.length ? "fail" : "pass", issues, packagePath, lockPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let result;
  try { result = checkNpmWorkspace(); }
  catch (error) {
    result = { status: "error", issues: [error.message] };
  }
  console.log(JSON.stringify({
    protocol: "foundation-npm-lockfile-check-v1",
    status: result.status,
    issues: result.issues
  }));
  if (!["pass", "not-applicable"].includes(result.status)) process.exitCode = 1;
}
