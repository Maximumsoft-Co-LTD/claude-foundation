import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syncChildOnlyTaskProgress } from "../runtime/workflow/apply-runtime.mjs";
import { taskBlocks } from "../runtime/contracts/change-artifacts.mjs";
import { createSandboxRuntime } from "../runtime/workflow/sandbox-runtime.mjs";

// The same tick rule sync uses from root into the sandbox.
const { mergeTaskProgress } = createSandboxRuntime({ taskBlocks });

const ROOT_LEDGER = [
  "# Tasks",
  "",
  "> This is the sole implementation ledger.",
  "",
  "- [ ] **T001** Implement /v2 backend [repo:backend] — verify: `npm test`",
  "- [ ] **T002** Implement SDK methods [repo:sdk] [depends:T001] — verify: `npm test`",
  "- [ ] **T003** Implement web order state [repo:web] [depends:T002] — verify: `npm test`",
  ""
].join("\n");
const CHILD_ONLY = [
  { id: "backend", mode: "write" }, { id: "sdk", mode: "write" }, { id: "web", mode: "write" }
];

function ledgers(t, sandboxText) {
  const dir = mkdtempSync(join(tmpdir(), "child-only-ledger-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "root"));
  mkdirSync(join(dir, "sandbox"));
  const rootTasksPath = join(dir, "root", "tasks.md");
  const sandboxTasksPath = join(dir, "sandbox", "tasks.md");
  writeFileSync(rootTasksPath, ROOT_LEDGER);
  writeFileSync(sandboxTasksPath, sandboxText);
  return { rootTasksPath, sandboxTasksPath };
}

const ticked = (text, ids) => ids.reduce((out, id) =>
  out.replace(`- [ ] **${id}**`, `- [x] **${id}**`), text);

test("a child-only Land carries every Build tick into the root ledger before archive", (t) => {
  const paths = ledgers(t, ticked(ROOT_LEDGER, ["T001", "T002", "T003"]));
  assert.equal(syncChildOnlyTaskProgress({ repositories: CHILD_ONLY, mergeTaskProgress, ...paths }), true);
  const root = readFileSync(paths.rootTasksPath, "utf8");
  assert.equal(taskBlocks(root).filter((task) => task.done).length, 3);
  assert.doesNotMatch(root, /- \[ \]/);
});

test("only ticked tasks change and every other root line keeps its bytes", (t) => {
  // The sandbox copy also differs in prose; only its tick may cross back.
  const sandbox = ticked(ROOT_LEDGER, ["T001"]).replace("sole implementation ledger", "edited in sandbox");
  const paths = ledgers(t, sandbox);
  syncChildOnlyTaskProgress({ repositories: CHILD_ONLY, mergeTaskProgress, ...paths });
  assert.equal(readFileSync(paths.rootTasksPath, "utf8"), ticked(ROOT_LEDGER, ["T001"]));
});

test("a change with a writable root keeps the root projection and merges nothing", (t) => {
  const paths = ledgers(t, ticked(ROOT_LEDGER, ["T001", "T002", "T003"]));
  const repositories = [{ id: "root", mode: "write" }, ...CHILD_ONLY];
  assert.equal(syncChildOnlyTaskProgress({ repositories, mergeTaskProgress, ...paths }), false);
  assert.equal(readFileSync(paths.rootTasksPath, "utf8"), ROOT_LEDGER);
});

test("a read-only root still counts as child-only", (t) => {
  const paths = ledgers(t, ticked(ROOT_LEDGER, ["T002"]));
  const repositories = [{ id: "root", mode: "read" }, ...CHILD_ONLY];
  assert.equal(syncChildOnlyTaskProgress({ repositories, mergeTaskProgress, ...paths }), true);
  assert.equal(readFileSync(paths.rootTasksPath, "utf8"), ticked(ROOT_LEDGER, ["T002"]));
});
