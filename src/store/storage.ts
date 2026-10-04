/** A tiny key–value store on IndexedDB, falling back to memory when the browser refuses storage. */
const DB = 'attention-planner';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function load<T>(key: string): Promise<T | undefined> {
  const db = await open();
  if (!db) return memory.get(key) as T | undefined;
  return new Promise((resolve) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => resolve(memory.get(key) as T | undefined);
  });
}

/** Resolves once the value is durable (or kept in memory when storage is unavailable). */
export async function save(key: string, value: unknown): Promise<boolean> {
  memory.set(key, value);
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem('ap:device');
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem('ap:device', id);
    }
    return id;
  } catch {
    return 'device';
  }
}
