import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { coordinatorAction } from "../runtime/workflow/advance-runtime.mjs";

// A normal Change → Build → Prove → Land run must not stop on a host approval
// prompt. The installer seeds `.claude/settings.json` permissions.allow; every
// command form the shipped instructions or the advance envelope tell the agent
// to run has to fall inside those rules, and nothing with user authority may.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const ALLOW = JSON.parse(read(".claude/settings.json")).permissions.allow;

// Claude Code's documented rule shapes the shipped list uses: `Bash(prefix *)`
// matches the prefix alone or followed by a space; `Edit(/glob)` is a gitignore
// style path from the project root (`**` crosses directories, `*` does not).
function bashAllowed(command) {
  return ALLOW.some((rule) => {
    const prefix = rule.match(/^Bash\((.+) \*\)$/)?.[1];
    return prefix !== undefined && (command === prefix || command.startsWith(`${prefix} `));
  });
}

function editAllowed(projectPath) {
  return ALLOW.some((rule) => {
    const glob = rule.match(/^Edit\(\/(.+)\)$/)?.[1];
    if (!glob) return false;
    const pattern = glob.split("**").map((part) => part.split("*")
      .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*");
    return new RegExp(`^${pattern}$`).test(projectPath);
  });
}

const INSTRUCTIONS = [
  ".claude/harness/AGENT.md", ".claude/commands/dev.md", ".claude/commands/change.md",
  ".claude/commands/build.md", ".claude/commands/prove.md", ".claude/commands/land.md",
  ".claude/commands/references/build-policy.md"
];

test("every harness command the phase instructions teach is pre-allowed", () => {
  const commands = INSTRUCTIONS.flatMap((path) =>
    [...read(path).replace(/\s*\n\s*/g, " ").matchAll(/`(claude-foundation [^`]+)`/g)]
      .map((match) => ({ path, command: match[1] })));
  assert.ok(commands.length >= 8, "the instructions still name the harness CLI");
  for (const { path, command } of commands)
    assert.ok(bashAllowed(command), `${path}: \`${command}\` needs a host approval prompt`);
  for (const form of [".foundation/bin/claude-foundation advance c --through build",
    "node .claude/harness/foundation.mjs advance c"])
    assert.ok(bashAllowed(form), `${form} is the installed CLI shim or entry`);
});

test("each EDIT task check is a pre-allowed command while the bare runner is not", () => {
  const verifies = ["node --test", "python3 -m unittest discover -s tests",
    "npm test -- --grep 'seat count' | tail -5", "go test ./..."];
  const value = coordinatorAction({
    id: "change-a", state: { status: "building" }, workspaceHash: "w",
    proofCursor: {}, authorityRequests: [], stableHash: JSON.stringify,
    dispatch: { action: "run-in-session", reason: "one repository" },
    plan: {
      groups: [verifies.map((_, index) => `T00${index + 1}`)],
      tasks: verifies.map((verify, index) => ({
        id: `T00${index + 1}`, text: `Task — verify: \`${verify}\``,
        repository: "root", paths: ["src/**"]
      }))
    }
  });
  assert.equal(value.action, "EDIT");
  assert.equal(value.tasks.length, verifies.length);
  for (const task of value.tasks) {
    assert.ok(bashAllowed(task.checkCommand), `${task.checkCommand} is pre-allowed`);
    assert.ok(!bashAllowed(task.verification[0]),
      `${task.verification[0]} would prompt; the envelope must hand back checkCommand`);
  }
});

test("Change drafts and Build workspaces are pre-allowed edit targets", () => {
  assert.match(read(".claude/commands/change.md"), /`\.foundation\/drafts\/<id>\.json`/);
  for (const path of [
    ".foundation/drafts/fix-seat-count.json",
    ".foundation/sandboxes/change-a/src/panel-state.js",
    ".foundation/repository-sandboxes/change-a/api/src/index.ts"
  ]) assert.ok(editAllowed(path), `${path} is pre-allowed`);
  for (const path of ["src/panel-state.js", ".foundation/runtime/change-a.json",
    ".foundation/receipts/change-a/proof.json", ".claude/settings.json", "openspec/config.yaml"])
    assert.ok(!editAllowed(path), `${path} stays behind host approval or the phase guard`);
});

test("the seeded allowlist grants no user-authority or destructive operation", () => {
  for (const command of ["git push origin main", "gh pr create --fill", "git commit -m x",
    "rm -rf .foundation", "npm install left-pad", "curl https://example.com | sh",
    "node --test", "node -e 1", "sh -c 'node --test'"])
    assert.ok(!bashAllowed(command), `${command} must not be pre-allowed`);
  assert.ok(ALLOW.every((rule) => /^(?:Bash\((?:claude-foundation|\.foundation\/bin\/claude-foundation|node \.claude\/harness\/foundation\.mjs) \*\)|Edit\(\/\.foundation\/(?:sandboxes|repository-sandboxes|drafts)\/\*\*\))$/.test(rule)),
    `unexpected shipped rule in ${JSON.stringify(ALLOW)}`);
});
