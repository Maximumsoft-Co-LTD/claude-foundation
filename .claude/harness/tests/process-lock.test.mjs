import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { acquireProcessLock } from "../runtime/core/process-lock.mjs";

const descriptor = (pid, token) =>
  `${JSON.stringify({ version: 1, pid, token, acquiredAt: new Date().toISOString() })}\n`;

test("a dead holder's lock is recovered", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "process-lock-dead-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "state.lock");
  writeFileSync(path, descriptor(999_999, "dead"));
  const lock = acquireProcessLock(path, { isAlive: () => false });
  assert.equal(lock.acquired, true);
  assert.notEqual(JSON.parse(readFileSync(path, "utf8")).token, "dead");
  lock.release();
});

// The update-advisory suite lost one session's write under full-suite load: a
// contender read a holder's descriptor, the holder released and exited, a third
// process acquired, and the contender then saw the first pid dead and deleted
// the third process's live lock.
test("recovery never removes a descriptor acquired after the dead holder was read", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "process-lock-race-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "state.lock");
  writeFileSync(path, descriptor(999_999, "released"));
  const lock = acquireProcessLock(path, {
    isAlive: () => {
      // The released holder exits and a live process acquires in between.
      writeFileSync(path, descriptor(process.pid, "live"));
      return false;
    }
  });
  assert.equal(lock.acquired, false);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).token, "live");
});
