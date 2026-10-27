import { spawnSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync, writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildCrapReport } from "../../../../scripts/quality/calculate-crap.mjs";
import { collectComplexity } from "../../../../scripts/quality/collect-complexity.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function javascriptIncludes(workspace) {
  const ignored = new Set([
    ".claude", ".foundation", ".git", "node_modules", "openspec",
    "test", "tests", "__tests__"
  ]);
  const extensions = new Set();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && (ignored.has(entry.name) || entry.name.startsWith(".quality-")))
        continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (!/\.(?:test|spec)\.(?:js|mjs|cjs)$/.test(entry.name)) {
        const extension = entry.name.match(/\.(js|mjs|cjs)$/)?.[1];
        if (extension) extensions.add(extension);
      }
    }
  };
  visit(workspace);
  return [...extensions].sort().map((extension) => `**/*.${extension}`);
}

function nodeTestFiles(workspace) {
  const ignored = new Set([".claude", ".foundation", ".git", "node_modules", "openspec"]);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:test|spec)\.(?:js|mjs|cjs)$/.test(entry.name))
        files.push(relative(workspace, path));
    }
  };
  visit(workspace);
  return files.sort();
}

function pythonProductionFiles(workspace) {
  const ignored = new Set([
    ".claude", ".foundation", ".git", ".venv", "venv", "__pycache__", "tests", "test"
  ]);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".py") && !entry.name.startsWith("test_") &&
          !entry.name.endsWith("_test.py")) files.push(relative(workspace, path));
    }
  };
  visit(workspace);
  return files.sort();
}

export function benchmarkWorkspace(project, changeId) {
  const projectRoot = resolve(project);
  const sandbox = changeId && join(projectRoot, ".foundation/sandboxes", changeId);
  return sandbox && existsSync(sandbox) ? sandbox : projectRoot;
}

// Composite Build writes belong to the per-repository sandboxes. The shared
// root can still contain seed placeholders until Land. Evaluate a private
// assembled copy, never grade those placeholders or mutate a proven workspace.
export function benchmarkEvaluationWorkspace(project, changeId) {
  const root = realpathSync(resolve(project));
  const state = changeId ? readJson(join(root,'.foundation/runtime',`${changeId}.json`),{}) : {};
  if (state.status === 'archived') return {workspace:root,cleanup:()=>{}};
  const repositories = Object.entries(state.repositories || {}).filter(([id])=>id!=='root');
  const base = benchmarkWorkspace(root,changeId);
  if (!repositories.length) return {workspace:base,cleanup:()=>{}};
  const scratch=mkdtempSync(join(tmpdir(),'foundation-benchmark-evaluation-'));
  const workspace=join(scratch,'workspace');
  const excluded=new Set(['.git','.foundation','.claude','openspec','__pycache__']);
  const filter=path=>!excluded.has(path.split(/[\\/]/).at(-1));
  try {
    cpSync(base,workspace,{recursive:true,filter});
    for (const [id,repository] of repositories) {
      if (!repository.path || !repository.targetPath || !existsSync(repository.path))
        throw new Error(`benchmark repository workspace unavailable: ${id}`);
      const source=realpathSync(repository.path);
      const target=realpathSync(repository.targetPath);
      const location=relative(root,target);
      if (!location || isAbsolute(location) || location==='..' || location.startsWith(`..${process.platform==='win32'?'\\':'/'}`))
        throw new Error(`benchmark repository target is outside the product root: ${id}`);
      const destination=join(workspace,location);
      rmSync(destination,{recursive:true,force:true});
      cpSync(source,destination,{recursive:true,filter});
    }
    return {workspace,cleanup:()=>rmSync(scratch,{recursive:true,force:true})};
  } catch (error) {rmSync(scratch,{recursive:true,force:true});throw error;}
}

export async function collectBenchmarkQuality({ project, changeId }) {
  const evaluation=benchmarkEvaluationWorkspace(project,changeId);
  try {return await collectQualityInWorkspace({project,changeId,workspace:evaluation.workspace});}
  finally {evaluation.cleanup();}
}

async function collectQualityInWorkspace({ project, changeId, workspace }) {
  const projectRoot = realpathSync(resolve(project));
  const manifest = readJson(join(workspace, "package.json"));
  const includes = javascriptIncludes(workspace);
  const pythonFiles = pythonProductionFiles(workspace);
  const outputDir = join(projectRoot, ".foundation/test-results/quality");
  const coverageDir = join(outputDir, "benchmark-coverage");
  const coveragePath = join(coverageDir, "coverage-final.json");
  const policyPath = join(outputDir, "benchmark-policy.json");
  const reportPath = join(outputDir, "crap.json");
  const diagnosticPath = join(outputDir, "benchmark-collector.json");
  const discoveredTests = manifest?.scripts?.test ? [] : nodeTestFiles(workspace);
  if (!includes.length && pythonFiles.length) {
    const collector = join(HERE, "python-quality.py");
    const execution = spawnSync("python3", [collector, workspace], {
      cwd: workspace, encoding: "utf8", timeout: 120_000,
      env: { ...process.env, FOUNDATION_TELEMETRY: "0" },
      maxBuffer: 10 * 1024 * 1024
    });
    let report = null;
    try { report = JSON.parse(String(execution.stdout || "").trim()); } catch {}
    const valid = execution.status === 0 && report?.protocol === "foundation-quality-v1" &&
      report?.collector === "openspec-native-python-stdlib-quality-v1" &&
      Array.isArray(report?.functions) && report.functions.length > 0 &&
      report.functions.every((fn) => Number.isFinite(fn.coveragePercent) &&
        Number.isFinite(fn.crap));
    if (!valid) {
      writeJson(diagnosticPath, {
        status: "unavailable", reason: execution.error?.code === "ETIMEDOUT"
          ? "quality-test-timeout" : execution.error?.code === "ENOENT"
            ? "python3-not-installed" : "quality-test-failed",
        exitCode: execution.status, signal: execution.signal,
        stderr: String(execution.stderr || "").slice(-4000)
      });
      return null;
    }
    writeJson(reportPath, report);
    writeJson(diagnosticPath, { status: "measured", functions: report.summary.functions,
      report: reportPath, files: pythonFiles });
    return report;
  }
  if (!includes.length || (!manifest?.scripts?.test && !discoveredTests.length)) {
    writeJson(diagnosticPath, { status: "unavailable", reason: !includes.length
      ? "no-production-javascript" : "no-node-test-entrypoint" });
    return null;
  }
  const policy = {
    javascript: {
      include: includes,
      exclude: ["**/node_modules/**", "**/test/**", "**/tests/**",
        "**/*.test.js", "**/*.test.mjs", "**/*.test.cjs",
        "**/*.spec.js", "**/*.spec.mjs", "**/*.spec.cjs",
        ".foundation/**", ".claude/**", "openspec/**"]
    },
    complexity: { variant: "classic", warning: 11, refactor: 21,
      maximumChanged: 30 },
    coverage: { kind: "branch-with-function-fallback",
      changedCodeFloors: { unit: 80, integration: 70, criticalJourneys: 50 } },
    crap: { mode: "enforce", warning: 20, failure: 30,
      rejectRegression: true }
  };
  writeJson(policyPath, policy);
  mkdirSync(coverageDir, { recursive: true });
  const c8 = join(ROOT, "node_modules/.bin/c8");
  if (!existsSync(c8)) {
    writeJson(diagnosticPath, { status: "unavailable", reason: "c8-not-installed" });
    return null;
  }
  // An outer repository coverage run exports NODE_V8_COVERAGE. c8 otherwise
  // adopts that inherited directory and cleans it before this nested collector
  // starts, erasing coverage from every suite that already completed.
  const args = ["--all", "--reporter=json", `--report-dir=${coverageDir}`,
    `--temp-directory=${join(coverageDir, "tmp")}`];
  for (const pattern of includes) args.push(`--include=${pattern}`);
  for (const pattern of policy.javascript.exclude) args.push(`--exclude=${pattern}`);
  if (manifest?.scripts?.test) args.push("npm", "test", "--silent");
  // c8 treats an absolute Node executable as a child binary and can leave only
  // raw tmp coverage without running its final report hook. The PATH-resolved
  // `node` spelling preserves c8's normal Node command lifecycle.
  else args.push("node", "--test", ...discoveredTests);
  const execution = spawnSync(c8, args, {
    cwd: workspace, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, FOUNDATION_TELEMETRY: "0" },
    maxBuffer: 10 * 1024 * 1024
  });
  if (execution.status !== 0 || !existsSync(coveragePath)) {
    writeJson(diagnosticPath, {
      status: "unavailable", reason: execution.error?.code === "ETIMEDOUT"
        ? "quality-test-timeout" : "quality-test-failed",
      exitCode: execution.status, signal: execution.signal,
      stderr: String(execution.stderr || "").slice(-4000)
    });
    return null;
  }
  try {
    const complexity = await collectComplexity({ root: workspace, policyPath });
    const report = buildCrapReport({
      complexity,
      coverageReports: [readJson(coveragePath)],
      coverageLanes: [{ id: "benchmark-node", report: coveragePath,
        include: includes, changedCodeFloor: 80, required: true, active: true }],
      policy, root: workspace,
      metadata: { collector: "openspec-native-node-quality-v1", changeId,
        workspace: workspace === projectRoot ? "project" : "sandbox" }
    });
    writeJson(reportPath, report);
    writeJson(diagnosticPath, { status: "measured", functions: report.summary.functions,
      report: reportPath });
    return report;
  } catch (error) {
    writeJson(diagnosticPath, { status: "unavailable",
      reason: "quality-analysis-failed", message: error.message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Change packet metrics. A packet is measured from the files a run left; a run
// without a packet is `unavailable`, never a reassuring zero.

const OUTLINE_MODULE = ".claude/harness/runtime/workflow/validation/outline-contract.mjs";
const PACKET_DOCUMENTS = ["proposal", "design", "tasks"];
const SECTIONED_DOCUMENTS = ["proposal", "design"];

function readText(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

// Headings outside fenced code, with their level.
export function packetHeadings(markdown) {
  const headings = [];
  let fence = null;
  for (const line of String(markdown || "").split(/\r?\n/)) {
    const marker = line.match(/^\s*(```|~~~)/)?.[1];
    if (marker) { fence = fence === marker ? null : fence ?? marker; continue; }
    if (fence) continue;
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) headings.push({ level: match[1].length, text: match[2].trim() });
  }
  return headings;
}

function normalizeHeading(value) {
  return String(value || "").trim().replace(/^\d+(?:\.\d+)*[.)]?\s+/, "")
    .replace(/\s*:\s*$/, "").replace(/\s+/g, " ").toLowerCase();
}

// "# Change: Title" carries the header row; every other row is its own heading.
function headingMatches(found, expected) {
  const heading = normalizeHeading(found);
  const target = normalizeHeading(expected);
  return Boolean(target) && (heading === target || heading.startsWith(`${target}:`));
}

const WORDS = typeof Intl?.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

// Word-like segments, so Thai text without spaces is counted too.
export function wordCount(markdown) {
  if (typeof markdown !== "string") return null;
  if (!WORDS) return (markdown.match(/\S+/g) || []).length;
  let total = 0;
  for (const segment of WORDS.segment(markdown)) if (segment.isWordLike) total += 1;
  return total;
}

// Repeated level-2 sections in one document: extra occurrences are duplicates.
export function duplicateSections(markdown) {
  const counts = new Map();
  for (const heading of packetHeadings(markdown).filter((entry) => entry.level === 2)) {
    const key = normalizeHeading(heading.text);
    const current = counts.get(key) || { heading: heading.text, occurrences: 0 };
    current.occurrences += 1;
    counts.set(key, current);
  }
  return [...counts.values()].filter((entry) => entry.occurrences > 1);
}

// Rows the renderer omits when the draft supplies nothing and the draft
// validator never requires (change-lifecycle: "a row with nothing to say is
// omitted"). Counting them as missing flags every packet.
const CONTENT_DEPENDENT_ROWS = new Set(["summary", "successCriteria", "provenance", "overview"]);

// Required sections are the outline rows that hold for every draft: rows whose
// condition is true without any draft field. The packet's draft is not kept,
// so conditional rows cannot be judged and are left out.
export function requiredOutlineRows(outline, document) {
  if (typeof outline?.outlineSections !== "function") return [];
  try {
    return outline.outlineSections(document, {}, { archived: false })
      .filter((row) => row.archiveOnly !== true && !CONTENT_DEPENDENT_ROWS.has(row.key));
  } catch { return []; }
}

export function packetDocumentMetrics(documents = {}, { outline = null, outlineSource = null } = {}) {
  if (typeof documents.proposal !== "string") return {
    measurement: "unavailable", reason: "packet-unavailable", outlineSource: null,
    missingSections: null, duplicateSections: null,
    words: { proposal: null, design: null, tasks: null }
  };
  const missing = [];
  const duplicates = [];
  for (const document of SECTIONED_DOCUMENTS) {
    const markdown = documents[document];
    // A packet without the document (a rapid lane without design.md) has no
    // sections of it to check.
    if (typeof markdown !== "string") continue;
    const headings = packetHeadings(markdown);
    for (const row of requiredOutlineRows(outline, document)) {
      const found = headings.some((heading) => heading.level <= 2 &&
        (headingMatches(heading.text, row.heading?.en) || headingMatches(heading.text, row.heading?.th)));
      if (!found) missing.push({ document, key: row.key, heading: row.heading?.en ?? row.key });
    }
    for (const entry of duplicateSections(markdown)) duplicates.push({ document, ...entry });
  }
  const outlineKnown = typeof outline?.outlineSections === "function";
  return {
    measurement: outlineKnown ? "measured" : "partial",
    reason: outlineKnown ? null : "outline-unavailable",
    outlineSource: outlineKnown ? outlineSource : null,
    missingSections: outlineKnown ? { count: missing.length, sections: missing } : null,
    duplicateSections: {
      count: duplicates.reduce((total, entry) => total + entry.occurrences - 1, 0),
      sections: duplicates
    },
    words: Object.fromEntries(PACKET_DOCUMENTS.map((document) =>
      [document, wordCount(documents[document])]))
  };
}

// The archived packet is final; before Land the control-root packet, then the
// Build sandbox copy.
export function findChangePacket(project, changeId) {
  if (!project || !changeId) return null;
  const root = resolve(project);
  const state = readJson(join(root, ".foundation/runtime", `${changeId}.json`)) || {};
  const archiveRoot = join(root, "openspec/changes/archive");
  let dated = [];
  try {
    dated = readdirSync(archiveRoot).filter((name) => name === changeId ||
      name.endsWith(`-${changeId}`)).sort().reverse().map((name) => join(archiveRoot, name));
  } catch { /* no archive yet */ }
  const candidates = [
    state.archivedChangePath ? join(root, state.archivedChangePath) : null,
    ...dated,
    join(root, "openspec/changes", changeId),
    join(root, ".foundation/sandboxes", changeId, "openspec/changes", changeId)
  ].filter(Boolean);
  return candidates.find((path) => existsSync(join(path, "proposal.md"))) || null;
}

// The consumer's installed outline wins, so a packet is judged by the harness
// that wrote it; else the candidate's. Older harnesses have no outline.
export async function loadPacketOutline(project) {
  const sources = [
    ["consumer", project ? join(resolve(project), OUTLINE_MODULE) : null],
    ["candidate", join(ROOT, OUTLINE_MODULE)]
  ];
  for (const [source, path] of sources) {
    if (!path || !existsSync(path)) continue;
    try {
      const outline = await import(pathToFileURL(path).href);
      if (typeof outline.outlineSections === "function") return { outline, source };
    } catch { /* try the next source */ }
  }
  return { outline: null, source: null };
}

export async function collectPacketMetrics({ project, changeId, outline = undefined } = {}) {
  const packet = findChangePacket(project, changeId);
  if (!packet) return { ...packetDocumentMetrics({}), path: null };
  const loaded = outline === undefined ? await loadPacketOutline(project)
    : { outline, source: outline ? "provided" : null };
  const documents = Object.fromEntries(PACKET_DOCUMENTS.map((document) =>
    [document, readText(join(packet, `${document}.md`))]));
  return {
    ...packetDocumentMetrics(documents, { outline: loaded.outline, outlineSource: loaded.source }),
    path: relative(resolve(project), packet)
  };
}
