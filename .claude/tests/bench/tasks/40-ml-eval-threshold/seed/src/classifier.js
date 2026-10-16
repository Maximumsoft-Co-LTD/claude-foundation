"use strict";

const LABELS = ["billing", "technical", "account", "other"];

const RULES = [
  ["billing", /invoice/i],
  ["technical", /error/i],
  ["account", /password/i]
];

function predict(text) {
  for (const [label, pattern] of RULES) if (pattern.test(text)) return label;
  return "other";
}

module.exports = { predict, LABELS };
