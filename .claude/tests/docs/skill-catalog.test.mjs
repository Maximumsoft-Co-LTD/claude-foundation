import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { auditCatalog } from "../../skills/skill-suite-auditor/scripts/audit.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const catalog = join(root, ".claude/skills");
const helper = join(catalog, "skill-suite-auditor/scripts/audit.mjs");

test("benchmark viewer distinguishes unavailable metrics from observed zero", () => {
  const html = readFileSync(join(catalog, "skill-creator/eval-viewer/viewer.html"), "utf8");
  const formatter = html.match(/function fmtStat\(stat, pct\) \{[\s\S]*?\n      \}/)[0];
  const fmt = runInNewContext(`(${formatter})`);
  assert.equal(fmt({ mean: null, stddev: null }, true), "—");
  assert.equal(fmt({ mean: 0, stddev: null }, false), "0.0 ± —");
  assert.equal(fmt({ mean: 0, stddev: 0 }, true), "0% ± 0%");
  const runFormatter = html.match(/function fmtRunRate\(result\) \{[\s\S]*?\n    \}/)[0];
  const fmtRun = runInNewContext(`(${runFormatter})`);
  assert.equal(fmtRun({ pass_rate: null, passed: null, total: null }), "—");
  assert.equal(fmtRun({ pass_rate: 0, passed: 0, total: 3 }), "0% (0/3)");
  assert.equal(fmtRun({ pass_rate: 0.5, passed: null, total: null }), "50% (—/—)");
});

test("audit rejects directory references and symlinks into unshipped state", t => {
  const directory = fixture(t);
  skill(directory, "example", "Read [directory](references) and [hidden](alias.md).");
  mkdirSync(join(directory, "example/references"));
  mkdirSync(join(directory, "example/.foundation"));
  writeFileSync(join(directory, "example/.foundation/hidden.md"), "Unshipped state.");
  symlinkSync(".foundation/hidden.md", join(directory, "example/alias.md"));
  assert.deepEqual(auditCatalog(directory).findings.map(f => f.code).sort(),
    ["non-file-reference", "unshipped-dependency"]);
});

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), "skill-catalog-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const skills = join(base, ".foundation/sandboxes/consumer/.claude/skills");
  mkdirSync(skills, { recursive: true });
  return skills;
}
function skill(directory, name, body = "", description = "Use for a focused task; preserve the current authority boundary.") {
  mkdirSync(join(directory, name), { recursive: true });
  writeFileSync(join(directory, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n\n${body}\n`);
}
function snapshot(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => entry.isDirectory() ? snapshot(join(directory, entry.name)) :
      [[join(directory, entry.name), readFileSync(join(directory, entry.name), "utf8")]]);
}

test("audit is read-only, resolves nested references, and does not reject sandbox ancestors", t => {
  const directory = fixture(t);
  skill(directory, "example", "Read [guide](references/guide.md).");
  mkdirSync(join(directory, "example/references"));
  writeFileSync(join(directory, "example/references/guide.md"), "Read [detail](detail.md).");
  writeFileSync(join(directory, "example/references/detail.md"), "A verified local guide.");
  const before = snapshot(directory);
  const result = auditCatalog(directory);
  assert.equal(result.status, "clean");
  assert.equal(result.behavioralEvaluation, "not-run");
  assert.deepEqual(result.coverage, ["metadata", "explicit-local-references"]);
  assert.deepEqual(snapshot(directory), before);
});

test("audit accepts folded description metadata", t => {
  const directory = fixture(t);
  skill(directory, "example");
  writeFileSync(join(directory, "example/SKILL.md"),
    "---\nname: example\ndescription: >-\n  Analyze a focused task.\n  Preserve authority boundaries.\n---\n");
  const result = auditCatalog(directory);
  assert.equal(result.status, "clean");
  assert.equal(result.skills[0].description, "Analyze a focused task. Preserve authority boundaries.");
});

test("cross-skill handoffs resolve references from the linked skill rather than the caller", t => {
  // Follow the handoff before checking the evaluator's own nested references.
  const directory = fixture(t);
  skill(directory, "author", "Read [evaluation](../evaluator/SKILL.md).");
  skill(directory, "evaluator", "Read [procedure](references/procedure.md).");
  mkdirSync(join(directory, "evaluator/references"));
  writeFileSync(join(directory, "evaluator/references/procedure.md"), "Read [detail](detail.md).");
  writeFileSync(join(directory, "evaluator/references/detail.md"), "Independent evaluation procedure.");
  assert.deepEqual(auditCatalog(directory).findings, []);
  rmSync(join(directory, "evaluator/references/detail.md"));
  assert.ok(auditCatalog(directory).findings.some(f => f.code === "missing-reference" &&
    f.path === "evaluator/references/procedure.md" && f.target === "detail.md"));
});

test("audit detects broken nested references rather than accepting the entry point", t => {
  const directory = fixture(t);
  skill(directory, "example", "Read [guide](references/guide.md).");
  mkdirSync(join(directory, "example/references"));
  writeFileSync(join(directory, "example/references/guide.md"), "Read [missing](absent.md).");
  assert.ok(auditCatalog(directory).findings.some(f => f.code === "missing-reference" && f.target === "absent.md"));
});

test("audit rejects duplicate names, absent metadata, empty descriptions, and unshipped dependencies", t => {
  const directory = fixture(t);
  skill(directory, "first", "Read [test](../../tests/private.md).");
  skill(directory, "second", "", "");
  const second = join(directory, "second/SKILL.md");
  writeFileSync(second, readFileSync(second, "utf8").replace("name: second", "name: first"));
  mkdirSync(join(directory, "third"));
  writeFileSync(join(directory, "third/SKILL.md"), "# Missing metadata");
  const codes = new Set(auditCatalog(directory).findings.map(f => f.code));
  for (const code of ["duplicate-name", "directory-name-mismatch", "invalid-description",
    "missing-frontmatter", "unshipped-dependency"]) assert.ok(codes.has(code), code);
});

test("audit CLI works outside the source checkout and fails honestly on unavailable input", t => {
  const directory = fixture(t);
  skill(directory, "example");
  const copied = join(directory, "example/audit.mjs");
  cpSync(helper, copied);
  const before = snapshot(directory);
  const good = spawnSync(process.execPath, [copied, directory], { cwd: tmpdir(), encoding: "utf8" });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).behavioralEvaluation, "not-run");
  assert.deepEqual(snapshot(directory), before);
  const unavailable = spawnSync(process.execPath, [copied, join(directory, "missing")], { encoding: "utf8" });
  assert.equal(unavailable.status, 2);
  assert.match(unavailable.stderr, /unavailable/);
  const missing = join(directory, "example/references/missing.md");
  writeFileSync(join(directory, "example/SKILL.md"),
    readFileSync(join(directory, "example/SKILL.md"), "utf8") + "\nRead [missing](references/missing.md).\n");
  const rejected = spawnSync(process.execPath, [copied, directory], { encoding: "utf8" });
  assert.equal(rejected.status, 1);
  assert.equal(JSON.parse(rejected.stdout).status, "findings");
  assert.ok(!snapshot(directory).some(([file]) => file === missing));
});

test("shipped catalog and proposed routing cases cover the same skills without claiming model runs", () => {
  const result = auditCatalog(catalog);
  assert.deepEqual(result.findings, []);
  const cases = JSON.parse(readFileSync(join(catalog, "skill-evaluation/references/evaluation-cases.json"), "utf8"));
  assert.equal(cases.execution, "not-run");
  const names = result.skills.map(skill => skill.name).sort();
  assert.deepEqual(cases.cases.map(row => row.expectedSkill).sort(), names);
  assert.equal(new Set(cases.cases.map(row => row.id)).size, names.length);
  for (const row of cases.cases) {
    assert.equal(row.status, "not-run");
    assert.ok(row.positive.length > 20 && row.negative.length > 20);
    assert.notEqual(row.positive, row.negative);
    assert.notEqual(row.expectedSkill, row.expectedNegativeSkill);
    assert.ok(names.includes(row.expectedNegativeSkill));
  }
  for (const { description } of result.skills) {
    assert.ok(description.split(/\s+/).length <= 80, "description should remain selection metadata");
    assert.doesNotMatch(description, /Must always apply|any prose surface|Use any MCP tool/i);
  }
  const map = readFileSync(join(catalog, "skill-suite-auditor/references/pstack-adoption.md"), "utf8");
  const sources = [...map.matchAll(/^\| `([a-z-]+)` \|/gm)].map(match => match[1]);
  assert.equal(sources.length, 58);
  assert.equal(new Set(sources).size, 58);
});

test("new skills preserve agreement, evidence, isolation, and authority owners", () => {
  const read = name => readFileSync(join(catalog, name, "SKILL.md"), "utf8");
  assert.match(read("change-impact-analysis"), /OpenSpec/);
  assert.match(read("change-impact-analysis"), /not receipts/);
  assert.match(read("performance-investigation"), /returned Build/);
  assert.match(read("performance-investigation"), /Never fabricate missing measurements/);
  assert.match(read("skill-evaluation"), /Static checks are not model evaluations/);
  assert.match(read("skill-evaluation"), /only its providers can establish proof/);
  assert.match(read("skill-suite-auditor"), /not another ledger/);
  assert.match(read("skill-suite-auditor"), /grant external authority/);
});

test("refactoring references preserve sandbox and Git boundaries through the full procedure", () => {
  const read = path => readFileSync(join(catalog, "refactoring-fundamentals", path), "utf8");
  const sources = ["SKILL.md", "references/refactoring-discipline.md",
    "references/characterization-tests.md", "references/catalog.md", "references/large-scale.md"];
  for (const path of sources) {
    const body = read(path);
    assert.doesNotMatch(body, /commit when green|committing per step|one commit each|commit them \*\*before\*\*|check it off|merge to trunk daily/i, path);
    assert.match(body, /harness/i, path);
  }
  const baseline = read("references/characterization-tests.md");
  assert.match(baseline, /Characterization records actual behavior/);
  assert.match(baseline, /not that existing behavior is correct/);
  assert.doesNotMatch(baseline, /Recorded in `tests\.md|retro appends|plan\.md > Current state/);
});

test("authoring references hand off experiments without forced fan-out or invented success", () => {
  const read = path => readFileSync(join(catalog, "skill-creator/references", path), "utf8");
  for (const path of ["authoring-overview.md", "creating-skills.md", "testing-and-evaluation.md",
    "improving-skills.md", "description-optimization.md", "environment-specifics.md"]) {
    const body = read(path);
    assert.match(body, /skill-evaluation/, path);
    assert.doesNotMatch(body, /Spawn all runs|Launch everything at once|as a sibling to the skill directory|Skip baseline runs|Empty feedback means|feedback is all empty|make the skill descriptions a little bit "pushy"/, path);
  }
  assert.match(read("testing-and-evaluation.md"), /Missing usage\/cost stays null/);
  assert.match(read("testing-and-evaluation.md"), /Empty or absent feedback is not approval/);
  assert.match(read("description-optimization.md"), /Do not select a winner using\s+held-out results/);
  assert.doesNotMatch(read("schemas.md"), /empty `feedback` means the user thought/);
});

test("planning, Prove, and Git references cannot override compiled agreement or Land gates", () => {
  const read = path => readFileSync(join(catalog, path), "utf8");
  assert.match(read("plan-writing/SKILL.md"), /Before Build use Change intake\/revision; after it starts use amendment/);
  assert.match(read("plan-writing/SKILL.md"), /harness marks\s+verified tasks/);
  assert.match(read("change-impact-analysis/SKILL.md"), /never hand-edit/);
  const prove = read("prove/references/workflow.md");
  assert.doesNotMatch(prove, /offer further investigation or Land with the remaining risks/);
  assert.match(prove, /Unresolved required findings remain blockers/);
  assert.match(prove, /After a waiver, resume advance/);
  const pr = read("git-workflow/references/pull-requests.md");
  assert.doesNotMatch(pr, /`\/dev` flow auto-generates|`\/dev` flow's commits|Open a PR as \*\*Draft\*\* the moment/);
  assert.match(pr, /Land and \/dev do not commit, push, open a PR/);
  assert.doesNotMatch(read("git-workflow/references/commit-messages.md"), /engineer agent's ship step|spec's `Type:` slot/);
  assert.match(read("debug-fundamentals/references/bisection.md"), /never the active target or\s+Build workspace/);
  const feature = read("feature/references/workflow.md");
  assert.doesNotMatch(feature, /Beyond one\s+closure review|missing permission becomes a DevOps handoff/);
  assert.match(feature, /configured harness policy owns reviewer selection/);
  assert.match(feature, /Product repair has no fixed retry count/);
  const report = read("harness-html-report/references/report.md");
  assert.doesNotMatch(report, /harness committed|per-file table from the round's commits/);
  assert.match(report, /Land preserves HEAD\/index and creates no commit/);
  assert.match(report, /does not grant\s+upload\/publication authority/);
});
