// Pure state module for the todolist example.
//
// Architecture: this file owns the state shape and all transitions, and it has
// zero knowledge of the DOM or localStorage. The shell (render.js + main.js)
// is responsible for side effects. That split is deliberate so the smoke
// harness in tests.html can drive this module directly without rendering.
//
// State shape:
//   {
//     tasks: [{ id: string, text: string, done: boolean, createdAt: number }],
//     filter: 'all' | 'active' | 'done'
//   }
//
// Public API:
//   const store = createStore(initialState, { idFactory, clock });
//   store.getState();
//   store.subscribe(listener) -> unsubscribe
//   store.dispatch({ type, ... });
//
// Action types:
//   { type: 'add',           text }
//   { type: 'toggle',        id }
//   { type: 'edit',          id, text }
//   { type: 'delete',        id }
//   { type: 'setFilter',     filter }
//   { type: 'clearCompleted' }
//   { type: 'replace',       state }   // used by main.js when hydrating from storage
//
// Selectors (pure functions, exported so the shell and tests can share them):
//   getVisibleTasks(state)
//   getActiveCount(state)
//   getDoneCount(state)
//   isValidFilter(value)

export const FILTERS = Object.freeze(['all', 'active', 'done']);

export function isValidFilter(value) {
  return FILTERS.includes(value);
}

function normaliseText(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

function sanitiseTask(task) {
  if (!task || typeof task !== 'object') return null;
  const text = normaliseText(task.text);
  if (!text) return null;
  const id = typeof task.id === 'string' && task.id.length > 0 ? task.id : null;
  const createdAt = Number.isFinite(task.createdAt) ? task.createdAt : null;
  if (!id || createdAt === null) return null;
  return {
    id,
    text,
    done: Boolean(task.done),
    createdAt,
  };
}

export function sanitiseState(candidate) {
  // Defensive: never trust localStorage. Drop anything we don't recognise.
  if (!candidate || typeof candidate !== 'object') {
    return { tasks: [], filter: 'all' };
  }
  const tasks = Array.isArray(candidate.tasks)
    ? candidate.tasks.map(sanitiseTask).filter(Boolean)
    : [];
  const filter = isValidFilter(candidate.filter) ? candidate.filter : 'all';
  return { tasks, filter };
}

function reducer(state, action, deps) {
  switch (action.type) {
    case 'add': {
      const text = normaliseText(action.text);
      if (!text) return state; // spec: reject empty / whitespace-only
      const newTask = {
        id: deps.idFactory(),
        text,
        done: false,
        createdAt: deps.clock(),
      };
      return { ...state, tasks: [...state.tasks, newTask] };
    }
    case 'toggle': {
      const tasks = state.tasks.map((t) =>
        t.id === action.id ? { ...t, done: !t.done } : t,
      );
      return { ...state, tasks };
    }
    case 'edit': {
      const text = normaliseText(action.text);
      if (!text) return state; // spec: empty edit is a no-op, not a delete
      const tasks = state.tasks.map((t) =>
        t.id === action.id ? { ...t, text } : t,
      );
      return { ...state, tasks };
    }
    case 'delete': {
      const tasks = state.tasks.filter((t) => t.id !== action.id);
      return { ...state, tasks };
    }
    case 'setFilter': {
      if (!isValidFilter(action.filter)) return state;
      return { ...state, filter: action.filter };
    }
    case 'clearCompleted': {
      const tasks = state.tasks.filter((t) => !t.done);
      return { ...state, tasks };
    }
    case 'replace': {
      return sanitiseState(action.state);
    }
    default:
      // Unknown action — return state unchanged so we never lose data.
      return state;
  }
}

export function createStore(initialState = {}, options = {}) {
  const idFactory =
    typeof options.idFactory === 'function'
      ? options.idFactory
      : defaultIdFactory;
  const clock = typeof options.clock === 'function' ? options.clock : Date.now;

  let state = sanitiseState(initialState);
  const listeners = new Set();

  function getState() {
    return state;
  }

  function dispatch(action) {
    const next = reducer(state, action, { idFactory, clock });
    if (next === state) return state;
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
    return state;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('subscribe expects a function');
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, dispatch, subscribe };
}

// Selectors ------------------------------------------------------------------

export function getVisibleTasks(state) {
  if (!state || !Array.isArray(state.tasks)) return [];
  switch (state.filter) {
    case 'active':
      return state.tasks.filter((t) => !t.done);
    case 'done':
      return state.tasks.filter((t) => t.done);
    case 'all':
    default:
      return state.tasks.slice();
  }
}

export function getActiveCount(state) {
  if (!state || !Array.isArray(state.tasks)) return 0;
  return state.tasks.reduce((n, t) => (t.done ? n : n + 1), 0);
}

export function getDoneCount(state) {
  if (!state || !Array.isArray(state.tasks)) return 0;
  return state.tasks.reduce((n, t) => (t.done ? n + 1 : n), 0);
}

// Default id factory --------------------------------------------------------
// crypto.randomUUID is available in modern browsers and recent Node. Fall
// back to a time+random string so this module also runs in tests.html on
// older builds.
function defaultIdFactory() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `t_${Date.now().toString(36)}_${rand}`;
}
