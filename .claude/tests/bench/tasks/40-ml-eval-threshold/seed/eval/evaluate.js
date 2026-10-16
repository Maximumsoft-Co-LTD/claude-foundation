#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { predict } = require("../src/classifier");

const examples = require(path.join(__dirname, "labeled.json"));
const { minAccuracy } = require(path.join(__dirname, "threshold.json"));

let correct = 0;
for (const { text, label } of examples) if (predict(text) === label) correct += 1;
const accuracy = correct / examples.length;
process.stdout.write(`accuracy: ${accuracy.toFixed(3)} (${correct}/${examples.length}), threshold ${minAccuracy}\n`);
process.exitCode = accuracy >= minAccuracy ? 0 : 1;
