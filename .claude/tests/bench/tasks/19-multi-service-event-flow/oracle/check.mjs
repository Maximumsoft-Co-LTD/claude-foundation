import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(process.argv[2]);
const producer = await import(`${pathToFileURL(resolve(root,
  "services/orders/order-event.mjs"))}?oracle=${Date.now()}`);
const consumer = await import(`${pathToFileURL(resolve(root,
  "services/billing/apply-event.mjs"))}?oracle=${Date.now()}`);
const event = producer.orderCharged({ eventId: "evt-1", id: "order-1", totalCents: 1299 });
let first = null;
let second = null;
try {
  first = consumer.applyOrderCharged({ processed: [], balances: {} }, event);
  second = consumer.applyOrderCharged(first, event);
} catch { /* recorded as failed compatibility below */ }
let rejectsOld = false;
try { consumer.applyOrderCharged({ processed: [], balances: {} }, { ...event, version: 1 }); }
catch { rejectsOld = true; }
const results = {
  CASE_CONTRACT_VERSION: event.version === 2 ? "pass" : "fail",
  CASE_INTEGER_AMOUNT: Number.isSafeInteger(event.totalCents) ? "pass" : "fail",
  CASE_CONSUMER_COMPATIBLE: first?.balances?.["order-1"] === 1299 ? "pass" : "fail",
  CASE_IDEMPOTENT: second?.processed?.length === 1 &&
    second?.balances?.["order-1"] === 1299 ? "pass" : "fail",
  CASE_OLD_VERSION_REJECTED: rejectsOld ? "pass" : "fail"
};
process.stdout.write(JSON.stringify({ results }));
