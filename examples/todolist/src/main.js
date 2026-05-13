// Bootstrap: read localStorage, create the store, wire DOM, kick first render.
//
// This is the only impure-shell entry point. store.js is pure; render.js
// touches the DOM but is given the store explicitly. Persistence happens
// here so the store stays unit-testable in tests.html.

import { createStore } from './store.js';
import { bindEvents, render } from './render.js';

const STORAGE_KEY = 'examples-todolist:v1';

function loadInitialState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw);
  } catch (err) {
    // Malformed JSON or storage disabled — start fresh, don't crash.
    console.warn('todolist: failed to load saved state, starting empty.', err);
    return undefined;
  }
}

function persistState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // Quota / private mode — log once, keep going in-memory.
    console.warn('todolist: failed to persist state.', err);
  }
}

function start() {
  const root = document.querySelector('main.app');
  if (!root) {
    console.error('todolist: missing main.app root');
    return;
  }
  const initial = loadInitialState();
  const store = createStore(initial);

  store.subscribe((state) => {
    render(state, root);
    persistState(state);
  });

  bindEvents(store, root);
  render(store.getState(), root);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
