import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";
import { bindEvents, render } from "../src/render.js";
import { createStore } from "../src/store.js";

function fixture() {
  const window = new Window();
  window.document.body.innerHTML = `
    <main id="app">
      <form id="new-task-form"><input id="new-task-input"></form>
      <ul id="task-list"></ul><p id="empty-state"></p>
      <footer id="app-footer">
        <span id="active-count"></span>
        <button class="filter" data-filter="all"></button>
        <button class="filter" data-filter="active"></button>
        <button class="filter" data-filter="done"></button>
        <button id="clear-completed"></button>
      </footer>
    </main>`;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  globalThis.CSS = window.CSS;
  return { window, root: window.document.getElementById("app") };
}

function setup() {
  const { window, root } = fixture();
  let nextId = 0;
  const store = createStore({}, {
    idFactory: () => `task-${nextId += 1}`,
    clock: () => nextId
  });
  store.subscribe((state) => render(state, root));
  bindEvents(store, root);
  render(store.getState(), root);
  return { window, root, store };
}

test("renderer wires add, toggle, filters, clear, and delete transitions", () => {
  const { window, root, store } = setup();
  const input = root.querySelector("#new-task-input");
  input.value = "first";
  root.querySelector("#new-task-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true })
  );
  input.value = "second";
  root.querySelector("#new-task-form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true })
  );
  assert.equal(root.querySelectorAll(".task").length, 2);
  assert.equal(root.querySelector("#active-count").textContent, "2 tasks left");

  root.querySelector('[data-id="task-1"] [data-action="toggle"]').click();
  assert.equal(store.getState().tasks[0].done, true);
  root.querySelector('[data-filter="done"]').click();
  assert.equal(root.querySelectorAll(".task").length, 1);
  root.querySelector("#clear-completed").click();
  assert.equal(store.getState().tasks.length, 1);
  root.querySelector('[data-filter="all"]').click();
  root.querySelector('[data-action="delete"]').click();
  assert.equal(store.getState().tasks.length, 0);
  assert.equal(root.querySelector("#empty-state").hidden, false);
});

test("renderer commits, cancels, and blurs inline edits", () => {
  const { window, root, store } = setup();
  store.dispatch({ type: "add", text: "original" });

  root.querySelector('[data-action="edit-start"]').dispatchEvent(
    new window.MouseEvent("dblclick", { bubbles: true })
  );
  let edit = root.querySelector(".edit-input");
  edit.value = "changed";
  edit.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(store.getState().tasks[0].text, "changed");

  root.querySelector('[data-action="edit-start"]').dispatchEvent(
    new window.MouseEvent("dblclick", { bubbles: true })
  );
  edit = root.querySelector(".edit-input");
  edit.value = "cancelled";
  edit.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(store.getState().tasks[0].text, "changed");

  root.querySelector('[data-action="edit-start"]').dispatchEvent(
    new window.MouseEvent("dblclick", { bubbles: true })
  );
  edit = root.querySelector(".edit-input");
  edit.value = "blurred";
  edit.dispatchEvent(new window.FocusEvent("blur", { bubbles: false }));
  assert.equal(store.getState().tasks[0].text, "blurred");

  root.querySelector('[data-action="edit-start"]').dispatchEvent(
    new window.MouseEvent("dblclick", { bubbles: true })
  );
  edit = root.querySelector(".edit-input");
  edit.value = "   ";
  edit.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(store.getState().tasks[0].text, "blurred");
});
