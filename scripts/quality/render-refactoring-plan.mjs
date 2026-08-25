import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ROOT, isMain, parseArgs, readJson, repoPath, writeJson } from "./lib.mjs";

const SURFACES = ["runtime", "dashboard", "examples", "website"];
const MUTATION_REPORTS = [
  ["dashboard", "mutation-automated.json"],
  ["runtime", "mutation-runtime.json"],
  ["examples", "mutation-examples.json"],
  ["website", "mutation-website.json"]
];

function surfaceFor(path) {
  if (path.startsWith("dashboard/")) return "dashboard";
  if (path.startsWith("examples/")) return "examples";
  if (path.startsWith("website/")) return "website";
  return "runtime";
}

function ownerFor(surface) {
  return surface === "runtime" ? "runtime-maintainers" : `${surface}-maintainers`;
}

function classify(fn) {
  if (fn.status === "unmapped") return {
    priority: "P1", wave: "W1", action: "coverage-mapping",
    strategy: "Repair function-to-coverage mapping, then reclassify before refactoring."
  };
  if (fn.status === "fail" && (fn.crap >= 1000 || fn.cyclomatic > 50)) return {
    priority: "P0", wave: "W1", action: "critical-refactor",
    strategy: "Characterize critical branches, extract pure decisions, then reduce orchestration complexity."
  };
  if (fn.status === "fail" && (fn.crap >= 100 || fn.cyclomatic > 30)) return {
    priority: "P1", wave: "W2", action: "high-risk-refactor",
    strategy: "Add boundary and negative tests, then split validation, decisions and side effects."
  };
  if (fn.status === "fail") return {
    priority: "P2", wave: "W3", action: "refactor",
    strategy: "Raise decision coverage and simplify until the function returns below the fail threshold."
  };
  if (fn.status === "warn") return {
    priority: "P3", wave: "W4", action: "test-and-simplify",
    strategy: "Cover weak decisions and simplify when touched; prevent promotion into CRAP failure."
  };
  if (fn.coveragePercent < Number(fn.changedCodeFloor ?? 70)) return {
    priority: "P4", wave: "W5", action: "test-hardening-when-touched",
    strategy: "Preserve structure; add happy, boundary and negative coverage before the next behavior change."
  };
  return {
    priority: "P5", wave: "continuous", action: "preserve",
    strategy: "No planned refactor; preserve coverage and prevent CRAP or mutation regression."
  };
}

function mutationGapsByFunction(functions, mutationReports) {
  const byPath = new Map();
  for (const { report } of mutationReports) {
    for (const [path, file] of Object.entries(report.files || {})) {
      const gaps = (file.mutants || []).filter((mutant) =>
        ["Survived", "NoCoverage"].includes(mutant.status));
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push(...gaps);
    }
  }
  return functions.map((fn) => {
    const gaps = (byPath.get(fn.path) || []).filter((mutant) => {
      const line = mutant.location?.start?.line;
      return Number.isInteger(line) && line >= fn.line && line <= (fn.endLine || fn.line);
    });
    return {
      survived: gaps.filter((mutant) => mutant.status === "Survived").length,
      noCoverage: gaps.filter((mutant) => mutant.status === "NoCoverage").length
    };
  });
}

function sortRows(left, right) {
  const priority = Number(left.priority.slice(1)) - Number(right.priority.slice(1));
  if (priority) return priority;
  if (right.crap !== left.crap) return right.crap - left.crap;
  return left.path.localeCompare(right.path) || left.line - right.line;
}

function countBy(rows, key) {
  return Object.fromEntries([...new Set(rows.map((row) => row[key]))]
    .sort().map((value) => [value, rows.filter((row) => row[key] === value).length]));
}

export function buildRefactoringPlan({ crap, mutationReports = [] }) {
  const identities = new Set();
  for (const fn of crap.functions) {
    const identity = `${fn.path}:${fn.line}:${fn.column}:${fn.name}`;
    if (identities.has(identity)) throw new Error(`duplicate function identity: ${identity}`);
    identities.add(identity);
  }
  const mutationGaps = mutationGapsByFunction(crap.functions, mutationReports);
  const rows = crap.functions.map((fn, index) => {
    const surface = surfaceFor(fn.path);
    const classification = classify(fn);
    return {
      path: fn.path, line: fn.line, endLine: fn.endLine, column: fn.column,
      function: fn.name, surface, owner: ownerFor(surface),
      cyclomatic: fn.cyclomatic, coveragePercent: fn.coveragePercent,
      coverageStatus: fn.coverageStatus, crap: fn.crap, status: fn.status,
      changedCodeFloor: fn.changedCodeFloor ?? 70,
      mutationGaps: mutationGaps[index], ...classification,
      acceptance: classification.action === "preserve"
        ? "Keep CRAP <20, retain coverage floor, and introduce no mutation regression."
        : classification.action === "coverage-mapping"
          ? "Produce an unambiguous coverage mapping and assign a measured follow-up action."
          : "Changed branch coverage >=80%; extracted functions CC <=30 and CRAP <30; no mutation regression."
    };
  }).sort(sortRows).map((row, index) => ({
    id: `RF-${String(index + 1).padStart(4, "0")}`, ...row
  }));
  const bySurface = Object.fromEntries(SURFACES.map((surface) => {
    const selected = rows.filter((row) => row.surface === surface);
    return [surface, {
      total: selected.length,
      statuses: countBy(selected, "status"),
      actions: countBy(selected, "action"),
      waves: countBy(selected, "wave")
    }];
  }));
  return {
    protocol: "foundation-refactoring-plan-v1",
    sourceCommit: crap.repositoryCommit,
    sourceGeneratedAt: crap.generatedAt,
    coverageKind: crap.coverageKind,
    scope: {
      includedPaths: crap.includedPaths,
      excludedPaths: crap.excludedPaths,
      note: "Every measured production function is assigned exactly one action. Tests, generated and vendored code remain excluded by policy."
    },
    summary: {
      functions: rows.length,
      statuses: countBy(rows, "status"),
      priorities: countBy(rows, "priority"),
      actions: countBy(rows, "action"),
      waves: countBy(rows, "wave"),
      surfaces: bySurface
    },
    functions: rows
  };
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderIndex(plan) {
  const lines = [
    "# All-functions refactoring plan", "",
    "> Generated from the versioned CRAP inventory; do not edit function rows by hand.", "",
    `- Production functions planned: ${plan.summary.functions}`,
    `- Source commit: \`${plan.sourceCommit}\``,
    `- Coverage model: ${plan.coverageKind}`, "",
    "Every measured production function has exactly one action. Test, generated and vendored functions are excluded by project quality policy.", "",
    "## Execution waves", "",
    "| Wave | Meaning | Functions |", "|---|---|---:|",
    `| W1 | Critical refactors and coverage-mapping gaps | ${(plan.summary.waves.W1 || 0)} |`,
    `| W2 | High-risk refactors | ${(plan.summary.waves.W2 || 0)} |`,
    `| W3 | Remaining CRAP failures | ${(plan.summary.waves.W3 || 0)} |`,
    `| W4 | Warning functions: test and simplify when touched | ${(plan.summary.waves.W4 || 0)} |`,
    `| W5 | Passing but below changed-code coverage floor | ${(plan.summary.waves.W5 || 0)} |`,
    `| Continuous | Healthy functions to preserve | ${(plan.summary.waves.continuous || 0)} |`, "",
    "## Surface plans", "", "| Surface | Functions | Fail | Warn | Unmapped | Plan |", "|---|---:|---:|---:|---:|---|"
  ];
  for (const surface of SURFACES) {
    const item = plan.summary.surfaces[surface];
    lines.push(`| ${surface} | ${item.total} | ${item.statuses.fail || 0} | ${item.statuses.warn || 0} | ${item.statuses.unmapped || 0} | [Open](./${surface}.md) |`);
  }
  lines.push("", "## Delivery rule", "",
    "Work in small test-hardening and structural-refactor batches. A function may move to a later wave after new coverage changes its measured risk, but it may not disappear from the manifest without being deleted from production.", "",
    "For every changed function: branch coverage must be at least 80%, extracted functions must have CC <=30 and CRAP <30, mutation score must not regress, no new Survived/NoCoverage mutant is allowed, and all required semantic mutants must remain killed.", "",
    "The machine-readable source of this plan is [`quality/refactoring-plan-v1.json`](../../../quality/refactoring-plan-v1.json).", "");
  return lines.join("\n");
}

export function renderSurface(plan, surface) {
  const rows = plan.functions.filter((row) => row.surface === surface);
  const lines = [
    `# ${surface[0].toUpperCase()}${surface.slice(1)} function refactoring plan`, "",
    `[Back to plan index](./index.md)`, "",
    `This file assigns an explicit action to all ${rows.length} measured ${surface} production functions.`, "",
    "| ID | Function | State | CC | Coverage | CRAP | Mutation gaps S/NC | Priority / wave | Action | Acceptance |",
    "|---|---|---|---:|---:|---:|---:|---|---|---|"
  ];
  for (const row of rows) lines.push(
    `| ${row.id} | \`${escapeCell(`${row.path}:${row.line} ${row.function}`)}\` | ${row.status} | ${row.cyclomatic} | ${row.coveragePercent ?? "unmapped"}% | ${row.crap} | ${row.mutationGaps.survived}/${row.mutationGaps.noCoverage} | ${row.priority} / ${row.wave} | ${row.action} | ${escapeCell(row.acceptance)} |`
  );
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const directory = resolve(ROOT, args.directory || ".foundation/test-results/quality");
  const crapPath = resolve(ROOT, args.input || `${repoPath(directory)}/crap.json`);
  const outputDirectory = resolve(ROOT, args.output || "docs/reports/refactoring-plan");
  const manifestPath = resolve(ROOT, args.manifest || "quality/refactoring-plan-v1.json");
  const mutationReports = MUTATION_REPORTS.map(([surface, name]) => ({
    surface, path: resolve(directory, name)
  })).filter(({ path }) => existsSync(path)).map(({ surface, path }) => ({
    surface, report: readJson(path)
  }));
  const plan = buildRefactoringPlan({ crap: readJson(crapPath), mutationReports });
  writeJson(manifestPath, plan);
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(resolve(outputDirectory, "index.md"), renderIndex(plan));
  for (const surface of SURFACES)
    writeFileSync(resolve(outputDirectory, `${surface}.md`), renderSurface(plan, surface));
  process.stdout.write(`refactoring plan: ${plan.summary.functions} functions -> ${repoPath(outputDirectory)}\n`);
}

if (isMain(import.meta.url)) await main();
