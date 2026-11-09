// Hidden oracle for the prototype-bound Settings screen.
// Usage: node check.mjs <work-copy> <seed> [--forbid-beta]
// Renders the delivered screen through renderSettings() and checks its
// structure: heading, two labelled checkboxes whose checked state follows the
// settings, the Save button, the mount, and a passing grown test suite. With
// --forbid-beta it also requires that no BETA banner ships.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const work = resolve(process.argv[2]);
const seed = resolve(process.argv[3]);
const forbidBeta = process.argv.includes("--forbid-beta");
const results = {};

const plain = (html) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();
const isCheckbox = (tag) => /\btype\s*=\s*["']?checkbox\b/i.test(tag);
const isChecked = (tag) => /\schecked(?=[\s=/>])/i.test(tag);
const inputs = (html) => [...html.matchAll(/<input\b[^>]*>/gi)].map((match) => match[0]);
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")) || [])
  .slice(1).find((value) => value !== undefined);

// The checkbox whose visible label (wrapping <label>, <label for>, or
// aria-labelledby) or aria-label names `text`.
function labelledCheckbox(html, text) {
  const wanted = text.toLowerCase();
  for (const [, attrs, inner] of html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)) {
    if (!plain(inner).toLowerCase().includes(wanted)) continue;
    const wrapped = inputs(inner).find(isCheckbox);
    if (wrapped) return wrapped;
    const target = attr(`<x ${attrs}>`, "for");
    const linked = target && inputs(html).find((tag) => attr(tag, "id") === target);
    if (linked && isCheckbox(linked)) return linked;
  }
  for (const tag of inputs(html).filter(isCheckbox)) {
    if (String(attr(tag, "aria-label") || "").toLowerCase().includes(wanted)) return tag;
    const ids = String(attr(tag, "aria-labelledby") || "").split(/\s+/).filter(Boolean);
    for (const id of ids) {
      const element = html.match(new RegExp(`<(\\w+)\\b[^>]*\\bid\\s*=\\s*["']?${id}["']?[^>]*>([\\s\\S]*?)</\\1>`, "i"));
      if (element && plain(element[2]).toLowerCase().includes(wanted)) return tag;
    }
  }
  return null;
}

const check = (id, fn) => {
  try { results[id] = fn() ? "pass" : "fail"; } catch { results[id] = "fail"; }
};

let renderSettings = null;
let defaults = null;
try {
  const module = await import(`${pathToFileURL(join(work, "src/settings.js"))}?oracle=${Date.now()}`);
  renderSettings = module.renderSettings;
  defaults = module.DEFAULT_SETTINGS;
} catch { /* every rendered case fails below */ }
const render = (settings) => String(renderSettings(settings));

check("CASE_HEADING", () => /<h1\b[^>]*>\s*Settings\s*<\/h1>/i.test(render(defaults)));
check("CASE_EMAIL_TOGGLE", () => Boolean(labelledCheckbox(render(defaults), "Email notifications")));
check("CASE_DARK_MODE_TOGGLE", () => Boolean(labelledCheckbox(render(defaults), "Dark mode")));
check("CASE_SAVE_BUTTON", () => [...render(defaults).matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)]
  .some(([, inner]) => plain(inner) === "Save"));
check("CASE_STATE_REFLECTED", () => [[true, false], [false, true], [true, true], [false, false]]
  .every(([emailNotifications, darkMode]) => {
    const html = render({ emailNotifications, darkMode });
    const email = labelledCheckbox(html, "Email notifications");
    const dark = labelledCheckbox(html, "Dark mode");
    return email && dark && isChecked(email) === emailNotifications && isChecked(dark) === darkMode;
  }) && defaults?.emailNotifications === true && defaults?.darkMode === false &&
  isChecked(labelledCheckbox(render(defaults), "Email notifications")) &&
  !isChecked(labelledCheckbox(render(defaults), "Dark mode")));
check("CASE_PAGE_MOUNTS", () => {
  const index = readFileSync(join(work, "index.html"), "utf8");
  const main = readFileSync(join(work, "src/main.js"), "utf8");
  return /id\s*=\s*["']?app\b/.test(index) && /src\/main\.js/.test(index) &&
    /renderSettings\s*\(/.test(main) && existsSync(join(work, "scripts/screenshot.mjs"));
});
if (forbidBeta)
  check("CASE_NO_BETA_BANNER", () => {
    const shipped = [render(defaults), render({ emailNotifications: false, darkMode: true }),
      readFileSync(join(work, "index.html"), "utf8")];
    return shipped.every((html) => !/\bbeta\b/i.test(plain(html)) &&
      !/class\s*=\s*["'][^"']*\bbeta\b/i.test(html));
  });

function suite() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap"],
    { cwd: work, encoding: "utf8", timeout: 60000, env, maxBuffer: 10 * 1024 * 1024 });
  return { ok: run.status === 0, pass: Number((String(run.stdout).match(/^# pass (\d+)/m) || [])[1] || 0) };
}
const seedTests = readdirSync(join(seed, "test")).filter((name) => name.endsWith(".test.mjs")).length;
check("CASE_TESTS_PASS", () => {
  const delivered = suite();
  return delivered.ok && delivered.pass > seedTests;
});

const ids = Object.keys(results);
const score = ids.filter((id) => results[id] === "pass").length;
process.stdout.write(`${JSON.stringify({ results, score, max: ids.length,
  verdict: score === ids.length ? "pass" : "fail" })}\n`);
process.exit(0);
