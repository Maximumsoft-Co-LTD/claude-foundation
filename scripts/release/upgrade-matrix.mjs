#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const POLICY = JSON.parse(readFileSync(join(ROOT, "scripts/release/supported-upgrades.json"), "utf8"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(
    `${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout;
}

function sourceIdentity() {
  const head = run("git", ["rev-parse", "HEAD"]).trim();
  const status = run("git", ["status", "--porcelain=v1"]);
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"])
    .trim().split(/\r?\n/).filter(Boolean).sort();
  const hash = createHash("sha256").update(run("git", ["diff", "--binary", "HEAD"]));
  for (const path of untracked) hash.update(`\0${path}\0`).update(readFileSync(join(ROOT, path)));
  return { head, dirty: status.length > 0, workspaceDigest: hash.digest("hex") };
}

export function semverTuple(tag) {
  const match = String(tag).match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

export function compareSemver(left, right) {
  const a = semverTuple(left); const b = semverTuple(right);
  if (!a || !b) throw new Error(`invalid semantic version: ${!a ? left : right}`);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function supportedTags(tags, minimum, current) {
  return tags.filter((tag) => semverTuple(tag) &&
    compareSemver(tag, minimum) >= 0 && compareSemver(tag, current) <= 0)
    .sort(compareSemver);
}

function installer(host) {
  return host === "claude-code" ? "install.sh" : `install-${host}.sh`;
}

function hostArtifact(host, target, codexHome) {
  return ({
    "claude-code": join(target, ".claude", "commands", "change.md"),
    cursor: join(target, ".cursor", "commands", "change.md"),
    opencode: join(target, ".opencode", "commands", "change.md"),
    codex: join(codexHome, "prompts", "change.md")
  })[host];
}

function install(source, host, target, codexHome) {
  const env = { ...process.env, CODEX_HOME: codexHome };
  run("bash", [join(source, installer(host)), target, "--source", source, "--yes"], { env });
}

function unpackTag(tag, destination) {
  const archive = spawnSync("git", ["-C", ROOT, "archive", tag], {
    encoding: null, maxBuffer: 256 * 1024 * 1024
  });
  if (archive.status !== 0) throw new Error(`cannot archive ${tag}: ${archive.stderr}`);
  const extracted = spawnSync("tar", ["-x", "-C", destination], { input: archive.stdout });
  if (extracted.status !== 0) throw new Error(`cannot extract ${tag}`);
}

function exercise({ tag, source, host, root, currentVersion }) {
  const slug = `${tag.slice(1).replaceAll(".", "-")}-${host}`;
  const target = join(root, slug, "project");
  const codexHome = join(root, slug, "codex-home");
  mkdirSync(target, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  install(source, host, target, codexHome);
  const changeId = `upgrade-${slug}`;
  run("bash", [join(source, "cli.sh"), "--project", target,
    "change", "new", changeId, "--rapid"]);
  const userFile = join(target, "USER-OWNED-UPGRADE.txt");
  writeFileSync(userFile, `preserve ${tag} ${host}\n`);
  install(ROOT, host, target, codexHome);
  const version = run("bash", [join(ROOT, "cli.sh"), "--project", target, "version"]).trim();
  const changes = run("bash", [join(ROOT, "cli.sh"), "--project", target, "changes"]);
  const checks = {
    freshInstall: existsSync(join(target, ".claude", "harness", "foundation.mjs")),
    activeChangeReadable: changes.includes(changeId),
    userOwnedFilePreserved: readFileSync(userFile, "utf8") === `preserve ${tag} ${host}\n`,
    currentRuntimeInstalled: version.includes(currentVersion),
    hostAdapterPresent: existsSync(hostArtifact(host, target, codexHome))
  };
  return { tag, host, status: Object.values(checks).every(Boolean) ? "pass" : "fail", checks };
}

export function runUpgradeMatrix({ tags: requestedTags = null } = {}) {
  const currentVersion = readFileSync(join(ROOT, "VERSION"), "utf8").trim();
  const allTags = run("git", ["tag", "--list", "v*.*.*"]).trim().split(/\r?\n/).filter(Boolean);
  const tags = requestedTags || supportedTags(allTags, POLICY.minimum, currentVersion);
  if (!tags.length) throw new Error("supported upgrade matrix selected no tags");
  const root = mkdtempSync(join(tmpdir(), "foundation-upgrade-matrix-"));
  const rows = [];
  try {
    for (const tag of tags) {
      const source = join(root, `source-${tag.slice(1)}`);
      mkdirSync(source, { recursive: true });
      unpackTag(tag, source);
      for (const host of POLICY.hosts)
        rows.push(exercise({ tag, source, host, root, currentVersion }));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const policyDigest = createHash("sha256").update(JSON.stringify(POLICY)).digest("hex");
  const report = {
    version: 1, protocol: "foundation-upgrade-matrix-report-v1", policyDigest,
    source: sourceIdentity(),
    currentVersion, minimum: POLICY.minimum, tags, hosts: POLICY.hosts,
    rows, status: rows.every((row) => row.status === "pass") ? "pass" : "fail"
  };
  return { ...report,
    reportDigest: createHash("sha256").update(JSON.stringify(report)).digest("hex") };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const tagIndex = process.argv.indexOf("--tag");
    const tags = tagIndex >= 0 ? [process.argv[tagIndex + 1]] : null;
    const report = runUpgradeMatrix({ tags });
    const rendered = `${JSON.stringify(report, null, 2)}\n`;
    const outputIndex = process.argv.indexOf("--output");
    if (outputIndex >= 0) {
      const output = resolve(process.argv[outputIndex + 1]);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, rendered);
    }
    process.stdout.write(rendered);
    if (report.status !== "pass") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
