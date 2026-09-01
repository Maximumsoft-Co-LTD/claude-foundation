/**
 * Vitest environment setup — runs inside the test environment (after DOM is created).
 *
 * Node and DOM test environments expose different localStorage implementations.
 * Install one deterministic in-memory implementation before every test file so
 * storage-failure tests do not depend on host-version proxy semantics.
 */

class MemoryStorage {
  constructor() {
    this._data = Object.create(null);
  }

  get length() {
    return Object.keys(this._data).length;
  }

  key(n) {
    return Object.keys(this._data)[n] ?? null;
  }

  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this._data, key)
      ? this._data[key]
      : null;
  }

  setItem(key, value) {
    this._data[String(key)] = String(value);
  }

  removeItem(key) {
    delete this._data[key];
  }

  clear() {
    this._data = Object.create(null);
  }
}

const localStorageImpl = new MemoryStorage();
const sessionStorageImpl = new MemoryStorage();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageImpl,
  writable: true,
  configurable: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: sessionStorageImpl,
  writable: true,
  configurable: true,
});

// Some DOM environments expose a distinct window object. Keep both lookup
// paths bound to the same instances because app.js uses browser globals.
if (typeof window !== 'undefined' && window !== globalThis) {
  Object.defineProperty(window, 'localStorage', {
    value: localStorageImpl,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'sessionStorage', {
    value: sessionStorageImpl,
    writable: true,
    configurable: true,
  });
}

// Clear before each test
beforeEach(() => {
  try { globalThis.localStorage.clear(); } catch (_) {}
});
