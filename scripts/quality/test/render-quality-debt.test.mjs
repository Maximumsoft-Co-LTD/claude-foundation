import assert from "node:assert/strict";
import test from "node:test";
import { buildDebtInventory, renderDebt } from "../render-quality-debt.mjs";

test("debt inventory classifies baseline CRAP and mutation findings without hiding raw rows", () => {
  const inventory = buildDebtInventory({
    crap: { functions: [{ path: "a.js", line: 1, name: "a", cyclomatic: 10, coveragePercent: 0, crap: 110 }] },
    mutationReports: [{ scope: "unit", report: { files: { "a.js": { mutants: [
      { id: "1", status: "Survived", mutatorName: "ConditionalExpression", location: { start: { line: 2 } } },
      { id: "2", status: "NoCoverage", mutatorName: "BlockStatement", location: { start: { line: 3 } } }
    ] } } } }]
  });
  assert.deepEqual(inventory.summary, { highCrap: 1, survivedMutants: 1, noCoverageMutants: 1 });
  assert.match(renderDebt(inventory), /accepted baseline debt/);
});
