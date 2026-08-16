#!/usr/bin/env node

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServiceSessions } from "../../harness/runtime/evidence/proof-execution/service-sessions.mjs";

const events = [];
const processRef = new EventEmitter();
processRef.exit = (code) => events.push(`exit:${code}`);
const serviceSessions = createServiceSessions({
  processRef,
  startRequiredServices: async () => [
    { stop: () => { events.push("stop:first"); return { path: "first.log" }; } },
    { stop: () => { events.push("stop:second"); return { path: "second.log" }; } }
  ]
});

const sessions = await serviceSessions.startTrackedServices("change", [], "proof");
const artifacts = serviceSessions.stopAll(sessions);
assert.deepEqual(events, ["stop:second", "stop:first"]);
assert.deepEqual(artifacts, [{ path: "second.log" }, { path: "first.log" }]);
assert.deepEqual(serviceSessions.stopAll(sessions), []);

const interrupted = await serviceSessions.startTrackedServices("change", [], "proof-2");
assert.equal(interrupted.length, 2);
processRef.emit("SIGTERM");
assert.deepEqual(events.slice(-3), ["stop:second", "stop:first", "exit:130"]);

console.log("service session tests: ALL PASS (5/5 assertions)");
