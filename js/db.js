// IndexedDB への保存（記録は records ストアに id をキーとして保存）
const DB_NAME = 'pachi-memo';
const DB_VERSION = 1;
const STORE = 'records';

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('date', 'date');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

export async function getAll() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function write(fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const put = (record) => write((s) => s.put(record));
export const remove = (id) => write((s) => s.delete(id));
export const clear = () => write((s) => s.clear());
export const replaceAll = (records) =>
  write((s) => {
    s.clear();
    for (const r of records) s.put(r);
  });
