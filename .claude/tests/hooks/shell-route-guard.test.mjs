import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bashRuleAllows, shellRoute, topLevelSegments
} from "../../hooks/shell-route-guard.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const HOOK = join(ROOT, ".claude/hooks/shell-route-guard.sh");
const project = "/work/gateway";
const change = "api-keys";
const users = `${project}/.foundation/repository-sandboxes/${change}/users`;
const sdk = `${project}/.foundation/repository-sandboxes/${change}/sdk`;
const building = {
  id: change, workspace: `${project}/.foundation/sandboxes/${change}`,
  repositories: [
    { id: "root", path: `${project}/.foundation/sandboxes/${change}`, targetPath: project },
    { id: "users", path: users, targetPath: `${project}/services/users` },
    { id: "sdk", path: sdk, targetPath: "/work/sdk" }
  ]
};
const context = (overrides = {}) => ({
  cwd: project, change: building, ambiguousChanges: [], allowed: () => false, ...overrides
});

test("segments split on top-level operators; heredocs and open quotes are unparseable", () => {
  assert.deepEqual(topLevelSegments("cd a && git status 2>&1 | tail -5").map((row) => [row.text, row.op]),
    [["cd a", "&&"], ["git status 2>&1", "|"], ["tail -5", null]]);
  assert.equal(topLevelSegments("echo 'a && b'").length, 1);
  assert.equal(topLevelSegments("cd a && git commit -F - <<'EOF'\nmsg\nEOF"), null);
  assert.equal(topLevelSegments("echo 'open"), null);
});

test("cd chained into git routes to git -C with the directory", () => {
  for (const separator of [" && ", "; "]) {
    const route = shellRoute(`cd ${sdk}${separator}git status --short && ls src test`, context());
    assert.equal(route.shape, "cd-git");
    assert.match(route.reason, new RegExp(`git -C ${sdk} status --short\``));
    assert.match(route.reason, /`cd` alone first/);
    assert.match(route.reason, /separate calls/);
  }
  const relative = shellRoute("cd services/users && git diff --stat | head -20", context());
  assert.match(relative.reason, /git -C \/work\/gateway\/services\/users diff --stat \| head -20`/);
  assert.doesNotMatch(relative.reason, /separate calls/);
  const spaced = shellRoute("cd my\\ dir && git log -1", context());
  assert.equal(spaced, null, "an escaped directory is not guessed");
  // Without an active change the shape is still refused by the host.
  assert.equal(shellRoute(`cd ${sdk} && git log -1`, context({ change: null })).shape, "cd-git");
});

test("a direct test run during Build routes through exec with the change and repository", () => {
  const piped = shellRoute(`cd ${users} && npm test 2>&1 | tail -40`, context());
  assert.equal(piped.shape, "direct-test");
  assert.match(piped.reason, /`claude-foundation exec api-keys --repo users -- npm test 2>&1 \| tail -40`/);
  const plain = shellRoute("npm test", context({ cwd: users }));
  assert.match(plain.reason, /`claude-foundation exec api-keys --repo users -- npm test`/);
  const shared = shellRoute("node --test test/", context({ cwd: building.workspace }));
  assert.match(shared.reason, /`claude-foundation exec api-keys -- node --test test\/`/);
  for (const command of ["pytest -q", "go test ./...", "npm run test:unit", "pnpm test", "npm test | grep FAIL"])
    assert.equal(shellRoute(command, context())?.shape, "direct-test", command);
  const ambiguous = shellRoute("npm test", context({ change: null, ambiguousChanges: ["a", "b"] }));
  assert.match(ambiguous.reason, /exec <change> -- npm test`.*one of: a, b/);
});

test("test commands pass through without a change in Build or when the host allows them", () => {
  assert.equal(shellRoute("npm test", context({ change: null })), null);
  assert.equal(shellRoute("npm test", context({ allowed: (text) => text === "npm test" })), null);
  assert.equal(shellRoute(`cd ${users} && npm test`, context({ allowed: (text) => text === "npm test" })), null);
  assert.equal(shellRoute("npm test && rm -rf build", context()), null);
  assert.equal(shellRoute("npm test | sort", context()), null);
  assert.equal(shellRoute("npm install", context()), null);
});

test("ordinary, unparseable, and already-routed commands pass through untouched", () => {
  for (const command of [
    "git status --short", `git -C ${sdk} status`, "ls src test", `cd ${users}`,
    `cd ${users} && ls -la src`, "claude-foundation exec api-keys -- npm test",
    "npx claude-foundation exec api-keys --task T1 -- npm test 2>&1 | tail -30",
    "cd \"$DIR\" && git status", "cd ~/x && git status", "echo 'npm test'", "ls ../sdk",
    "python3 -c 'print(1)'", "node -e 'console.log(1)'", `cd ${sdk} && npm test <<'EOF'\nx\nEOF`
  ]) assert.equal(shellRoute(command, context()), null, command);
});

test("Claude Code Bash allow rules match exact, prefix, and glob forms", () => {
  assert.ok(bashRuleAllows("Bash", "npm test"));
  assert.ok(bashRuleAllows("Bash(npm test:*)", "npm test -- --watch"));
  assert.ok(bashRuleAllows("Bash(npm *)", "npm test 2>&1"));
  assert.ok(bashRuleAllows("Bash(npm test)", "npm test 2>&1"));
  assert.ok(!bashRuleAllows("Bash(npm install)", "npm test"));
  assert.ok(!bashRuleAllows("Read(//work/**)", "npm test"));
});

test("the wired hook denies with the route, advises in audit mode, and passes through when off", () => {
  const dir = mkdtempSync(join(tmpdir(), "shell-route-"));
  try {
    const sandbox = join(dir, ".foundation", "repository-sandboxes", change, "users");
    mkdirSync(sandbox, { recursive: true });
    mkdirSync(join(dir, "openspec", "changes", change), { recursive: true });
    mkdirSync(join(dir, ".foundation", "runtime"), { recursive: true });
    writeFileSync(join(dir, ".foundation", "runtime", `${change}.json`), JSON.stringify({
      status: "building", repositories: { users: { path: sandbox, targetPath: join(dir, "services/users") } }
    }));
    const run = (command, env = {}, extra = {}) => execFileSync("sh", [HOOK], {
      input: JSON.stringify({ tool_name: "Bash", cwd: sandbox, tool_input: { command }, ...extra }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, FOUNDATION_GUARDRAIL_MODE: "auto", ...env },
      encoding: "utf8"
    });
    const denied = JSON.parse(run("npm test"));
    assert.equal(denied.decision, "block");
    assert.match(denied.reason, /claude-foundation exec api-keys --repo users -- npm test/);
    assert.equal(JSON.parse(run(`cd ${sandbox} && git status`)).decision, "block");
    const advised = JSON.parse(run("npm test", { FOUNDATION_GUARDRAIL_MODE: "audit" }));
    assert.match(advised.hookSpecificOutput.additionalContext, /claude-foundation exec/);
    assert.equal(run("npm test", { FOUNDATION_GUARDRAIL_MODE: "off" }), "");
    assert.equal(run("npm test", {}, { permission_mode: "bypassPermissions" }), "");
    assert.equal(run("ls src"), "");
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { allow: ["Bash(npm test:*)"] } }));
    assert.equal(run("npm test"), "", "a matching project allow rule passes through");
    rmSync(join(dir, ".claude"), { recursive: true });
    rmSync(join(dir, "openspec", "changes", change), { recursive: true });
    assert.equal(run("npm test"), "", "no active change passes through");
    assert.equal(execFileSync("sh", [HOOK], { input: "not json", encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir } }), "");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
