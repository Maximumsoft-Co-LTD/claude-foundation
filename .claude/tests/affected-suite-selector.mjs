import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const ALWAYS = [
  "runtime syntax",
  "run-all process control",
  "affected test selection",
  "composition-root wiring",
  "architecture boundaries",
  "single-source tables"
];

const EVIDENCE = [
  "harness contracts (evidence recovery)",
  "harness contracts (evidence telemetry)",
  "harness contracts (evidence execution)",
  "harness contracts (evidence lifecycle)",
  "harness contracts (evidence review)",
  "harness contracts (evidence binding)",
  "harness contracts (evidence CI)",
  "harness contracts (evidence browser)",
  "harness contracts (evidence cache)",
  "harness contracts (evidence waiver)",
  "harness contracts (evidence service)",
  "proof loop end to end",
  "bounded review repair closure"
];
const REVIEW = [
  "feedback review",
  "risk-tiered review contract",
  "configured reviewer adapters",
  "review guard reconciliation",
  "bounded review repair closure"
];
const LAND = [
  "harness contracts (sandbox land)",
  "target drift",
  "land surface",
  "spec sync land gate",
  "model drift land gate"
];

const RULES = [
  [/^dashboard\//, ["dashboard contracts"]],
  [/^\.claude\/tests\/docs\//, ["workflow documentation contracts"]],
  [/^\.claude\/tests\/interview\//, ["human interaction contracts"]],
  [/^\.claude\/hooks\//, ["current hook contracts", "phase mutation guard"]],
  [/configured-reviewer|codex-reviewer|review-protocol|review-attempt-store/,
    REVIEW],
  [/handoff-runtime|handoff-policy/, ["external operation handoff", ...LAND]],
  [/authority-runtime|proof-advance|review-repair-closure/,
    [...REVIEW, "proof loop end to end"]],
  [/packet-runtime|packet-scaling/, [
    "packet scaling", "bounded review repair closure",
    "harness contracts (evidence review)"
  ]],
  [/repository-snapshot|state-runtime|workspace-surface/, [
    ...EVIDENCE, ...LAND, "land surface mutation", "target drift mutation",
    "evidence binding mutation", "workspace surface"
  ]],
  [/runtime\/evidence\/(?!configured-reviewer|codex-reviewer|review-protocol|review-attempt-store)/, [
    ...EVIDENCE, ...REVIEW, "land surface", "evidence binding mutation"
  ]],
  [/runtime\/workflow\/(?:land|apply|sandbox)/, [
    ...LAND, "change loop seams", "land surface mutation",
    "target drift mutation"
  ]],
  [/runtime\/workflow\/(?:change|security)|change-policy|change-validation/, [
    "harness contracts (change policy)", "change loop seams",
    "user guidance contracts", "harness contracts (evidence lifecycle)"
  ]],
  [/runtime\/observability\//, [
    "telemetry concurrency", "telemetry truth", "archive telemetry"
  ]],
  [/runtime\/composition\//, [
    "composition-root wiring", "harness reliability gaps", "change loop seams"
  ]],
  [/run-feedback-review-tests/, ["feedback review"]],
  [/run-land-surface-tests/, ["land surface"]],
  [/run-target-drift-tests/, ["target drift"]],
  [/run-reliability-gap-tests/, ["harness reliability gaps"]],
  [/run-changeloop-seam-tests/, ["change loop seams"]],
  [/configured-reviewer\.test/, ["configured reviewer adapters"]],
  [/handoff-policy\.test/, ["external operation handoff"]],
  [/proof-advance\.test/, ["bounded review repair closure"]],
  [/contracts\/evidence-proof|run-harness-tests/, EVIDENCE],
  [/run-all\.sh|affected-suite-selector/, [
    "run-all process control", "affected test selection"
  ]]
];

const CROSS_CUTTING = /^(?:\.claude\/harness\/(?:foundation\.mjs|protocol\.json)|\.claude\/harness\/runtime\/(?:version\.mjs|core\/cli-router\.mjs|core\/workspace-policy\.mjs)|\.claude\/tests\/lib\/)/;

function addKnown(target, labels, known) {
  for (const label of labels) if (known.has(label)) target.add(label);
}

export function selectAffectedSuites(files, suiteLabels) {
  const known = new Set(suiteLabels);
  const selected = new Set();
  const reasons = new Map();
  addKnown(selected, ALWAYS, known);
  for (const label of selected) reasons.set(label, ["always-on safety contract"]);

  for (const file of [...new Set(files)].sort()) {
    if (CROSS_CUTTING.test(file)) {
      for (const label of known) {
        selected.add(label);
        const rows = reasons.get(label) || [];
        rows.push(`${file} is cross-cutting`);
        reasons.set(label, rows);
      }
      continue;
    }
    let matched = false;
    for (const [pattern, labels] of RULES) {
      if (!pattern.test(file)) continue;
      matched = true;
      for (const label of labels) {
        if (!known.has(label)) continue;
        selected.add(label);
        const rows = reasons.get(label) || [];
        rows.push(file);
        reasons.set(label, rows);
      }
    }
    // A changed suite must always select itself even before a domain rule is
    // added. Match its runner basename against the label-normalized command
    // metadata supplied by run-all.
    if (!matched && file.startsWith(".claude/tests/")) {
      const stem = file.split("/").at(-1)
        .replace(/^run-/, "").replace(/-tests?(?:\.mjs|\.sh)$/, "")
        .replaceAll("-", " ");
      for (const label of known) if (label.includes(stem)) {
        selected.add(label);
        reasons.set(label, [...(reasons.get(label) || []), file]);
      }
    }
  }
  return { selected: [...selected], reasons };
}

function gitLines(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" })
      .split("\n").map((row) => row.trim()).filter(Boolean);
  } catch { return []; }
}

export function changedFiles(root, base = null) {
  const tracked = base
    ? gitLines(root, ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`])
    : [];
  return [...new Set([
    ...tracked,
    ...gitLines(root, ["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]),
    ...gitLines(root, ["ls-files", "--others", "--exclude-standard"])
  ])];
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const root = process.argv[2];
  const labels = String(process.env.FOUNDATION_SUITE_LABELS || "")
    .split("\n").filter(Boolean);
  const files = process.env.FOUNDATION_CHANGED_FILES
    ? process.env.FOUNDATION_CHANGED_FILES.split("\n").filter(Boolean)
    : changedFiles(root, process.env.FOUNDATION_TEST_BASE || null);
  const result = selectAffectedSuites(files, labels);
  if (!files.length) console.error("affected tests: no changed files");
  else console.error(`affected tests: ${files.length} changed file(s) selected ${result.selected.length}/${labels.length} suite(s)`);
  for (const label of result.selected) console.log(label);
}
