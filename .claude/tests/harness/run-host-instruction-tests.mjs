import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import {
  HOST_COMMANDS, HostInstructionError, hostInstructionResponse, resolveHostInstruction
} from "../../harness/runtime/core/host-instruction.mjs";
import {
  HostAgentContractError, resolveHostAgentContract
} from "../../harness/runtime/core/host-agent-contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const CLI = join(ROOT, "cli.sh");
const reportPath = process.env.FOUNDATION_HOST_INSTRUCTION_REPORT || null;
const criticalCases = new Map([
  ["all-eight", "missing"], ["opaque-arguments", "missing"],
  ["unknown-command", "missing"], ["outside-project", "missing"],
  ["packaged-layout", "missing"], ["existing-host-instruction", "missing"],
  ["agent-contract-source", "missing"],
  ["agent-contract-failure", "missing"], ["agent-contract-packaged", "missing"]
]);
let resolvedCommands = 0;

test("synchronous host instruction response preserves success and stable errors", () => {
  const success = hostInstructionResponse([
    "build", "--arguments", "direct response"
  ], { packageRoot: ROOT });
  assert.equal(success.status, 0);
  assert.equal(success.body.command, "build");
  assert.match(success.body.instruction, /direct response/);

  const known = hostInstructionResponse(["unknown"], { packageRoot: ROOT });
  assert.equal(known.status, 1);
  assert.equal(known.body.error.code, "unknown_host_command");
  assert.match(known.body.error.message, /Unknown Foundation host command/);

  const unexpected = {};
  Object.defineProperty(unexpected, "packageRoot", {
    get() { throw new Error("internal path failure"); }
  });
  const fallback = hostInstructionResponse(["build"], unexpected);
  assert.equal(fallback.status, 1);
  assert.deepEqual(fallback.body.error, {
    code: "instruction_unavailable",
    message: "The installed Foundation instruction is unavailable."
  });
});

after(() => {
  if (!reportPath) return;
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify({
    numTotalTests: 22,
    criticalCases: [...criticalCases].map(([id, status]) => ({ id, status }))
  })}\n`);
});

function invoke(args, cwd = ROOT, cli = CLI) {
  const result = spawnSync("bash", [cli, "host", "instruction", ...args], {
    cwd, encoding: "utf8"
  });
  return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

function invokeAgentContract(args = [], cwd = ROOT, cli = CLI) {
  const result = spawnSync("bash", [cli, "host", "agent-contract", ...args], {
    cwd, encoding: "utf8"
  });
  return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

for (const command of HOST_COMMANDS) {
  test(`all-eight: ${command} resolves from the installed release`, () => {
    const argumentsValue = command === "changes" ? "" : "sample input";
    const result = invoke([command, "--protocol", "1", "--format", "json",
      "--arguments", argumentsValue]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.protocol, 1);
    assert.equal(result.json.command, command);
    assert.equal(typeof result.json.description, "string");
    assert.equal(typeof result.json.instruction, "string");
    assert.equal(result.json.foundationVersion.length > 0, true);
    assert.equal(result.json.instruction.includes("$ARGUMENTS"), false);
    resolvedCommands += 1;
    if (resolvedCommands === HOST_COMMANDS.length) {
      criticalCases.set("all-eight", "passed");
      criticalCases.set("existing-host-instruction", "passed");
    }
  });
}

test("opaque-arguments: metacharacters are rendered literally and never evaluated", () => {
  const fixture = mkdtempSync(join(tmpdir(), "foundation-host-opaque-"));
  try {
    const probe = join(fixture, "must-not-exist");
    const value = `spaces \"quotes\" $HOME $(touch ${probe}) $& $\``;
    const result = invoke(["build", "--arguments", value], fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.instruction.includes(value), true);
    assert.equal(spawnSync("test", ["-e", probe]).status, 1);
    criticalCases.set("opaque-arguments", "passed");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("no-argument enforcement: changes rejects non-empty arguments", () => {
  const result = invoke(["changes", "--arguments", "not allowed"]);
  assert.notEqual(result.status, 0);
  assert.equal(result.json.error.code, "unexpected_arguments");
});

test("unknown-command: an allow-list miss has a stable error", () => {
  const result = invoke(["../../VERSION"]);
  assert.notEqual(result.status, 0);
  assert.equal(result.json.error.code, "unknown_host_command");
  assert.equal(result.stdout.includes("3."), false);
  criticalCases.set("unknown-command", "passed");
});

test("unsupported protocol fails without returning an instruction", () => {
  const result = invoke(["build", "--protocol", "2", "--arguments", "demo"]);
  assert.notEqual(result.status, 0);
  assert.equal(result.json.error.code, "unsupported_protocol");
  assert.equal("instruction" in result.json, false);
});

test("unavailable source returns instruction_unavailable", () => {
  const fixture = mkdtempSync(join(tmpdir(), "foundation-host-missing-"));
  try {
    writeFileSync(join(fixture, "VERSION"), "1.0.0\n");
    assert.throws(() => resolveHostInstruction("build", {
      packageRoot: fixture, arguments: "demo"
    }), (error) => error instanceof HostInstructionError &&
      error.code === "instruction_unavailable");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("outside-project: endpoint does not perform project discovery", () => {
  const fixture = mkdtempSync(join(tmpdir(), "foundation-host-outside-"));
  try {
    const result = invoke(["changes"], fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.json.command, "changes");
    criticalCases.set("outside-project", "passed");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("agent-contract-source: endpoint returns the exact package-owned contract", () => {
  const result = invokeAgentContract();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.protocol, 1);
  assert.equal(result.json.contract,
    readFileSync(join(ROOT, ".claude/harness/AGENT.md"), "utf8"));
  assert.equal(result.json.foundationVersion,
    readFileSync(join(ROOT, "VERSION"), "utf8").trim());
  criticalCases.set("agent-contract-source", "passed");
});

test("agent-contract-failure: invalid protocol and flags return stable errors", () => {
  const unsupported = invokeAgentContract(["--protocol", "2"]);
  assert.notEqual(unsupported.status, 0);
  assert.equal(unsupported.json.error.code, "unsupported_protocol");
  const invalid = invokeAgentContract(["unexpected"]);
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.json.error.code, "invalid_host_request");
  criticalCases.set("agent-contract-failure", "passed");
});

test("agent contract reports unavailable package content", () => {
  const fixture = mkdtempSync(join(tmpdir(), "foundation-host-agent-missing-"));
  try {
    writeFileSync(join(fixture, "VERSION"), "1.0.0\n");
    assert.throws(() => resolveHostAgentContract({ packageRoot: fixture }),
      (error) => error instanceof HostAgentContractError &&
        error.code === "contract_unavailable");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("agent contract endpoint runs outside a project", () => {
  const fixture = mkdtempSync(join(tmpdir(), "foundation-host-agent-outside-"));
  try {
    const result = invokeAgentContract([], fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.json.contract, /Foundation agent contract/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("packaged-layout: a Homebrew-style libexec owns every dependency", () => {
  const fixture = mkdtempSync(join(tmpdir(), "foundation-host-libexec-"));
  const libexec = join(fixture, "libexec");
  try {
    mkdirSync(join(libexec, ".claude", "harness", "runtime"), { recursive: true });
    cpSync(join(ROOT, "cli.sh"), join(libexec, "cli.sh"));
    cpSync(join(ROOT, "VERSION"), join(libexec, "VERSION"));
    cpSync(join(ROOT, ".claude", "commands"), join(libexec, ".claude", "commands"),
      { recursive: true });
    cpSync(join(ROOT, ".claude", "harness", "AGENT.md"),
      join(libexec, ".claude", "harness", "AGENT.md"));
    cpSync(join(ROOT, ".claude", "harness", "runtime", "core"),
      join(libexec, ".claude", "harness", "runtime", "core"), { recursive: true });
    const result = invoke(["changes"], fixture, join(libexec, "cli.sh"));
    assert.equal(result.status, 0, result.stderr);
    assert.notEqual(result.json, null,
      `packaged CLI emitted no JSON; stdout=${result.stdout} stderr=${result.stderr}`);
    assert.deepEqual({ protocol: result.json.protocol, command: result.json.command },
      { protocol: 1, command: "changes" });
    criticalCases.set("packaged-layout", "passed");
    const agentContract = invokeAgentContract([], fixture, join(libexec, "cli.sh"));
    assert.equal(agentContract.status, 0, agentContract.stderr);
    assert.equal(agentContract.json.contract,
      readFileSync(join(ROOT, ".claude/harness/AGENT.md"), "utf8"));
    criticalCases.set("agent-contract-packaged", "passed");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("contract evolves additively", () => {
  const response = { ...resolveHostInstruction("build", { arguments: "demo" }), future: true };
  const { protocol, command, instruction } = response;
  assert.deepEqual({ protocol, command }, { protocol: 1, command: "build" });
  assert.match(instruction, /demo/);
});

test("host instruction answers --help without project discovery", () => {
  const fixture = mkdtempSync(join(tmpdir(), "foundation-host-help-"));
  try {
    const result = spawnSync("bash", [CLI, "host", "instruction", "--help"], {
      cwd: fixture, encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /host instruction <command>/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("host agent-contract answers --help without project discovery", () => {
  const fixture = mkdtempSync(join(tmpdir(), "foundation-host-agent-help-"));
  try {
    const result = spawnSync("bash", [CLI, "host", "agent-contract", "--help"], {
      cwd: fixture, encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /host agent-contract/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
