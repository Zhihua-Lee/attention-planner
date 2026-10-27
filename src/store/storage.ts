/** A tiny key–value store on IndexedDB, falling back to memory when the browser refuses storage. */
const DB = 'attention-planner';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

/** Open the database once and keep it; a failed open or a lost connection is forgotten, so the next call opens anew. */
function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  const p: Promise<IDBDatabase | null> = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        const db = req.result;
        // Safari drops the connection of a page left in the background; Chrome when site data is cleared.
        db.onclose = () => drop(p);
        db.onversionchange = () => drop(p);
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  dbPromise = p;
  void p.then((db) => db || drop(p));
  return p;
}

function drop(p: Promise<IDBDatabase | null>) {
  if (dbPromise !== p) return;
  dbPromise = null;
  void p.then((db) => db?.close());
}

/** Run one request on a fresh transaction; null when the connection or the transaction fails. */
async function attempt<T>(
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<{ v: T } | null> {
  const p = open();
  const db = await p;
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve({ v: req.result });
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then((r) => {
    if (!r) drop(p);
    return r as { v: T } | null;
  });
}

/** One failure is retried on a new connection: a broken one is common, a browser that refuses storage is not. */
async function retry<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  return (await attempt(mode, run)) ?? (await attempt(mode, run));
}

export async function load<T>(key: string): Promise<T | undefined> {
  const r = await retry('readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
  return r ? r.v : (memory.get(key) as T | undefined);
}

/** Resolves once the value is durable (or kept in memory when storage is unavailable). */
export async function save(key: string, value: unknown): Promise<boolean> {
  memory.set(key, value);
  return (await retry('readwrite', (s) => s.put(value, key))) !== null;
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
