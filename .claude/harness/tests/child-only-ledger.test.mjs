import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { syncChildOnlyPacket, syncChildOnlyTaskProgress } from "../runtime/workflow/apply-runtime.mjs";
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

// A change amended during Build keeps its agreement in the sandbox packet
// (new task, revised requirement, spec delta, amendment history). A child-only
// Land must archive that packet, so it replaces the root packet whole; without
// an amendment only the ticks cross, as before.
function packets(t, { root, sandbox }) {
  const dir = mkdtempSync(join(tmpdir(), "child-only-packet-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (base, files) => {
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(join(base, name, ".."), { recursive: true });
      writeFileSync(join(base, name), content);
    }
  };
  write(join(dir, "root"), root);
  write(join(dir, "sandbox"), sandbox);
  return { rootPacketPath: join(dir, "root"), sandboxPacketPath: join(dir, "sandbox") };
}

const read = (base, name) => readFileSync(join(base, name), "utf8");

test("an amended child-only Land replaces the root packet with the sandbox packet", (t) => {
  const amendedLedger = ticked(ROOT_LEDGER, ["T001", "T002", "T003"]).replace(/\n$/, "") +
    "\n- [x] **T004** Partial release [repo:backend] [depends:T001] — verify: `npm test`\n";
  const paths = packets(t, {
    root: { "tasks.md": ROOT_LEDGER, "proposal.md": "# Change\n\n## Why\n\nBefore.\n",
      "specs/orders/spec.md": "## ADDED Requirements\n\n### Requirement: reservations\n",
      "stale.md": "only in root\n" },
    sandbox: { "tasks.md": amendedLedger,
      "proposal.md": "# Change\n\n## Why\n\nBefore.\n\n## Appendix: Amendment history\n\n- rev 1: partial release\n",
      "specs/orders/spec.md": "## ADDED Requirements\n\n### Requirement: reservations\n\n### Requirement: partial-release\n",
      "design.md": "## Overview\n\nAdded by the amendment.\n" }
  });
  assert.equal(syncChildOnlyPacket({ repositories: CHILD_ONLY, mergeTaskProgress, amended: true, ...paths }),
    "replaced");
  for (const name of ["tasks.md", "proposal.md", "specs/orders/spec.md", "design.md"])
    assert.equal(read(paths.rootPacketPath, name), read(paths.sandboxPacketPath, name), name);
  assert.equal(existsSync(join(paths.rootPacketPath, "stale.md")), false, "a root-only file is removed");
  assert.match(read(paths.rootPacketPath, "proposal.md"), /Amendment history/);
  assert.equal(taskBlocks(read(paths.rootPacketPath, "tasks.md")).length, 4);
});

test("without an amendment a child-only Land still merges only the ticks", (t) => {
  const paths = packets(t, {
    root: { "tasks.md": ROOT_LEDGER, "proposal.md": "# Change\n" },
    sandbox: { "tasks.md": ticked(ROOT_LEDGER, ["T001"]).replace("sole implementation ledger", "edited"),
      "proposal.md": "# Change edited\n" }
  });
  assert.equal(syncChildOnlyPacket({ repositories: CHILD_ONLY, mergeTaskProgress, amended: false, ...paths }), true);
  assert.equal(read(paths.rootPacketPath, "tasks.md"), ticked(ROOT_LEDGER, ["T001"]));
  assert.equal(read(paths.rootPacketPath, "proposal.md"), "# Change\n", "prose never crosses without an amendment");
});

test("a writable root keeps its projection whether or not the change was amended", (t) => {
  const paths = packets(t, { root: { "tasks.md": ROOT_LEDGER }, sandbox: { "tasks.md": ticked(ROOT_LEDGER, ["T001"]) } });
  const repositories = [{ id: "root", mode: "write" }, ...CHILD_ONLY];
  assert.equal(syncChildOnlyPacket({ repositories, mergeTaskProgress, amended: true, ...paths }), false);
  assert.equal(read(paths.rootPacketPath, "tasks.md"), ROOT_LEDGER);
});
