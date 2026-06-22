/**
 * Integration tests — CRUD + persistence
 * AC1, AC2, AC3, AC4, AC5, AC6, AC7, FR-005, AC5/FR-001 banner
 */
import { initApp, addTodoViaForm, submitAddForm } from './helpers.js';

// Each test gets a fresh DOM + fresh Store
beforeEach(async () => {
  await initApp();
});

// ─── AC1: add todo ────────────────────────────────────────────────────────────
describe('AC1 — add todo (happy path)', () => {
  test('submitting a non-empty title appends one item to the DOM', () => {
    addTodoViaForm('Buy milk');
    const items = document.querySelectorAll('#todo-list .todo-item');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('Buy milk');
  });

  test('item count increments by 1 after adding', () => {
    addTodoViaForm('Buy milk');
    const countEl = document.getElementById('active-count');
    expect(countEl.textContent).toBe('1 item left');
  });
});

// ─── AC2: toggle complete ─────────────────────────────────────────────────────
describe('AC2 — toggle complete (happy path)', () => {
  test('clicking checkbox flips completed class and updates count', () => {
    addTodoViaForm('Task A');
    const checkbox = document.querySelector('.todo-item__checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    const li = document.querySelector('.todo-item');
    expect(li.classList.contains('completed')).toBe(true);

    const countEl = document.getElementById('active-count');
    expect(countEl.textContent).toBe('0 items left');
  });

  test('second click restores active state and increments count', () => {
    addTodoViaForm('Task A');
    const checkbox = document.querySelector('.todo-item__checkbox');

    // toggle on
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    // toggle off — need fresh reference after re-render
    const checkbox2 = document.querySelector('.todo-item__checkbox');
    checkbox2.checked = false;
    checkbox2.dispatchEvent(new Event('change', { bubbles: true }));

    const li = document.querySelector('.todo-item');
    expect(li.classList.contains('completed')).toBe(false);
    const countEl = document.getElementById('active-count');
    expect(countEl.textContent).toBe('1 item left');
  });
});

// ─── AC3: inline edit ────────────────────────────────────────────────────────
describe('AC3 — inline edit (happy path)', () => {
  test('activating edit, typing new title and saving updates displayed text', () => {
    addTodoViaForm('Original title');
    const editBtn = document.querySelector('.btn--icon[aria-label^="Edit todo"]');
    editBtn.click();

    const editInput = document.querySelector('.todo-item__edit-input');
    editInput.value = 'Updated title';
    editInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    const titleEl = document.querySelector('.todo-item__title');
    expect(titleEl.textContent).toBe('Updated title');
  });
});

// ─── AC4: delete ─────────────────────────────────────────────────────────────
describe('AC4 — delete (happy path)', () => {
  test('clicking delete removes item from DOM and decrements count', () => {
    addTodoViaForm('To delete');
    addTodoViaForm('To keep');

    const deleteBtn = document.querySelector('.btn--icon[aria-label^="Delete todo: To delete"]');
    deleteBtn.click();

    const items = document.querySelectorAll('#todo-list .todo-item');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('To keep');

    const countEl = document.getElementById('active-count');
    expect(countEl.textContent).toBe('1 item left');
  });
});

// ─── AC5: persistence round-trip ─────────────────────────────────────────────
describe('AC5 — persistence round-trip', () => {
  test('seeding localStorage and re-initialising restores all todo attributes', async () => {
    const seed = [{
      id:        'seed-1',
      title:     'Persisted task',
      completed: true,
      createdAt: 1700000000000,
      dueDate:   '2025-12-31',
      priority:  'High',
      tag:       'work',
    }];
    // Use localStorage (jsdom) not the Node global which may be unavailable
    localStorage.setItem('todos_v1', JSON.stringify(seed));

    // Re-init simulates a page reload
    const { Store: S } = await import('../../app.js');
    S._reset();
    S.init();

    const todos = S.getAll();
    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe('Persisted task');
    expect(todos[0].completed).toBe(true);
    expect(todos[0].dueDate).toBe('2025-12-31');
    expect(todos[0].priority).toBe('High');
    expect(todos[0].tag).toBe('work');
  });
});

// ─── AC6: empty / whitespace submit ──────────────────────────────────────────
describe('AC6 — empty/whitespace submission', () => {
  test('submitting empty input shows a visible error element', () => {
    document.getElementById('add-title').value = '';
    submitAddForm();

    const errEl = document.getElementById('add-title-error');
    expect(errEl.classList.contains('hidden')).toBe(false);
    expect(errEl.textContent).toBeTruthy();
  });

  test('submitting whitespace-only input shows a visible error element', () => {
    document.getElementById('add-title').value = '   ';
    submitAddForm();

    const errEl = document.getElementById('add-title-error');
    expect(errEl.classList.contains('hidden')).toBe(false);
  });

  test('no todo is created when empty input is submitted', () => {
    submitAddForm();
    expect(document.querySelectorAll('#todo-list .todo-item')).toHaveLength(0);
  });
});

// ─── AC7: max-length visible feedback ────────────────────────────────────────
describe('AC7 — max-length visible feedback', () => {
  test('submitting 201-char title renders a visible error', () => {
    document.getElementById('add-title').value = 'x'.repeat(201);
    submitAddForm();

    const errEl = document.getElementById('add-title-error');
    expect(errEl.classList.contains('hidden')).toBe(false);
    expect(errEl.textContent).toMatch(/200/);
  });

  test('submitting exactly 200-char title succeeds — no error shown', () => {
    document.getElementById('add-title').value = 'y'.repeat(200);
    submitAddForm();

    const errEl = document.getElementById('add-title-error');
    expect(errEl.classList.contains('hidden')).toBe(true);
    expect(document.querySelectorAll('#todo-list .todo-item')).toHaveLength(1);
  });
});

// ─── FR-005: edit save to empty/whitespace ───────────────────────────────────
describe('FR-005 — edit save to empty/whitespace (DOM)', () => {
  test('clearing the title in edit mode and pressing Enter does NOT update displayed text', () => {
    addTodoViaForm('Keep this title');
    const editBtn = document.querySelector('.btn--icon[aria-label^="Edit todo"]');
    editBtn.click();

    const editInput = document.querySelector('.todo-item__edit-input');
    editInput.value = '';
    editInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    const titleEl = document.querySelector('.todo-item__title');
    expect(titleEl.textContent).toBe('Keep this title');
  });

  test('whitespace-only edit title does NOT update displayed text', () => {
    addTodoViaForm('Stay the same');
    const editBtn = document.querySelector('.btn--icon[aria-label^="Edit todo"]');
    editBtn.click();

    const editInput = document.querySelector('.todo-item__edit-input');
    editInput.value = '    ';
    editInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    const titleEl = document.querySelector('.todo-item__title');
    expect(titleEl.textContent).toBe('Stay the same');
  });
});

// ─── AC5/FR-001: storage banner shown when localStorage unavailable ───────────
describe('AC5/FR-001 — storage banner (integration)', () => {
  test('banner is visible when app inits with localStorage throwing', async () => {
    const { Store: S, App: A } = await import('../../app.js');

    // Stub localStorage (jsdom) to throw on setItem so Store detects unavailability
    const origSetItem = localStorage.setItem.bind(localStorage);
    const origGetItem = localStorage.getItem.bind(localStorage);
    localStorage.setItem = () => { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); };
    localStorage.getItem = () => null;

    S._reset();
    const { bootstrapApp } = await import('./helpers.js');
    await bootstrapApp();

    A.init();

    const banner = document.getElementById('storage-banner');
    expect(banner).not.toBeNull();
    expect(banner.classList.contains('hidden')).toBe(false);

    // Restore
    localStorage.setItem = origSetItem;
    localStorage.getItem = origGetItem;
  });

  test('add/toggle/delete remain functional after banner is shown', async () => {
    const { Store: S, App: A } = await import('../../app.js');
    const origSetItem = localStorage.setItem.bind(localStorage);
    const origGetItem = localStorage.getItem.bind(localStorage);
    localStorage.setItem = () => { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); };
    localStorage.getItem = () => null;

    S._reset();
    const { bootstrapApp, addTodoViaForm: addViaForm } = await import('./helpers.js');
    await bootstrapApp();
    A.init();

    // add todo
    addViaForm('In-memory task');
    let items = document.querySelectorAll('#todo-list .todo-item');
    expect(items).toHaveLength(1);

    // toggle
    const checkbox = document.querySelector('.todo-item__checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    const countEl = document.getElementById('active-count');
    expect(countEl.textContent).toBe('0 items left');

    // delete
    const delBtn = document.querySelector('.btn--icon[aria-label^="Delete todo"]');
    delBtn.click();
    expect(document.querySelectorAll('#todo-list .todo-item')).toHaveLength(0);

    localStorage.setItem = origSetItem;
    localStorage.getItem = origGetItem;
  });
});
