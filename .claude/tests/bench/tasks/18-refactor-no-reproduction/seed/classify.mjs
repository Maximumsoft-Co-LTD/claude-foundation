export function normalizeCustomerName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeSupplierName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function sameCustomer(left, right) {
  return normalizeCustomerName(left) === normalizeCustomerName(right);
}

export function sameSupplier(left, right) {
  return normalizeSupplierName(left) === normalizeSupplierName(right);
}
