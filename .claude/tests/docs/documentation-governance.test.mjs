import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = file => readFileSync(resolve(root, file), "utf8");
const guides = [
  "README.md", "README.th.md", "AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md",
  ".claude/tests/README.md", "docs/reports/README.md"
];
const withoutFences = body => body.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");

test("first-run guides stay within their documented reading budgets", () => {
  const policy = read("CLAUDE.md");
  // Read the budgets from their canonical policy, rather than maintaining a
  // second configuration that can silently disagree with the instructions.
  const readmeLimit = Number(policy.match(/root README at \*\*(\d+) lines or fewer\*\*/)?.[1]);
  const quickstartLimit = Number(policy.match(/website quickstart\n\s*at \*\*(\d+) lines or fewer\*\*/)?.[1]);
  assert.ok(readmeLimit > 0 && quickstartLimit > 0, "reading budgets must be explicit");
  for (const [file, limit] of [
    ["README.md", readmeLimit], ["README.th.md", readmeLimit],
    ["website/docs/src/content/docs/quickstart.md", quickstartLimit],
    ["website/docs/src/content/docs/th/quickstart.md", quickstartLimit]
  ]) {
    const lines = read(file).split(/\r?\n/).filter(line =>
      line.trim() && !/^\s*<a id="[^"]+"><\/a>\s*$/.test(line));
    assert.ok(lines.length <= limit,
      `${file}: ${lines.length}/${limit} lines; move detail to its canonical reference`);
  }
});

test("every website documentation page has an English and Thai counterpart", () => {
  const base = resolve(root, "website/docs/src/content/docs");
  const files = readdirSync(base, { recursive: true })
    .filter(file => /\.mdx?$/.test(file)).map(file => file.replaceAll("\\", "/"));
  assert.ok(files.length > 0);
  const en = files.filter(file => !file.startsWith("th/")).sort();
  const th = files.filter(file => file.startsWith("th/")).map(file => file.slice(3)).sort();
  assert.deepEqual(th, en, "all pages, including pages outside the sidebar, need both locales");
});

function anchors(body) {
  const ids = new Set([...body.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const counts = new Map();
  for (const [, heading] of withoutFences(body).matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const slug = heading.trim().toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, "").replace(/\s/g, "-");
    const count = counts.get(slug) || 0;
    counts.set(slug, count + 1);
    ids.add(count ? `${slug}-${count}` : slug);
  }
  return ids;
}

test("entry-guide local links resolve after documentation moves", () => {
  for (const file of guides) {
    for (const [, href] of withoutFences(read(file)).matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) continue;
      const [path, fragment] = href.split("#");
      const target = path ? resolve(root, dirname(file), decodeURIComponent(path)) : resolve(root, file);
      assert.ok(existsSync(target), `${file}: missing target ${href}`);
      if (fragment && statSync(target).isFile() && /\.mdx?$/.test(target)) {
        assert.ok(anchors(readFileSync(target, "utf8")).has(decodeURIComponent(fragment)),
          `${file}: missing section ${href}`);
      }
    }
  }
});

test("agent and contributor entrypoints reach the canonical documentation policy", () => {
  for (const file of ["AGENTS.md", "CONTRIBUTING.md"]) {
    assert.ok(read(file).includes("CLAUDE.md#documentation-ownership"), file);
  }
});

test("all website pages declare a matching reader category in both languages", () => {
  const base = "website/docs/src/content/docs/";
  const files = readdirSync(resolve(root, base), { recursive: true })
    .filter(file => /\.mdx?$/.test(file)).map(file => file.replaceAll("\\", "/"));
  const allowed = new Set(["users", "project-maintainers", "agents-integrators"]);
  const audience = body => [...body.matchAll(/<!-- docs-audience: ([a-z-]+) -->/g)]
    .map(match => match[1]);
  for (const file of files) {
    const body = read(base + file);
    const roles = audience(body);
    assert.equal(roles.length, 1, `${file}: declare exactly one reader category`);
    assert.ok(allowed.has(roles[0]), `${file}: unknown audience ${roles[0]}`);
    assert.ok(body.includes(file.startsWith("th/") ? "**ผู้อ่าน:**" : "**Audience:**"),
      `${file}: the reader must see the classification`);
    if (!file.startsWith("th/")) {
      assert.deepEqual(audience(read(base + "th/" + file)), roles, `${file}: locale audience drift`);
    }
  }
});

test("the ownership reference covers the actual installer-managed surface", () => {
  const managedBlock = read("install.sh").match(/^MANAGED=\(\n([\s\S]*?)^\)/m)?.[1];
  assert.ok(managedBlock, "installer ownership must be inspectable");
  const managed = [...managedBlock.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const reference = read(".claude/harness/README.md");
  const row = reference.split("\n").find(line => line.startsWith("| Installed product |"));
  assert.ok(row, "ownership needs a distinct installed-product category");
  const documented = [...row.split("|")[2].matchAll(/`([^`]+)`/g)].map(match => match[1]);
  assert.deepEqual(documented.sort(), managed.sort(), "ownership table must match MANAGED exactly");
  const projectRow = reference.split("\n").find(line =>
    line.startsWith("| Project instructions and host settings |"));
  for (const file of ["CLAUDE.md", "AGENTS.md", ".claude/settings.json"]) {
    assert.ok(projectRow?.includes(`\`${file}\``), `${file}: must remain project-owned`);
    assert.equal(managed.includes(file), false, `${file}: must not be overwritten wholesale`);
  }
});

test("live artifact guides do not treat runtime storage as disposable or uniformly generated", () => {
  for (const file of [
    "website/docs/src/content/docs/artifacts.md",
    "website/docs/src/content/docs/th/artifacts.md",
    ".foundation/README.md"
  ]) {
    const body = read(file);
    assert.doesNotMatch(body, /safe to delete between changes|ลบทิ้งระหว่าง change ได้อย่างปลอดภัย/);
    assert.doesNotMatch(body, /Everything under `\.foundation\/` is generated/);
    for (const input of ["drafts/", "policy.json"]) assert.ok(body.includes(input), `${file}: ${input}`);
    assert.ok(body.includes("file-ownership-and-writers"), `${file}: canonical ownership link`);
  }
});
