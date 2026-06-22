/* ── Todo List App — app.js ────────────────────────────────────
 * Architecture:
 *   Store    — data + localStorage persistence
 *   Renderer — DOM manipulation (textContent / createElement only)
 *   App      — event wiring + controller logic
 *
 * Testable surface exposed on globalThis so vitest+jsdom can import.
 * Conditional module.exports guard below keeps file:// loads working.
 * ──────────────────────────────────────────────────────────────── */

'use strict';

/* ═══════════════════════════════════════════════════════════════
 *  Pure helpers (exported for unit testing)
 * ═══════════════════════════════════════════════════════════════ */

/** @returns {string} 'N item(s) left' */
function formatCount(n) {
  return n === 1 ? '1 item left' : n + ' items left';
}

/** Validate title for add. Returns {ok, error}. */
function validateTitle(raw) {
  var t = (raw || '').trim();
  if (!t) return { ok: false, error: "Title can't be empty." };
  if (t.length > 200) return { ok: false, error: 'Title must be 200 characters or fewer.' };
  return { ok: true, error: null };
}

/** Validate title for inline edit. Same rules, same signature. */
function validateEditTitle(raw) {
  return validateTitle(raw);
}

/** Build a fresh Todo object. */
function createTodo(fields) {
  return {
    id:        (typeof crypto !== 'undefined' && crypto.randomUUID)
                 ? crypto.randomUUID()
                 : Math.random().toString(36).slice(2),
    title:     (fields.title || '').trim(),
    completed: false,
    createdAt: Date.now(),
    dueDate:   fields.dueDate   || null,
    priority:  fields.priority  || null,
    tag:       fields.tag       || null,
  };
}

/** Return updated todo (immutable-style). */
function updateTodo(todo, patch) {
  return Object.assign({}, todo, patch);
}

/** Remove completed todos from array. Returns new array. */
function clearCompleted(todos) {
  return todos.filter(function(t) { return !t.completed; });
}

/* Priority weight for sort (High=3, Medium=2, Low=1, null=0) */
var PRIORITY_WEIGHT = { High: 3, Medium: 2, Low: 1 };
function priorityWeight(p) {
  return PRIORITY_WEIGHT[p] || 0;
}

/** Sort todos by due-date asc (undated last), ties by priority desc. */
function sortByDueDate(todos) {
  return todos.slice().sort(function(a, b) {
    var aDate = a.dueDate, bDate = b.dueDate;
    if (aDate && bDate) {
      if (aDate < bDate) return -1;
      if (aDate > bDate) return 1;
      return priorityWeight(b.priority) - priorityWeight(a.priority);
    }
    if (aDate && !bDate) return -1;
    if (!aDate && bDate) return 1;
    return priorityWeight(b.priority) - priorityWeight(a.priority);
  });
}

/** Sort todos by priority desc (High→Med→Low→none), ties by due-date asc. */
function sortByPriority(todos) {
  return todos.slice().sort(function(a, b) {
    var diff = priorityWeight(b.priority) - priorityWeight(a.priority);
    if (diff !== 0) return diff;
    var aDate = a.dueDate, bDate = b.dueDate;
    if (aDate && bDate) {
      if (aDate < bDate) return -1;
      if (aDate > bDate) return 1;
      return 0;
    }
    if (aDate && !bDate) return -1;
    if (!aDate && bDate) return 1;
    return 0;
  });
}

/* ═══════════════════════════════════════════════════════════════
 *  Store — data layer
 * ═══════════════════════════════════════════════════════════════ */
var STORAGE_KEY = 'todos_v1';

/* ponytail: migrate key if schema changes — bump version and remap old key */
var Store = (function() {
  var _todos = [];
  var _storageAvailable = false;
  /* Fires once on the first available→unavailable transition (mid-session quota). */
  var _onDegrade = null;

  function _testStorage() {
    try {
      var k = '__test__';
      localStorage.setItem(k, k);
      localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function _save() {
    if (!_storageAvailable) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_todos));
    } catch (e) {
      /* quota exceeded — degrade to in-memory; notify caller once */
      _storageAvailable = false;
      if (typeof _onDegrade === 'function') {
        var cb = _onDegrade;
        _onDegrade = null; /* one-shot */
        cb();
      }
    }
  }

  function _load() {
    if (!_storageAvailable) return;
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) _todos = JSON.parse(raw);
    } catch (e) {
      _todos = [];
    }
  }

  function init() {
    _storageAvailable = _testStorage();
    if (_storageAvailable) _load();
    return _storageAvailable;
  }

  function isStorageAvailable() {
    return _storageAvailable;
  }

  function getAll() {
    return _todos.slice();
  }

  function add(fields) {
    var todo = createTodo(fields);
    _todos.push(todo);
    _save();
    return todo;
  }

  function update(id, patch) {
    for (var i = 0; i < _todos.length; i++) {
      if (_todos[i].id === id) {
        _todos[i] = updateTodo(_todos[i], patch);
        _save();
        return _todos[i];
      }
    }
    return null;
  }

  function remove(id) {
    _todos = _todos.filter(function(t) { return t.id !== id; });
    _save();
  }

  function removeCompleted() {
    _todos = clearCompleted(_todos);
    _save();
  }

  return {
    init: init,
    isStorageAvailable: isStorageAvailable,
    getAll: getAll,
    add: add,
    update: update,
    remove: remove,
    removeCompleted: removeCompleted,
    /* Register a one-shot callback for the available→unavailable transition. */
    onDegrade: function(cb) { _onDegrade = cb; },
    /* expose internals for testing only */
    _reset: function() { _todos = []; _storageAvailable = false; _onDegrade = null; },
  };
})();

/* ═══════════════════════════════════════════════════════════════
 *  Renderer — DOM layer (textContent / createElement only)
 * ═══════════════════════════════════════════════════════════════ */
var Renderer = (function() {

  /* Date formatting: YYYY-MM-DD → human-readable */
  function _formatDate(dateStr) {
    if (!dateStr) return '';
    var parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var m = parseInt(parts[1], 10) - 1;
    return months[m] + ' ' + parseInt(parts[2], 10);
  }

  function _isOverdue(dateStr) {
    if (!dateStr) return false;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var due = new Date(dateStr + 'T00:00:00');
    return due < today;
  }

  /** Build a priority chip element. */
  function _makeChip(priority) {
    if (!priority) return null;
    var span = document.createElement('span');
    span.className = 'priority-chip priority-chip--' + priority.toLowerCase();
    span.setAttribute('aria-label', priority + ' priority');
    span.textContent = priority.toUpperCase().slice(0, 3); // HIGH / MED / LOW
    return span;
  }

  /** Build the view portion of a todo item (non-editing state). */
  function _buildItemView(todo) {
    var view = document.createElement('div');
    view.className = 'todo-item__view';

    /* Top row: priority chip + title */
    var top = document.createElement('div');
    top.className = 'todo-item__top';

    var chip = _makeChip(todo.priority);
    if (chip) top.appendChild(chip);

    var titleEl = document.createElement('span');
    titleEl.className = 'todo-item__title';
    titleEl.textContent = todo.title;
    top.appendChild(titleEl);

    view.appendChild(top);

    /* Meta row: date + tag */
    var hasMeta = todo.dueDate || todo.tag;
    if (hasMeta) {
      var meta = document.createElement('div');
      meta.className = 'todo-item__meta';

      if (todo.dueDate) {
        var dateEl = document.createElement('span');
        dateEl.className = 'todo-item__date';
        if (_isOverdue(todo.dueDate) && !todo.completed) {
          dateEl.classList.add('overdue');
        }
        dateEl.textContent = '📅 ' + _formatDate(todo.dueDate);
        meta.appendChild(dateEl);
      }

      if (todo.tag) {
        var tagEl = document.createElement('span');
        tagEl.className = 'todo-item__tag';
        tagEl.textContent = '🏷️ ' + todo.tag;
        meta.appendChild(tagEl);
      }

      view.appendChild(meta);
    }

    return view;
  }

  /** Build a single todo list item element. */
  function buildItem(todo, onToggle, onEdit, onDelete) {
    var li = document.createElement('li');
    li.className = 'todo-item' + (todo.completed ? ' completed' : '');
    li.dataset.id = todo.id;

    /* Checkbox */
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'todo-item__checkbox';
    checkbox.checked = todo.completed;
    checkbox.setAttribute('aria-label', (todo.completed ? 'Mark incomplete: ' : 'Mark complete: ') + todo.title);
    checkbox.addEventListener('change', function() { onToggle(todo.id); });
    li.appendChild(checkbox);

    /* Body */
    var body = document.createElement('div');
    body.className = 'todo-item__body';

    /* View state */
    var viewEl = _buildItemView(todo);
    body.appendChild(viewEl);

    /* Edit area (hidden until editing) */
    var editArea = document.createElement('div');
    editArea.className = 'todo-item__edit-area';

    var editInput = document.createElement('input');
    editInput.type = 'text';
    editInput.className = 'todo-item__edit-input';
    editInput.value = todo.title;
    editInput.setAttribute('aria-label', 'Edit todo title');
    editInput.setAttribute('aria-describedby', 'edit-error-' + todo.id);
    editArea.appendChild(editInput);

    var editError = document.createElement('div');
    editError.className = 'inline-error hidden';
    editError.id = 'edit-error-' + todo.id;
    editError.setAttribute('role', 'alert');
    editArea.appendChild(editError);

    var editActions = document.createElement('div');
    editActions.className = 'todo-item__edit-actions';

    var saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn--accent';
    saveBtn.textContent = '✔ Save';
    saveBtn.setAttribute('aria-label', 'Save edit');
    editActions.appendChild(saveBtn);

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--ghost';
    cancelBtn.textContent = '✖ Cancel';
    cancelBtn.setAttribute('aria-label', 'Cancel edit');
    editActions.appendChild(cancelBtn);

    editArea.appendChild(editActions);
    body.appendChild(editArea);

    li.appendChild(body);

    /* Action buttons (edit + delete) */
    var actions = document.createElement('div');
    actions.className = 'todo-item__actions';

    var editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn--icon';
    editBtn.setAttribute('aria-label', 'Edit todo: ' + todo.title);
    editBtn.textContent = '✎';
    actions.appendChild(editBtn);

    var deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn--icon';
    deleteBtn.setAttribute('aria-label', 'Delete todo: ' + todo.title);
    deleteBtn.textContent = '✕';
    actions.appendChild(deleteBtn);

    li.appendChild(actions);

    /* Edit open/save/cancel logic (wired here so closure holds the li ref) */
    function openEdit() {
      li.classList.add('editing');
      editInput.value = todo.title;
      editError.textContent = '';
      editError.classList.add('hidden');
      editInput.focus();
    }

    function closeEdit() {
      li.classList.remove('editing');
      editError.classList.add('hidden');
    }

    function trySave() {
      var v = validateEditTitle(editInput.value);
      if (!v.ok) {
        editInput.classList.remove('error');
        /* force reflow to restart animation */
        void editInput.offsetWidth;
        editInput.classList.add('error');
        editError.textContent = v.error;
        editError.classList.remove('hidden');
        return;
      }
      editInput.classList.remove('error');
      closeEdit();
      onEdit(todo.id, editInput.value.trim());
    }

    editBtn.addEventListener('click', openEdit);
    editBtn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); openEdit(); }
    });

    saveBtn.addEventListener('click', trySave);

    cancelBtn.addEventListener('click', closeEdit);

    editInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); trySave(); }
      if (e.key === 'Escape') { closeEdit(); }
    });

    deleteBtn.addEventListener('click', function() { onDelete(todo.id); });
    deleteBtn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDelete(todo.id); }
    });

    /* Double-click on view area to open edit (UX affordance) */
    viewEl.addEventListener('dblclick', openEdit);

    return li;
  }

  /** Render the full todo list into #todo-list. */
  function renderList(todos, onToggle, onEdit, onDelete) {
    var list = document.getElementById('todo-list');
    var emptyState = document.getElementById('empty-state');
    while (list.firstChild) list.removeChild(list.firstChild);

    if (todos.length === 0) {
      emptyState.classList.remove('hidden');
    } else {
      emptyState.classList.add('hidden');
      todos.forEach(function(todo) {
        list.appendChild(buildItem(todo, onToggle, onEdit, onDelete));
      });
    }
  }

  /** Update the count display in toolbar + footer. */
  function renderCount(activeCount) {
    var text = formatCount(activeCount);
    var toolbarCount = document.getElementById('active-count');
    if (toolbarCount) toolbarCount.textContent = text;
    var footerCount = document.getElementById('footer-count');
    if (footerCount) footerCount.textContent = text;
  }

  /** Show or hide the "Clear completed" button. */
  function renderClearCompleted(hasCompleted) {
    var btn = document.getElementById('clear-completed');
    if (!btn) return;
    if (hasCompleted) {
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }

  /** Rebuild the tag filter dropdown from current todos. */
  function renderTagFilter(todos, selectedTag) {
    var select = document.getElementById('tag-filter');
    if (!select) return;
    /* preserve selected value */
    var current = selectedTag !== undefined ? selectedTag : select.value;
    while (select.firstChild) select.removeChild(select.firstChild);

    var allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'All tags';
    select.appendChild(allOpt);

    var seen = {};
    todos.forEach(function(t) {
      if (t.tag && !seen[t.tag]) {
        seen[t.tag] = true;
        var opt = document.createElement('option');
        opt.value = t.tag;
        opt.textContent = t.tag;
        select.appendChild(opt);
      }
    });

    /* restore selection if still valid */
    if (current && seen[current]) {
      select.value = current;
    } else {
      select.value = '';
    }
  }

  /** Update active state on filter tabs. */
  function renderFilterTabs(activeFilter) {
    var tabs = document.querySelectorAll('.filter-tab');
    tabs.forEach(function(tab) {
      var isActive = tab.dataset.filter === activeFilter;
      tab.classList.toggle('filter-tab--active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });
  }

  /** Show/hide the storage banner. */
  function showStorageBanner() {
    var banner = document.getElementById('storage-banner');
    if (banner) banner.classList.remove('hidden');
  }

  return {
    renderList: renderList,
    renderCount: renderCount,
    renderClearCompleted: renderClearCompleted,
    renderTagFilter: renderTagFilter,
    renderFilterTabs: renderFilterTabs,
    showStorageBanner: showStorageBanner,
    buildItem: buildItem,
  };
})();

/* ═══════════════════════════════════════════════════════════════
 *  App — event wiring + controller
 * ═══════════════════════════════════════════════════════════════ */
var App = (function() {
  /* View state */
  var _filter   = 'all';   /* 'all' | 'active' | 'completed' */
  var _sortKey  = null;    /* null | 'date' | 'priority' */
  var _tagFilter = '';     /* '' = all tags */

  /* ── Apply filters + sort to raw todos → visible list ── */
  function _computeVisible(todos) {
    var filtered = todos.filter(function(t) {
      var statusOk =
        _filter === 'all'       ? true :
        _filter === 'active'    ? !t.completed :
        _filter === 'completed' ? t.completed :
        true;
      var tagOk = !_tagFilter || t.tag === _tagFilter;
      return statusOk && tagOk;
    });

    if (_sortKey === 'date') {
      return sortByDueDate(filtered);
    }
    if (_sortKey === 'priority') {
      return sortByPriority(filtered);
    }
    return filtered;
  }

  /* ── Central re-render call ── */
  function _render() {
    var all = Store.getAll();

    /* N1 fix: if active tag filter no longer exists on any todo, reset to 'all' */
    if (_tagFilter && !all.some(function(t) { return t.tag === _tagFilter; })) {
      _tagFilter = '';
    }

    var visible = _computeVisible(all);

    Renderer.renderList(visible, _onToggle, _onEdit, _onDelete);
    Renderer.renderCount(all.filter(function(t) { return !t.completed; }).length);
    Renderer.renderClearCompleted(all.some(function(t) { return t.completed; }));
    Renderer.renderTagFilter(all, _tagFilter);
    Renderer.renderFilterTabs(_filter);
    _updateSortButtons();
  }

  function _updateSortButtons() {
    var btns = document.querySelectorAll('[data-sort]');
    btns.forEach(function(btn) {
      var active = btn.dataset.sort === _sortKey;
      btn.setAttribute('aria-pressed', String(active));
    });
  }

  /* ── Handlers passed into Renderer ── */
  function _onToggle(id) {
    var todos = Store.getAll();
    var todo = todos.find(function(t) { return t.id === id; });
    if (!todo) return;
    Store.update(id, { completed: !todo.completed });
    _render();
  }

  function _onEdit(id, newTitle) {
    Store.update(id, { title: newTitle });
    _render();
  }

  function _onDelete(id) {
    Store.remove(id);
    _render();
  }

  /* ── Add form ── */
  function _bindAddForm() {
    var form     = document.getElementById('add-form');
    var titleIn  = document.getElementById('add-title');
    var dateIn   = document.getElementById('add-due-date');
    var priIn    = document.getElementById('add-priority');
    var tagIn    = document.getElementById('add-tag');
    var errEl    = document.getElementById('add-title-error');

    if (!form) return;

    function _showError(msg) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
      titleIn.classList.remove('error');
      void titleIn.offsetWidth; /* reflow to restart animation */
      titleIn.classList.add('error');
      titleIn.focus();
    }

    function _clearError() {
      errEl.textContent = '';
      errEl.classList.add('hidden');
      titleIn.classList.remove('error');
    }

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var v = validateTitle(titleIn.value);
      if (!v.ok) {
        _showError(v.error);
        return;
      }
      _clearError();
      Store.add({
        title:    titleIn.value.trim(),
        dueDate:  dateIn.value  || null,
        priority: priIn.value   || null,
        tag:      (tagIn.value || '').trim() || null,
      });
      titleIn.value = '';
      dateIn.value  = '';
      priIn.value   = '';
      tagIn.value   = '';
      _render();
    });

    /* Live: clear error once user starts typing again */
    titleIn.addEventListener('input', function() {
      if (!errEl.classList.contains('hidden')) _clearError();
    });
  }

  /* ── Filter tabs ── */
  function _bindFilterTabs() {
    var tabs = document.querySelectorAll('[data-filter]');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        _filter = tab.dataset.filter;
        _render();
      });
      tab.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          _filter = tab.dataset.filter;
          _render();
        }
      });
    });
  }

  /* ── Tag filter ── */
  function _bindTagFilter() {
    var sel = document.getElementById('tag-filter');
    if (!sel) return;
    sel.addEventListener('change', function() {
      _tagFilter = sel.value;
      _render();
    });
  }

  /* ── Sort buttons ── */
  function _bindSortButtons() {
    var btns = document.querySelectorAll('[data-sort]');
    btns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var key = btn.dataset.sort;
        _sortKey = (_sortKey === key) ? null : key;
        _render();
      });
      btn.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          var key = btn.dataset.sort;
          _sortKey = (_sortKey === key) ? null : key;
          _render();
        }
      });
    });
  }

  /* ── Clear completed ── */
  function _bindClearCompleted() {
    var btn = document.getElementById('clear-completed');
    if (!btn) return;
    btn.addEventListener('click', function() {
      Store.removeCompleted();
      _render();
    });
    btn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        Store.removeCompleted();
        _render();
      }
    });
  }

  /* ── Storage banner dismiss ── */
  function _bindBannerDismiss() {
    var btn = document.getElementById('storage-banner-dismiss');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var banner = document.getElementById('storage-banner');
      if (banner) banner.classList.add('hidden');
    });
  }

  /* ── Public: init ── */
  function init() {
    var storageOk = Store.init();
    if (!storageOk) {
      Renderer.showStorageBanner();
    } else {
      /* covers mid-session quota-exceeded or write failure (FR-001) */
      Store.onDegrade(Renderer.showStorageBanner);
    }

    _bindAddForm();
    _bindFilterTabs();
    _bindTagFilter();
    _bindSortButtons();
    _bindClearCompleted();
    _bindBannerDismiss();

    _render();
  }

  return {
    init: init,
    /* expose state accessors for testing */
    getFilter:    function() { return _filter; },
    getSortKey:   function() { return _sortKey; },
    getTagFilter: function() { return _tagFilter; },
    _setFilter:   function(f) { _filter = f; },
    _setSortKey:  function(k) { _sortKey = k; },
    _setTagFilter:function(t) { _tagFilter = t; },
    _render:      _render,
  };
})();

/* ═══════════════════════════════════════════════════════════════
 *  Testable surface — exposed on globalThis
 * ═══════════════════════════════════════════════════════════════ */
globalThis.Store    = Store;
globalThis.Renderer = Renderer;
globalThis.App      = App;
globalThis.validateTitle     = validateTitle;
globalThis.validateEditTitle = validateEditTitle;
globalThis.createTodo        = createTodo;
globalThis.updateTodo        = updateTodo;
globalThis.clearCompleted    = clearCompleted;
globalThis.sortByDueDate     = sortByDueDate;
globalThis.sortByPriority    = sortByPriority;
globalThis.formatCount       = formatCount;

/* CommonJS guard — lets vitest+jsdom import with require() without
 * breaking direct file:// browser load (typeof module is undefined
 * in browser global scope). */
if (typeof module !== 'undefined') {
  module.exports = {
    Store: Store,
    Renderer: Renderer,
    App: App,
    validateTitle: validateTitle,
    validateEditTitle: validateEditTitle,
    createTodo: createTodo,
    updateTodo: updateTodo,
    clearCompleted: clearCompleted,
    sortByDueDate: sortByDueDate,
    sortByPriority: sortByPriority,
    formatCount: formatCount,
  };
}

/* ── Bootstrap ── */
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function() {
    App.init();
  });
}
