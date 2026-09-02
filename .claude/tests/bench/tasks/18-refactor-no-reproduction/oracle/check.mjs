import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(process.argv[2]);
const path = resolve(root, "classify.mjs");
const source = readFileSync(path, "utf8");
const api = await import(`${pathToFileURL(path)}?oracle=${Date.now()}`);
const results = {
  CASE_EXPORTS_PRESERVED: ["normalizeCustomerName", "normalizeSupplierName",
    "sameCustomer", "sameSupplier"].every((name) => typeof api[name] === "function")
    ? "pass" : "fail",
  CASE_WHITESPACE: api.normalizeCustomerName("  Ada   Lovelace ") === "ada lovelace"
    ? "pass" : "fail",
  CASE_NULL: api.normalizeSupplierName(null) === "" ? "pass" : "fail",
  CASE_COMPARISON: api.sameCustomer("GRACE  HOPPER", " grace hopper ") &&
    !api.sameSupplier("Ada", "Grace") ? "pass" : "fail",
  CASE_SHARED_ABSTRACTION: /function\s+normalizeText|const\s+normalizeText/.test(source)
    ? "pass" : "fail"
};
process.stdout.write(JSON.stringify({ results }));
