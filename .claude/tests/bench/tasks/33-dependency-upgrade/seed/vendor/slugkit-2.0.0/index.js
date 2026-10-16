"use strict";

function toSlug(input, { separator = "-", maxLength = 64 } = {}) {
  if (typeof input !== "string") throw new TypeError("toSlug expects a string");
  if (!Number.isInteger(maxLength) || maxLength < 0) throw new RangeError("maxLength must be a non-negative integer");
  const words = input.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean);
  let slug = words.join(separator);
  if (maxLength > 0 && slug.length > maxLength) {
    slug = slug.slice(0, maxLength);
    while (separator && slug.endsWith(separator)) slug = slug.slice(0, -separator.length);
  }
  return slug;
}

module.exports = { toSlug };
