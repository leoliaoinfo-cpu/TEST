import {
  createContext, useContext, useReducer, useEffect, useCallback, useRef, useState,
} from 'react';
import { db } from './db';
import { generateId } from './utils/crm';
import { today } from './utils/date';
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

  // ── Startup load ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function loadAll() {
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
          payload: { clients, cats: resolvedCats, stages: resolvedStages, customFields, timers },
        });
      } catch (err) {
        // IndexedDB 不可用時（file:// 限制、隱私模式等），以空資料繼續執行
        console.warn('IndexedDB unavailable, running in memory-only mode:', err);
        dispatch({
          type: 'LOAD_INIT',
          payload: {
            clients: [],
            cats: DEFAULT_CATS,
            stages: DEFAULT_STAGES,
            customFields: [],
            timers: [],
            dbUnavailable: true,
          },
        });
      }
    }
    loadAll();
  }, []);

  // ── Debounced save helper ─────────────────────────────────────────────────
  const debounceSave = useCallback((key, storeName, value) => {
    if (saveDebounceRef.current[key]) clearTimeout(saveDebounceRef.current[key]);
    saveDebounceRef.current[key] = setTimeout(() => {
      db.put(storeName, value).catch(() => {});
    }, 600);
  }, []);

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

  // ── CRM ───────────────────────────────────────────────────────────────────
  const saveClient = useCallback(async (client) => {
    const now = new Date().toISOString();
    const full = { createdAt: now, ...client, updatedAt: now };
    await db.put('clients', full);
    dispatch({ type: 'UPSERT_CLIENT', payload: full });
    return full;
  }, []);

  const deleteClient = useCallback(async (id) => {
    await db.delete('clients', id);
    dispatch({ type: 'DELETE_CLIENT', id });
  }, []);

  const saveCats = useCallback(async (cats) => {
    for (const c of cats) await db.put('cats', c);
    dispatch({ type: 'SET_CATS', payload: cats });
  }, []);

  const saveStages = useCallback(async (stages) => {
    for (const s of stages) await db.put('stages', s);
    dispatch({ type: 'SET_STAGES', payload: stages });
  }, []);

  const saveCustomFields = useCallback(async (fields) => {
    for (const f of fields) await db.put('customFields', f);
    dispatch({ type: 'SET_CUSTOM_FIELDS', payload: fields });
  }, []);

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
  }, []);

  const deleteTimer = useCallback(async (id) => {
    await db.delete('timers', id);
    dispatch({ type: 'DELETE_TIMER', id });
  }, []);

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

  const value = {
    ...state,
    dispatch,
    loadJournalEntry,
    saveJournalEntry,
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
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
