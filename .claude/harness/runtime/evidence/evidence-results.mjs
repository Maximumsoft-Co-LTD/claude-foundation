export function parseJsonOutput(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return null; }
}

export function parseTapOutput(value) {
  const text = String(value || "");
  if (!/^(TAP version|\s*(?:ok|not ok)\b)/m.test(text)) return null;
  const testsFooter = [...text.matchAll(/^# tests\s+(\d+)\s*$/gm)].at(-1);
  const passFooter = [...text.matchAll(/^# pass\s+(\d+)\s*$/gm)].at(-1);
  const failFooter = [...text.matchAll(/^# fail\s+(\d+)\s*$/gm)].at(-1);
  const plan = [...text.matchAll(/^\s*1\.\.(\d+)\s*$/gm)].at(-1);
  const totalTests = Number(testsFooter?.[1] ?? plan?.[1]);
  if (!Number.isInteger(totalTests) || totalTests < 0) return null;
  return {
    totalTests,
    passed: passFooter ? Number(passFooter[1]) : null,
    failed: failFooter ? Number(failFooter[1]) : null,
    format: "tap"
  };
}

export function mutationProtocolResult(value) {
  const text = String(value || "");
  const line = text.match(
    /(?:^|\n)FOUNDATION_MUTATION_RESULT=(behavioral-kill|test-failure|survived|crash|timeout|not-applied)(?:\n|$)/
  );
  if (line) return line[1];
  const parsed = parseJsonOutput(text);
  const result = parsed?.foundationMutationResult || parsed?.mutationResult;
  return [
    "behavioral-kill", "test-failure", "survived", "crash", "timeout", "not-applied"
  ].includes(result) ? result : null;
}

export function numericReportValue(report, keys) {
  if (!report || typeof report !== "object") return null;
  for (const container of [report, report.summary, report.stats].filter((value) =>
    value && typeof value === "object" && !Array.isArray(value)))
    for (const key of keys) {
      const value = container[key];
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
    }
  return null;
}

export function playwrightReportSummary(report) {
  const claims = new Set();
  const attachments = new Set();
  let tests = 0;
  let failed = 0;
  let skipped = 0;
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.annotations))
      for (const annotation of value.annotations)
        if (annotation?.type === "claim" && annotation.description)
          claims.add(String(annotation.description));
    if (Array.isArray(value.attachments))
      for (const attachment of value.attachments)
        if (attachment?.path) attachments.add(String(attachment.path));
    if (Array.isArray(value.results)) {
      tests += 1;
      const statuses = value.results.map((result) => result?.status).filter(Boolean);
      if (statuses.some((status) => ["failed", "timedOut", "interrupted"].includes(status))) failed += 1;
      else if (statuses.length && statuses.every((status) => status === "skipped")) skipped += 1;
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  }
  visit(report);
  return {
    claims: [...claims].sort(), attachments: [...attachments].sort(),
    tests, failed, skipped
  };
}

export function configuredCommand(provider, config) {
  const [command, ...originalArgs] = config.command;
  const args = [...originalArgs];
  const directPlaywright = config.adapter === "playwright" &&
    ([command, ...args].some((part) =>
      part === "playwright" || part.endsWith("/playwright") || part === "@playwright/test"));
  if (directPlaywright) {
    if (config.project && !args.some((arg) => arg === "--project" || arg.startsWith("--project=")))
      args.push(`--project=${config.project}`);
    if (!args.some((arg) => arg === "--reporter" || arg.startsWith("--reporter=")))
      args.push("--reporter=json");
  }
  return { command, args, display: [command, ...args].join(" ") };
}

export function adapterResources(provider, config, providerCapability) {
  if (Array.isArray(config.resources)) return [...new Set(config.resources)].sort();
  if (config.adapter === "playwright") return ["browser", "dev-server", "workspace-read"];
  if (providerCapability(provider, config) === "mutation") return ["workspace-write"];
  return ["workspace-read"];
}

export function resourcesConflict(left, right) {
  const a = new Set(left);
  const b = new Set(right);
  if (a.has("workspace-write") && [...b].some((item) => item.startsWith("workspace-"))) return true;
  if (b.has("workspace-write") && [...a].some((item) => item.startsWith("workspace-"))) return true;
  return [...a].some((item) => item !== "workspace-read" && b.has(item));
}
