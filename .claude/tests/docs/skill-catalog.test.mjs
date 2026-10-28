import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

test("UX skill adoption ships portable resources and retires the grid style skill", () => {
  assert.ok(existsSync(join(catalog, "ux-ui-principles/SKILL.md")));
  assert.equal(existsSync(join(catalog, "gridgeist")), false);
  const entry = readFileSync(join(catalog, "ux-ui-principles/SKILL.md"), "utf8");
  assert.ok(entry.split(/\s+/).length <= 700, "entry must fit the lazy skill budget");
  const upstream = readFileSync(join(catalog, "ux-ui-principles/references/upstream.md"), "utf8");
  assert.match(upstream, /c2a7b6dffe6ac795886f81ce936a9c536aadd5b3/);
  const layouts = JSON.parse(readFileSync(join(catalog,
    "ux-ui-principles/assets/layouts/opendesign-catalog.json"), "utf8"));
  assert.ok(layouts && typeof layouts === "object");
  for (const file of ["frontend-design/SKILL.md", "ui-ux-pro-max/SKILL.md"]) {
    const body = readFileSync(join(catalog, file), "utf8");
    assert.doesNotMatch(body, /gridgeist/);
    assert.match(body, /ux-ui-principles/);
  }
});

test("long skill references provide linked contents for selective reading", () => {
  const files = readdirSync(catalog, { recursive: true }).filter(file =>
    file.endsWith(".md") && file.split(/[\\/]/).includes("references"));
  for (const file of files) {
    const body = readFileSync(join(catalog, file), "utf8");
    if (body.split(/\r?\n/).length <= 300) continue;
    const contents = body.match(/^## (?:Contents|Table of contents)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m);
    assert.ok(contents, `${file}: references over 300 lines need contents`);
    assert.match(contents[1], /^- \[[^\]]+\]\(#[^)]+\)/m,
      `${file}: contents must link to local headings`);
    const anchors = new Set([...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, heading]) =>
      heading.trim().toLocaleLowerCase("und").replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .replace(/\s+/g, "-")));
    for (const [, anchor] of contents[1].matchAll(/\]\(#([^)]+)\)/g))
      assert.ok(anchors.has(anchor), `${file}: unresolved contents anchor #${anchor}`);
  }
});

test("hexagonal references preserve selective routing and current heading links", () => {
  for (const file of ["go.md", "typescript.md", "patterns-and-pitfalls.md"]) {
    const body = readFileSync(join(catalog, "hexagonal-backend/references", file), "utf8");
    assert.doesNotMatch(body, /Always-on|When NOT to apply strictly|SKILL\.md >/, file);
  }
  const guidance = readFileSync(join(catalog,
    "hexagonal-backend/references/patterns-and-pitfalls.md"), "utf8");
  assert.match(guidance, /dependency direction or use-case ownership/);
  assert.match(guidance, /simpler vertical slice for trivial CRUD/);
});

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
  for (const { name, description } of result.skills) {
    const words = description.split(/\s+/).length;
    assert.ok(words <= 80, `${name}: description is ${words} words; it must stay selection metadata (≤ 80)`);
    assert.doesNotMatch(description, /Must always apply|any prose surface|Use any MCP tool/i, name);
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

// Procedures adapted from pstack (cursor/plugins@e5136d8). Each is pinned in its
// single owner reference so a later edit cannot silently drop it.
const ref = (path) => readFileSync(join(catalog, path), "utf8");
// The text a heading opens, up to the next heading of the same level.
function section(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing section ${heading}`);
  const level = heading.match(/^#+/)[0];
  const rest = text.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n${level} `));
  return heading + (next === -1 ? rest : rest.slice(0, next));
}

test("performance references bound a hillclimb and explain every number", () => {
  const hillclimb = ref("performance-investigation/references/hillclimb.md");
  assert.match(hillclimb, /## Stop predicate/);
  assert.match(hillclimb, /paired with a minimum attempt count, or a confirmed plateau/);
  assert.match(hillclimb, /## Freeze the harness/);
  assert.match(hillclimb, /## Order hypotheses by cost/);
  assert.match(hillclimb, /## Pivot on a plateau/);
  assert.match(hillclimb, /as raw-run evidence outside managed\s+skills/);
  assert.match(hillclimb, /not version-control history and not lifecycle\s+state; the harness owns task status/);
  assert.match(readFileSync(join(catalog, "performance-investigation/SKILL.md"), "utf8"),
    /Keep raw runs as evidence, not a status ledger\./);
  assert.match(hillclimb, /## Prove the final claim/);
  assert.match(hillclimb, /Paid or production workloads require\s+explicit authority/);
  const measurement = ref("performance-investigation/references/measurement.md");
  assert.match(measurement, /Write the claim sentence before measuring/);
  assert.match(measurement, /Ask "why not double\?" of every result/);
  assert.match(measurement, /The verdict is inconclusive when\s+the run count, spread, or limiter is missing/);
  assert.match(measurement, /\[hillclimb\]\(hillclimb\.md\)/);
  assert.match(measurement, /Raw files remain outside managed skills/);
});

test("debugging stops after repeated failed fixes and keeps fixes in scope", () => {
  const rootCause = ref("debug-fundamentals/references/root-cause.md");
  assert.match(rootCause, /After two failed fixes on the same gate, stop editing\./);
  assert.match(rootCause, /Write a falsifying experiment/);
  assert.match(rootCause, /\*\*Guard legitimacy\.\*\*/);
  assert.match(rootCause, /\[cleanup\]\(\.\.\/\.\.\/coding-discipline\/references\/cleanup\.md\)/);
  assert.match(rootCause, /report instances outside it as follow-up/);
  assert.match(rootCause, /Do not bundle cleanup\./);
  assert.match(rootCause, /suspect persisted state first/);
  assert.match(ref("debug-fundamentals/references/reproduction.md"), /\[root cause\]\(root-cause\.md\)/);
  assert.match(ref("debug-fundamentals/references/bisection.md"), /never the active target or\s+Build workspace/);
});

test("tests are judged by a behavior break and an internal change", () => {
  const design = ref("testing-fundamentals/references/test-design.md");
  assert.match(design, /## Judge a test by two edits/);
  assert.match(design, /\*\*Break the behavior\*\*/);
  assert.match(design, /\*\*Change the internals while keeping behavior\*\*/);
  assert.match(design, /\*\*Expected value computed by the code under test\*\*/);
  assert.match(design, /\*\*Restated constant\*\*/);
  assert.match(design, /For idempotent behavior, do the effect twice/);
});

test("impact claims say where proof stopped and operations answer rerun questions", () => {
  const ladder = ref("change-impact-analysis/references/proof-ladder.md");
  assert.match(ladder, /load-bearing safety fact/);
  assert.match(ladder, /Say where it stopped/);
  assert.match(ladder, /Never call a risk\s+cleared from a lower level than the risk requires/);
  assert.match(ladder, /only through a harness provider/);
  const skill = readFileSync(join(catalog, "change-impact-analysis/SKILL.md"), "utf8");
  assert.match(skill, /references\/proof-ladder\.md/);
  assert.match(skill, /never hand-edit/);
  const principle = section(ref("concurrency-fundamentals/references/shared-state-and-async.md"),
    "## Principle 5");
  assert.match(principle,
    /What if it runs twice\? What if the previous run crashed halfway\? What if two runs overlap\?/);
  assert.match(principle, /Write to a temp file, then rename\./);
  assert.match(principle, /Judge staleness by evidence valid at every crash point\./);
  assert.match(ref("queue-fundamentals/references/idempotency.md"), /answer the three rerun questions/);
});

test("recurring corrections become the strongest check and repeated work builds a lever", () => {
  const details = ref("coding-discipline/references/details.md");
  assert.match(details, /## Encode a recurring correction/);
  assert.match(details, /A lint whose message names the fix/);
  assert.match(details, /A new check must fail on a real past occurrence\./);
  assert.match(details, /Adopt it through an ordinary `\/change`/);
  assert.match(details, /## Build the lever/);
  assert.match(details, /Do the first unit by hand/);
  const module = ref("programming-fundamentals/references/module-design.md");
  assert.match(module, /one more branch/);
  assert.match(module, /A second boolean must stay in sync with another/);
  assert.match(module, /under 30 seconds/);
});

test("prose deliverables share one writing reference that protects parser text", () => {
  const writing = ref("init-project-docs/references/writing.md");
  assert.match(writing, /Choose the document mode first/);
  assert.match(writing, /Do not mix modes\./);
  assert.match(writing, /## Remove AI-sounding patterns/);
  assert.match(writing, /## Protected text/);
  assert.match(writing, /`Requirement:` and `Scenario:`/);
  assert.match(writing, /The document language the user chose\./);
  assert.match(writing, /Writing a message grants no\s+authority to create it\./);
  assert.match(ref("init-project-docs/references/documentation-workflow.md"), /`writing\.md`/);
  for (const path of ["git-workflow/references/commit-messages.md",
    "git-workflow/references/pull-requests.md", "harness-html-report/references/report.md",
    "claude-md/references/guide-workflow.md"])
    assert.match(ref(path), /\[writing\]\(\.\.\/\.\.\/init-project-docs\/references\/writing\.md\)/, path);
});

test("pstack adoption records both reviewed sources without growing the disposition table", () => {
  const adoption = ref("skill-suite-auditor/references/pstack-adoption.md");
  assert.match(adoption, /5062f28d9d0cedaed2622a9be82961a7d1df051a/);
  assert.match(adoption, /e5136d82418d2db3165ea1050d17577cd618cc05/);
  assert.match(adoption, /Not adopted from e5136d8: never-block-on-the-human,/);
  assert.match(adoption, /"Fix every instance" is\s+limited to the change's scope/);
});

// The adopted procedures must not reintroduce authority or orchestration that
// Change Loop reserves for the user or the harness.
test("adopted pstack guidance never grants Git, dispatch, or approval authority", () => {
  const forbidden = /\bspawn|fan[- ]out|\bmerge\b|without asking|without approval|\bpush\b|open a PR|commit per|one commit each|separate commit|per-attempt commit|create a worktree|delete the old API/i;
  const adopted = [
    ref("performance-investigation/references/hillclimb.md"),
    ref("debug-fundamentals/references/root-cause.md"),
    ref("change-impact-analysis/references/proof-ladder.md"),
    ref("init-project-docs/references/writing.md"),
    section(ref("performance-investigation/references/measurement.md"), "## Explain the number"),
    section(ref("testing-fundamentals/references/test-design.md"), "## Judge a test by two edits"),
    section(ref("concurrency-fundamentals/references/shared-state-and-async.md"), "## Principle 5"),
    section(ref("coding-discipline/references/details.md"), "## Encode a recurring correction"),
    section(ref("coding-discipline/references/details.md"), "## Build the lever"),
    section(ref("programming-fundamentals/references/module-design.md"),
      "## Skip signals: the domain model is missing")
  ];
  for (const text of adopted) {
    const hit = text.match(forbidden);
    assert.equal(hit, null, `forbidden instruction "${hit?.[0]}" in: ${text.split("\n")[0]}`);
  }
  // The new hillclimb log is raw evidence, never a commit trail or a ledger.
  assert.doesNotMatch(adopted[0], /\bcommit/i);
  assert.doesNotMatch(adopted[0], /\bledger\b|status log|progress tracker/i);
});

// The 2026-10 catalog simplification rewrote every non-lifecycle skill. These
// guards cover the whole catalog, not only the bundles earlier changes pinned.
const LIFECYCLE_SKILLS = new Set(["change", "build", "prove", "land", "investigate", "dev", "feature", "changes"]);
const skillMarkdown = () => readdirSync(catalog, { recursive: true })
  .filter(file => file.endsWith(".md") && !file.split(/[\\/]/).includes("assets"))
  .map(file => [file, readFileSync(join(catalog, file), "utf8")]);

test("no skill or reference reintroduces per-step commit or unapproved-action instructions", () => {
  const forbidden = /commit when green|committing per step|one commit each|commit them \*\*before\*\*|check it off|merge to trunk daily|proceed without approval|Open a PR as \*\*Draft\*\*/i;
  // "open a PR" is an instruction unless the sentence refuses or scopes it
  // ("Land and /dev do not commit, push, open a PR"). git-workflow is the one
  // skill whose job is the authorized PR operation itself.
  const prInstruction = /\bopen(?:s|ing)? a (?:pull request|PR)\b/i;
  const negated = /\b(?:not|never|no|without|cannot|grants? no|only (?:via|with|when))\b/i;
  for (const [file, body] of skillMarkdown()) {
    const hit = body.match(forbidden);
    assert.equal(hit, null, `${file}: forbidden instruction "${hit?.[0]}"`);
    if (file.split(/[\\/]/)[0] === "git-workflow") continue;
    for (const sentence of body.split(/(?<=[.!?])\s+|\n\s*\n/)) {
      const pr = sentence.match(prInstruction);
      if (pr && !negated.test(sentence))
        assert.fail(`${file}: forbidden instruction "${pr[0]}" in: ${sentence.trim().slice(0, 80)}`);
    }
  }
});

test("simplified skill bodies keep one shape and stay short", () => {
  for (const [file, body] of skillMarkdown()) {
    const parts = file.split(/[\\/]/);
    if (parts.length !== 2 || parts[1] !== "SKILL.md" || LIFECYCLE_SKILLS.has(parts[0])) continue;
    const skill = parts[0];
    const content = body.replace(/^---[\s\S]*?\n---\n/, "");
    const words = content.split(/\s+/).filter(Boolean).length;
    assert.ok(words <= 250, `${skill}: body is ${words} words; limit 250`);
    for (const heading of ["## Steps", "## Harness", "## References"])
      assert.ok(content.includes(`\n${heading}\n`), `${skill}: missing ${heading}`);
    const harness = content.split("\n## Harness\n")[1].split("\n## ")[0].trim().split("\n");
    assert.ok(harness.length <= 3, `${skill}: Harness section is ${harness.length} lines; limit 3`);
    const description = body.match(/^description: "(.*)"$/m)?.[1] || "";
    const descriptionWords = description.split(/\s+/).filter(Boolean).length;
    assert.ok(descriptionWords <= 40, `${skill}: description is ${descriptionWords} words; limit 40`);
    assert.match(description, /^(Use |Alias for )/, `${skill}: description must open with its trigger`);
    assert.match(description, /Skip |skip |use [a-z-]+ for|\([a-z-]+\)|only when/, `${skill}: description must say when not to use it`);
  }
});

test("reference files link only to siblings and cross-bundle files that exist", () => {
  // Markdown links are routes and must resolve; a bare backtick name such as
  // `tasks.md` or `OVERVIEW.md` is an artifact mention, so only explicit
  // `../` or `references/` backtick paths are checked. Document-template
  // bundles link to files the reader will create, not to the catalog.
  const illustrative = new Set(["init-project-docs", "ui-ux-pro-max", "harness-html-report", "claude-md", "grill-task-gu"]);
  for (const [file, body] of skillMarkdown()) {
    const parts = file.split(/[\\/]/);
    if (!parts.includes("references") || LIFECYCLE_SKILLS.has(parts[0]) || illustrative.has(parts[0])) continue;
    const links = [
      ...[...body.matchAll(/\[[^\]]*\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)].map(match => match[1]),
      ...[...body.matchAll(/`((?:\.\.\/|references\/)[A-Za-z0-9._/-]+\.md)`/g)].map(match => match[1])
    ];
    for (const link of new Set(links)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue;
      const target = resolve(dirname(join(catalog, file)), link);
      assert.ok(existsSync(target), `${file}: link ${link} does not resolve`);
    }
  }
});
