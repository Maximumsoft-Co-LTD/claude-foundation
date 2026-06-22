/**
 * Integration tests — due dates, priority, tags, persistence
 * AC17, AC20, AC21, AC22, AC23, AC24
 */
import { initApp, addTodoViaForm } from './helpers.js';

beforeEach(async () => {
  await initApp();
});

// ─── AC17: due date + priority saved and displayed ────────────────────────────
describe('AC17 — due date and priority saved and displayed', () => {
  test('adds todo with dueDate and priority; both stored and rendered', async () => {
    addTodoViaForm('Deadline task', { dueDate: '2025-12-31', priority: 'High' });

    const { Store } = await import('../../app.js');
    const todos = Store.getAll();
    expect(todos).toHaveLength(1);
    expect(todos[0].dueDate).toBe('2025-12-31');
    expect(todos[0].priority).toBe('High');

    // Priority chip rendered in DOM
    const chip = document.querySelector('.priority-chip');
    expect(chip).not.toBeNull();
    expect(chip.getAttribute('aria-label')).toContain('High');

    // Date rendered in DOM
    const dateEl = document.querySelector('.todo-item__date');
    expect(dateEl).not.toBeNull();
    expect(dateEl.textContent).toContain('Dec');
  });
});

// ─── AC20: due date + priority persist on reload ──────────────────────────────
describe('AC20 — due date + priority persist across reload', () => {
  test('re-initialising Store restores dueDate and priority', async () => {
    addTodoViaForm('Persisted', { dueDate: '2025-06-15', priority: 'Medium' });

    const { Store } = await import('../../app.js');
    Store._reset();
    Store.init();

    const todos = Store.getAll();
    expect(todos[0].dueDate).toBe('2025-06-15');
    expect(todos[0].priority).toBe('Medium');
  });
});

// ─── AC21: tag saved and displayed ───────────────────────────────────────────
describe('AC21 — tag saved and displayed', () => {
  test('adds todo with tag; tag stored and rendered as label', async () => {
    addTodoViaForm('Tag task', { tag: 'work' });

    const { Store } = await import('../../app.js');
    const todos = Store.getAll();
    expect(todos[0].tag).toBe('work');

    const tagEl = document.querySelector('.todo-item__tag');
    expect(tagEl).not.toBeNull();
    expect(tagEl.textContent).toContain('work');
  });
});

// ─── AC22: tag filter ────────────────────────────────────────────────────────
describe('AC22 — tag filter', () => {
  test('selecting tag "work" shows only work todos', () => {
    addTodoViaForm('Work task',  { tag: 'work' });
    addTodoViaForm('Home task',  { tag: 'home' });
    addTodoViaForm('No tag task');

    const tagFilter = document.getElementById('tag-filter');
    tagFilter.value = 'work';
    tagFilter.dispatchEvent(new Event('change', { bubbles: true }));

    const visible = document.querySelectorAll('#todo-list .todo-item');
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toContain('Work task');
  });
});

// ─── AC23: tag filter options reflect existing tags ───────────────────────────
describe('AC23 — tag filter options reflect existing tags', () => {
  test('deleting all work todos removes "work" from tag filter options', async () => {
    addTodoViaForm('Work task', { tag: 'work' });
    addTodoViaForm('Home task', { tag: 'home' });

    // Confirm "work" exists in dropdown
    const tagFilter = document.getElementById('tag-filter');
    expect(Array.from(tagFilter.options).map(o => o.value)).toContain('work');

    // Delete the work todo
    const deleteBtn = document.querySelector('.btn--icon[aria-label^="Delete todo: Work task"]');
    deleteBtn.click();

    // "work" option should be gone
    const updatedOptions = Array.from(document.getElementById('tag-filter').options).map(o => o.value);
    expect(updatedOptions).not.toContain('work');
    expect(updatedOptions).toContain('home');
  });
});

// ─── AC24: tag persists on reload ────────────────────────────────────────────
describe('AC24 — tag persists across reload', () => {
  test('re-initialising Store restores tag', async () => {
    addTodoViaForm('Tagged', { tag: 'home' });

    const { Store } = await import('../../app.js');
    Store._reset();
    Store.init();

    const todos = Store.getAll();
    expect(todos[0].tag).toBe('home');
  });
});
