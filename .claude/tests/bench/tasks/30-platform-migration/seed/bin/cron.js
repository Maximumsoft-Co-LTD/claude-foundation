#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { runCron } = require("../src/cron");

const [storeFile, at = new Date().toISOString()] = process.argv.slice(2);
if (!storeFile) {
  process.stderr.write("usage: cron.js <store.json> [iso-time]\n");
  process.exit(1);
}
const store = JSON.parse(fs.readFileSync(storeFile, "utf8"));
const entries = runCron(store, at);
fs.writeFileSync(storeFile, `${JSON.stringify(store, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(entries)}\n`);
