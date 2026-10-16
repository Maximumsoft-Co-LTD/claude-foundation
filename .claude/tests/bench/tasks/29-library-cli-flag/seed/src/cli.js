"use strict";

const fs = require("node:fs");
const { countText } = require("./index");

const USAGE = "usage: wordstat <file>\n";

// Returns { code, stdout, stderr } so the CLI is testable without spawning.
function run(argv) {
  const files = [];
  for (const arg of argv) {
    if (arg.startsWith("-")) return { code: 1, stdout: "", stderr: `unknown option: ${arg}\n${USAGE}` };
    files.push(arg);
  }
  if (files.length !== 1) return { code: 1, stdout: "", stderr: USAGE };
  let text;
  try {
    text = fs.readFileSync(files[0], "utf8");
  } catch (error) {
    return { code: 2, stdout: "", stderr: `wordstat: cannot read ${files[0]}: ${error.code || error.message}\n` };
  }
  const stats = countText(text);
  return {
    code: 0,
    stdout: `words: ${stats.words}\nlines: ${stats.lines}\nchars: ${stats.chars}\n`,
    stderr: ""
  };
}

module.exports = { run, USAGE };
