#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function version(value) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(value ?? "");
  if (!match) throw new Error(`invalid Rust version '${value}'`);
  return match.slice(1).map((part) => Number(part ?? 0));
}

function greater(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

const command = spawnSync(
  "cargo",
  ["metadata", "--locked", "--format-version", "1"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (command.error) throw command.error;
if (command.status !== 0) {
  process.stderr.write(command.stderr);
  process.exit(command.status ?? 1);
}

const metadata = JSON.parse(command.stdout);
const workspace = new Set(metadata.workspace_members);
const declared = new Set(
  metadata.packages
    .filter((entry) => workspace.has(entry.id))
    .map((entry) => entry.rust_version),
);
if (declared.size !== 1 || declared.has(null)) {
  throw new Error(
    `workspace crates must declare one shared rust-version; found ${JSON.stringify([...declared])}`,
  );
}

const [declaredText] = declared;
const declaredVersion = version(declaredText);
const incompatible = metadata.packages
  .filter(
    (entry) =>
      entry.rust_version && greater(version(entry.rust_version), declaredVersion),
  )
  .map((entry) => `${entry.name} ${entry.version} requires ${entry.rust_version}`)
  .sort();

if (incompatible.length > 0) {
  throw new Error(
    `locked dependency MSRV exceeds workspace rust-version ${declaredText}:\n${incompatible.join("\n")}`,
  );
}

process.stdout.write(
  `MSRV contract: PASS (workspace ${declaredText}; ${metadata.packages.length} locked packages checked)\n`,
);
