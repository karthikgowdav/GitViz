/**
 * Node 26 exposes an experimental global `localStorage` that throws when
 * `--localstorage-file` is not provided. jsdom-backed Vitest does not fill it
 * in, so UI tests that use theming/repo persistence crash before rendering.
 *
 * Provide a small in-memory Storage on both `window` and `globalThis`.
 */
class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  get length() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
  }

  getItem(key) {
    return this.map.has(String(key)) ? this.map.get(String(key)) : null;
  }

  key(index) {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key) {
    this.map.delete(String(key));
  }

  setItem(key, value) {
    this.map.set(String(key), String(value));
  }
}

function install(name) {
  const storage = new MemoryStorage();
  for (const target of [globalThis, typeof window !== 'undefined' ? window : null]) {
    if (!target) continue;
    try {
      Object.defineProperty(target, name, {
        configurable: true,
        enumerable: true,
        value: storage,
        writable: false,
      });
    } catch {
      // Some environments expose a non-configurable getter; ignore.
    }
  }
}

install('localStorage');
install('sessionStorage');
