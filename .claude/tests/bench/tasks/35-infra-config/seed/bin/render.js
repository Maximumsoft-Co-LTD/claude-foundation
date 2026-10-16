#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { buildManifest } = require("../src/manifest");

try {
  const service = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  process.stdout.write(`${JSON.stringify(buildManifest(service), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`deploygen: ${error.message}\n`);
  process.exitCode = 1;
}
