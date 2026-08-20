// Usage and persisted metrics may arrive from external JSON. JavaScript's
// Number coercion treats blanks, booleans, and arrays as numbers, which turns
// unknown data into a measurement. Accept only actual finite numbers and
// non-blank numeric strings. Every current caller measures a quantity (tokens,
// cost, time, or bytes), so negative values are invalid observations too.
export function measuredNumber(value) {
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function isMeasuredNumber(value) {
  return measuredNumber(value) !== null;
}
