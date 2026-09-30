const { subtotalCents } = require("./cart");
const { taxCents } = require("./tax");

function checkout(cart) {
  const subtotal = subtotalCents(cart);
  const tax = taxCents(subtotal);
  return { subtotalCents: subtotal, taxCents: tax, totalCents: subtotal + tax };
}

module.exports = { checkout };
