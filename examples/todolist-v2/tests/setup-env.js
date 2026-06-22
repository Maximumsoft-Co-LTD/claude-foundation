/**
 * Vitest environment setup — runs inside the test environment (after DOM is created).
 *
 * Node 22 has an experimental localStorage global that is broken (requires
 * --localstorage-file). This setup installs a real in-memory localStorage
 * implementation on globalThis before any test runs, overriding Node's stub.
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

// Only install if localStorage is not already a working implementation
try {
  const ls = globalThis.localStorage;
  if (!ls || typeof ls.setItem !== 'function') {
    throw new Error('needs install');
  }
  // Quick smoke test
  ls.setItem('__test__', '1');
  ls.removeItem('__test__');
} catch (_) {
  const impl = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    value: impl,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
}

// Also assign on window if it exists and doesn't have a working localStorage
if (typeof window !== 'undefined') {
  try {
    const ls = window.localStorage;
    if (!ls || typeof ls.setItem !== 'function') {
      throw new Error('needs install');
    }
    ls.setItem('__test__', '1');
    ls.removeItem('__test__');
  } catch (_) {
    Object.defineProperty(window, 'localStorage', {
      value: globalThis.localStorage,
      writable: true,
      configurable: true,
    });
  }
}

// Clear before each test
beforeEach(() => {
  try { globalThis.localStorage.clear(); } catch (_) {}
});
