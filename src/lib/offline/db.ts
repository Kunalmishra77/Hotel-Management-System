/**
 * Minimal promise-wrapped IndexedDB for the offline mutation queue (17 T-3).
 * Zero-dependency (tech-stack.md). One object store of pending mutations, keyed
 * by an auto-increment id so flush order == enqueue order (FR-4). All calls are
 * client-only and guard on `indexedDB` being present (SSR / unsupported → no-op).
 */
const DB_NAME = "woodpecker-offline";
const DB_VERSION = 1;
const STORE = "mutations";

export type StoredMutation = {
  /** Auto-increment key; also the FIFO ordering key. */
  id?: number;
  /** Resolver key, e.g. "housekeeping:status". */
  kind: string;
  /** Serializable action input (must survive structured clone). */
  payload: unknown;
  /** Epoch ms at enqueue — for display + tie-break. */
  createdAt: number;
  /** Flush attempts so far (retry backoff / give-up cap). */
  attempts: number;
};

export function isOfflineStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  if (!isOfflineStorageAvailable()) return undefined;
  const db = await openDb();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result: T | undefined;
    const req = fn(store);
    if (req) req.onsuccess = () => (result = req.result);
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/** Append a mutation; returns its generated id (undefined if storage unavailable). */
export async function idbAdd(m: Omit<StoredMutation, "id">): Promise<number | undefined> {
  return withStore<number>("readwrite", (store) => store.add(m) as IDBRequest<number>);
}

/** All pending mutations, oldest first (FIFO by key). */
export async function idbAll(): Promise<StoredMutation[]> {
  const all = await withStore<StoredMutation[]>("readonly", (store) => store.getAll() as IDBRequest<StoredMutation[]>);
  return (all ?? []).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

export async function idbPut(m: StoredMutation): Promise<void> {
  await withStore("readwrite", (store) => void store.put(m));
}

export async function idbDelete(id: number): Promise<void> {
  await withStore("readwrite", (store) => void store.delete(id));
}
