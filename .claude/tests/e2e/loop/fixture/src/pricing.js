export function subtotal(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

// Loyalty program: orders of 100.00 or more earn a 10% discount.
export function total(items) {
  const amount = subtotal(items);
  if (amount > 100) {
    return round2(amount * 0.9);
  }
  return round2(amount);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
