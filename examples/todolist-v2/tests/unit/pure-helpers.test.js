/**
 * Unit tests — pure helper functions
 * AC1(boundary), AC6, AC7, AC3(boundary), AC14(count), AC15(boundary),
 * AC18, AC19, FR-005, AC5/FR-001 fallback logic
 */
import {
  validateTitle,
  validateEditTitle,
  createTodo,
  updateTodo,
  clearCompleted,
  sortByDueDate,
  sortByPriority,
  formatCount,
  Store,
} from '../../app.js';

// Reset Store state before each test that touches it
afterEach(() => {
  if (typeof localStorage !== 'undefined') localStorage.clear();
  Store._reset();
});

// ─── AC1 boundary: whitespace trimming ───────────────────────────────────────
describe('createTodo — AC1 boundary: title trimming', () => {
  test('strips leading/trailing whitespace before storage', () => {
    const todo = createTodo({ title: '  buy milk  ' });
    expect(todo.title).toBe('buy milk');
  });

  test('assigns a unique id to each todo', () => {
    const a = createTodo({ title: 'a' });
    const b = createTodo({ title: 'b' });
    expect(a.id).toBeTruthy();
    expect(b.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  test('defaults completed to false', () => {
    const todo = createTodo({ title: 'task' });
    expect(todo.completed).toBe(false);
  });
});

// ─── AC6: empty / whitespace validation ──────────────────────────────────────
describe('validateTitle — AC6: empty/whitespace rejection', () => {
  test('rejects empty string', () => {
    const r = validateTitle('');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  test('rejects whitespace-only string', () => {
    const r = validateTitle('   ');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  test('accepts a non-empty title', () => {
    const r = validateTitle('buy milk');
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
  });
});

// ─── AC7: max-length boundary ────────────────────────────────────────────────
describe('validateTitle — AC7: max-length 200', () => {
  test('accepts title at exactly 200 chars', () => {
    const r = validateTitle('x'.repeat(200));
    expect(r.ok).toBe(true);
  });

  test('rejects title at 201 chars', () => {
    const r = validateTitle('x'.repeat(201));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/200/);
  });
});

// ─── AC3 boundary: updateTodo preserves identity fields ──────────────────────
describe('updateTodo — AC3: immutable-style patch', () => {
  test('returns todo with updated title, preserving id and createdAt', () => {
    const original = createTodo({ title: 'original' });
    const updated = updateTodo(original, { title: 'new title' });
    expect(updated.title).toBe('new title');
    expect(updated.id).toBe(original.id);
    expect(updated.createdAt).toBe(original.createdAt);
  });

  test('does not mutate the original todo', () => {
    const original = createTodo({ title: 'original' });
    updateTodo(original, { title: 'new title' });
    expect(original.title).toBe('original');
  });
});

// ─── AC14: formatCount — singular/plural ─────────────────────────────────────
describe('formatCount — AC14: live count display', () => {
  test('0 → "0 items left"', () => {
    expect(formatCount(0)).toBe('0 items left');
  });

  test('1 → "1 item left" (singular)', () => {
    expect(formatCount(1)).toBe('1 item left');
  });

  test('3 → "3 items left"', () => {
    expect(formatCount(3)).toBe('3 items left');
  });

  test('2 → "2 items left"', () => {
    expect(formatCount(2)).toBe('2 items left');
  });
});

// ─── AC15 boundary: clearCompleted logic ─────────────────────────────────────
describe('clearCompleted — AC15: removes only completed todos', () => {
  test('removes completed todos, keeps active ones', () => {
    const todos = [
      createTodo({ title: 'active' }),
      updateTodo(createTodo({ title: 'done1' }), { completed: true }),
      updateTodo(createTodo({ title: 'done2' }), { completed: true }),
    ];
    const result = clearCompleted(todos);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('active');
  });

  test('returns empty array when all todos are completed', () => {
    const todos = [
      updateTodo(createTodo({ title: 'a' }), { completed: true }),
      updateTodo(createTodo({ title: 'b' }), { completed: true }),
    ];
    expect(clearCompleted(todos)).toHaveLength(0);
  });

  test('returns unchanged array when no todos are completed', () => {
    const todos = [createTodo({ title: 'a' }), createTodo({ title: 'b' })];
    expect(clearCompleted(todos)).toHaveLength(2);
  });
});

// ─── AC18: sortByDueDate ──────────────────────────────────────────────────────
describe('sortByDueDate — AC18: ascending, undated last', () => {
  test('sorts: earliest-dated first, undated last', () => {
    const early  = createTodo({ title: 'early',   dueDate: '2025-01-01' });
    const late   = createTodo({ title: 'late',    dueDate: '2025-12-31' });
    const undated = createTodo({ title: 'undated' });
    const result = sortByDueDate([undated, late, early]);
    expect(result[0].title).toBe('early');
    expect(result[1].title).toBe('late');
    expect(result[2].title).toBe('undated');
  });

  test('does not mutate the original array', () => {
    const todos = [
      createTodo({ title: 'b', dueDate: '2025-06-01' }),
      createTodo({ title: 'a', dueDate: '2025-01-01' }),
    ];
    sortByDueDate(todos);
    expect(todos[0].title).toBe('b');
  });
});

// ─── AC19: sortByPriority ─────────────────────────────────────────────────────
describe('sortByPriority — AC19: High → Medium → Low → none', () => {
  test('orders by priority weight descending', () => {
    const low    = createTodo({ title: 'low',    priority: 'Low'    });
    const none   = createTodo({ title: 'none'                       });
    const high   = createTodo({ title: 'high',   priority: 'High'   });
    const medium = createTodo({ title: 'medium', priority: 'Medium' });
    const result = sortByPriority([low, none, high, medium]);
    expect(result[0].title).toBe('high');
    expect(result[1].title).toBe('medium');
    expect(result[2].title).toBe('low');
    expect(result[3].title).toBe('none');
  });

  test('does not mutate the original array', () => {
    const todos = [createTodo({ title: 'a', priority: 'Low' })];
    sortByPriority(todos);
    expect(todos[0].title).toBe('a');
  });

  test('breaks equal-priority ties by due date with undated items last', () => {
    const early = createTodo({
      title: 'early', priority: 'Medium', dueDate: '2025-01-01'
    });
    const sameEarly = createTodo({
      title: 'same early', priority: 'Medium', dueDate: '2025-01-01'
    });
    const late = createTodo({
      title: 'late', priority: 'Medium', dueDate: '2025-12-31'
    });
    const undated = createTodo({ title: 'undated', priority: 'Medium' });

    expect(sortByPriority([late, early]).map(todo => todo.title)).toEqual([
      'early', 'late'
    ]);
    expect(sortByPriority([early, late]).map(todo => todo.title)).toEqual([
      'early', 'late'
    ]);
    expect(sortByPriority([undated, early]).map(todo => todo.title)).toEqual([
      'early', 'undated'
    ]);
    expect(sortByPriority([early, undated]).map(todo => todo.title)).toEqual([
      'early', 'undated'
    ]);
    expect(sortByPriority([sameEarly, early]).map(todo => todo.title)).toEqual([
      'same early', 'early'
    ]);
  });
});

// ─── FR-005: validateEditTitle — edit save to empty/whitespace ───────────────
describe('validateEditTitle — FR-005: edit empty/whitespace rejection', () => {
  test('rejects empty string in edit context', () => {
    const r = validateEditTitle('');
    expect(r.ok).toBe(false);
  });

  test('rejects whitespace-only string in edit context', () => {
    const r = validateEditTitle('   ');
    expect(r.ok).toBe(false);
  });

  test('accepts a valid non-empty title in edit context', () => {
    const r = validateEditTitle('valid title');
    expect(r.ok).toBe(true);
  });
});

// ─── AC5 / FR-001: Store in-memory fallback when localStorage unavailable ────
describe('Store — AC5/FR-001: localStorage fallback', () => {
  test('operations succeed against in-memory array when setItem throws QuotaExceededError', () => {
    // jsdom's localStorage may not be available in all vitest configs;
    // install a minimal stub on globalThis so Store._testStorage() sees it and can throw.
    const originalLS = globalThis.localStorage;
    const throwingStorage = {
      setItem: () => { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); },
      getItem: () => null,
      removeItem: () => {},
      clear: () => {},
      length: 0,
      key: () => null,
    };
    globalThis.localStorage = throwingStorage;

    // Re-init Store so it detects storage unavailable
    Store._reset();
    const storageOk = Store.init();

    // Storage should be detected as unavailable
    expect(storageOk).toBe(false);
    expect(Store.isStorageAvailable()).toBe(false);

    // But add/getAll operations must still work in-memory
    Store.add({ title: 'in-memory task' });
    const todos = Store.getAll();
    expect(todos).toHaveLength(1);
    expect(todos[0].title).toBe('in-memory task');

    // Update also works
    const id = todos[0].id;
    Store.update(id, { completed: true });
    expect(Store.getAll()[0].completed).toBe(true);

    // Delete works
    Store.remove(id);
    expect(Store.getAll()).toHaveLength(0);

    // Restore
    globalThis.localStorage = originalLS;
  });
});
