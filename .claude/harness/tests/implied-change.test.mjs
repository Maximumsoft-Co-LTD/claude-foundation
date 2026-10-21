import assert from "node:assert/strict";
import test from "node:test";
import { impliedChangeValues } from "../runtime/core/implied-change.mjs";

const refusal = (message) => { throw new Error(message); };
const resolve = (command, values, active) =>
  impliedChangeValues(command, values, () => active, refusal);

test("a sole active change fills an omitted id, keeping flags and their values", () => {
  assert.deepEqual(resolve("advance", [], ["add-search"]), ["add-search"]);
  assert.deepEqual(resolve("advance", ["--through", "build", "--pretty"], ["add-search"]),
    ["add-search", "--through", "build", "--pretty"]);
  assert.deepEqual(resolve("packet", ["--phase", "build"], ["add-search"]),
    ["add-search", "--phase", "build"]);
  assert.deepEqual(resolve("feedback", [], ["add-search"]), ["add-search"]);
});

test("an explicit id is never replaced, even after a value flag", () => {
  assert.deepEqual(resolve("advance", ["other", "--through", "build"], ["add-search"]),
    ["other", "--through", "build"]);
  assert.deepEqual(resolve("advance", ["--through", "build", "other"], ["add-search"]),
    ["--through", "build", "other"]);
  assert.deepEqual(resolve("advance", ["--inspect", "other"], ["add-search"]),
    ["--inspect", "other"]);
});

test("several active changes refuse and list the candidates", () => {
  assert.throws(() => resolve("advance", ["--through", "build"], ["a-one", "b-two"]),
    /advance needs a change id; 2 changes are active: a-one, b-two/);
});

test("no active change leaves the arguments for the command's own error", () => {
  assert.deepEqual(resolve("advance", [], []), []);
  assert.deepEqual(
    impliedChangeValues("advance", [], () => { throw new Error("no changes dir"); }, refusal), []);
});

test("Land, undo, restore, recovery, and approval never infer the change", () => {
  for (const flags of [["--through", "archived"], ["--undo-land", "--decision-ref", "r"],
    ["--recover-apply", "settle", "--decision-ref", "r"], ["--restore-target", "a.txt"],
    ["--approve-spec", "--decision-ref", "r"], ["--through=archived"]])
    assert.throws(() => resolve("advance", flags, ["add-search"]),
      /requires an explicit change id; it is never inferred/, flags.join(" "));
});

test("commands outside the defaultable set are untouched", () => {
  for (const command of ["resolve", "abandon", "land-advance", "preview", "exec", "waive"])
    assert.deepEqual(resolve(command, [], ["add-search"]), [], command);
});
