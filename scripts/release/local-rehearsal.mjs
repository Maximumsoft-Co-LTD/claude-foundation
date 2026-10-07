#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const REQUIRED_ARCHIVE_PATHS = ["VERSION", "install.sh", "cli.sh", "foundation.json",
  ".claude/harness/foundation.mjs", ".claude/harness/commands.json",
  "Formula/claude-foundation.rb", "website/docs/package.json"];

function run(command, args, cwd = ROOT) {
  return spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

export function rehearsalStatus(checks) {
  const required = Object.values(checks).filter((row) => row.required !== false);
  return required.every((row) => row.status === "pass") ? "pass" : "fail";
}

export function unsafeEnvironmentPaths(paths) {
  return paths.filter((path) => {
    const name = basename(path);
    return (name === ".env" || name.startsWith(".env.")) && name !== ".env.example";
  });
}

export function cliHelpStatus(compact, full) {
  return compact.status === 0 && full.status === 0 &&
    compact.stdout.includes("change start") && compact.stdout.includes("advance <change>") &&
    full.stdout.includes("proof readiness") && full.stdout.includes("land check")
    ? "pass" : "fail";
}

export function runLocalRehearsal(outputDir = resolve(ROOT, ".foundation/test-results/release/local")) {
  mkdirSync(outputDir, { recursive: true });
  const temp = mkdtempSync(join(tmpdir(), "foundation-release-rehearsal-"));
  const version = readFileSync(join(ROOT, "VERSION"), "utf8").trim();
  const archive = join(outputDir, `claude-foundation-${version}-workspace.tar.gz`);
  const temporaryArchive = join(temp, basename(archive));
  const extract = join(temp, "source");
  const consumer = join(temp, "consumer");
  mkdirSync(extract); mkdirSync(consumer);
  const checks = {};
  try {
    const candidates = run("git", ["ls-files", "--cached", "--others",
      "--exclude-standard", "-z"]).stdout.split("\0").filter(Boolean);
    const paths = candidates.filter((path) => existsSync(join(ROOT, path)));
    const unsafeEnvironmentFiles = unsafeEnvironmentPaths(paths);
    if (unsafeEnvironmentFiles.length)
      throw new Error(`refusing environment file(s): ${unsafeEnvironmentFiles.join(", ")}`);
    const packed = spawnSync("tar", ["-czf", temporaryArchive, "-C", ROOT,
      "--null", "-T", "-"], {
      input: Buffer.from(`${paths.join("\0")}\0`), encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024
    });
    checks.archiveCreated = { status: packed.status === 0 ? "pass" : "fail", detail: packed.stderr };
    if (packed.status !== 0) throw new Error(`source archive failed: ${packed.stderr}`);
    copyFileSync(temporaryArchive, archive);
    const unpacked = run("tar", ["-xzf", temporaryArchive, "-C", extract]);
    checks.archiveExtracted = { status: unpacked.status === 0 ? "pass" : "fail", detail: unpacked.stderr };
    for (const path of REQUIRED_ARCHIVE_PATHS) checks[`archive:${path}`] = {
      status: existsSync(join(extract, path)) ? "pass" : "fail", detail: path
    };
    const installed = run("bash", [join(extract, "install.sh"), consumer,
      "--source", extract, "--yes"], extract);
    checks.consumerInstall = { status: installed.status === 0 ? "pass" : "fail", detail: installed.stderr };
    const cliVersion = run("bash", [join(extract, "cli.sh"), "--project", consumer, "version"], extract);
    checks.cliVersion = { status: cliVersion.status === 0 && cliVersion.stdout.includes(version)
      ? "pass" : "fail", detail: cliVersion.stdout || cliVersion.stderr };
    const help = run("bash", [join(extract, "cli.sh"), "help"], extract);
    const helpAll = run("bash", [join(extract, "cli.sh"), "help", "--all"], extract);
    checks.cliHelp = { status: cliHelpStatus(help, helpAll),
      detail: help.stderr || helpAll.stderr };
    const ruby = run("ruby", ["-c", join(extract, "Formula/claude-foundation.rb")], extract);
    checks.formulaSyntax = { status: ruby.status === 0 ? "pass" : "fail", detail: ruby.stdout || ruby.stderr };
    const brewAvailable = run("sh", ["-c", "command -v brew >/dev/null"]).status === 0;
    const style = brewAvailable ? run("brew", ["style", join(extract, "Formula/claude-foundation.rb")], extract) : null;
    checks.formulaStyle = brewAvailable
      ? { status: style.status === 0 ? "pass" : "fail", detail: style.stdout || style.stderr }
      : { status: "unavailable", required: false, detail: "brew unavailable on this host" };
    const archiveSha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
    const report = {
      version: 1, protocol: "foundation-local-release-rehearsal-v1",
      candidateVersion: version,
      artifact: { path: basename(archive), sha256: archiveSha256 }, checks,
      status: rehearsalStatus(checks)
    };
    const rendered = `${JSON.stringify(report, null, 2)}\n`;
    writeFileSync(join(outputDir, "report.json"), rendered);
    return report;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const outputIndex = process.argv.indexOf("--output-dir");
    const report = runLocalRehearsal(outputIndex >= 0 ? resolve(process.argv[outputIndex + 1]) : undefined);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.status !== "pass") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
