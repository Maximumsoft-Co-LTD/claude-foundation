import assert from "node:assert/strict";
import test from "node:test";
import { taskChangeIssue } from "../runtime/workflow/task-change.mjs";

const task = { id: "T003", kind: "implementation", paths: ["src/api/**"] };

// A behavior task whose verify passed on unchanged paths is handed back with
// every way forward named, not only "implement it".
test("a task with no change in its paths names why and every route forward", () => {
  const issue = taskChangeIssue({ workTypes: ["feature"], task, changedPaths: ["src/web/app.js"],
    changeId: "change-a" });
  assert.match(issue, /task T003 completed with no change/);
  assert.match(issue, /nothing changed in its declared paths \(src\/api\/\*\*\)/);
  assert.match(issue, /updateTasks amendment \(\{ key, verify, paths \}\)/);
  assert.match(issue, /removeTasks amendment/);
  assert.match(issue, /claude-foundation change amend --template/);
  assert.match(issue, /claude-foundation change amend change-a <amendment\.json>/);
});

test("a task that changed its paths, or light work, completes on its verify", () => {
  assert.equal(taskChangeIssue({ workTypes: ["feature"], task, changedPaths: ["src/api/x.js"] }), null);
  assert.equal(taskChangeIssue({ workTypes: ["docs"], task, changedPaths: [] }), null);
  assert.equal(taskChangeIssue({ workTypes: ["feature"], task: { ...task, kind: "verification" },
    changedPaths: [] }), null);
});
