/**
 * Integration tests — filter, count, clear completed
 * AC11, AC12, AC13, AC14, AC15, AC16
 */
import { initApp, addTodoViaForm } from './helpers.js';

beforeEach(async () => {
  await initApp();
});

/** Helper: add N todos and complete the first `completeCount` of them.
 * Re-queries the checkbox list after each toggle because App._render()
 * replaces all DOM nodes on every state change.
 */
function seedAndComplete(titles, completeCount) {
  titles.forEach(t => addTodoViaForm(t));

  for (let i = 0; i < completeCount; i++) {
    // Re-query after each re-render: always take the first uncompleted checkbox
    const checkboxes = document.querySelectorAll('.todo-item__checkbox:not(:checked)');
    if (!checkboxes[0]) break;
    checkboxes[0].checked = true;
    checkboxes[0].dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/** Click a filter tab by data-filter value */
function clickFilter(filter) {
  const tab = document.querySelector(`[data-filter="${filter}"]`);
  tab.click();
}

// ─── AC11: Active filter ──────────────────────────────────────────────────────
describe('AC11 — Active filter', () => {
  test('shows only incomplete todos', () => {
    seedAndComplete(['A', 'B', 'C'], 2); // A+B completed, C active
    clickFilter('active');
    const visible = document.querySelectorAll('#todo-list .todo-item');
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toContain('C');
  });
});

// ─── AC12: Completed filter ───────────────────────────────────────────────────
describe('AC12 — Completed filter', () => {
  test('shows only completed todos', () => {
    seedAndComplete(['A', 'B', 'C'], 2);
    clickFilter('completed');
    const visible = document.querySelectorAll('#todo-list .todo-item');
    expect(visible).toHaveLength(2);
  });
});

// ─── AC13: All filter restores full list ──────────────────────────────────────
describe('AC13 — All filter', () => {
  test('restores all todos after Active filter was applied', () => {
    seedAndComplete(['A', 'B', 'C'], 2);
    clickFilter('active');
    clickFilter('all');
    const visible = document.querySelectorAll('#todo-list .todo-item');
    expect(visible).toHaveLength(3);
  });
});

// ─── AC14: live count ─────────────────────────────────────────────────────────
describe('AC14 — live count', () => {
  test('"1 item left" when 1 of 3 is active', () => {
    seedAndComplete(['A', 'B', 'C'], 2);
    const count = document.getElementById('active-count');
    expect(count.textContent).toBe('1 item left');
  });

  test('count updates immediately on toggle', () => {
    addTodoViaForm('X');
    const count = document.getElementById('active-count');
    expect(count.textContent).toBe('1 item left');

    const checkbox = document.querySelector('.todo-item__checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('active-count').textContent).toBe('0 items left');
  });
});

// ─── AC15: clear completed ────────────────────────────────────────────────────
describe('AC15 — clear completed', () => {
  test('removes all completed todos from DOM and localStorage', () => {
    seedAndComplete(['A', 'B', 'C'], 2);

    const clearBtn = document.getElementById('clear-completed');
    clearBtn.click();

    const items = document.querySelectorAll('#todo-list .todo-item');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('C');

    // Verify localStorage also updated (use localStorage for jsdom)
    const stored = JSON.parse(localStorage.getItem('todos_v1') || '[]');
    expect(stored.every(t => !t.completed)).toBe(true);
  });
});

// ─── AC16: clear completed hidden when none ───────────────────────────────────
describe('AC16 — clear completed hidden when no completed todos', () => {
  test('clear-completed button is hidden when all todos are active', () => {
    addTodoViaForm('Active');
    const clearBtn = document.getElementById('clear-completed');
    expect(clearBtn.classList.contains('hidden')).toBe(true);
  });

  test('clear-completed button appears when a todo is completed', () => {
    addTodoViaForm('Active');
    const checkbox = document.querySelector('.todo-item__checkbox');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    const clearBtn = document.getElementById('clear-completed');
    expect(clearBtn.classList.contains('hidden')).toBe(false);
  });
});
