"use strict";

function countText(text) {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  const words = (text.match(/\S+/g) || []).length;
  const newlines = (text.match(/\n/g) || []).length;
  const lines = newlines + (text.length > 0 && !text.endsWith("\n") ? 1 : 0);
  const chars = Array.from(text).length;
  return { words, lines, chars };
}

module.exports = { countText };
