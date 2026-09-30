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
  // REFACTOR.md asks for one internal abstraction without naming it, so any
  // helper name passes: the normalization chain appears once and both exports
  // delegate to the same non-exported helper.
  CASE_SHARED_ABSTRACTION: sharedAbstraction(source) ? "pass" : "fail"
};

function sharedAbstraction(text) {
  const chains = text.match(/\.trim\(\)\s*\.replace\(/g) || [];
  if (chains.length !== 1) return false;
  const exported = new Set([...text.matchAll(
    /export\s+(?:async\s+)?(?:function\s+|const\s+|let\s+)([\w$]+)/g)].map((match) => match[1]));
  const helpers = [...text.matchAll(/(?:^|\n)\s*(?:function\s+([\w$]+)|const\s+([\w$]+)\s*=)/g)]
    .map((match) => match[1] || match[2]).filter((name) => name && !exported.has(name));
  // An export delegates through its function body or an alias (`= helper`).
  const body = (name) => text.match(new RegExp(
    `export\\s+function\\s+${name}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ||
    text.match(new RegExp(`export\\s+(?:const|let)\\s+${name}\\s*=\\s*([^;\\n]+)`))?.[1] || "";
  return helpers.some((helper) => ["normalizeCustomerName", "normalizeSupplierName"]
    .every((name) => new RegExp(`\\b${helper}\\b`).test(body(name))));
}

process.stdout.write(JSON.stringify({ results }));
