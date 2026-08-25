import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeGitRef } from "../lib.mjs";

test("git ref validation accepts ancestry syntax used by push workflows", () => {
  assert.equal(assertSafeGitRef("HEAD^"), "HEAD^");
  assert.equal(assertSafeGitRef("HEAD~2"), "HEAD~2");
  assert.equal(assertSafeGitRef("origin/main"), "origin/main");
});

test("git ref validation rejects revision/path and option injection", () => {
  assert.throws(() => assertSafeGitRef("HEAD:package.json"), /unsafe base ref/);
  assert.throws(() => assertSafeGitRef("--help"), /unsafe base ref/);
  assert.throws(() => assertSafeGitRef("HEAD;echo"), /unsafe base ref/);
});
