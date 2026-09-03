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
    ["git commit"]);
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

// The marker is process-local to the runtime apply transaction and never
// reaches a host tool call, so requiring it for a commit made the Land
// contract's own delivery step unreachable and handed it back to the user.
test("Land permits authorized delivery without the marker [land-delivery-commit-allowed]", () => {
  for (const command of [
    "git add foundation.json && git commit -q -m \"chore: update pointers\"",
    "git commit -m \"chore: land\" && git push origin main",
    "git add . && git commit -m \"x\" && git log -1 --oneline"
  ]) assert.equal(shellMutationViolation("land", {}, command), null, command);
});

test("Land still refuses tree mutations and names them [land-tree-mutation-refused]", () => {
  for (const [command, refused] of [
    ["git checkout -- src", "git checkout"],
    ["rm -rf build", "rm"],
    ["echo x > notes.txt", "redirect"],
    ["sh -c \"cd /repo && git commit -m y\"", "sh -c"],
    ["git commit -m \"x\" && git reset --hard origin/main", "git reset"]
  ]) {
    const violation = shellMutationViolation("land", {}, command);
    assert.match(violation, /^Land shell mutations require the runtime transaction marker;/,
      command);
    assert.match(violation, new RegExp(`refused: .*${refused.replace(/ /g, " ")}`), command);
  }
});

// The operation screen reads a copy with quoted spans blanked out, so a
// substitution inside a commit message arrives as whitespace and the delivery
// carve-out saw only `git commit` while the shell still ran the removal.
test("Land refuses delivery that hides a command [land-delivery-substitution-refused]", () => {
  for (const command of [
    'git commit -m "$(rm -rf build)"',
    "git commit -m \"`rm -rf build`\"",
    'git push origin "$(cat /etc/passwd)"',
    'git commit -m "release ${VERSION}"',
    'git commit -m "notes $(<(cat plan))"'
  ]) {
    const violation = shellMutationViolation("land", {}, command);
    assert.match(violation, /refused: .*command substitution/, command);
  }
  assert.equal(shellMutationViolation("land", {}, 'git commit -m "release $VERSION"'), null);
  assert.equal(shellMutationViolation("land", {
    FOUNDATION_LAND_TRANSACTION: "1"
  }, 'git commit -m "$(date)"'), null);
});

test("Land leaves read-only commands alone", () => {
  assert.equal(shellMutationViolation("land", {}, "git status"), null);
  assert.equal(shellMutationViolation("land", {}, "git log 2>/dev/null"), null);
});

test("shell mutation policy requires an isolated Build workspace", () => {
  assert.equal(shellMutationViolation("build", {}),
    "Build shell mutations require an isolated workspace");
  assert.equal(shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: "/workspace"
  }), null);
  assert.equal(shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: "/workspace"
  }, "npm install"), "Build shell mutations must start inside the isolated workspace");
  assert.equal(shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: "/workspace"
  }, "cd /workspace && npm install"), null);
  assert.equal(shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: "/workspace"
  }, "cd /workspace && echo x > /outside.txt"),
  "Build shell mutation contains an obvious path outside the isolated workspace");
  assert.equal(shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: "/workspace"
  }, "cd /workspace && cp ../secret ./secret"),
  "Build shell mutation contains an obvious path outside the isolated workspace");
  for (const command of [
    "cd /workspace && cp $SOURCE ./source",
    "cd /workspace && cp $(pwd)/source ./source",
    "cd /workspace && cp `pwd`/source ./source",
    "cd /workspace && cp ~/source ./source"
  ]) assert.equal(shellMutationViolation("build", {
    FOUNDATION_WORKSPACE_ROOT: "/workspace"
  }, command), "Build shell mutation contains a dynamic path that cannot be proven isolated");
  assert.equal(shellMutationViolation("unknown", {}), null);
});
