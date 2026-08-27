import assert from "node:assert/strict";
import test from "node:test";

import { detachedAuthorityCommand } from "../../hooks/no-detached-authority.mjs";

test("configured authority reviewer must remain in the foreground", () => {
  assert.equal(detachedAuthorityCommand(
    "claude-foundation authority run demo --request req &"), true);
  assert.equal(detachedAuthorityCommand(
    "nohup node .claude/harness/foundation.mjs authority run demo --request req"), true);
  assert.equal(detachedAuthorityCommand(
    "node .claude/harness/foundation.mjs authority-run demo --request req; disown"), true);
  assert.equal(detachedAuthorityCommand(
    "claude-foundation authority run demo --request req"), false);
  assert.equal(detachedAuthorityCommand("node --test &"), false);
  assert.equal(detachedAuthorityCommand(
    "printf '%s' 'authority run demo &'"), false);
});
