/**
 * Integration test helpers — set up jsdom DOM from index.html fragments
 * and bootstrap the app module.
 *
 * Strategy: We set document.body.innerHTML to the markup from index.html,
 * then import app.js (which uses module.exports guard) to get the
 * Store / Renderer / App objects, then call App.init() to wire events.
 *
 * Each test calls initApp() in beforeEach so state is clean.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR   = path.resolve(__dirname, '../../');
const HTML_FILE = path.join(APP_DIR, 'index.html');

/**
 * Safe localStorage clear — works whether localStorage is the jsdom global
 * or provided via environmentOptions.
 */
function safeStorageClear() {
  try {
    // setup-env.js installs a working localStorage on globalThis
    if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
      globalThis.localStorage.clear();
    }
  } catch (_) {
    // Storage not available — that's fine for these tests
  }
}

/**
 * Parse the <body> content from index.html and set it as document.body.innerHTML,
 * then re-import app.js's exported API, reset Store state, and call App.init().
 */
export async function bootstrapApp() {
  // Read HTML and extract body content
  const html = fs.readFileSync(HTML_FILE, 'utf8');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : '';

  // Remove the <script src="app.js"> tag — we load via import()
  const bodyWithoutScript = bodyContent.replace(/<script[^>]*src=["'][^"']*app\.js["'][^>]*><\/script>/gi, '');

  document.body.innerHTML = bodyWithoutScript;

  // Import the module
  const mod = await import('../../app.js');

  // Reset Store internal state + clear localStorage before re-init
  safeStorageClear();
  mod.Store._reset();

  // Reset App view state (filter, sortKey, tagFilter) so tests are isolated.
  // App exposes _setFilter / _setSortKey / _setTagFilter for this purpose.
  mod.App._setFilter('all');
  mod.App._setSortKey(null);
  mod.App._setTagFilter('');

  return mod;
}

/**
 * Convenience: bootstrap + init the App (wires all event listeners).
 */
export async function initApp() {
  const mod = await bootstrapApp();
  mod.App.init();
  return mod;
}

/**
 * Fire a DOM submit event on the add form.
 */
export function submitAddForm() {
  const form = document.getElementById('add-form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

/**
 * Fill the add-title input and submit the form.
 */
export function addTodoViaForm(title, { dueDate = '', priority = '', tag = '' } = {}) {
  document.getElementById('add-title').value = title;
  if (dueDate)   document.getElementById('add-due-date').value    = dueDate;
  if (priority)  document.getElementById('add-priority').value    = priority;
  if (tag)       document.getElementById('add-tag').value         = tag;
  submitAddForm();
}
