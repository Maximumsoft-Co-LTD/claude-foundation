"use strict";

const { slugify } = require("slugkit");

function invoicePath({ customer, number, title }) {
  if (!Number.isInteger(number) || number <= 0) throw new RangeError("number must be a positive integer");
  const customerSlug = slugify(customer);
  if (!customerSlug) throw new RangeError("customer must contain letters or digits");
  const titleSlug = slugify(title || "invoice", { separator: "_" }) || "invoice";
  return `invoices/${customerSlug}/${String(number).padStart(6, "0")}-${titleSlug}.pdf`;
}

module.exports = { invoicePath };
