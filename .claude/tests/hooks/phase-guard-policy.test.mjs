import assert from "node:assert/strict";
import test from "node:test";

import {
  looksMutatingShellCommand, mutatingShellOperations, shellMutationViolation
} from "../../hooks/phase-guard-policy.mjs";

test("shell mutation detection covers formatters, package scripts, and script runners", () => {
  for (const command of [
    "npx prettier --write src", "eslint src --fix", "ruff check --fix .",
    "ruff format .", "black .", "gofmt -w main.go", "cargo fmt",
    "npm run build", "pnpm exec prettier --write .", "yarn run generate",
    "bun run build", "sh generate.sh", "bash scripts/update.sh"
  ]) assert.equal(looksMutatingShellCommand(command), true, command);
  for (const command of ["git status", "node --test", "python3 -m unittest", "cat README.md"])
    assert.equal(looksMutatingShellCommand(command), false, command);
});

test("shell mutation detection names the operations it matched", () => {
  assert.deepEqual(mutatingShellOperations("git add a && git commit -m \"x\""),
    ["git add", "git commit"]);
  assert.deepEqual(mutatingShellOperations("rm -rf build && mkdir build"),
    ["rm", "mkdir"]);
  assert.deepEqual(mutatingShellOperations("echo x > notes.txt"), ["redirect"]);
  assert.deepEqual(mutatingShellOperations("sed -i '' s/a/b/ file"), ["in-place edit"]);
  assert.deepEqual(mutatingShellOperations("git   commit -m 'y'"), ["git commit"]);
  assert.deepEqual(mutatingShellOperations("git log 2>/dev/null"), []);
});

test("shell mutation policy blocks read-only lifecycle phases", () => {
  assert.equal(shellMutationViolation("change", {}),
    "Change cannot run mutating shell commands");
  assert.equal(shellMutationViolation("prove", {}),
    "Prove cannot run mutating shell commands");
});

test("shell mutation policy requires Land transaction authority", () => {
  assert.equal(shellMutationViolation("land", {}),
    "Land shell mutations require the runtime transaction marker");
  assert.equal(shellMutationViolation("land", {
    FOUNDATION_LAND_TRANSACTION: "0"
  }), "Land shell mutations require the runtime transaction marker");
  assert.equal(shellMutationViolation("land", {
    FOUNDATION_LAND_TRANSACTION: "1"
  }), null);
  assert.equal(shellMutationViolation("land", {
    FOUNDATION_LAND_TRANSACTION: "1"
  }, "rm -rf build"), null);
});

test("Land never infers delivery authority from the active phase", () => {
  for (const command of [
    "git add foundation.json && git commit -q -m \"chore: update pointers\"",
    "git commit -m \"chore: land\" && git push origin main",
    "git add . && git commit -m \"x\" && git log -1 --oneline",
    "git commit --amend --no-edit",
    "git push --force origin main",
    "git push origin --delete main",
    "git checkout -- src",
    "rm -rf build",
    "echo x > notes.txt",
    "sh -c \"cd /repo && git commit -m y\""
  ]) {
    const violation = shellMutationViolation("land", {}, command);
    assert.equal(violation, "Land shell mutations require the runtime transaction marker",
      command);
  }
});

test("Land refuses delivery that hides a command [land-delivery-substitution-refused]", () => {
  for (const command of [
    'git commit -m "$(rm -rf build)"',
    "git commit -m \"`rm -rf build`\"",
    'git push origin "$(cat /etc/passwd)"',
    'git commit -m "release ${VERSION}"',
    'git commit -m "notes $(<(cat plan))"'
  ]) {
    const violation = shellMutationViolation("land", {}, command);
    assert.equal(violation, "Land shell mutations require the runtime transaction marker",
      command);
  }
  assert.equal(shellMutationViolation("land", {}, 'git commit -m "release $VERSION"'),
    "Land shell mutations require the runtime transaction marker");
  assert.equal(shellMutationViolation("land", {
    FOUNDATION_LAND_TRANSACTION: "1"
  }, 'git commit -m "$(date)"'), null);
});

test("Land leaves read-only commands alone", () => {
  assert.equal(shellMutationViolation("land", {}, "git status"), null);
  assert.equal(shellMutationViolation("land", {}, "git log 2>/dev/null"), null);
});

const UNANCHORED = "Build shell mutations must start inside the isolated workspace";
const DYNAMIC = "Build shell mutation contains a dynamic path that cannot be proven isolated";
const ESCAPE = "Build shell mutation contains an obvious path outside the isolated workspace";
const WS = { FOUNDATION_WORKSPACE_ROOT: "/workspace" };

test("shell mutation policy requires an isolated Build workspace", () => {
  assert.equal(shellMutationViolation("build", {}),
    "Build shell mutations require an isolated workspace");
  assert.equal(shellMutationViolation("build", WS), null);
  assert.match(shellMutationViolation("build", WS, "npm install"), new RegExp(`^${UNANCHORED}`));
  assert.equal(shellMutationViolation("build", WS, "cd /workspace && npm install"), null);
  assert.equal(shellMutationViolation("build", WS,
    "cd /workspace && /usr/bin/touch nested/file"), null);
  assert.match(shellMutationViolation("build", WS,
    "cd /workspace && echo x > /outside.txt"), new RegExp(`^${ESCAPE}`));
  assert.match(shellMutationViolation("build", WS,
    "cd /workspace && cp ../secret ./secret"), new RegExp(`^${ESCAPE}`));
  for (const command of [
    "cd /workspace && touch /outside.txt",
    "cd /workspace && cp source /outside.txt",
    "cd /workspace && mv source /outside.txt",
    "cd /workspace && rm /outside.txt",
    "cd /workspace && cd /tmp && touch outside.txt"
  ]) assert.match(shellMutationViolation("build", WS, command), new RegExp(`^${ESCAPE}`), command);
  for (const command of [
    "cd /workspace && cp $SOURCE ./source",
    "cd /workspace && cp $(pwd)/source ./source",
    "cd /workspace && cp `pwd`/source ./source",
    "cd /workspace && cp ~/source ./source"
  ]) assert.match(shellMutationViolation("build", WS, command), new RegExp(`^${DYNAMIC}`), command);
  assert.equal(shellMutationViolation("unknown", {}), null);
});

// A consumer agent retried the same blocked verification command five times:
// the reason named a rule, not the workspace, the refused word, or the prefix
// the guard wanted. Every Build refusal must carry its own repair route.
test("Build refusals name the refused operation, the workspace, and the required prefix", () => {
  assert.equal(shellMutationViolation("build", WS,
    'npx tsc --noEmit 2>&1 | tail -20; npm run lint'),
  `${UNANCHORED} (refused: npx, npm run); ` +
  "start the command with `cd /workspace && ` or `cd /workspace/<subdir> && `");
  assert.equal(shellMutationViolation("build", WS, "cd /workspace && cp $SOURCE ./source"),
    `${DYNAMIC} (\`$SOURCE\`); use literal paths inside /workspace`);
  assert.equal(shellMutationViolation("build", WS, "cd /workspace && cp $(pwd)/source ./source"),
    `${DYNAMIC} (\`$(…)\`); use literal paths inside /workspace`);
  assert.equal(shellMutationViolation("build", WS, "cd /workspace && echo x > /outside.txt"),
    `${ESCAPE} (\`/outside.txt\`); keep every mutation target inside /workspace`);
  assert.equal(shellMutationViolation("build", WS, "cd /workspace && cp ../secret ./secret"),
    `${ESCAPE} (\`../secret\`); keep every mutation target inside /workspace`);
  assert.equal(shellMutationViolation("build", { FOUNDATION_WORKSPACE_ROOT: "/my ws" }, "npm install"),
    `${UNANCHORED} (refused: npm install); ` +
    "start the command with `cd '/my ws' && ` or `cd '/my ws/<subdir>' && `");
  assert.equal(shellMutationViolation("build", WS, "cd /workspace/nope; rm -rf ./build"),
    `${UNANCHORED} (\`cd /workspace/nope;\` continues even when the directory change fails); ` +
    "start the command with `cd /workspace/nope && `");
});

// Exit-status expansions expand to integers. The blocked consumer command
// reported ${PIPESTATUS[0]} after a piped check, which is verification, not a
// mutation target the guard cannot prove.
test("Build allows exit-status expansions and still refuses real dynamic paths", () => {
  for (const command of [
    'cd /workspace && npx tsc --noEmit 2>&1 | tail -20; echo "tsc-exit=${PIPESTATUS[0]}"',
    'cd /workspace && npm run lint 2>&1 | tail -20; echo "lint=${PIPESTATUS[@]}"',
    "cd /workspace && npm test 2>&1 | tail -5; echo $PIPESTATUS",
    "cd /workspace && npm test 2>&1 | tail -5; echo ${pipestatus[1]}"
  ]) assert.equal(shellMutationViolation("build", WS, command), null, command);
  // bash evaluates array subscripts, so anything but a literal index would run.
  for (const command of [
    'cd /workspace && npm run lint; echo "${PIPESTATUS_FILE}"',
    "cd /workspace && cp ${SOURCE} ./source",
    "cd /workspace && cp ${#PIPESTATUS[@]} ./source",
    "cd /workspace && npm run test; echo ${PIPESTATUS[$(id >/tmp/pwned)]}",
    "cd /workspace && npm run test; echo ${PIPESTATUS[$(id)]}",
    "cd /workspace && npm run test; echo ${PIPESTATUS[`touch /tmp/pwn`]}",
    "cd /workspace && npm run test; echo ${PIPESTATUS[i]}"
  ]) assert.match(shellMutationViolation("build", WS, command), new RegExp(`^${DYNAMIC}`), command);
});

// Monorepo checks run from a package directory. Any literal absolute directory
// inside the workspace is as provable as the root; relative and parent-escaping
// anchors remain unprovable.
test("Build accepts an anchor inside the workspace and refuses unprovable anchors", () => {
  for (const command of [
    "cd /workspace/packages/app && npm run lint",
    "pushd /workspace/packages/app && npm run lint",
    'cd "/workspace/packages/app" && npm run lint',
    "cd '/workspace/packages/app' && npm run lint",
    "cd /workspace/ && npm run lint",
    "cd /workspace; npm run lint",
    "cd /workspace/ ; npm run lint"
  ]) assert.equal(shellMutationViolation("build", WS, command), null, command);
  for (const command of [
    "cd packages/app && npm run lint",
    "cd /workspace-other/app && npm run lint",
    "cd /workspace/../etc && npm run lint",
    "cd /workspace/packages/app; cd /tmp && npm run lint"
  ]) assert.notEqual(shellMutationViolation("build", WS, command), null, command);
  assert.match(shellMutationViolation("build", WS, "cd /workspace-other/app && npm run lint"),
    new RegExp(`^${UNANCHORED}`));
  // Below the root the directory may not exist; a failed `cd` followed by `;`
  // would run the mutation in the shell's inherited cwd, the main checkout.
  for (const command of [
    "cd /workspace/nope; rm -rf ./build",
    "pushd /workspace/missing; npm install",
    "cd /workspace/packages/app; cd /tmp && npm run lint"
  ]) assert.match(shellMutationViolation("build", WS, command),
    /continues even when the directory change fails/, command);
  // An anchor is only literal when nothing in it expands at run time.
  for (const command of [
    "cd /workspace/$X && rm -rf ./build",
    'cd "/workspace/$X" && rm -rf ./build',
    "cd /workspace/${X} && npm install",
    "cd /workspace && cp source /workspace/$X"
  ]) assert.match(shellMutationViolation("build", WS, command), new RegExp(`^${DYNAMIC}`), command);
  assert.equal(shellMutationViolation("build", WS, 'cd /workspace && git commit -m "$MSG"'), null);
});

// Workspaces under macOS "My Project" style directories carry spaces or
// apostrophes. The anchor must accept every quoting a shell or `exec` emits
// for them, and the refusal hint must be a prefix the policy itself accepts.
test("Build anchors accept quoted workspaces and the hint they are given", () => {
  const spaced = { FOUNDATION_WORKSPACE_ROOT: "/my ws" };
  for (const command of [
    'cd "/my ws" && npm run lint',
    "cd '/my ws' && npm run lint",
    "cd '/my ws/packages/app' && npm run lint",
    'cd "/my ws" && echo x > "/my ws/out.txt"',
    'cd "/my\\ ws" && npm run lint'
  ]) assert.equal(shellMutationViolation("build", spaced, command), null, command);
  assert.match(shellMutationViolation("build", spaced, 'cd "/my ws" && echo x > "/other dir/out.txt"'),
    new RegExp(`^${ESCAPE} \\(\`/other dir/out.txt\`\\)`));
  assert.match(shellMutationViolation("build", spaced, "cd '/my ws' && cp a '/other dir/b'"),
    new RegExp(`^${ESCAPE}`));
  const apostrophe = { FOUNDATION_WORKSPACE_ROOT: "/it's/ws" };
  assert.equal(shellMutationViolation("build", apostrophe,
    "cd '/it'\\''s/ws' && npm run lint"), null);
  assert.equal(shellMutationViolation("build", apostrophe, "npm run lint"),
    `${UNANCHORED} (refused: npm run); ` +
    "start the command with `cd '/it'\\''s/ws' && ` or `cd '/it'\\''s/ws/<subdir>' && `");
});

test("shell mutation detection keeps a quoted operand as an operand", () => {
  assert.deepEqual(mutatingShellOperations('echo x > "/etc/x"'), ["redirect"]);
  assert.deepEqual(mutatingShellOperations("echo x > '/etc/x'"), ["redirect"]);
  assert.deepEqual(mutatingShellOperations('echo "a > b"'), []);
  assert.deepEqual(mutatingShellOperations('sh "scripts/update.sh"'), ["sh"]);
  assert.deepEqual(mutatingShellOperations("bash scripts/update.sh"), ["bash"]);
});
