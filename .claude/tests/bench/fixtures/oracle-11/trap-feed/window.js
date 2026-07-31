// Shared list helpers. Several screens import these — keep the names and shapes.

// Return the most recent `n` items, oldest-first order preserved.
function lastN(items, n) {
  return items.slice(-n);
}

// Return items after dropping the most recent `n`.
function dropLastN(items, n) {
  return items.slice(0, items.length - n);
}

module.exports = { lastN, dropLastN };
