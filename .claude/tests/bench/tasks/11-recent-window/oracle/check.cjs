// Deterministic AC oracle for 11-recent-window.
//
// Loads the DELIVERED window.js / feed.js out of a solution sandbox and asserts
// each acceptance criterion directly, so quality stops being a judge score with
// a 3-point spread and becomes a per-AC pass/fail. AC1 (regression-first) is
// checked by the caller (run.sh) with the FAIL_TO_PASS swap; everything below is
// a direct behavioural assertion.
//
//   node check.cjs <sandbox-dir>   ->  JSON on stdout
//
// Never copied into a sandbox: run-bench.sh copies only tasks/<t>/seed/.

const path = require("path");

const sandbox = process.argv[2];
if (!sandbox) {
  console.log(JSON.stringify({ error: "usage: check.cjs <sandbox-dir>" }));
  process.exit(2);
}

const results = {};
const note = [];

function record(id, ok, why) {
  results[id] = ok ? "pass" : "fail";
  if (!ok) note.push(`${id}: ${why}`);
}

// eq for flat arrays of primitives
const eq = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

let win;
try {
  win = require(path.resolve(sandbox, "window.js"));
} catch (e) {
  console.log(JSON.stringify({ error: `cannot load window.js: ${e.message}`, results: {} }));
  process.exit(2);
}

const items = ["a", "b", "c", "d", "e"];

// AC5 (shape half) — exported names survive. Checked first: everything else
// depends on them existing.
const hasShape = typeof win.lastN === "function" && typeof win.dropLastN === "function";
record("AC5_shape", hasShape, "window.js must still export lastN and dropLastN as functions");
if (!hasShape) {
  console.log(JSON.stringify({ results, note, error: "exports missing — later ACs unevaluable" }));
  process.exit(0);
}

// AC2 — RIGHT LAYER. lastN itself must handle the zero window. A guard bolted
// into feed.js leaves this failing, which is exactly the documented trap.
let ac2 = false;
try {
  ac2 = eq(win.lastN(items, 0), []);
} catch (e) {
  note.push(`AC2 threw: ${e.message}`);
}
record("AC2_right_layer", ac2, "lastN(items, 0) must return [] at the window.js layer");

// AC3 — NO COLLATERAL CHANGE.
let ac3 = false;
try {
  ac3 =
    eq(win.dropLastN(items, 0), items) &&        // dropping zero drops nothing
    eq(win.lastN(items, 1), ["e"]) &&
    eq(win.lastN(items, 3), ["c", "d", "e"]) &&  // original order preserved
    eq(win.lastN(items, 99), items) &&           // n > length returns everything
    eq(win.lastN([], 0), []) &&
    eq(win.lastN([], 3), []);
} catch (e) {
  note.push(`AC3 threw: ${e.message}`);
}
record("AC3_no_collateral", ac3, "dropLastN(_,0) or lastN for n>=1 / n>len / empty regressed");

// AC4 — NEGATIVE AND NON-INTEGER input must not resurrect the bug.
let ac4 = false;
try {
  ac4 =
    eq(win.lastN(items, -1), []) &&
    eq(win.lastN(items, -3), []) &&
    eq(win.lastN(items, -0), []) &&
    eq(win.lastN(items, 0.4), []);   // truncates toward a zero window, not a front slice
} catch (e) {
  note.push(`AC4 threw: ${e.message}`);
}
record("AC4_negative_input", ac4, "negative / fractional window must yield no rows, never a front slice");

// AC5 (no-special-case half) — the consumer must still work through the shared
// helper, and must not have been turned into the fix site.
let ac5 = false;
try {
  const feed = require(path.resolve(sandbox, "feed.js"));
  const events = [{ label: "x" }, { label: "y" }];
  ac5 =
    typeof feed.activityStrip === "function" &&
    eq(feed.activityStrip(events, 0), []) &&
    eq(feed.activityStrip(events, 1), ["y"]) &&
    eq(feed.activityStrip(events, 9), ["x", "y"]);
} catch (e) {
  note.push(`AC5 threw: ${e.message}`);
}
record("AC5_consumer_intact", ac5, "activityStrip must still work for 0 / 1 / oversize windows");

console.log(JSON.stringify({ results, note }));
