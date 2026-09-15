import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const words = (value) => String(value || "").toLocaleLowerCase("und")
  .normalize("NFKC").match(/[\p{L}\p{N}]+/gu) || [];
const normalizedBlock = (value) => words(value).join(" ");
function markdownFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files.sort();
}

function anchor(value) {
  return String(value || "").trim().toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function headingAnchors(markdown) {
  const counts = new Map();
  const result = new Set();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = anchor(match[1].replace(/\s+#+\s*$/, ""));
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  return result;
}

function links(markdown) {
  const found = [];
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    const [path, fragment = ""] = raw.split("#", 2);
    if (!path.endsWith(".md")) continue;
    found.push({ path, fragment });
  }
  for (const match of markdown.matchAll(/`((?:references\/)?[A-Za-z0-9._/-]+\.md)(?:#([A-Za-z0-9._-]+))?`/g))
    found.push({ path: match[1], fragment: match[2] || "" });
  return found;
}

function paragraphs(markdown) {
  return markdown.split(/\n\s*\n/).map((block) => block.replace(/\s+/g, " ").trim())
    .filter((block) => !block.startsWith("```") && words(block).length >= 24);
}

function similarity(left, right) {
  const a = new Set(words(left));
  const b = new Set(words(right));
  const intersection = [...a].filter((word) => b.has(word)).length;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

export function auditReferenceGovernance(skillsRoot, {
  acyclicBundles = new Set(["change", "investigate"])
} = {}) {
  const root = resolve(skillsRoot);
  const issues = [];
  const skillFiles = markdownFiles(root).filter((path) => basename(path) === "SKILL.md");
  const allParagraphs = [];

  for (const skill of skillFiles) {
    const bundle = dirname(skill);
    const refs = markdownFiles(join(bundle, "references"));
    const requireAcyclic = acyclicBundles.has(basename(bundle));
    const files = [skill, ...refs];
    const known = new Set(files);
    const graph = new Map(files.map((file) => [file, []]));
    for (const file of files) {
      const markdown = readFileSync(file, "utf8");
      for (const link of links(markdown)) {
        const candidates = [resolve(dirname(file), link.path)];
        if (link.path.startsWith("references/")) candidates.unshift(resolve(bundle, link.path));
        else if (file === skill) candidates.push(resolve(bundle, "references", link.path));
        const target = candidates.find(existsSync) || candidates[0];
        // Template documents may contain illustrative links to artifacts that
        // do not exist yet. A references/ path, however, is an executable skill
        // route and must always resolve.
        if (!existsSync(target) && link.path.includes("references/")) {
          issues.push(`${relative(root, file)} has unresolved reference ${link.path}`);
          continue;
        }
        if (!existsSync(target)) continue;
        if (link.fragment && !headingAnchors(readFileSync(target, "utf8")).has(link.fragment))
          issues.push(`${relative(root, file)} has unresolved anchor ${link.path}#${link.fragment}`);
        if (known.has(target) && target !== file) graph.get(file).push(target);
      }
      for (const block of paragraphs(markdown))
        allParagraphs.push({ file, bundle, block, normalized: normalizedBlock(block) });
    }
    const reached = new Set();
    const active = new Set();
    const visit = (file) => {
      if (active.has(file)) {
        if (requireAcyclic)
          issues.push(`${relative(root, file)} participates in a reference cycle`);
        return;
      }
      if (reached.has(file)) return;
      reached.add(file);
      active.add(file);
      for (const target of graph.get(file) || []) visit(target);
      active.delete(file);
    };
    visit(skill);
    for (const orphan of refs.filter((file) => !reached.has(file)))
      issues.push(`${relative(root, orphan)} is not reachable from ${relative(root, skill)}`);
  }

  for (let left = 0; left < allParagraphs.length; left += 1) {
    for (let right = left + 1; right < allParagraphs.length; right += 1) {
      const a = allParagraphs[left];
      const b = allParagraphs[right];
      if (a.file === b.file) continue;
      if (a.normalized === b.normalized)
        issues.push(`${relative(root, a.file)} and ${relative(root, b.file)} duplicate a long block`);
      else if (words(a.block).length >= 40 && words(b.block).length >= 40 &&
          similarity(a.block, b.block) >= 0.92)
        issues.push(`${relative(root, a.file)} and ${relative(root, b.file)} near-duplicate a long block`);
    }
  }
  return [...new Set(issues)].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const issues = auditReferenceGovernance(process.argv[2]);
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
  }
}
