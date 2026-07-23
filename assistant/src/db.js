import { openDB } from 'idb';

const DB_NAME = 'business_assistant_v2';
const DB_VERSION = 1;

// keyPath for every store — shared by the IndexedDB schema and the
// localStorage / memory fallback adapters so all three behave identically.
const STORE_KEYS = {
  clients: 'id',
  cats: 'id',
  stages: 'id',
  customFields: 'id',
  journalEntries: 'date',
  archivedJournal: 'date',
  salaryMonths: 'key',
  timers: 'id',
  timerHistory: 'id',
  settings: 'key',
};

const ALL_STORES = Object.keys(STORE_KEYS);

// ── IndexedDB schema ─────────────────────────────────────────────────────────
function applySchema(database) {
  if (!database.objectStoreNames.contains('clients')) {
    const s = database.createObjectStore('clients', { keyPath: 'id' });
    s.createIndex('catId', 'catId');
    s.createIndex('stageId', 'stageId');
    s.createIndex('nextDate', 'nextDate');
    s.createIndex('lastContact', 'lastContact');
  }
  for (const store of ALL_STORES) {
    if (store === 'clients') continue;
    if (!database.objectStoreNames.contains(store)) {
      database.createObjectStore(store, { keyPath: STORE_KEYS[store] });
    }
  }
}

// ── Backend adapters ─────────────────────────────────────────────────────────
// Every adapter implements the same async surface:
//   getAll, get, put, delete, clear, count
// The public `db` object below is built on top of these, so the rest of the
// app never needs to know which backend is live.

// (1) IndexedDB adapter — preferred: large capacity, structured, durable.
function makeIdbAdapter(database) {
  return {
    name: 'idb',
    getAll: (store) => database.getAll(store),
    get: (store, key) => database.get(store, key),
    put: (store, value) => database.put(store, value),
    delete: (store, key) => database.delete(store, key),
    clear: (store) => database.clear(store),
    count: (store) => database.count(store),
  };
}

// (2) localStorage adapter — durable fallback that works even on file:// in
// Chrome (where IndexedDB is blocked). Data is cached in memory as Maps and
// written through to localStorage on every mutation.
const LS_PREFIX = 'ba2::';

function makeLocalAdapter() {
  const cache = {};

  function hydrate(store) {
    if (cache[store]) return cache[store];
    const map = new Map();
    try {
      const raw = localStorage.getItem(LS_PREFIX + store);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          for (const item of arr) map.set(item[STORE_KEYS[store]], item);
        }
      }
    } catch { /* corrupt entry → start empty */ }
    cache[store] = map;
    return map;
  }

  function persist(store) {
    const arr = [...cache[store].values()];
    // May throw QuotaExceededError — let it propagate so callers know.
    localStorage.setItem(LS_PREFIX + store, JSON.stringify(arr));
  }

  return {
    name: 'local',
    async getAll(store) { return [...hydrate(store).values()]; },
    async get(store, key) { return hydrate(store).get(key); },
    async put(store, value) {
      const map = hydrate(store);
      map.set(value[STORE_KEYS[store]], value);
      persist(store);
    },
    async delete(store, key) {
      const map = hydrate(store);
      map.delete(key);
      persist(store);
    },
    async clear(store) {
      cache[store] = new Map();
      persist(store);
    },
    async count(store) { return hydrate(store).size; },
  };
}

// (3) Memory adapter — last resort. Data lives only for the session; the UI
// warns loudly and nudges the user to keep JSON backups.
function makeMemoryAdapter() {
  const cache = {};
  const map = (store) => (cache[store] ||= new Map());
  return {
    name: 'memory',
    async getAll(store) { return [...map(store).values()]; },
    async get(store, key) { return map(store).get(key); },
    async put(store, value) { map(store).set(value[STORE_KEYS[store]], value); },
    async delete(store, key) { map(store).delete(key); },
    async clear(store) { cache[store] = new Map(); },
    async count(store) { return map(store).size; },
  };
}

// ── Backend selection ────────────────────────────────────────────────────────
// Probe each tier with a real write→read→delete round-trip so we pick a backend
// that actually works, instead of latching on the first transient error.

let backendPromise = null;

async function probeIndexedDB() {
  if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('no indexedDB');
  const database = await openDB(DB_NAME, DB_VERSION, {
    upgrade: applySchema,
    blocked() { console.warn('IndexedDB upgrade blocked by another open tab'); },
    blocking() { database?.close?.(); },
    terminated() { backendPromise = null; },
  });
  // Round-trip probe against a throwaway settings row.
  const tx = database.transaction('settings', 'readwrite');
  await tx.store.put({ key: '__probe__', ts: Date.now() });
  await tx.store.delete('__probe__');
  await tx.done;
  return makeIdbAdapter(database);
}

function probeLocalStorage() {
  if (typeof localStorage === 'undefined' || !localStorage) throw new Error('no localStorage');
  const k = LS_PREFIX + '__probe__';
  localStorage.setItem(k, '1');
  localStorage.removeItem(k);
  return makeLocalAdapter();
}

async function selectBackend() {
  try {
    const idb = await probeIndexedDB();
    return idb;
  } catch (e) {
    console.warn('IndexedDB unavailable, trying localStorage:', e?.message || e);
  }
  try {
    const local = probeLocalStorage();
    console.warn('Using localStorage persistence fallback (data is saved, capacity is limited).');
    return local;
  } catch (e) {
    console.warn('localStorage unavailable, falling back to in-memory (NOT persisted):', e?.message || e);
  }
  return makeMemoryAdapter();
}

function getBackendAsync() {
  if (!backendPromise) backendPromise = selectBackend();
  return backendPromise;
}

let activeBackendName = null; // resolved after first access

async function be() {
  const backend = await getBackendAsync();
  activeBackendName = backend.name;
  return backend;
}

// ── Public API (unchanged surface) ───────────────────────────────────────────
export const db = {
  /** Which persistence tier is live: 'idb' | 'local' | 'memory' (null before init). */
  getBackend() { return activeBackendName; },

  /** Resolve once the backend is chosen; returns its name. */
  async ready() { return (await be()).name; },

  async getAll(store) { return (await be()).getAll(store); },
  async get(store, key) { return (await be()).get(store, key); },
  async put(store, value) { return (await be()).put(store, value); },
  async delete(store, key) { return (await be()).delete(store, key); },
  async clear(store) { return (await be()).clear(store); },
  async count(store) { return (await be()).count(store); },

  async bulkPut(store, items) {
    if (!items || items.length === 0) return;
    const backend = await be();
    // idb adapter has a raw database for a fast single transaction; fallbacks
    // just loop (they persist per-put, which is fine at these data sizes).
    for (const item of items) await backend.put(store, item);
  },

  /** Full export of all stores */
  async exportAll() {
    const data = { _v: 2, exportedAt: new Date().toISOString() };
    for (const store of ALL_STORES) {
      data[store] = await db.getAll(store);
    }
    return data;
  },

  /** Full import — wipes existing data */
  async importAll(data) {
    for (const store of ALL_STORES) {
      if (Array.isArray(data[store])) {
        await db.clear(store);
        await db.bulkPut(store, data[store]);
      }
    }
  },

  /** Merge import from v2 format without wiping */
  async mergeImport(data) {
    for (const store of ALL_STORES) {
      if (Array.isArray(data[store])) {
        await db.bulkPut(store, data[store]);
      }
    }
  },

  /** Import from legacy v1 format: { _v:1, crm, jnl, sal } */
  async importLegacy(legacyData) {
    const { crm, jnl, sal } = legacyData;

    if (crm) {
      if (Array.isArray(crm.clients)) await db.bulkPut('clients', crm.clients);
      if (Array.isArray(crm.cats)) await db.bulkPut('cats', crm.cats);
      if (Array.isArray(crm.stages)) await db.bulkPut('stages', crm.stages);
      if (Array.isArray(crm.customFields)) await db.bulkPut('customFields', crm.customFields);
    }

    if (jnl) {
      const entries = Array.isArray(jnl)
        ? jnl
        : Object.entries(jnl).map(([date, data]) => ({ date, ...data }));
      await db.bulkPut('journalEntries', entries);
    }

    if (sal) {
      const months = Array.isArray(sal)
        ? sal
        : Object.entries(sal).map(([key, data]) => ({ key, ...data }));
      await db.bulkPut('salaryMonths', months);
    }
  },

  /** Archive journal entries older than given cutoff date string (YYYY-MM-DD) */
  async archiveJournalBefore(cutoffDate) {
    const all = await db.getAll('journalEntries');
    const toArchive = all.filter((e) => e.date < cutoffDate);
    if (toArchive.length === 0) return 0;
    await db.bulkPut('archivedJournal', toArchive);
    for (const e of toArchive) await db.delete('journalEntries', e.date);
    return toArchive.length;
  },
};

export default db;
