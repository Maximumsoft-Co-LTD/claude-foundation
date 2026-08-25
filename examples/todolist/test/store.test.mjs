import assert from "node:assert/strict";
import test from "node:test";
import {
  createStore,
  getActiveCount,
  getDoneCount,
  getVisibleTasks,
  isValidFilter,
  sanitiseState
} from "../src/store.js";

test("store covers add, edit, toggle, filters, delete and clear transitions", () => {
  let id = 0;
  const store = createStore({}, { idFactory: () => `id-${++id}`, clock: () => 42 });
  const observed = [];
  const unsubscribe = store.subscribe((state) => observed.push(state));
  store.dispatch({ type: "add", text: "  first  " });
  store.dispatch({ type: "add", text: "second" });
  store.dispatch({ type: "toggle", id: "id-1" });
  store.dispatch({ type: "edit", id: "id-2", text: "updated" });
  store.dispatch({ type: "setFilter", filter: "done" });
  assert.deepEqual(getVisibleTasks(store.getState()).map((item) => item.id), ["id-1"]);
  assert.equal(getActiveCount(store.getState()), 1);
  assert.equal(getDoneCount(store.getState()), 1);
  store.dispatch({ type: "clearCompleted" });
  store.dispatch({ type: "delete", id: "id-2" });
  unsubscribe();
  assert.equal(observed.length, 7);
  assert.deepEqual(store.getState().tasks, []);
});

test("invalid input is rejected without notifying subscribers", () => {
  const store = createStore();
  let calls = 0;
  store.subscribe(() => calls++);
  assert.throws(() => store.subscribe(null), /expects a function/);
  store.dispatch({ type: "add", text: "   " });
  store.dispatch({ type: "setFilter", filter: "unknown" });
  store.dispatch({ type: "unknown" });
  assert.equal(calls, 0);
  assert.equal(isValidFilter("active"), true);
  assert.equal(isValidFilter("unknown"), false);
});

test("untrusted persisted state is sanitized and replace uses the same boundary", () => {
  assert.deepEqual(sanitiseState(null), { tasks: [], filter: "all" });
  const candidate = {
    filter: "bad",
    tasks: [
      { id: "ok", text: " task ", done: 1, createdAt: 10 },
      { id: "", text: "bad", createdAt: 10 },
      null
    ]
  };
  const store = createStore();
  store.dispatch({ type: "replace", state: candidate });
  assert.deepEqual(store.getState(), {
    filter: "all",
    tasks: [{ id: "ok", text: "task", done: true, createdAt: 10 }]
  });
  assert.deepEqual(getVisibleTasks({ filter: "all", tasks: [1, 2] }), [1, 2]);
  assert.deepEqual(getVisibleTasks(null), []);
  assert.equal(getActiveCount(null), 0);
  assert.equal(getDoneCount(null), 0);
});
