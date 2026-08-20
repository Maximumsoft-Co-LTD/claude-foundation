// Post-land acceptance check, run with cwd = sandbox root. Content-bound:
// imports the landed src/pricing.js and checks the agreed acceptance criteria,
// independent of whatever tests the run wrote for itself.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const { total } = await import(pathToFileURL(resolve(process.cwd(), "src/pricing.js")));

const checks = [
  [[{ price: 100, qty: 1 }], 90],
  [[{ price: 99.99, qty: 1 }], 99.99],
  [[{ price: 75, qty: 2 }], 135],
];

let failed = 0;
for (const [items, want] of checks) {
  const got = total(items);
  if (got === want) {
    console.log(`ok total(${JSON.stringify(items)}) = ${got}`);
  } else {
    console.error(`FAIL total(${JSON.stringify(items)}) = ${got}, want ${want}`);
    failed = 1;
  }
}
process.exit(failed);
