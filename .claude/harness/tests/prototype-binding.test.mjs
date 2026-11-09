import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  PROTOTYPE_BINDING, materializePrototype, prototypeSelectionIssues, readPrototypeBinding
} from "../runtime/workflow/prototype-binding.mjs";
import { packetIdentity } from "../runtime/core/user-decisions.mjs";
import { renderDraftDesign } from "../runtime/workflow/change-lifecycle.mjs";

function project(t) {
  const root = mkdtempSync(join(tmpdir(), "foundation-prototype-binding-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const basePath = join(root, "openspec", "changes", "demo");
  mkdirSync(basePath, { recursive: true });
  writeFileSync(join(basePath, "proposal.md"), "## Why\n\nDemo.\n");
  const prototypes = join(root, ".foundation", "prototypes", "inv-1");
  mkdirSync(prototypes, { recursive: true });
  writeFileSync(join(prototypes, "board.html"), "<main><button>Add</button></main>\n");
  return { root, basePath };
}

const claims = [
  { id: "board-renders", requirementKey: "board" },
  { id: "board-empty", requirementKey: "board" },
  { id: "export-csv", requirementKey: "export" }
];
const tasks = [
  { id: "T001", claims: ["board-renders", "board-empty"] },
  { id: "T002", claims: ["export-csv"] }
];

test("an investigation prototype is copied into the packet and bound to its requirements", (t) => {
  const { root, basePath } = project(t);
  const binding = materializePrototype({
    root, basePath, claims, tasks,
    selection: { reference: ".foundation/prototypes/inv-1/board.html", selected: "A", covers: ["board"] }
  });
  assert.equal(binding.file, "prototype/board.html");
  assert.equal(readFileSync(join(basePath, "prototype", "board.html"), "utf8"),
    "<main><button>Add</button></main>\n");
  assert.equal(binding.mode, "strict", "strict is the default mode");
  assert.deepEqual(binding.requirements, ["board"]);
  assert.deepEqual(binding.claims, ["board-empty", "board-renders"]);
  assert.deepEqual(binding.tasks, ["T001"]);
  const read = readPrototypeBinding(basePath);
  assert.equal(read.intact, true);
  assert.equal(read.source, ".foundation/prototypes/inv-1/board.html");
});

test("a reference missing or outside the project is refused and writes nothing", (t) => {
  const { root, basePath } = project(t);
  const outside = mkdtempSync(join(tmpdir(), "foundation-prototype-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, "x.html"), "<p>x</p>");
  for (const reference of ["missing.html", join(outside, "x.html"), "../x.html"])
    assert.throws(() => materializePrototype({
      root, basePath, claims, tasks, selection: { reference, selected: "A" }
    }), /inside the project/, reference);
  assert.equal(existsSync(join(basePath, PROTOTYPE_BINDING)), false);
});

test("covers naming an unknown requirement or an invalid mode is a draft issue", () => {
  assert.deepEqual(prototypeSelectionIssues(undefined, ["board"]), []);
  assert.deepEqual(prototypeSelectionIssues({ covers: ["board"] }, ["board"]), []);
  assert.match(prototypeSelectionIssues({ covers: ["board", "ghost"] }, ["board"]).join("\n"),
    /unknown requirement keys: ghost/);
  assert.match(prototypeSelectionIssues({ covers: "board" }, ["board"]).join("\n"),
    /covers must be an array/);
  assert.match(prototypeSelectionIssues({ mode: "loose" }, []).join("\n"), /mode must be strict\|advisory/);
  assert.deepEqual(prototypeSelectionIssues({ mode: "advisory" }, []), []);
});

test("editing the packet copy after approval changes the agreement identity", (t) => {
  const { root, basePath } = project(t);
  materializePrototype({
    root, basePath, claims, tasks,
    selection: { reference: ".foundation/prototypes/inv-1/board.html", selected: "A", covers: ["board"] }
  });
  const approved = packetIdentity(basePath);
  writeFileSync(join(basePath, "prototype", "board.html"), "<main><button>Remove</button></main>\n");
  assert.notEqual(packetIdentity(basePath), approved);
  assert.equal(readPrototypeBinding(basePath).intact, false);
});

test("a revision without a prototype removes the earlier binding", (t) => {
  const { root, basePath } = project(t);
  materializePrototype({
    root, basePath, claims, tasks,
    selection: { reference: ".foundation/prototypes/inv-1/board.html", selected: "A" }
  });
  assert.equal(materializePrototype({ root, basePath, claims, tasks, selection: undefined }), null);
  assert.equal(existsSync(join(basePath, "prototype")), false);
  assert.equal(readPrototypeBinding(basePath), null);
});

test("design.md links the packet copy with its mode and requirements", () => {
  const design = renderDraftDesign({
    workType: ["ui"],
    prototypeSelection: {
      selected: "Board A", reference: ".foundation/prototypes/inv-1/board.html",
      reason: "clearest", covers: ["board"], mode: "advisory"
    },
    tasks: [{ id: "T001", outcome: "Board", paths: ["src/board.js"], verify: "npm test" }]
  });
  assert.match(design, /\[prototype\/board\.html\]\(prototype\/board\.html\)/);
  assert.match(design, /\*\*Mode:\*\* advisory/);
  assert.match(design, /\*\*Requirements:\*\* `board`/);
});
