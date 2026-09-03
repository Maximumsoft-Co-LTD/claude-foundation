// The change loop knows its own position. Whether it says so is what these
// assertions pin.
//
// Two regressions are guarded here. First, the status-to-command map had one
// caller — `changes` — so a status could be reachable in the state machine and
// still have no stated exit; the map now serves the CLI and the SessionStart
// hook, and a gap shows up in both at once. Second, `validate` used to answer
// "what now?" with the operation the caller had just run, which reads as the
// loop having lost its place.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIFECYCLE_STATUSES, nextAfterValidate, nextCommand
} from "../../harness/runtime/core/next-step.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
let assertions = 0;
const check = (fn) => { fn(); assertions += 1; };

// Every status the lifecycle can hold names a real operation, not the doctor
// fallback. `proven` is the one that only the hook sees raw: `changes` has
// already paid for a workspace hash and collapsed it, so a map that omitted it
// would degrade silently in exactly the caller that cannot detect the gap.
for (const status of LIFECYCLE_STATUSES)
  check(() => assert.doesNotMatch(nextCommand(status, "demo"), /doctor --change/,
    `status '${status}' must name the operation that moves it`));

check(() => assert.equal(nextCommand("proven", "demo"),
  "claude-foundation advance demo",
  "the coordinator rechecks proof freshness without implying Land authority"));
check(() => assert.equal(nextCommand("building", "demo"),
  "claude-foundation advance demo --through build",
  "Build status names the exact bounded target"));
check(() => assert.equal(nextCommand("stale-proof", "demo"),
  "claude-foundation advance demo --through proven",
  "stale proof returns to the exact proof target"));
check(() => assert.equal(nextCommand("landing", "demo"),
  "claude-foundation advance demo --through archived",
  "an authorized in-flight Land resumes to archived"));
check(() => assert.match(nextCommand("no-such-status", "demo"), /doctor --change demo/,
  "an unknown status falls back to diagnosis rather than a dead entry"));

// The circular-advice regression: validate recommending validate.
check(() => assert.equal(nextAfterValidate("change", "demo"), "/build demo"));
check(() => assert.notEqual(nextAfterValidate("change", "demo"),
  nextCommand("change", "demo"),
  "validate must not recommend the operation it just performed"));
check(() => assert.equal(nextAfterValidate("building", "demo"),
  nextCommand("building", "demo"),
  "outside the just-validated case the canonical map still governs"));

// The SessionStart hook is the only place a fresh context learns where it
// stands, so its digest is exercised against real fixtures rather than trusted
// to stay wired. It must never fail a session: both fixtures assert exit 0.
function digest(project) {
  const out = execFileSync("node", [join(ROOT, ".claude", "hooks", "session-context.mjs")], {
    input: JSON.stringify({ session_id: "s", transcript_path: "/t/s.jsonl" }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, CLAUDE_ENV_FILE: "" },
    encoding: "utf8"
  });
  return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "";
}

const fixture = mkdtempSync(join(tmpdir(), "foundation-next-step-"));
try {
  mkdirSync(join(fixture, "openspec", "changes"), { recursive: true });
  mkdirSync(join(fixture, ".foundation", "runtime"), { recursive: true });

  const empty = digest(fixture);
  check(() => assert.match(empty, /no active change/));
  check(() => assert.match(empty, /\/investigate/,
    "the phase before `change` has no runtime status, so the entry points are named instead"));

  mkdirSync(join(fixture, "openspec", "changes", "demo-change"), { recursive: true });
  writeFileSync(join(fixture, ".foundation", "runtime", "demo-change.json"),
    JSON.stringify({ id: "demo-change", status: "building", schema: "foundation-rapid" }));
  writeFileSync(join(fixture, ".foundation", "runtime", "left-behind.json"),
    JSON.stringify({ id: "left-behind", status: "change", schema: "foundation-standard" }));

  const active = digest(fixture);
  check(() => assert.match(active, /demo-change \[building\]/));
  check(() => assert.match(active, /next: claude-foundation advance demo-change/));
  check(() => assert.match(active, /orphan runtime state/,
    "state with no active change is how a stuck project stays stuck unnoticed"));
  check(() => assert.match(active, /left-behind/));
  // Freshness needs a workspace hash this hook deliberately does not compute.
  // Claiming readiness it never checked would be worse than staying silent.
  check(() => assert.match(active, /claude-foundation changes/));
  check(() => assert.doesNotMatch(active, /ready-to-land/));

  writeFileSync(join(fixture, ".foundation", "runtime", "demo-change.json"), "{ not json");
  check(() => assert.match(digest(fixture), /demo-change \[invalid-runtime-json\]/,
    "one unreadable state file must not take the whole digest down"));

  rmSync(join(fixture, "openspec"), { recursive: true, force: true });
  check(() => assert.equal(digest(fixture), "",
    "a project without the OpenSpec tree gets no digest and no error"));
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log(`next-step contracts: ALL PASS (${assertions}/${assertions} assertions)`);
