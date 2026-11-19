import { openDB } from 'https://cdn.jsdelivr.net/npm/idb@8.0.0/+esm';

const DB_NAME = 'loom';
const DB_VERSION = 1;
const ENTRIES = 'entries';
const BLOBS = 'blobs';
const LEGACY_STATE_KEY = 'loom.state.v1';
const LEGACY_ORDER_KEY = 'loom.order.v1';
const QUOTA_HEADROOM_BYTES = 10 * 1024 * 1024;

export class StorageFullError extends Error {
  constructor() {
    super('Storage is full');
    this.name = 'StorageFullError';
  }
}

let dbPromise = null;
let initPromise = null;
let persistRequested = false;

function generateId() {
  return Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const entries = db.createObjectStore(ENTRIES, { keyPath: 'id' });
          entries.createIndex('position', 'position');
          db.createObjectStore(BLOBS);
        }
      }
    }).catch(err => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

function toStorageError(err) {
  return err?.name === 'QuotaExceededError' ? new StorageFullError() : err;
}

async function ensureSpace(bytes) {
  if (!navigator.storage?.estimate) return;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  if (quota && quota - usage < bytes + QUOTA_HEADROOM_BYTES) {
    throw new StorageFullError();
  }
}

function requestPersistence() {
  if (persistRequested || !navigator.storage?.persist) return;
  persistRequested = true;
  navigator.storage.persist().catch(() => {});
}

function readLegacy() {
  try {
    const rawState = localStorage.getItem(LEGACY_STATE_KEY);
    if (!rawState) return null;
    const state = JSON.parse(rawState);
    if (!Array.isArray(state)) return null;
    const rawOrder = localStorage.getItem(LEGACY_ORDER_KEY);
    const order = rawOrder ? JSON.parse(rawOrder) : [];
    return { state, order: Array.isArray(order) ? order : [] };
  } catch (err) {
    console.warn('Failed to read legacy state:', err);
    return null;
  }
}

async function convertLegacyEntry(legacy) {
  const id = legacy.id || generateId();

  if (legacy.type === 'url' && legacy.url) {
    return { meta: { id, type: 'url', url: legacy.url }, blob: null };
  }

  if (legacy.type === 'thumb' && legacy.dataUrl) {
    const blob = await (await fetch(legacy.dataUrl)).blob();
    return { meta: { id, type: 'file', name: legacy.name, size: blob.size }, blob };
  }

  return null;
}

async function migrateLegacy(db) {
  const legacy = readLegacy();
  if (!legacy) return;

  const { state, order } = legacy;
  const rank = id => {
    const index = order.indexOf(id);
    return index === -1 ? order.length : index;
  };
  const sorted = [...state].sort((a, b) => rank(a.id) - rank(b.id));

  const converted = [];
  for (const entry of sorted) {
    try {
      const result = await convertLegacyEntry(entry);
      if (result) converted.push(result);
    } catch (err) {
      console.warn('Skipping legacy entry that could not be converted:', err);
    }
  }

  const tx = db.transaction([ENTRIES, BLOBS], 'readwrite');
  const writes = [tx.done];
  converted.forEach(({ meta, blob }, position) => {
    writes.push(tx.objectStore(ENTRIES).put({ ...meta, position }));
    if (blob) writes.push(tx.objectStore(BLOBS).put(blob, meta.id));
  });
  await Promise.all(writes);

  try {
    localStorage.removeItem(LEGACY_STATE_KEY);
    localStorage.removeItem(LEGACY_ORDER_KEY);
  } catch (err) {
    console.warn('Failed to clear legacy state:', err);
  }
}

export function init() {
  if (!initPromise) {
    initPromise = (async () => {
      const db = await getDB();
      try {
        await migrateLegacy(db);
      } catch (err) {
        console.warn('Legacy migration failed, will retry next load:', err);
      }
    })().catch(err => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export async function loadEntries() {
  const db = await getDB();
  const tx = db.transaction([ENTRIES, BLOBS], 'readonly');
  const entries = await tx.objectStore(ENTRIES).index('position').getAll();
  return Promise.all(entries.map(async entry =>
    entry.type === 'file'
      ? { ...entry, blob: await tx.objectStore(BLOBS).get(entry.id) }
      : entry
  ));
}

export async function addEntry({ blob, ...meta }) {
  const db = await getDB();

  if (blob) {
    await ensureSpace(blob.size);
    requestPersistence();
  }

  const record = { ...meta, id: meta.id || generateId() };

  try {
    const tx = db.transaction([ENTRIES, BLOBS], 'readwrite');
    const entries = tx.objectStore(ENTRIES);
    const last = await entries.index('position').openKeyCursor(null, 'prev');
    record.position = last ? last.key + 1 : 0;

    const writes = [entries.add(record), tx.done];
    if (blob) writes.push(tx.objectStore(BLOBS).add(blob, record.id));
    await Promise.all(writes);
    return record;
  } catch (err) {
    throw toStorageError(err);
  }
}

export async function removeEntry(id) {
  const db = await getDB();
  const tx = db.transaction([ENTRIES, BLOBS], 'readwrite');
  await Promise.all([
    tx.objectStore(ENTRIES).delete(id),
    tx.objectStore(BLOBS).delete(id),
    tx.done
  ]);
}

export async function clearEntries() {
  const db = await getDB();
  const tx = db.transaction([ENTRIES, BLOBS], 'readwrite');
  await Promise.all([
    tx.objectStore(ENTRIES).clear(),
    tx.objectStore(BLOBS).clear(),
    tx.done
  ]);
}

export async function updatePositions(ids) {
  const db = await getDB();
  const tx = db.transaction(ENTRIES, 'readwrite');
  await Promise.all([
    ...ids.map(async (id, position) => {
      const record = await tx.store.get(id);
      if (record && record.position !== position) {
        await tx.store.put({ ...record, position });
      }
    }),
    tx.done
  ]);
}

export default { init, loadEntries, addEntry, removeEntry, clearEntries, updatePositions };
