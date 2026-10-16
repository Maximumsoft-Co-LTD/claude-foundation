const assert = require("node:assert/strict");
const test = require("node:test");
const { invoicePath } = require("../src/invoice");

test("builds stable invoice paths", () => {
  assert.equal(invoicePath({ customer: "Café Müller GmbH", number: 42, title: "March Hosting" }),
    "invoices/cafe-muller-gmbh/000042-march_hosting.pdf");
  assert.equal(invoicePath({ customer: "ACME", number: 7, title: "" }), "invoices/acme/000007-invoice.pdf");
});

test("rejects invalid input", () => {
  assert.throws(() => invoicePath({ customer: "ACME", number: 0, title: "x" }), RangeError);
  assert.throws(() => invoicePath({ customer: "!!!", number: 1, title: "x" }), RangeError);
});
