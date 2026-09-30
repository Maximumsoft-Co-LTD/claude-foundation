const { getProduct } = require("./catalog");

function createCart() {
  return { lines: [] };
}

function assertQuantity(quantity) {
  if (!Number.isInteger(quantity) || quantity < 1)
    throw new RangeError("quantity must be a positive integer");
}

function addItem(cart, sku, quantity = 1) {
  assertQuantity(quantity);
  getProduct(sku);
  const line = cart.lines.find((candidate) => candidate.sku === sku);
  if (line) line.quantity += quantity;
  else cart.lines.push({ sku, quantity });
  return cart;
}

function setQuantity(cart, sku, quantity) {
  if (quantity === 0) return removeItem(cart, sku);
  assertQuantity(quantity);
  const line = cart.lines.find((candidate) => candidate.sku === sku);
  if (!line) throw new Error(`sku not in cart: ${sku}`);
  line.quantity = quantity;
  return cart;
}

function removeItem(cart, sku) {
  cart.lines = cart.lines.filter((line) => line.sku !== sku);
  return cart;
}

function subtotalCents(cart) {
  return cart.lines.reduce((sum, line) =>
    sum + getProduct(line.sku).priceCents * line.quantity, 0);
}

module.exports = { createCart, addItem, setQuantity, removeItem, subtotalCents };
