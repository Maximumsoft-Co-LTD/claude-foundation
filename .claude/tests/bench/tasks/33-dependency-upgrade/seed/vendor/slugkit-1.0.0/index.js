"use strict";

function slugify(input, { separator = "-" } = {}) {
  if (typeof input !== "string") throw new TypeError("slugify expects a string");
  const words = input.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean);
  return words.join(separator);
}

module.exports = { slugify };
