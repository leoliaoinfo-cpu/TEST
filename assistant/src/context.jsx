import {
  createContext, useContext, useReducer, useEffect, useCallback, useRef, useState,
} from 'react';
import { db } from './db';
import { generateId } from './utils/crm';
import { today, localNow } from './utils/date';
import {
  fsSupported, requestPersistentStorage, isStoragePersisted,
  pickBackupFile, pickRestoreFile, queryPermissionState, ensurePermission,
  writeFileHandle, readFileHandle,
} from './utils/autobackup';
import dayjs from 'dayjs';

const AppContext = createContext(null);

const DEFAULT_CATS = [
  { id: 'cat-1', name: '一般客戶', colorIdx: 0, order: 0 },
  { id: 'cat-2', name: '潛在客戶', colorIdx: 1, order: 1 },
  { id: 'cat-3', name: '成交客戶', colorIdx: 2, order: 2 },
];

const DEFAULT_STAGES = [
  { id: 'stage-1', name: '初次接觸', colorIdx: 0, order: 0 },
  { id: 'stage-2', name: '有意願', colorIdx: 1, order: 1 },
  { id: 'stage-3', name: '已傳資料', colorIdx: 2, order: 2 },
  { id: 'stage-4', name: '已成交', colorIdx: 3, order: 3 },
];

function makeEmptyJournalEntry(date) {
  return {
    date,
    newDev: [],
    oldDev: [],
    findList: [],
    fbProposal: [],
    lineProposal: [],
    emailProposal: [],
    answered: 0,
    rejected: 0,
    noAnswer: 0,
    dealAmount: 0,
    dealCount: 0,
    notes: '',
    goal: { newDev: 30, oldDev: 20, findList: 20, will: 10, data: 10 },
  };
}

export function makeWorkRow(name = '') {
  return {
    id: generateId('row'),
    name,
    done: false,
    color: 0,
    will: false,
    data: false,
    pin: false,
    timer: null,
  };
}

const initialState = {
  loading: true,
  storageMode: null, // 'idb' | 'local' | 'memory' — set after startup probe
  clients: [],
  cats: DEFAULT_CATS,
  stages: DEFAULT_STAGES,
  customFields: [],
  journalEntries: {},
  salaryMonths: {},
  timers: [],
};

function reducer(state, action) {
  switch (action.type) {
    case 'LOAD_INIT':
      return {
        ...state,
        ...action.payload,
        loading: false,
      };

    // CRM
    case 'UPSERT_CLIENT': {
      const idx = state.clients.findIndex((c) => c.id === action.payload.id);
      const next = [...state.clients];
      if (idx === -1) next.push(action.payload);
      else next[idx] = action.payload;
      return { ...state, clients: next };
    }
    case 'DELETE_CLIENT':
      return { ...state, clients: state.clients.filter((c) => c.id !== action.id) };
    case 'SET_CATS':
      return { ...state, cats: action.payload };
    case 'SET_STAGES':
      return { ...state, stages: action.payload };
    case 'SET_CUSTOM_FIELDS':
      return { ...state, customFields: action.payload };

    // Journal
    case 'SET_JOURNAL_ENTRY':
      return {
        ...state,
        journalEntries: { ...state.journalEntries, [action.date]: action.payload },
      };

    // Salary
    case 'SET_SALARY_MONTH':
      return {
        ...state,
        salaryMonths: { ...state.salaryMonths, [action.key]: action.payload },
      };

    // Timers
    case 'SET_TIMERS':
      return { ...state, timers: action.payload };
    case 'UPSERT_TIMER': {
      const idx = state.timers.findIndex((t) => t.id === action.payload.id);
      const next = [...state.timers];
      if (idx === -1) next.push(action.payload);
      else next[idx] = action.payload;
      return { ...state, timers: next };
    }
    case 'DELETE_TIMER':
      return { ...state, timers: state.timers.filter((t) => t.id !== action.id) };

    case 'RELOAD_ALL':
      return { ...initialState, ...action.payload, loading: false };

    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const saveDebounceRef = useRef({});
  const pendingSavesRef = useRef({});

  // ── Durable auto-backup (File System Access) ──────────────────────────────
  const backupHandleRef = useRef(null);
  const autoBackupTimerRef = useRef(null);
  const [backupInfo, setBackupInfo] = useState({
    supported: fsSupported(),
    linked: false,
    name: '',
    permission: 'prompt', // 'granted' | 'prompt' | 'denied'
    lastSaved: null,
    persisted: false,
  });

  // Write a full snapshot to the linked file. Debounced by default so bursts of
  // edits collapse into one write; pass immediate=true to flush now.
  const scheduleAutoBackup = useCallback((immediate = false) => {
    const handle = backupHandleRef.current;
    if (!handle) return;
    if (autoBackupTimerRef.current) clearTimeout(autoBackupTimerRef.current);
    const run = async () => {
      try {
        const perm = await queryPermissionState(handle, true);
        if (perm !== 'granted') { setBackupInfo((b) => ({ ...b, permission: perm })); return; }
        const data = await db.exportAll();
        await writeFileHandle(handle, JSON.stringify(data, null, 2));
        const lastSaved = localNow();
        await db.put('settings', { key: 'backupFileHandle', handle, name: handle.name, lastSaved });
        setBackupInfo((b) => ({ ...b, lastSaved, permission: 'granted' }));
      } catch (e) {
        console.warn('Auto-backup write failed:', e);
      }
    };
    if (immediate) run();
    else autoBackupTimerRef.current = setTimeout(run, 2500);
  }, []);

  // ── Startup load ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadAll() {
      // Resilient storage layer auto-selects IndexedDB → localStorage → memory.
      // storageMode reflects the tier actually in use so the UI can warn only
      // when data is truly ephemeral (memory).
      const storageMode = await db.ready().catch(() => 'memory');
      try {
        const [clients, cats, stages, customFields, timers] = await Promise.all([
          db.getAll('clients'),
          db.getAll('cats'),
          db.getAll('stages'),
          db.getAll('customFields'),
          db.getAll('timers'),
        ]);

        const resolvedCats = cats.length > 0 ? cats : DEFAULT_CATS;
        const resolvedStages = stages.length > 0 ? stages : DEFAULT_STAGES;

        if (cats.length === 0) for (const c of DEFAULT_CATS) await db.put('cats', c).catch(() => {});
        if (stages.length === 0) for (const s of DEFAULT_STAGES) await db.put('stages', s).catch(() => {});

        dispatch({
          type: 'LOAD_INIT',
          payload: { clients, cats: resolvedCats, stages: resolvedStages, customFields, timers, storageMode },
        });
      } catch (err) {
        console.warn('Storage load failed, running with empty in-memory data:', err);
        dispatch({
          type: 'LOAD_INIT',
          payload: {
            clients: [],
            cats: DEFAULT_CATS,
            stages: DEFAULT_STAGES,
            customFields: [],
            timers: [],
            storageMode: 'memory',
          },
        });
      }
    }
    loadAll();
  }, []);

  // ── Init durable backup: request persistence + restore linked file ────────
  useEffect(() => {
    async function initBackup() {
      const persisted = await requestPersistentStorage().then(() => isStoragePersisted());
      let restored = {};
      try {
        const rec = await db.get('settings', 'backupFileHandle');
        if (rec?.handle) {
          backupHandleRef.current = rec.handle;
          const permission = await queryPermissionState(rec.handle, true);
          restored = { linked: true, name: rec.name || rec.handle.name || '備份檔', permission, lastSaved: rec.lastSaved || null };
        }
      } catch (e) {
        console.warn('Restore backup handle failed:', e);
      }
      setBackupInfo((b) => ({ ...b, persisted, ...restored }));
    }
    if (fsSupported() || navigator.storage) initBackup();
  }, []);

  // ── Flush pending saves on page unload ───────────────────────────────────
  useEffect(() => {
    function flushPending() {
      for (const { storeName, value } of Object.values(pendingSavesRef.current)) {
        db.put(storeName, value).catch(() => {});
      }
    }
    window.addEventListener('beforeunload', flushPending);
    return () => window.removeEventListener('beforeunload', flushPending);
  }, []);

  // ── Debounced save helper ─────────────────────────────────────────────────
  const debounceSave = useCallback((key, storeName, value) => {
    pendingSavesRef.current[key] = { storeName, value };
    if (saveDebounceRef.current[key]) clearTimeout(saveDebounceRef.current[key]);
    saveDebounceRef.current[key] = setTimeout(() => {
      db.put(storeName, value).catch(() => {});
      delete pendingSavesRef.current[key];
      scheduleAutoBackup();
    }, 300);
  }, [scheduleAutoBackup]);

  // ── Journal ───────────────────────────────────────────────────────────────
  const loadJournalEntry = useCallback(async (date) => {
    if (state.journalEntries[date]) return state.journalEntries[date];
    let entry = await db.get('journalEntries', date);
    if (!entry) entry = makeEmptyJournalEntry(date);
    dispatch({ type: 'SET_JOURNAL_ENTRY', date, payload: entry });
    return entry;
  }, [state.journalEntries]);

  const saveJournalEntry = useCallback((entry) => {
    dispatch({ type: 'SET_JOURNAL_ENTRY', date: entry.date, payload: entry });
    debounceSave(`journal-${entry.date}`, 'journalEntries', entry);
  }, [debounceSave]);

  // Add a CRM contact action to today's journal pending queue
  const addToJournalPending = useCallback(async (clientName, action) => {
    const date = today();
    let entry = state.journalEntries[date];
    if (!entry) {
      entry = await db.get('journalEntries', date) || makeEmptyJournalEntry(date);
    }
    // Avoid duplicate: same clientName + action already pending today
    const already = (entry.pendingJournal || []).some(
      (p) => p.clientName === clientName && p.action === action
    );
    if (already) return;
    const updated = {
      ...entry,
      pendingJournal: [...(entry.pendingJournal || []), {
        id: generateId('pj'),
        clientName,
        action,
        addedAt: localNow(),
      }],
    };
    dispatch({ type: 'SET_JOURNAL_ENTRY', date, payload: updated });
    debounceSave(`journal-${date}`, 'journalEntries', updated);
  }, [state.journalEntries, debounceSave]);

  // ── CRM ───────────────────────────────────────────────────────────────────
  const saveClient = useCallback(async (client) => {
    const now = localNow(); // GMT+8 本地時間，非 UTC
    const full = { createdAt: now, ...client, updatedAt: now };
    await db.put('clients', full);
    dispatch({ type: 'UPSERT_CLIENT', payload: full });
    scheduleAutoBackup();
    return full;
  }, [scheduleAutoBackup]);

  const deleteClient = useCallback(async (id) => {
    await db.delete('clients', id);
    dispatch({ type: 'DELETE_CLIENT', id });
    scheduleAutoBackup();
  }, [scheduleAutoBackup]);

  const saveCats = useCallback(async (cats) => {
    const existing = await db.getAll('cats');
    const newIds = new Set(cats.map((c) => c.id));
    for (const c of existing) { if (!newIds.has(c.id)) await db.delete('cats', c.id); }
    for (const c of cats) await db.put('cats', c);
    dispatch({ type: 'SET_CATS', payload: cats });
    scheduleAutoBackup();
  }, [scheduleAutoBackup]);

  const saveStages = useCallback(async (stages) => {
    const existing = await db.getAll('stages');
    const newIds = new Set(stages.map((s) => s.id));
    for (const s of existing) { if (!newIds.has(s.id)) await db.delete('stages', s.id); }
    for (const s of stages) await db.put('stages', s);
    dispatch({ type: 'SET_STAGES', payload: stages });
    scheduleAutoBackup();
  }, [scheduleAutoBackup]);

  const saveCustomFields = useCallback(async (fields) => {
    const existing = await db.getAll('customFields');
    const newIds = new Set(fields.map((f) => f.id));
    for (const f of existing) { if (!newIds.has(f.id)) await db.delete('customFields', f.id); }
    for (const f of fields) await db.put('customFields', f);
    dispatch({ type: 'SET_CUSTOM_FIELDS', payload: fields });
    scheduleAutoBackup();
  }, [scheduleAutoBackup]);

  // ── Salary ────────────────────────────────────────────────────────────────
  const loadSalaryMonth = useCallback(async (key) => {
    if (state.salaryMonths[key]) return state.salaryMonths[key];
    let entry = await db.get('salaryMonths', key);
    if (!entry) entry = { key, cases: [] };
    dispatch({ type: 'SET_SALARY_MONTH', key, payload: entry });
    return entry;
  }, [state.salaryMonths]);

  const saveSalaryMonth = useCallback((entry) => {
    dispatch({ type: 'SET_SALARY_MONTH', key: entry.key, payload: entry });
    debounceSave(`salary-${entry.key}`, 'salaryMonths', entry);
  }, [debounceSave]);

  // ── Timers ────────────────────────────────────────────────────────────────
  const saveTimer = useCallback(async (timer) => {
    await db.put('timers', timer);
    dispatch({ type: 'UPSERT_TIMER', payload: timer });
    scheduleAutoBackup();
  }, [scheduleAutoBackup]);

  const deleteTimer = useCallback(async (id) => {
    await db.delete('timers', id);
    dispatch({ type: 'DELETE_TIMER', id });
    scheduleAutoBackup();
  }, [scheduleAutoBackup]);

  // ── Full reload (after import) ────────────────────────────────────────────
  const reloadAll = useCallback(async () => {
    const [clients, cats, stages, customFields, timers] = await Promise.all([
      db.getAll('clients'),
      db.getAll('cats'),
      db.getAll('stages'),
      db.getAll('customFields'),
      db.getAll('timers'),
    ]);
    dispatch({
      type: 'RELOAD_ALL',
      payload: { clients, cats: cats.length > 0 ? cats : DEFAULT_CATS, stages: stages.length > 0 ? stages : DEFAULT_STAGES, customFields, timers },
    });
  }, []);

  // ── Durable backup actions ────────────────────────────────────────────────
  // Link a real file on disk; from now on every change auto-writes to it.
  const linkBackupFile = useCallback(async () => {
    const handle = await pickBackupFile(); // throws AbortError if user cancels
    const ok = await ensurePermission(handle, true);
    if (!ok) throw new Error('未取得檔案寫入權限');
    backupHandleRef.current = handle;
    const data = await db.exportAll();
    await writeFileHandle(handle, JSON.stringify(data, null, 2));
    const lastSaved = localNow();
    await db.put('settings', { key: 'backupFileHandle', handle, name: handle.name, lastSaved });
    setBackupInfo((b) => ({ ...b, linked: true, name: handle.name, permission: 'granted', lastSaved }));
    return handle.name;
  }, []);

  // Re-grant permission after a browser restart (needs a click).
  const reactivateBackup = useCallback(async () => {
    const handle = backupHandleRef.current;
    if (!handle) return false;
    const ok = await ensurePermission(handle, true);
    setBackupInfo((b) => ({ ...b, permission: ok ? 'granted' : 'denied' }));
    if (ok) scheduleAutoBackup(true);
    return ok;
  }, [scheduleAutoBackup]);

  const unlinkBackupFile = useCallback(async () => {
    backupHandleRef.current = null;
    if (autoBackupTimerRef.current) clearTimeout(autoBackupTimerRef.current);
    await db.delete('settings', 'backupFileHandle');
    setBackupInfo((b) => ({ ...b, linked: false, name: '', permission: 'prompt', lastSaved: null }));
  }, []);

  // Restore all data from a chosen backup file (used after a browser wipe).
  const restoreFromBackupFile = useCallback(async () => {
    const handle = await pickRestoreFile();
    const text = await readFileHandle(handle);
    const data = JSON.parse(text);
    if (data._v === 1) await db.importLegacy(data);
    else await db.importAll(data);
    await reloadAll();
    return true;
  }, [reloadAll]);

  const value = {
    ...state,
    dispatch,
    loadJournalEntry,
    saveJournalEntry,
    addToJournalPending,
    saveClient,
    deleteClient,
    saveCats,
    saveStages,
    saveCustomFields,
    loadSalaryMonth,
    saveSalaryMonth,
    saveTimer,
    deleteTimer,
    reloadAll,
    // durable auto-backup
    backupInfo,
    linkBackupFile,
    reactivateBackup,
    unlinkBackupFile,
    restoreFromBackupFile,
    scheduleAutoBackup,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
