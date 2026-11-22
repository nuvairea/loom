import { openDB } from 'https://cdn.jsdelivr.net/npm/idb@8.0.0/+esm';

const DB_NAME = 'loom';
const DB_VERSION = 2;
const ENTRIES = 'entries';
const BLOBS = 'blobs';
const BOARDS = 'boards';
const DEFAULT_BOARD_ID = 'default';
const DEFAULT_BOARD_TITLE = 'My weave';
const LEGACY_TITLE_KEY = 'loom.title.v1';
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
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const entries = db.createObjectStore(ENTRIES, { keyPath: 'id' });
          entries.createIndex('position', 'position');
          db.createObjectStore(BLOBS);
        }
        if (oldVersion < 2) {
          const boards = db.createObjectStore(BOARDS, { keyPath: 'id' });
          const entries = tx.objectStore(ENTRIES);
          entries.createIndex('boardId', 'boardId');
          if (oldVersion === 1) {
            // existing images move into one default board named after the old title
            const now = Date.now();
            boards.put({
              id: DEFAULT_BOARD_ID,
              title: readLegacyTitle() || DEFAULT_BOARD_TITLE,
              created: now,
              updated: now
            });
            let cursor = await entries.openCursor();
            while (cursor) {
              cursor.update({ ...cursor.value, boardId: DEFAULT_BOARD_ID });
              cursor = await cursor.continue();
            }
          }
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
  navigator.storage.persist().catch(() => { });
}

function readLegacyTitle() {
  try {
    return (localStorage.getItem(LEGACY_TITLE_KEY) || '').trim();
  } catch {
    return '';
  }
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

async function migrateLegacy(db, boardId) {
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
    writes.push(tx.objectStore(ENTRIES).put({ ...meta, position, boardId }));
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

async function ensureBoard(db) {
  let boards = await db.getAll(BOARDS);
  if (boards.length === 0) {
    const now = Date.now();
    const board = {
      id: generateId(),
      title: readLegacyTitle() || DEFAULT_BOARD_TITLE,
      created: now,
      updated: now
    };
    await db.add(BOARDS, board);
    boards = [board];
  }
  try {
    localStorage.removeItem(LEGACY_TITLE_KEY);
  } catch (err) {
    console.warn('Failed to clear legacy title:', err);
  }
  return boards.sort((a, b) => a.created - b.created)[0].id;
}

export function init() {
  if (!initPromise) {
    initPromise = (async () => {
      const db = await getDB();
      const firstBoardId = await ensureBoard(db);
      try {
        await migrateLegacy(db, firstBoardId);
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

async function touchBoard(tx, boardId) {
  const store = tx.objectStore(BOARDS);
  const board = await store.get(boardId);
  if (board) await store.put({ ...board, updated: Date.now() });
}

async function attachBlobs(tx, entries) {
  return Promise.all(entries.map(async entry =>
    entry.type === 'file'
      ? { ...entry, blob: await tx.objectStore(BLOBS).get(entry.id) }
      : entry
  ));
}

export async function listBoards() {
  const db = await getDB();
  const boards = await db.getAll(BOARDS);
  const counts = await Promise.all(boards.map(board => db.countFromIndex(ENTRIES, 'boardId', board.id)));
  return boards
    .map((board, i) => ({ ...board, count: counts[i] }))
    .sort((a, b) => b.updated - a.updated);
}

export async function getBoard(id) {
  const db = await getDB();
  return db.get(BOARDS, id);
}

export async function createBoard(title) {
  const db = await getDB();
  const now = Date.now();
  const board = { id: generateId(), title, created: now, updated: now };
  await db.add(BOARDS, board);
  return board;
}

export async function renameBoard(id, title) {
  const db = await getDB();
  const tx = db.transaction(BOARDS, 'readwrite');
  const board = await tx.store.get(id);
  if (board) await tx.store.put({ ...board, title, updated: Date.now() });
  await tx.done;
}

export async function deleteBoard(id) {
  const db = await getDB();
  const tx = db.transaction([BOARDS, ENTRIES, BLOBS], 'readwrite');
  const ids = await tx.objectStore(ENTRIES).index('boardId').getAllKeys(id);
  await Promise.all([
    ...ids.flatMap(entryId => [
      tx.objectStore(ENTRIES).delete(entryId),
      tx.objectStore(BLOBS).delete(entryId)
    ]),
    tx.objectStore(BOARDS).delete(id),
    tx.done
  ]);
}

export async function duplicateBoard(id) {
  const db = await getDB();
  const source = await db.get(BOARDS, id);
  if (!source) return null;

  const readTx = db.transaction([ENTRIES, BLOBS], 'readonly');
  const entries = await readTx.objectStore(ENTRIES).index('boardId').getAll(id);
  const withBlobs = await attachBlobs(readTx, entries);

  const total = withBlobs.reduce((sum, entry) => sum + (entry.blob?.size || 0), 0);
  if (total) await ensureSpace(total);

  const now = Date.now();
  const copy = { id: generateId(), title: `${source.title} copy`.slice(0, 40), created: now, updated: now };

  try {
    const tx = db.transaction([BOARDS, ENTRIES, BLOBS], 'readwrite');
    const writes = [tx.objectStore(BOARDS).add(copy), tx.done];
    withBlobs.forEach(({ blob, ...entry }) => {
      const newId = generateId();
      writes.push(tx.objectStore(ENTRIES).add({ ...entry, id: newId, boardId: copy.id }));
      if (blob) writes.push(tx.objectStore(BLOBS).add(blob, newId));
    });
    await Promise.all(writes);
    return copy;
  } catch (err) {
    throw toStorageError(err);
  }
}

export async function loadEntries(boardId) {
  const db = await getDB();
  const tx = db.transaction([ENTRIES, BLOBS], 'readonly');
  const entries = await tx.objectStore(ENTRIES).index('boardId').getAll(boardId);
  entries.sort((a, b) => a.position - b.position);
  return attachBlobs(tx, entries);
}

export async function loadPreviews(boardId, limit = 4) {
  const db = await getDB();
  const tx = db.transaction([ENTRIES, BLOBS], 'readonly');
  const entries = await tx.objectStore(ENTRIES).index('boardId').getAll(boardId);
  entries.sort((a, b) => a.position - b.position);
  return attachBlobs(tx, entries.slice(0, limit));
}

export async function addEntry({ boardId, blob, ...meta }) {
  const db = await getDB();

  if (blob) {
    await ensureSpace(blob.size);
    requestPersistence();
  }

  const record = { ...meta, boardId, id: meta.id || generateId() };

  try {
    const tx = db.transaction([ENTRIES, BLOBS, BOARDS], 'readwrite');
    const entries = tx.objectStore(ENTRIES);
    const siblings = await entries.index('boardId').getAll(boardId);
    record.position = siblings.reduce((max, entry) => Math.max(max, entry.position), -1) + 1;

    const writes = [entries.add(record), touchBoard(tx, boardId), tx.done];
    if (blob) writes.push(tx.objectStore(BLOBS).add(blob, record.id));
    await Promise.all(writes);
    return record;
  } catch (err) {
    throw toStorageError(err);
  }
}

export async function removeEntry(id) {
  const db = await getDB();
  const tx = db.transaction([ENTRIES, BLOBS, BOARDS], 'readwrite');
  const entry = await tx.objectStore(ENTRIES).get(id);
  await Promise.all([
    tx.objectStore(ENTRIES).delete(id),
    tx.objectStore(BLOBS).delete(id),
    entry ? touchBoard(tx, entry.boardId) : null,
    tx.done
  ]);
}

export async function clearEntries(boardId) {
  const db = await getDB();
  const tx = db.transaction([ENTRIES, BLOBS, BOARDS], 'readwrite');
  const ids = await tx.objectStore(ENTRIES).index('boardId').getAllKeys(boardId);
  await Promise.all([
    ...ids.flatMap(id => [
      tx.objectStore(ENTRIES).delete(id),
      tx.objectStore(BLOBS).delete(id)
    ]),
    touchBoard(tx, boardId),
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

export default {
  init,
  listBoards,
  getBoard,
  createBoard,
  renameBoard,
  deleteBoard,
  duplicateBoard,
  loadEntries,
  loadPreviews,
  addEntry,
  removeEntry,
  clearEntries,
  updatePositions
};
