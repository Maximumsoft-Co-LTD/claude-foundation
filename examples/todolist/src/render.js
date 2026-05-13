// DOM rendering + event wiring against the store.
//
// Responsibilities:
//   * render(state, root)         — rebuild the list, footer, empty state
//   * bindEvents(store, root)     — wire form, list, filters, clear-completed
//
// Anything else (localStorage, store creation) lives in main.js.

import { getActiveCount, getDoneCount, getVisibleTasks } from './store.js';

// Tracks the task currently in edit mode, if any. Lives in module scope
// because the list is rebuilt on every render — we restore the editing UI
// on the next render after dispatching the edit.
let editingId = null;

export function render(state, root) {
  const list = root.querySelector('#task-list');
  const empty = root.querySelector('#empty-state');
  const footer = root.querySelector('#app-footer');
  const activeCountEl = root.querySelector('#active-count');
  const clearCompletedBtn = root.querySelector('#clear-completed');

  const visible = getVisibleTasks(state);
  list.replaceChildren(...visible.map((task) => buildTaskNode(task)));

  const isEmpty = state.tasks.length === 0;
  empty.hidden = !isEmpty;
  footer.hidden = isEmpty;

  const activeCount = getActiveCount(state);
  activeCountEl.textContent =
    activeCount === 1 ? '1 task left' : `${activeCount} tasks left`;

  for (const btn of root.querySelectorAll('.filter')) {
    btn.classList.toggle('is-active', btn.dataset.filter === state.filter);
    btn.setAttribute(
      'aria-selected',
      btn.dataset.filter === state.filter ? 'true' : 'false',
    );
  }

  const doneCount = getDoneCount(state);
  clearCompletedBtn.hidden = doneCount === 0;

  // If a row is in edit mode, re-focus its input so re-render doesn't kick
  // the user out of editing on every keystroke that happens to dispatch.
  if (editingId) {
    const editingNode = list.querySelector(
      `.task[data-id="${cssEscape(editingId)}"] .edit-input`,
    );
    if (editingNode) {
      editingNode.focus();
      // Place caret at end.
      const len = editingNode.value.length;
      editingNode.setSelectionRange(len, len);
    } else {
      // Task vanished (filter switch or delete) — drop the editing pointer.
      editingId = null;
    }
  }
}

function buildTaskNode(task) {
  const li = document.createElement('li');
  li.className = 'task' + (task.done ? ' done' : '');
  li.dataset.id = task.id;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.done;
  checkbox.setAttribute('aria-label', `Mark "${task.text}" as done`);
  checkbox.dataset.action = 'toggle';

  li.appendChild(checkbox);

  if (editingId === task.id) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-input';
    input.value = task.text;
    input.dataset.action = 'edit-input';
    input.setAttribute('aria-label', 'Edit task');
    li.appendChild(input);
  } else {
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = task.text;
    label.dataset.action = 'edit-start';
    label.title = 'Double-click to edit';
    li.appendChild(label);
  }

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'delete-btn';
  del.dataset.action = 'delete';
  del.setAttribute('aria-label', `Delete "${task.text}"`);
  del.textContent = '×';
  li.appendChild(del);

  return li;
}

export function bindEvents(store, root) {
  // --- Add new task --------------------------------------------------------
  const form = root.querySelector('#new-task-form');
  const input = root.querySelector('#new-task-input');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value;
    store.dispatch({ type: 'add', text });
    input.value = '';
    input.focus();
  });

  // --- List actions (delegated) -------------------------------------------
  const list = root.querySelector('#task-list');
  list.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest('.task');
    if (!row) return;
    const id = row.dataset.id;
    if (!id) return;
    const action = target.dataset.action;
    if (action === 'toggle') {
      store.dispatch({ type: 'toggle', id });
    } else if (action === 'delete') {
      // If we were editing this row, drop the pointer first so the next
      // render doesn't try to re-focus a removed input.
      if (editingId === id) editingId = null;
      store.dispatch({ type: 'delete', id });
    }
  });

  list.addEventListener('dblclick', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.dataset.action !== 'edit-start') return;
    const row = target.closest('.task');
    if (!row) return;
    editingId = row.dataset.id || null;
    // Re-render to swap in the input; the renderer focuses it.
    render(store.getState(), root);
  });

  list.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.action !== 'edit-input') return;
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEdit(store, root, target);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit(store, root);
    }
  });

  list.addEventListener(
    'blur',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.action !== 'edit-input') return;
      // If Enter already committed (and cleared editingId) this is a no-op.
      if (!editingId) return;
      commitEdit(store, root, target);
    },
    true, // capture: blur doesn't bubble
  );

  // --- Filters -------------------------------------------------------------
  const footer = root.querySelector('#app-footer');
  footer.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const filter = target.dataset.filter;
    if (!filter) return;
    store.dispatch({ type: 'setFilter', filter });
  });

  // --- Clear completed -----------------------------------------------------
  const clearBtn = root.querySelector('#clear-completed');
  clearBtn.addEventListener('click', () => {
    store.dispatch({ type: 'clearCompleted' });
  });
}

function commitEdit(store, root, inputEl) {
  const row = inputEl.closest('.task');
  if (!row) return;
  const id = row.dataset.id;
  if (!id) return;
  const text = inputEl.value.trim();
  const previousEditingId = editingId;
  // Clear before dispatch so the blur path triggered by re-render doesn't
  // re-commit a second time.
  editingId = null;
  if (text.length === 0) {
    // Empty edit cancels rather than deletes; the user has a delete button.
    render(store.getState(), root);
    return;
  }
  store.dispatch({ type: 'edit', id: previousEditingId || id, text });
}

function cancelEdit(store, root) {
  editingId = null;
  render(store.getState(), root);
}

// Tiny CSS.escape polyfill for the rare browser without it. Used only to
// build a safe selector from a task id.
function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}
