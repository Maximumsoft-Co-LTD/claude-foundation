// Product catalog. Prices are integer cents.
const PRODUCTS = Object.freeze([
  { sku: "TEE", name: "T-shirt", category: "apparel", priceCents: 1999 },
  { sku: "CAP", name: "Cap", category: "apparel", priceCents: 1250 },
  { sku: "SOCKS", name: "Socks", category: "apparel", priceCents: 599 },
  { sku: "MUG", name: "Mug", category: "home", priceCents: 1099 },
  { sku: "LAMP", name: "Desk lamp", category: "home", priceCents: 4550 },
  { sku: "PEN", name: "Pen", category: "office", priceCents: 199 }
].map((product) => Object.freeze(product)));

function getProduct(sku) {
  const product = PRODUCTS.find((candidate) => candidate.sku === sku);
  if (!product) throw new Error(`unknown sku: ${sku}`);
  return product;
}

module.exports = { PRODUCTS, getProduct };
