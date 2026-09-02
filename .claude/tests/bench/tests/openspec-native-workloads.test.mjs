import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runBenchmarkOracle } from "../openspec-native/run.mjs";

const TASKS = fileURLToPath(new URL("../tasks", import.meta.url));

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function verifyWorkload(name, repair) {
  const task = join(TASKS, name);
  const project = mkdtempSync(join(tmpdir(), `foundation-${name}-`));
  try {
    cpSync(join(task, "seed"), project, { recursive: true });
    const before = runBenchmarkOracle({ project, oraclePath: join(task, "oracle/run.sh") });
    assert.equal(before.verdict, "fail", "the frozen seed must expose the scenario defect");
    repair(project);
    const after = runBenchmarkOracle({ project, oraclePath: join(task, "oracle/run.sh") });
    assert.equal(after.verdict, "pass", JSON.stringify(after));
    assert.equal(after.score, after.max);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

test("TypeScript/React state fixture has a mutation-killing acceptance oracle", () => {
  verifyWorkload("16-typescript-react-state", (project) => {
    const path = join(project, "src/panel-state.js");
    write(path, readFileSync(path, "utf8").replace("open: true", "open: !state.open"));
    write(join(project, "panel-state.test.mjs"), `
import assert from "node:assert/strict";
import test from "node:test";
import { initialPanelState, reducePanelState } from "./src/panel-state.js";
test("toggle opens and closes without dropping state", () => {
  const open = reducePanelState(initialPanelState(), { type: "toggle" });
  const closed = reducePanelState({ ...open, query: "Ada", selectedId: "c1" }, { type: "toggle" });
  assert.deepEqual(closed, { open: false, query: "Ada", selectedId: "c1" });
});
`);
  });
});

test("recent-window fixture kills the zero/fractional boundary mutant", () => {
  verifyWorkload("11-recent-window", (project) => {
    const path = join(project, "window.js");
    write(path, readFileSync(path, "utf8").replace(
      "return items.slice(-n);",
      "const count = Math.trunc(Number(n));\n  return count > 0 ? items.slice(-count) : [];"
    ));
    write(join(project, "window.test.js"), `
const assert = require("node:assert/strict");
const test = require("node:test");
const { lastN } = require("./window");
test("bug 412 zero, negative, and fractional windows stay empty", () => {
  assert.deepEqual(lastN(["a", "b"], 0), []);
  assert.deepEqual(lastN(["a", "b"], -1), []);
  assert.deepEqual(lastN(["a", "b"], 0.4), []);
});
`);
  });
});

test("Python validation fixture kills bool-as-int representation acceptance", () => {
  verifyWorkload("15-python-api-validation", (project) => {
    const path = join(project, "user_api.py");
    write(path, readFileSync(path, "utf8").replace(
      "not isinstance(seat_count, int)", "type(seat_count) is not int"));
    const testPath = join(project, "tests/test_user_api.py");
    write(testPath, `${readFileSync(testPath, "utf8")}\n
class WorkspaceBooleanBoundaryTests(unittest.TestCase):
    def test_boolean_is_not_an_integer_seat_count(self):
        self.assertIn("seat_count", validate_workspace({"seat_count": True}))
        self.assertEqual(create_workspace({"seat_count": True})["status"], 422)
`);
  });
});

test("migration fixture proves lossless rollback and regression-first coverage", () => {
  verifyWorkload("17-database-migration-rollback", (project) => {
    const path = join(project, "migration.mjs");
    write(path, readFileSync(path, "utf8").replace(
      "disabled: false", "disabled: row.status === \"disabled\""));
    write(join(project, "migration.test.mjs"), `
import assert from "node:assert/strict";
import test from "node:test";
import { up, down } from "./migration.mjs";
test("rollback preserves disabled accounts", () => {
  const rows = [{ id: "a", name: "Ada", disabled: false }, { id: "b", name: "Grace", disabled: true }];
  assert.deepEqual(down(up(rows)), rows);
});
`);
  });
});

test("refactor fixture requires shared structure and preserved behavior", () => {
  verifyWorkload("18-refactor-no-reproduction", (project) => {
    write(join(project, "classify.mjs"), `
function normalizeText(value) {
  return String(value ?? "").trim().replace(/\\s+/g, " ").toLowerCase();
}
export const normalizeCustomerName = normalizeText;
export const normalizeSupplierName = normalizeText;
export function sameCustomer(left, right) { return normalizeCustomerName(left) === normalizeCustomerName(right); }
export function sameSupplier(left, right) { return normalizeSupplierName(left) === normalizeSupplierName(right); }
`);
    write(join(project, "classify.test.mjs"), `
import assert from "node:assert/strict";
import test from "node:test";
import * as names from "./classify.mjs";
test("characterizes public normalization", () => {
  assert.equal(names.normalizeCustomerName("  Ada  "), "ada");
  assert.equal(names.normalizeSupplierName(null), "");
  assert.equal(names.sameCustomer("GRACE HOPPER", " grace  hopper "), true);
});
`);
  });
});

test("multi-service fixture binds producer and consumer contract semantics", () => {
  verifyWorkload("19-multi-service-event-flow", (project) => {
    const path = join(project, "services/orders/order-event.mjs");
    write(path, readFileSync(path, "utf8")
      .replace("version: 1", "version: 2")
      .replace("String(order.totalCents)", "Number(order.totalCents)"));
    write(join(project, "contract.test.mjs"), `
import assert from "node:assert/strict";
import test from "node:test";
import { orderCharged } from "./services/orders/order-event.mjs";
import { applyOrderCharged } from "./services/billing/apply-event.mjs";
test("v2 producer payload is accepted exactly once", () => {
  const event = orderCharged({ eventId: "e1", id: "o1", totalCents: 1299 });
  const first = applyOrderCharged({ processed: [], balances: {} }, event);
  assert.deepEqual(applyOrderCharged(first, event), first);
});
`);
  });
});

test("budget decision workload has a zero-cost deterministic sentinel", () => {
  const result = spawnSync(process.execPath, ["--test", resolve(
    TASKS, "../../../harness/tests/budget-continuation.test.mjs")], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
