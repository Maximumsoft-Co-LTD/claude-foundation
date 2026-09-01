/**
 * Regression tests — review-fix cycle 1
 *
 * B1: mid-session localStorage quota-exceeded → onDegrade fires → banner shown,
 *     mutation retained in-memory, banner appears exactly once across multiple fails.
 *
 * N1: deleting the last todo bearing the active tag filter resets _tagFilter
 *     to '' (All), so the visible list and tag-filter control are not stuck.
 */
import { initApp, addTodoViaForm } from './helpers.js';

beforeEach(async () => {
  await initApp();
});

// ─── B1: mid-session quota-exceeded triggers onDegrade → banner ───────────────
describe('B1 — mid-session storage degrade (FR-001)', () => {
  /**
   * Scenario:
   *  1. Storage works at init → Store.init() returns true → onDegrade(cb) registered.
   *  2. First add succeeds (setItem ok) → no banner.
   *  3. setItem is stubbed to throw QuotaExceededError.
   *  4. Second add triggers _save() which throws → onDegrade fires → banner shows.
   *  5. The second todo is retained in-memory (Store.getAll() has both).
   *  6. Further saves (toggle) don't fire the banner again (one-shot).
   */
  test('banner appears after a mid-session setItem throw, mutation is retained, banner fires exactly once', async () => {
    const { Store: S } = await import('../../app.js');

    // Sanity: storage is OK at this point (setup-env.js provides MemoryStorage)
    expect(S.isStorageAvailable()).toBe(true);

    // First add succeeds — no banner yet
    addTodoViaForm('First todo');
    const banner = document.getElementById('storage-banner');
    expect(banner).not.toBeNull();
    expect(banner.classList.contains('hidden')).toBe(true); // still hidden

    // Count how many times the banner transitions from hidden→visible via MutationObserver
    let bannerShowCount = 0;
    const observer = new MutationObserver(() => {
      if (!banner.classList.contains('hidden')) {
        bannerShowCount++;
      }
    });
    observer.observe(banner, { attributes: true, attributeFilter: ['class'] });

    // Stub setItem to throw from now on (quota exceeded mid-session)
    const storagePrototype = Object.getPrototypeOf(globalThis.localStorage);
    const setItemSpy = vi.spyOn(storagePrototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });

    try {
      // Second add → _save() throws → onDegrade fires → banner should appear
      addTodoViaForm('Second todo');

      // (a) banner is now visible in the DOM
      expect(banner.classList.contains('hidden')).toBe(false);

      // (b) both todos retained in-memory (no silent loss)
      const todos = S.getAll();
      expect(todos).toHaveLength(2);
      expect(todos.some(t => t.title === 'Second todo')).toBe(true);

      // (c) banner fires exactly once — subsequent failed saves must not re-show it.
      // Hide the banner manually to simulate a "re-show" attempt, then trigger saves.
      banner.classList.add('hidden');
      bannerShowCount = 0; // reset counter after the first legitimate show

      // Trigger further saves: toggle + another add
      const checkbox = document.querySelector('.todo-item__checkbox');
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      addTodoViaForm('Third todo');

      // onDegrade was one-shot: subsequent _save() failures must NOT call showStorageBanner
      expect(bannerShowCount).toBe(0);
    } finally {
      observer.disconnect();
      setItemSpy.mockRestore();
    }
  });
});

// ─── N1: tag-filter desync — deleting last todo with active tag resets filter ──
describe('N1 — tag-filter desync on last-tagged-todo delete', () => {
  test('deleting the last todo for the active tag resets filter to All and shows remaining todos', async () => {
    const { App: A } = await import('../../app.js');

    // Two todos: one tagged 'work', one tagged 'home'
    addTodoViaForm('Work task', { tag: 'work' });
    addTodoViaForm('Home task', { tag: 'home' });

    // Activate the 'work' tag filter
    const tagFilter = document.getElementById('tag-filter');
    tagFilter.value = 'work';
    tagFilter.dispatchEvent(new Event('change', { bubbles: true }));

    // Only the work todo should be visible
    expect(document.querySelectorAll('#todo-list .todo-item')).toHaveLength(1);
    // Internal state confirms filter is active
    expect(A.getTagFilter()).toBe('work');

    // Delete the last (only) 'work' todo
    const deleteBtn = document.querySelector('.btn--icon[aria-label^="Delete todo: Work task"]');
    deleteBtn.click();

    // (a) _tagFilter reset to '' (All)
    expect(A.getTagFilter()).toBe('');

    // (b) tag-filter <select> shows All (value '')
    expect(document.getElementById('tag-filter').value).toBe('');

    // (c) visible list is not stuck empty — 'home' todo is shown
    const visible = document.querySelectorAll('#todo-list .todo-item');
    expect(visible).toHaveLength(1);
    expect(visible[0].textContent).toContain('Home task');
  });
});
