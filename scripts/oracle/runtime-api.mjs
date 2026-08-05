import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const RUNTIME_BASELINES = Object.freeze({
  "12": {
    revision: "9a54190cafddec6546a63acbc606a86480da8b74"
  },
  "13": {
    revision: "2e76097623e1ffdf145685dbcd59a127434cda33"
  }
});

export const API_12_REVISION = RUNTIME_BASELINES["12"].revision;
export const API_13_REVISION = RUNTIME_BASELINES["13"].revision;

export const RUNTIME_API_CASES = Object.freeze([
  { name: "api-version", args: ["api-version"] },
  { name: "package-version", args: ["version"] },
  { name: "model-policy", args: ["models"] },
  { name: "provider-contracts", args: ["providers"] },
  { name: "active-changes", args: ["changes"] },
  { name: "public-help", args: ["help"] },
  {
    name: "repository-topology",
    args: ["repos"],
    setup: {
      directories: ["service"],
      files: {
        "openspec/repositories.yaml": "{\"version\":1,\"repositories\":[{\"id\":\"service\",\"type\":\"git\",\"path\":\"service\",\"dependsOn\":[\"root\"]}]}\n"
      }
    }
  },
  {
    name: "active-change-state",
    args: ["changes"],
    setup: changeSetup(),
    inspectPaths: [".foundation/snapshots/demo.json"]
  },
  {
    name: "workspace-hash",
    args: ["hash", "demo"],
    setup: changeSetup(),
    inspectPaths: [".foundation/snapshots/demo.json"]
  }
]);

function changeSetup() {
  return {
    directories: ["openspec/changes/demo"],
    files: {
      ".foundation/runtime/demo.json": "{\"id\":\"demo\",\"schema\":\"foundation-change/v4\",\"status\":\"building\",\"revision\":3,\"contractRevision\":3,\"workspace\":{\"mode\":\"root\"}}\n",
      "openspec/changes/demo/tasks.md": "# Tasks\n\n- [ ] deterministic parity\n",
      "source.txt": "stable fixture content\n"
    }
  };
}

export function repositoryRoot(start = process.cwd()) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: start,
    encoding: "utf8"
  }).trim();
}

export function materializeRevision(root, revision) {
  const directory = mkdtempSync(join(tmpdir(), "changeloop-oracle-"));
  try {
    const archive = execFileSync("git", ["archive", "--format=tar", revision], {
      cwd: root,
      maxBuffer: 128 * 1024 * 1024
    });
    execFileSync("tar", ["-xf", "-", "-C", directory], { input: archive });
    return directory;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function runCase({ bin, prefix = [], cwd, testCase }) {
  applySetup(cwd, testCase.setup);
  const result = spawnSync(bin, [...prefix, ...testCase.args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, FOUNDATION_TELEMETRY: "0" }
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: normalizeOutput(result.stdout, cwd),
    stderr: normalizeOutput(result.stderr, cwd),
    ...(testCase.inspectPaths?.length
      ? { filesystem: inspectFilesystem(cwd, testCase.inspectPaths) }
      : {})
  };
}

export function normalizeOutput(value, cwd = null) {
  let normalized = String(value ?? "").replaceAll("\r\n", "\n");
  if (cwd) {
    const resolved = resolve(cwd);
    const canonical = existsSync(resolved) ? realpathSync(resolved) : resolved;
    normalized = normalized.replaceAll(canonical, "<cwd>").replaceAll(resolved, "<cwd>");
  }
  return normalized
    .replace(/snapshot-[0-9a-f]{20}/g, "<snapshot>")
    .replace(/\b[0-9a-f]{64}\b/g, "<sha256>");
}

function applySetup(cwd, setup) {
  if (!setup) return;
  for (const directory of setup.directories || [])
    mkdirSync(resolve(cwd, directory), { recursive: true });
  for (const [path, content] of Object.entries(setup.files || {})) {
    const target = resolve(cwd, path);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, content.replaceAll("${CWD}", resolve(cwd)));
  }
}

function inspectFilesystem(cwd, paths) {
  const result = {};
  for (const relativePath of paths) {
    const path = resolve(cwd, relativePath);
    if (!existsSync(path)) {
      result[relativePath] = { type: "missing" };
      continue;
    }
    const stat = lstatSync(path);
    if (stat.isDirectory()) {
      result[relativePath] = {
        type: "directory",
        entries: readdirSync(path).sort()
      };
    } else if (relativePath.endsWith(".json")) {
      result[relativePath] = {
        type: "json",
        value: normalizeJson(JSON.parse(readFileSync(path, "utf8")), cwd)
      };
    } else {
      result[relativePath] = {
        type: "file",
        content: normalizeOutput(readFileSync(path, "utf8"), cwd)
      };
    }
  }
  return result;
}

function normalizeJson(value, cwd, key = null) {
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item, cwd));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right)).map(([childKey, child]) =>
      [childKey, normalizeJson(child, cwd, childKey)]));
  if (["createdAt", "updatedAt"].includes(key)) return "<timestamp>";
  if (key === "fileCount") return "<count>";
  if (typeof value === "string") return normalizeOutput(value, cwd);
  return value;
}

export function readOracle(path) {
  const oracle = JSON.parse(readFileSync(resolve(path), "utf8"));
  const baseline = RUNTIME_BASELINES[oracle.runtimeApi];
  if (oracle.schemaVersion !== 2 || !baseline ||
      oracle.sourceRevision !== baseline.revision ||
      oracle.entrypoint !== ".claude/harness/foundation.mjs" ||
      !Array.isArray(oracle.cases) || oracle.cases.length !== RUNTIME_API_CASES.length) {
    throw new Error("invalid runtime API oracle or provenance");
  }
  for (let index = 0; index < RUNTIME_API_CASES.length; index += 1) {
    const expected = RUNTIME_API_CASES[index];
    const captured = oracle.cases[index];
    if (captured?.name !== expected.name ||
        JSON.stringify(captured?.args) !== JSON.stringify(expected.args) ||
        JSON.stringify(captured?.setup || null) !== JSON.stringify(expected.setup || null) ||
        JSON.stringify(captured?.inspectPaths || null) !== JSON.stringify(expected.inspectPaths || null) ||
        !Number.isInteger(captured?.result?.status) ||
        typeof captured?.result?.stdout !== "string" ||
        typeof captured?.result?.stderr !== "string") {
      throw new Error(`invalid runtime API oracle case at index ${index}`);
    }
  }
  return oracle;
}
