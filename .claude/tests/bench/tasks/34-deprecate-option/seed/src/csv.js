"use strict";

function cell(value, sep) {
  const text = value === null || value === undefined ? "" : String(value);
  return text.includes(sep) || /["\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows, { sep = "," } = {}) {
  if (!Array.isArray(rows)) throw new TypeError("rows must be an array");
  if (typeof sep !== "string" || sep.length !== 1) throw new TypeError("sep must be a single character");
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const lines = [keys.map((key) => cell(key, sep)).join(sep)];
  for (const row of rows) lines.push(keys.map((key) => cell(row[key], sep)).join(sep));
  return `${lines.join("\n")}\n`;
}

module.exports = { toCsv };
