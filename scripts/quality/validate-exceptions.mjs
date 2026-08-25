import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, isMain, parseArgs, readJson } from "./lib.mjs";

export function validateExceptions(document, { root = ROOT, now = new Date(), maximumDays = 90 } = {}) {
  const errors = [];
  const ids = new Set();
  for (const exception of document.exceptions || []) {
    const prefix = exception.id || "<missing-id>";
    if (!/^QEX-\d{4,}$/.test(prefix)) errors.push(`${prefix}: invalid id`);
    if (ids.has(prefix)) errors.push(`${prefix}: duplicate id`);
    ids.add(prefix);
    if (!exception.path || resolve(root, exception.path) === root || exception.path.startsWith("/")) {
      errors.push(`${prefix}: path must be a narrow repository-relative target`);
    } else if (!existsSync(resolve(root, exception.path))) {
      errors.push(`${prefix}: target path does not exist`);
    }
    const expires = new Date(`${exception.expires}T23:59:59.999Z`);
    if (Number.isNaN(expires.getTime())) errors.push(`${prefix}: invalid expiry`);
    else {
      if (expires < now) errors.push(`${prefix}: expired on ${exception.expires}`);
      const maximum = new Date(now);
      maximum.setUTCDate(maximum.getUTCDate() + maximumDays);
      if (expires > maximum) errors.push(`${prefix}: expiry exceeds ${maximumDays} days`);
    }
    for (const field of ["functionOrMutant", "reason", "risk", "owner", "approvedBy", "trackingIssue"]) {
      if (!exception[field]) errors.push(`${prefix}: missing ${field}`);
    }
    if (!Array.isArray(exception.compensatingEvidence) || !exception.compensatingEvidence.length) {
      errors.push(`${prefix}: compensatingEvidence must not be empty`);
    }
  }
  return errors;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const policy = readJson(resolve(ROOT, args.policy || "quality/policy.json"));
  const document = readJson(resolve(ROOT, args.input || "quality/exceptions.json"));
  const errors = validateExceptions(document, { maximumDays: policy.exceptionMaximumDays });
  if (errors.length) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`quality exceptions: ${(document.exceptions || []).length} valid\n`);
}

if (isMain(import.meta.url)) await main();
