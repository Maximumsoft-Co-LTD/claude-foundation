#!/usr/bin/env node
"use strict";

const { run } = require("../src/cli");

const result = run(process.argv.slice(2));
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
