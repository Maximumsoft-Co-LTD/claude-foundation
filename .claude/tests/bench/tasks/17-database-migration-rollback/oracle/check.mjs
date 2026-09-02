import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const root = resolve(process.argv[2]);
const migration = await import(`${pathToFileURL(resolve(root, "migration.mjs"))}?oracle=${Date.now()}`);
const original = [
  { id: "a", name: "Ada", disabled: false },
  { id: "b", name: "Grace", disabled: true }
];
const upgraded = migration.up(original);
const rolledBack = migration.down(upgraded);
const results = {
  CASE_FORWARD_SHAPE: upgraded[0].displayName === "Ada" && upgraded[1].status === "disabled"
    ? "pass" : "fail",
  CASE_ROLLBACK_ACTIVE: rolledBack[0].disabled === false ? "pass" : "fail",
  CASE_ROLLBACK_DISABLED: rolledBack[1].disabled === true ? "pass" : "fail",
  CASE_ROUND_TRIP: JSON.stringify(rolledBack) === JSON.stringify(original) ? "pass" : "fail",
  CASE_INPUT_UNCHANGED: Object.hasOwn(original[0], "name") && !Object.hasOwn(original[0], "status")
    ? "pass" : "fail"
};
process.stdout.write(JSON.stringify({ results }));
