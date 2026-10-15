// Checkout pricing in integer cents.

function subtotalCents(lines) {
  return lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
}

function loyaltyPercent(points) {
  if (!Number.isInteger(points) || points < 0)
    throw new RangeError("points must be a non-negative integer");
  if (points > 5000) return 10;
  if (points > 1000) return 5;
  return 0;
}

function priceOrder(lines, { points = 0 } = {}) {
  const subtotal = subtotalCents(lines);
  const discountPercent = loyaltyPercent(points);
  const discountCents = Math.floor((subtotal * discountPercent + 50) / 100);
  return { subtotalCents: subtotal, discountPercent, discountCents,
    totalCents: subtotal - discountCents };
}

module.exports = { subtotalCents, loyaltyPercent, priceOrder };
