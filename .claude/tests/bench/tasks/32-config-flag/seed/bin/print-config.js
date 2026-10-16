#!/usr/bin/env node
"use strict";

const { loadConfig } = require("../src/config");

try {
  const config = loadConfig({ env: process.env, file: process.argv[2] });
  process.stdout.write(`${JSON.stringify(config)}\n`);
} catch (error) {
  if (error.name !== "ConfigError") throw error;
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
