// Sales tax: 7% of an integer-cent amount, rounded half up to a whole cent.
const TAX_RATE_PERCENT = 7;

function taxCents(amountCents) {
  if (!Number.isInteger(amountCents) || amountCents < 0)
    throw new RangeError("amount must be a non-negative integer number of cents");
  return Math.floor((amountCents * TAX_RATE_PERCENT + 50) / 100);
}

module.exports = { TAX_RATE_PERCENT, taxCents };
