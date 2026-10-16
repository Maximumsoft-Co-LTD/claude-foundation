"use strict";

const fs = require("node:fs");
const { toCsv } = require("./csv");

const USAGE = "usage: rows2csv [--sep <char>] <file.json>...\n";

// Returns { code, stdout, stderr } so the CLI is testable without spawning.
function run(argv) {
  const files = [];
  let sep = ",";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--sep") {
      if (i + 1 >= argv.length) return { code: 1, stdout: "", stderr: `missing value for --sep\n${USAGE}` };
      sep = argv[++i];
    } else if (arg.startsWith("-")) {
      return { code: 1, stdout: "", stderr: `unknown option: ${arg}\n${USAGE}` };
    } else {
      files.push(arg);
    }
  }
  if (files.length === 0) return { code: 1, stdout: "", stderr: USAGE };
  let stdout = "";
  for (const file of files) {
    let rows;
    try {
      rows = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      return { code: 2, stdout: "", stderr: `rows2csv: cannot read ${file}: ${error.code || error.message}\n` };
    }
    try {
      stdout += toCsv(rows, { sep });
    } catch (error) {
      return { code: 1, stdout: "", stderr: `rows2csv: ${error.message}\n` };
    }
  }
  return { code: 0, stdout, stderr: "" };
}

module.exports = { run, USAGE };
