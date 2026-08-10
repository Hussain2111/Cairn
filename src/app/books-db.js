// Where the PDFs live.
//
// Everything else in Cairn is one JSON blob in localStorage, which is right for
// records measured in kilobytes and hopeless for a book measured in megabytes:
// localStorage is synchronous, string-only, and capped at about five. So the
// bytes go in IndexedDB, keyed by the book's id, and the record in the main
// store keeps the title, the position and the bookmarks.
//
// Nothing here throws for a missing book. A file that is not there is a state
// the interface has to handle anyway — an export/import round trip carries the
// records but not the bytes — so `getBook` returning null is normal, not an
// error.

const DB_NAME = 'cairn.books';
const DB_VERSION = 1;
const STORE = 'files';

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB, so books cannot be stored.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the book store.'));
    request.onblocked = () => reject(new Error('Another tab is holding the book store open.'));
  });
  // A failed open must not be cached, or every later call fails for the life
  // of the tab even after the cause is gone.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/**
 * Run one request in its own transaction and resolve with its result once the
 * transaction commits.
 *
 * `work` must return the IDBRequest. The result is read off that request rather
 * than from whatever `work` returned, because a `get` for a key that is not
 * there resolves with `undefined` — and treating "no value" as "no request"
 * would hand the caller the request object instead of nothing, which is exactly
 * the shape of a missing book.
 */
function run(mode, work) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let request;
    try {
      request = work(store);
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(request && 'result' in request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('The write was aborted.'));
  }));
}

export function isQuotaError(error) {
  return (
    error?.name === 'QuotaExceededError' ||
    error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error?.code === 22
  );
}

/**
 * Store a book's bytes. Rejects with a `quota` flag when there is no room, so
 * the caller can say what to do about it rather than showing a stack trace.
 */
export async function putBook(id, blob) {
  try {
    await run('readwrite', (store) => store.put(blob, id));
    return { ok: true };
  } catch (error) {
    if (isQuotaError(error)) {
      return {
        ok: false,
        reason: 'quota',
        message: 'There is no room left for this book. Remove a book you have finished, or free up space in this browser, and try again.',
      };
    }
    return { ok: false, reason: 'error', message: error?.message ?? 'The book could not be saved.' };
  }
}

/** The bytes, or null when this book has no file on this device. */
export async function getBook(id) {
  try {
    const value = await run('readonly', (store) => store.get(id));
    return value ?? null;
  } catch {
    return null;
  }
}

export async function hasBook(id) {
  try {
    const count = await run('readonly', (store) => store.count(id));
    return count > 0;
  } catch {
    return false;
  }
}

export async function deleteBook(id) {
  try {
    await run('readwrite', (store) => store.delete(id));
    return true;
  } catch {
    return false;
  }
}

/** Every id that has a file here — used to spot records whose file is missing. */
export async function storedIds() {
  try {
    const keys = await run('readonly', (store) => store.getAllKeys());
    return new Set(keys ?? []);
  } catch {
    return new Set();
  }
}

/**
 * Bytes held by the book store, measured by adding up the files themselves
 * rather than trusting an estimate that covers the whole origin.
 */
export async function usage() {
  try {
    const values = await run('readonly', (store) => store.getAll());
    const bytes = (values ?? []).reduce((total, blob) => total + (blob?.size ?? blob?.byteLength ?? 0), 0);
    return { books: values?.length ?? 0, bytes };
  } catch {
    return { books: 0, bytes: 0 };
  }
}

/**
 * What the browser says about the whole origin. Advisory only: the numbers are
 * deliberately fuzzy for privacy, and no browser guarantees them.
 */
export async function quotaEstimate() {
  try {
    if (!navigator.storage?.estimate) return null;
    const { usage: used, quota } = await navigator.storage.estimate();
    if (!Number.isFinite(quota) || !quota) return null;
    return { used: used ?? 0, quota, ratio: (used ?? 0) / quota };
  } catch {
    return null;
  }
}

/** Remove files whose records are gone, so a deleted book cannot leak space. */
export async function pruneOrphans(keepIds) {
  const keep = new Set(keepIds);
  const stored = await storedIds();
  let removed = 0;
  for (const id of stored) {
    if (!keep.has(id)) {
      // eslint-disable-next-line no-await-in-loop -- deletions are tiny and rare
      if (await deleteBook(id)) removed += 1;
    }
  }
  return removed;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
