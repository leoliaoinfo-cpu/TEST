import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useApp, makeWorkRow } from '../../context';
import { generateId } from '../../utils/crm';
import { db } from '../../db';
import { today, addDays, formatDateFull, getLast30Days } from '../../utils/date';
import { ImeInput } from '../ImeInput';
import dayjs from 'dayjs';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

const ROW_COLORS = [
  null,
  { border: '#e05050', bg: '#fff0f0' },
  { border: '#e08030', bg: '#fff5e8' },
  { border: '#c8a800', bg: '#fffae0' },
  { border: '#40a860', bg: '#edf8f0' },
  { border: '#4080c0', bg: '#edf2fc' },
  { border: '#9050c0', bg: '#f5eefa' },
];
const ROW_COLOR_LABELS = ['無', '紅', '橙', '黃', '綠', '藍', '紫'];

const COLUMNS = [
  { key: 'newDev', label: '新開發', goal: 30 },
  { key: 'oldDev', label: '舊追蹤', goal: 20 },
  { key: 'findList', label: '找名單', goal: 20 },
  { key: 'fbProposal', label: 'FB提案', goal: null },
  { key: 'lineProposal', label: 'LINE提案', goal: null },
  { key: 'emailProposal', label: '信件提案', goal: null },
];

function countMetric(entries, key) {
  return (entries || []).reduce((n, r) => n + (r[key] ? 1 : 0), 0);
}

export default function JournalPage() {
  const { loadJournalEntry, saveJournalEntry, journalEntries, clients } = useApp();
  const [date, setDate] = useState(today());
  const [entry, setEntry] = useState(null);
  const [activePanel, setActivePanel] = useState(null);
  const [activeCol, setActiveCol] = useState(0);
  const [trendData, setTrendData] = useState([]);
  const [debtItems, setDebtItems] = useState([]);
  const [showDebt, setShowDebt] = useState(false);
  const [debtTargets, setDebtTargets] = useState({}); // id -> colKey
  const [pendingTargets, setPendingTargets] = useState({}); // pendingId -> colKey
  const [showPending, setShowPending] = useState(true);
  const [colorMenuRow, setColorMenuRow] = useState(null); // { col, id }

  // Load entry when date changes
  useEffect(() => {
    loadJournalEntry(date).then(setEntry);
  }, [date, loadJournalEntry]);

  // Load debt pool — scan ALL historical journal entries for unfinished items before today
  useEffect(() => {
    async function loadDebt() {
      const base = today();
      const seen = new Set();
      const all = [];

      // Gather all stored entries from both stores
      const [active, archived] = await Promise.all([
        db.getAll('journalEntries'),
        db.getAll('archivedJournal'),
      ]);
      // Merge: prefer active over archived for same date
      const byDate = {};
      [...archived, ...active].forEach((e) => { if (e?.date) byDate[e.date] = e; });

      // Sort descending (most recent first), exclude today and future
      const dates = Object.keys(byDate).filter((d) => d < base).sort().reverse();

      for (const d of dates) {
        const prev = byDate[d];
        COLUMNS.slice(0, 2).forEach(({ key, label }) => {
          (prev[key] || []).forEach((r) => {
            if (!r.done && !seen.has(r.id)) {
              seen.add(r.id);
              all.push({ ...r, _sourceCol: key, _sourceLabel: label, _sourceDate: d });
            }
          });
        });
      }
      setDebtItems(all);
    }
    loadDebt();
  }, []);

  // Load trend data for past 30 days
  useEffect(() => {
    async function loadTrend() {
      const days = getLast30Days();
      const results = await Promise.all(
        days.map(async (d) => {
          const e = await db.get('journalEntries', d) || await db.get('archivedJournal', d);
          return {
            date: d.slice(5),
            newDev: (e?.newDev || []).filter((r) => r.done).length,
            oldDev: (e?.oldDev || []).filter((r) => r.done).length,
            deal: e?.dealCount || 0,
          };
        })
      );
      setTrendData(results);
    }
    if (activePanel === 'trend') loadTrend();
  }, [activePanel]);

  function updateEntry(patch) {
    if (!entry) return;
    const updated = { ...entry, ...patch };
    setEntry(updated);
    saveJournalEntry(updated);
  }

  function updateRows(colKey, rows) {
    updateEntry({ [colKey]: rows });
  }

  function addRow(colKey, name = '') {
    const rows = [...(entry?.[colKey] || []), makeWorkRow(name)];
    updateRows(colKey, rows);
  }

  function updateRow(colKey, id, patch) {
    const rows = (entry?.[colKey] || []).map((r) => r.id === id ? { ...r, ...patch } : r);
    updateRows(colKey, rows);
    // Cross-day sync: when marking done, write back to source entry
    if (patch.done === true) {
      const row = (entry?.[colKey] || []).find((r) => r.id === id);
      if (row?._sourceDate) syncDoneToSource(row._sourceDate, id);
    }
  }

  function deleteRow(colKey, id) {
    const rows = (entry?.[colKey] || []).filter((r) => r.id !== id);
    updateRows(colKey, rows);
  }

  async function syncDoneToSource(sourceDate, rowId) {
    const src = await db.get('journalEntries', sourceDate) || await db.get('archivedJournal', sourceDate);
    if (!src) return;
    let changed = false;
    const updated = { ...src };
    for (const col of COLUMNS.slice(0, 2)) {
      if (Array.isArray(updated[col.key])) {
        updated[col.key] = updated[col.key].map((r) => {
          if (r.id === rowId && !r.done) { changed = true; return { ...r, done: true }; }
          return r;
        });
      }
    }
    if (changed) await db.put('journalEntries', updated);
  }

  const DEBT_TARGET_COLS = [
    { key: 'newDev', label: '新開發' },
    { key: 'oldDev', label: '舊追蹤' },
    { key: 'fbProposal', label: 'FB提案' },
    { key: 'lineProposal', label: 'LINE提案' },
    { key: 'emailProposal', label: '信件提案' },
  ];

  function getDebtTarget(item) {
    return debtTargets[item.id] || item._sourceCol || 'newDev';
  }

  function importSingleDebt(item) {
    if (!entry) return;
    const colKey = getDebtTarget(item);
    const existing = entry[colKey] || [];
    if (existing.find((r) => r.id === item.id || r.name === item.name)) {
      setDebtItems((prev) => prev.filter((r) => r.id !== item.id));
      return;
    }
    updateEntry({ [colKey]: [...existing, { ...makeWorkRow(item.name), id: item.id, _sourceDate: item._sourceDate }] });
    setDebtItems((prev) => prev.filter((r) => r.id !== item.id));
  }

  async function deleteDebtItem(item) {
    // Mark as done in source so it won't reappear
    await syncDoneToSource(item._sourceDate, item.id);
    setDebtItems((prev) => prev.filter((r) => r.id !== item.id));
  }

  function importDebt() {
    if (!entry) return;
    const patch = {};
    debtItems.forEach((item) => {
      const colKey = getDebtTarget(item);
      if (!patch[colKey]) patch[colKey] = [...(entry[colKey] || [])];
      if (!patch[colKey].find((r) => r.id === item.id || r.name === item.name)) {
        patch[colKey].push({ ...makeWorkRow(item.name), id: item.id, _sourceDate: item._sourceDate });
      }
    });
    updateEntry(patch);
    setDebtItems([]);
    setShowDebt(false);
  }

  // ── Pending journal dispatch (from CRM contacts) ─────────────────────────
  const pendingJournal = useMemo(() => {
    if (!entry || date !== today()) return []; // only show on today's view
    return (entry.pendingJournal || []);
  }, [entry, date]);

  function getPendingTarget(item) {
    return pendingTargets[item.id] || 'newDev';
  }

  function assignPendingItem(item) {
    if (!entry) return;
    const colKey = getPendingTarget(item);
    const rows = entry[colKey] || [];
    const nameNorm = item.clientName.trim().toLowerCase();
    const existing = rows.find((r) => r.name.trim().toLowerCase() === nameNorm);
    let updatedRows;
    if (existing) {
      updatedRows = rows.map((r) => r.id === existing.id ? { ...r, done: true } : r);
    } else {
      updatedRows = [...rows, { ...makeWorkRow(item.clientName), done: true }];
    }
    const remaining = (entry.pendingJournal || []).filter((p) => p.id !== item.id);
    updateEntry({ [colKey]: updatedRows, pendingJournal: remaining });
  }

  function dismissPendingItem(item) {
    const remaining = (entry.pendingJournal || []).filter((p) => p.id !== item.id);
    updateEntry({ pendingJournal: remaining });
  }

  function assignAllPending() {
    if (!entry || pendingJournal.length === 0) return;
    const patch = { pendingJournal: [] };
    pendingJournal.forEach((item) => {
      const colKey = getPendingTarget(item);
      if (!patch[colKey]) patch[colKey] = [...(entry[colKey] || [])];
      const nameNorm = item.clientName.trim().toLowerCase();
      const existing = patch[colKey].find((r) => r.name.trim().toLowerCase() === nameNorm);
      if (existing) {
        patch[colKey] = patch[colKey].map((r) => r.id === existing.id ? { ...r, done: true } : r);
      } else {
        patch[colKey] = [...patch[colKey], { ...makeWorkRow(item.clientName), done: true }];
      }
    });
    updateEntry(patch);
  }

  // 今日應聯繫
  const todayDueCount = useMemo(() => {
    const t = dayjs();
    return clients.filter((c) => c.nextDate && !dayjs(c.nextDate).isAfter(t, 'day')).length;
  }, [clients]);

  // Stats
  const stats = useMemo(() => {
    if (!entry) return {};
    const newDevDone = (entry.newDev || []).filter((r) => r.done).length;
    const oldDevDone = (entry.oldDev || []).filter((r) => r.done).length;
    const willCount = [...(entry.newDev || []), ...(entry.oldDev || [])].filter((r) => r.will).length;
    const dataCount = [...(entry.newDev || []), ...(entry.oldDev || [])].filter((r) => r.data).length;
    const findCount = (entry.findList || []).length;
    return { newDevDone, oldDevDone, willCount, dataCount, findCount };
  }, [entry]);

  if (!entry) return <div className="p-8 text-center text-ink-3">載入中…</div>;

  const colDef = COLUMNS[activeCol];

  return (
    <div className="max-w-5xl mx-auto p-3 md:p-5 space-y-4">
      {/* Date navigation */}
      <div className="card p-3 flex items-center gap-2 flex-wrap">
        <button onClick={() => setDate(addDays(date, -1))} className="btn-ghost px-3 text-lg">‹</button>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="text-sm font-medium"
        />
        <button onClick={() => setDate(addDays(date, 1))} className="btn-ghost px-3 text-lg">›</button>
        <button onClick={() => setDate(today())} className="btn-outline text-xs px-2 py-1">今天</button>
        <div className="flex-1" />
        {todayDueCount > 0 && (
          <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-1 rounded-lg font-medium shrink-0">
            📞 今日應聯繫 {todayDueCount} 人
          </span>
        )}
        <span className="text-sm text-ink-2 shrink-0">
          成交 <strong className="text-accent">{entry.dealCount || 0}</strong> 件
        </span>
      </div>

      {/* Progress bars */}
      <ProgressBars stats={stats} entry={entry} />

      {/* Debt pool banner */}
      {debtItems.length > 0 && (
        <div className="card border-l-4 border-l-amber-400 p-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-medium text-amber-700">
              ⚠️ 累積未完工 {debtItems.length} 筆（近5天）
            </span>
            <div className="flex gap-2">
              <button onClick={() => setShowDebt(!showDebt)} className="btn-ghost text-xs">
                {showDebt ? '收起' : '展開'}
              </button>
              <button onClick={importDebt} className="btn-primary text-xs">一鍵轉入今日</button>
            </div>
          </div>
          {showDebt && (
            <div className="mt-2 space-y-1.5">
              {debtItems.map((item) => (
                <div key={item.id} className="flex items-center gap-2 py-1 border-b border-bdr/30 last:border-0">
                  <span className="text-[10px] text-ink-3 shrink-0 w-20">{item._sourceDate?.slice(5)} [{item._sourceLabel}]</span>
                  <span className="flex-1 text-xs text-ink-2 truncate">{item.name}</span>
                  <select
                    value={getDebtTarget(item)}
                    onChange={(e) => setDebtTargets((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    className="text-[10px] py-0.5 px-1 shrink-0 max-w-[80px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {DEBT_TARGET_COLS.map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => importSingleDebt(item)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent hover:bg-accent/25 shrink-0 font-medium"
                    title="轉入今日"
                  >轉→</button>
                  <button
                    onClick={() => deleteDebtItem(item)}
                    className="text-danger/40 hover:text-danger text-xs shrink-0 leading-none"
                    title="刪除（標記完成）"
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending CRM contacts dispatch banner */}
      {pendingJournal.length > 0 && (
        <div className="card border-l-4 border-l-blue-400 p-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-medium text-blue-700">
              📋 待分配聯繫記錄 {pendingJournal.length} 筆
            </span>
            <div className="flex gap-2">
              <button onClick={() => setShowPending(!showPending)} className="btn-ghost text-xs">
                {showPending ? '收起' : '展開'}
              </button>
              <button onClick={assignAllPending} className="btn-primary text-xs">一鍵分配</button>
            </div>
          </div>
          {showPending && (
            <div className="mt-2 space-y-1.5">
              {pendingJournal.map((item) => (
                <div key={item.id} className="flex items-center gap-2 py-1 border-b border-bdr/30 last:border-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium ${item.action === '已聯繫' ? 'bg-ok/15 text-ok' : 'bg-danger/10 text-danger'}`}>
                    {item.action}
                  </span>
                  <span className="flex-1 text-xs text-ink-2 truncate">{item.clientName}</span>
                  <select
                    value={getPendingTarget(item)}
                    onChange={(e) => setPendingTargets((prev) => ({ ...prev, [item.id]: e.target.value }))}
                    className="text-[10px] py-0.5 px-1 shrink-0 max-w-[90px]"
                  >
                    {COLUMNS.filter((c) => c.key !== 'findList').map((c) => (
                      <option key={c.key} value={c.key}>{c.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => assignPendingItem(item)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent hover:bg-accent/25 shrink-0 font-medium"
                  >加入→</button>
                  <button
                    onClick={() => dismissPendingItem(item)}
                    className="text-danger/40 hover:text-danger text-xs shrink-0"
                  >✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Panel buttons */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: 'history', label: '⏰ 歷史' },
          { key: 'findList', label: '📋 名單' },
          { key: 'stats', label: '📊 統計' },
          { key: 'trend', label: '📈 趨勢' },
          { key: 'goal', label: '🎯 目標' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActivePanel(activePanel === key ? null : key)}
            className={`btn text-xs px-3 py-1.5 ${activePanel === key ? 'bg-accent text-white' : 'btn-outline'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Collapsible panels */}
      {activePanel === 'findList' && (
        <FindListPanel entry={entry} updateEntry={updateEntry} />
      )}
      {activePanel === 'stats' && (
        <StatsPanel date={date} stats={stats} entry={entry} />
      )}
      {activePanel === 'trend' && (
        <TrendPanel trendData={trendData} />
      )}
      {activePanel === 'goal' && (
        <GoalPanel entry={entry} updateEntry={updateEntry} />
      )}
      {activePanel === 'history' && (
        <HistoryPanel />
      )}

      {/* Mobile column tabs */}
      <div className="md:hidden flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {COLUMNS.map((c, i) => (
          <button
            key={c.key}
            onClick={() => setActiveCol(i)}
            className={`flex-none text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
              activeCol === i ? 'bg-accent text-white' : 'bg-s3 text-ink-2'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Desktop: all 6 columns; Mobile: active column only */}
      <div className="hidden md:grid grid-cols-3 gap-3">
        {COLUMNS.map((col) => (
          <WorkColumn
            key={col.key}
            col={col}
            rows={entry[col.key] || []}
            onAdd={() => addRow(col.key)}
            onUpdate={(id, patch) => updateRow(col.key, id, patch)}
            onDelete={(id) => deleteRow(col.key, id)}
            colorMenuRow={colorMenuRow?.col === col.key ? colorMenuRow.id : null}
            setColorMenuRow={(id) => setColorMenuRow(id ? { col: col.key, id } : null)}
          />
        ))}
      </div>
      <div className="md:hidden">
        <WorkColumn
          col={colDef}
          rows={entry[colDef.key] || []}
          onAdd={() => addRow(colDef.key)}
          onUpdate={(id, patch) => updateRow(colDef.key, id, patch)}
          onDelete={(id) => deleteRow(colDef.key, id)}
          colorMenuRow={colorMenuRow?.col === colDef.key ? colorMenuRow.id : null}
          setColorMenuRow={(id) => setColorMenuRow(id ? { col: colDef.key, id } : null)}
        />
      </div>

      {/* Results area */}
      <div className="card p-4 space-y-3">
        <h3 className="font-semibold text-sm text-ink-2">📋 今日業績</h3>
        <div className="flex flex-wrap gap-4 items-center">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            成交件數：
            <input
              type="number" min="0" value={entry.dealCount || 0}
              onChange={(e) => updateEntry({ dealCount: Number(e.target.value) })}
              className="w-16 text-center"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            成交金額：
            <input
              type="number" min="0" step="1000" value={entry.dealAmount || 0}
              onChange={(e) => updateEntry({ dealAmount: Number(e.target.value) })}
              className="w-28"
            />
          </label>
        </div>
        <textarea
          value={entry.notes || ''}
          onChange={(e) => updateEntry({ notes: e.target.value })}
          placeholder="自由備註…"
          rows={2}
          className="w-full text-sm resize-none"
        />
      </div>
    </div>
  );
}

// ── WorkColumn ──────────────────────────────────────────────────────────────
function WorkColumn({ col, rows, onAdd, onUpdate, onDelete, colorMenuRow, setColorMenuRow }) {
  const [newName, setNewName] = useState('');

  function handleAdd() {
    const name = newName.trim();
    onAdd(name);
    setNewName('');
  }

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-sm text-ink">{col.label}</h4>
        <span className="text-xs text-ink-3">{rows.length}{col.goal ? `/${col.goal}` : ''}</span>
      </div>

      <div className="space-y-0 min-h-[40px]">
        {rows.map((row) => (
          <WorkRow
            key={row.id}
            row={row}
            onUpdate={(patch) => onUpdate(row.id, patch)}
            onDelete={() => onDelete(row.id)}
            showColorMenu={colorMenuRow === row.id}
            onToggleColorMenu={() => setColorMenuRow(colorMenuRow === row.id ? null : row.id)}
          />
        ))}
      </div>

      <div className="flex gap-1 mt-2">
        <ImeInput
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && handleAdd()}
          placeholder="輸入姓名 Enter 新增"
          className="flex-1 text-xs py-1"
        />
        <button onClick={handleAdd} className="btn-primary text-xs px-2 py-1">+</button>
      </div>
    </div>
  );
}

// ── WorkRow ──────────────────────────────────────────────────────────────────
function WorkRow({ row, onUpdate, onDelete, showColorMenu, onToggleColorMenu }) {
  const { saveTimer } = useApp();
  const [showTimer, setShowTimer] = useState(false);
  const [timerTime, setTimerTime] = useState('');
  const rowColor = ROW_COLORS[row.color] || null;

  async function handleAddTimer() {
    if (!timerTime) return;
    await saveTimer({
      id: generateId('timer'),
      clientId: null,
      clientName: row.name,
      note: `[日誌] ${row.name}`,
      triggerAt: dayjs(timerTime).toISOString(),
      confirmedAt: null,
    });
    setTimerTime('');
    setShowTimer(false);
  }

  return (
    <div className="relative">
      <div
        className="row-item"
        style={rowColor ? { background: rowColor.bg, borderLeft: `3px solid ${rowColor.border}`, paddingLeft: '6px' } : {}}
      >
        <input
          type="checkbox"
          checked={row.done}
          onChange={(e) => onUpdate({ done: e.target.checked })}
          className="w-3.5 h-3.5 accent-accent shrink-0"
        />
        <ImeInput
          value={row.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="flex-1 input-inline text-xs min-w-0"
          placeholder="姓名"
        />

        {/* Color dot */}
        <div className="relative shrink-0">
          <button
            onClick={onToggleColorMenu}
            className="w-3 h-3 rounded-full border border-bdr/60"
            style={{ background: rowColor ? rowColor.border : '#e0c098' }}
            title="標記顏色"
          />
          {showColorMenu && (
            <div className="absolute top-5 left-0 bg-s1 border border-bdr rounded-lg shadow-panel p-1.5 z-20 flex gap-1 flex-wrap w-28">
              {ROW_COLORS.map((c, idx) => (
                <button
                  key={idx}
                  onClick={() => { onUpdate({ color: idx }); onToggleColorMenu(); }}
                  className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
                  style={{
                    background: c ? c.border : '#e0c098',
                    borderColor: row.color === idx ? '#2c1a08' : 'transparent',
                  }}
                  title={ROW_COLOR_LABELS[idx]}
                />
              ))}
            </div>
          )}
        </div>

        {/* Will / Data / Pin / Timer toggles */}
        <button
          onClick={() => onUpdate({ will: !row.will })}
          className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 transition-colors ${row.will ? 'bg-accent/20 text-accent' : 'text-ink-3/60 hover:bg-s3 hover:text-ink-2'}`}
          title="有意願"
        >有意</button>
        <button
          onClick={() => onUpdate({ data: !row.data })}
          className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 transition-colors ${row.data ? 'bg-ok/20 text-ok' : 'text-ink-3/60 hover:bg-s3 hover:text-ink-2'}`}
          title="已傳資料"
        >傳資</button>
        <button
          onClick={() => onUpdate({ pin: !row.pin })}
          className={`text-sm shrink-0 leading-none transition-opacity ${row.pin ? 'opacity-100' : 'opacity-25 hover:opacity-60'}`}
          title="釘選"
        >📌</button>
        <button
          onClick={() => setShowTimer(!showTimer)}
          className={`text-sm shrink-0 leading-none transition-opacity ${showTimer ? 'opacity-100' : 'opacity-25 hover:opacity-60'}`}
          title="設定計時提醒"
        >⏱</button>
        <button
          onClick={onDelete}
          className="text-danger/40 hover:text-danger text-sm shrink-0 leading-none"
          title="刪除"
        >✕</button>
      </div>

      {/* Inline timer picker */}
      {showTimer && (
        <div className="flex items-center gap-1.5 px-1 py-1.5 bg-s2 rounded-lg mt-0.5 mb-1">
          <span className="text-[10px] text-ink-3 shrink-0">提醒：</span>
          <input
            type="datetime-local"
            value={timerTime}
            min={dayjs().format('YYYY-MM-DDTHH:mm')}
            onChange={(e) => setTimerTime(e.target.value)}
            className="flex-1 text-xs py-0.5"
          />
          <button onClick={handleAddTimer} className="btn-primary text-[10px] px-2 py-1 shrink-0">設定</button>
          <button onClick={() => setShowTimer(false)} className="text-ink-3 text-xs shrink-0">✕</button>
        </div>
      )}
    </div>
  );
}

// ── ProgressBars ─────────────────────────────────────────────────────────────
function ProgressBars({ stats, entry }) {
  const bars = [
    { label: '日開發', value: stats.newDevDone || 0, max: entry.goal?.newDev || 30, color: '#c9670a' },
    { label: '新開發', value: (entry.newDev || []).length, max: entry.goal?.newDev || 30, color: '#e08030' },
    { label: '舊追蹤', value: stats.oldDevDone || 0, max: entry.goal?.oldDev || 20, color: '#2a8a50' },
    { label: '有意願', value: stats.willCount || 0, max: entry.goal?.will || 10, color: '#1a60a8' },
    { label: '傳資料', value: stats.dataCount || 0, max: entry.goal?.data || 10, color: '#9030a0' },
    { label: '找名單', value: stats.findCount || 0, max: entry.goal?.findList || 20, color: '#808020' },
  ];

  return (
    <div className="card p-3 grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
      {bars.map((b) => (
        <ProgressBar key={b.label} {...b} />
      ))}
    </div>
  );
}

function ProgressBar({ label, value, max, color }) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-ink-2">{label}</span>
        <span style={{ color }} className="font-semibold">{value}/{max}</span>
      </div>
      <div className="h-1.5 bg-s3 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

// ── FindListPanel ────────────────────────────────────────────────────────────
function FindListPanel({ entry, updateEntry }) {
  const allRows = [
    ...(entry.newDev || []),
    ...(entry.oldDev || []),
    ...(entry.findList || []),
  ];
  const seen = new Set();
  const unique = allRows.filter((r) => {
    if (seen.has(r.name)) return false;
    seen.add(r.name);
    return true;
  });

  const newList = unique.filter((r) => (entry.newDev || []).some((x) => x.id === r.id));
  const oldList = unique.filter((r) => (entry.oldDev || []).some((x) => x.id === r.id));
  const passList = unique.filter((r) => r.done === false && (entry.findList || []).some((x) => x.id === r.id));

  return (
    <div className="card p-3 space-y-3">
      <h4 className="font-semibold text-sm text-ink">📋 今日名單概覽</h4>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-ok/10 rounded-lg py-2">
          <p className="text-xl font-bold text-ok">{newList.length}</p>
          <p className="text-xs text-ok/70">新單</p>
        </div>
        <div className="bg-accent/10 rounded-lg py-2">
          <p className="text-xl font-bold text-accent">{oldList.length}</p>
          <p className="text-xs text-accent/70">舊單</p>
        </div>
        <div className="bg-s3 rounded-lg py-2">
          <p className="text-xl font-bold text-ink-2">{passList.length}</p>
          <p className="text-xs text-ink-3">PASS</p>
        </div>
      </div>
    </div>
  );
}

// ── StatsPanel ───────────────────────────────────────────────────────────────
function StatsPanel({ date, stats, entry }) {
  const [weekStats, setWeekStats] = useState(null);
  const [monthStats, setMonthStats] = useState(null);

  useEffect(() => {
    async function load() {
      const now = dayjs(date);
      const weekStart = now.startOf('week');
      const monthStart = now.startOf('month');

      let wDeal = 0, wAmount = 0, mDeal = 0, mAmount = 0;

      for (let i = 0; i < 7; i++) {
        const d = weekStart.add(i, 'day').format('YYYY-MM-DD');
        const e = await db.get('journalEntries', d) || await db.get('archivedJournal', d);
        if (e) { wDeal += e.dealCount || 0; wAmount += e.dealAmount || 0; }
      }

      const daysInMonth = now.daysInMonth();
      for (let i = 1; i <= daysInMonth; i++) {
        const d = monthStart.date(i).format('YYYY-MM-DD');
        const e = await db.get('journalEntries', d) || await db.get('archivedJournal', d);
        if (e) { mDeal += e.dealCount || 0; mAmount += e.dealAmount || 0; }
      }

      setWeekStats({ deal: wDeal, amount: wAmount });
      setMonthStats({ deal: mDeal, amount: mAmount });
    }
    load();
  }, [date]);

  return (
    <div className="card p-3 space-y-3">
      <h4 className="font-semibold text-sm text-ink">📊 統計</h4>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-s2 rounded-lg p-3 text-center">
          <p className="text-xs text-ink-3 mb-1">本週成交</p>
          <p className="text-xl font-bold text-accent">{weekStats?.deal ?? '—'}</p>
          <p className="text-xs text-ink-2">${(weekStats?.amount || 0).toLocaleString('zh-TW')}</p>
        </div>
        <div className="bg-s2 rounded-lg p-3 text-center">
          <p className="text-xs text-ink-3 mb-1">本月成交</p>
          <p className="text-xl font-bold text-accent">{monthStats?.deal ?? '—'}</p>
          <p className="text-xs text-ink-2">${(monthStats?.amount || 0).toLocaleString('zh-TW')}</p>
        </div>
      </div>
    </div>
  );
}

// ── TrendPanel ───────────────────────────────────────────────────────────────
function TrendPanel({ trendData }) {
  return (
    <div className="card p-3">
      <h4 className="font-semibold text-sm text-ink mb-3">📈 30天趨勢</h4>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={trendData} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0d9b8" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#b88860' }} interval={6} />
          <YAxis tick={{ fontSize: 10, fill: '#b88860' }} />
          <Tooltip
            contentStyle={{ background: '#fffaf4', border: '1px solid #f0d9b8', borderRadius: 8, fontSize: 12 }}
          />
          <Line dataKey="newDev" name="新開發" stroke="#c9670a" dot={false} strokeWidth={1.5} />
          <Line dataKey="oldDev" name="舊追蹤" stroke="#2a8a50" dot={false} strokeWidth={1.5} />
          <Line dataKey="deal" name="成交" stroke="#1a60a8" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── GoalPanel ────────────────────────────────────────────────────────────────
function GoalPanel({ entry, updateEntry }) {
  const goal = entry.goal || {};
  const fields = [
    { key: 'newDev', label: '日新開發目標' },
    { key: 'oldDev', label: '舊追蹤目標' },
    { key: 'findList', label: '找名單目標' },
    { key: 'will', label: '有意願目標' },
    { key: 'data', label: '傳資料目標' },
  ];

  return (
    <div className="card p-3">
      <h4 className="font-semibold text-sm text-ink mb-3">🎯 今日目標設定</h4>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {fields.map(({ key, label }) => (
          <label key={key} className="flex items-center justify-between text-sm text-ink-2 gap-2">
            <span>{label}</span>
            <input
              type="number" min="0" value={goal[key] || 0}
              onChange={(e) => updateEntry({ goal: { ...goal, [key]: Number(e.target.value) } })}
              className="w-14 text-center"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

// ── HistoryPanel ─────────────────────────────────────────────────────────────
function HistoryPanel() {
  const { timers } = useApp();
  const confirmed = timers.filter((t) => t.confirmedAt).slice(-10).reverse();

  return (
    <div className="card p-3">
      <h4 className="font-semibold text-sm text-ink mb-3">⏰ 計時提醒歷史</h4>
      {confirmed.length === 0 && <p className="text-xs text-ink-3 text-center py-3">暫無歷史記錄</p>}
      <div className="space-y-2">
        {confirmed.map((t) => (
          <div key={t.id} className="text-xs flex justify-between text-ink-2">
            <span>{t.note || t.clientName}</span>
            <span className="text-ink-3">確認：{dayjs(t.confirmedAt).format('MM/DD HH:mm')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
