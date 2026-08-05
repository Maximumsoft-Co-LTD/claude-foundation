#!/usr/bin/env node

import { readFileSync } from "node:fs";

const read = path => JSON.parse(readFileSync(path, "utf8"));
const manifest = read("tests/oracle/m9-coverage.json");

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.suites)) {
  throw new Error("invalid M9 coverage manifest");
}

let total = 0;
for (const suite of manifest.suites) {
  const fixture = read(suite.fixture);
  const actual = new Set(fixture.cases.map(item => item.name));
  const mapped = suite.cases ?? suite.groups?.flatMap(group => group.cases) ?? [];
  if (mapped.length !== new Set(mapped).size) {
    throw new Error(`duplicate coverage mapping in ${suite.fixture}`);
  }
  const missing = [...actual].filter(name => !mapped.includes(name));
  const unknown = mapped.filter(name => !actual.has(name));
  if (missing.length || unknown.length) {
    throw new Error(`${suite.fixture}: missing=${missing.join(",")} unknown=${unknown.join(",")}`);
  }
  total += mapped.length;
}
if (total !== manifest.directlyMappedCases) {
  throw new Error(`mapped case count ${total} does not match declared ${manifest.directlyMappedCases}`);
}
console.log(`M9 coverage manifest: ${total}/${total} fixture cases mapped`);
