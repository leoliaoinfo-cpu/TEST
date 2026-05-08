import { useState, useCallback, useRef } from 'react';
import {
  getClientStatus, STATUS_COLOR, STATUS_LABEL, CAT_COLORS, FIELD_COLORS, generateId,
} from '../../utils/crm';
import { today, formatDateFull, addDays, QUICK_DATES, googleCalendarUrl } from '../../utils/date';
import { useApp } from '../../context';
import { ImeInput } from '../ImeInput';
import dayjs from 'dayjs';

const INTENT_LABELS = ['未評估', '低', '中', '高', '非常高'];
const INTENT_COLORS = ['#b88860', '#808020', '#2080a0', '#2a8a50', '#c9670a'];

export default function ClientDetail({ client, cats, stages, onClose, onSave, onDelete }) {
  const { customFields, saveTimer, timers, addToJournalPending } = useApp();
  const [form, setForm] = useState({ ...client });
  const [logInput, setLogInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddTimer, setShowAddTimer] = useState(false);
  const [timerNote, setTimerNote] = useState('');
  const [timerTime, setTimerTime] = useState('');
  const saveTimeout = useRef(null);

  const status = getClientStatus(client);
  const cat = cats.find((c) => c.id === client.catId);
  const stage = stages.find((s) => s.id === client.stageId);
  const daysSinceContact = client.lastContact ? dayjs().diff(dayjs(client.lastContact), 'day') : null;
  const daysSinceCreated = dayjs().diff(dayjs(client.createdAt), 'day');

  // Timers belonging to this client
  const clientTimers = timers.filter((t) => t.clientId === client.id && !t.confirmedAt);

  // Auto-move out of "匯入區" when any contact log is added
  function withImportPromotion(updated) {
    const importCat = cats.find((c) => c.name === '匯入區');
    if (importCat && updated.catId === importCat.id) {
      const defaultCat = cats.find((c) => c.id !== importCat.id);
      if (defaultCat) return { ...updated, catId: defaultCat.id };
    }
    return updated;
  }

  // Inline field update: update local form immediately, debounce save
  function setField(k, v) {
    const updated = { ...form, [k]: v };
    setForm(updated);
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => onSave(updated), 400);
  }

  // Immediate save (on blur of text inputs)
  function flushSave(overrides = {}) {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    onSave({ ...form, ...overrides });
  }

  async function handleContacted() {
    const t = today();
    const logEntry = {
      id: generateId('log'),
      date: t,
      text: logInput.trim() || '已聯繫',
      type: 'contact',
    };
    const updated = withImportPromotion({
      ...client,
      lastContact: t,
      missedCalls: 0,
      log: [...(client.log || []), logEntry],
    });
    await onSave(updated);
    addToJournalPending(client.name, '已聯繫');
    setLogInput('');
  }

  async function handleMissedCall() {
    const updated = withImportPromotion({
      ...client,
      missedCalls: (client.missedCalls || 0) + 1,
      log: [
        ...(client.log || []),
        { id: generateId('log'), date: today(), text: '致電未接', type: 'missed' },
      ],
    });
    await onSave(updated);
    addToJournalPending(client.name, '未接');
  }

  async function handleAddTimer() {
    if (!timerNote.trim() || !timerTime) return;
    await saveTimer({
      id: generateId('timer'),
      clientId: client.id,
      clientName: client.name,
      note: timerNote.trim(),
      triggerAt: dayjs(timerTime).toISOString(),
      confirmedAt: null,
    });
    setTimerNote('');
    setTimerTime('');
    setShowAddTimer(false);
  }

  function setNextDate(dateStr) {
    onSave({ ...client, nextDate: dateStr });
  }

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-s1 border-b border-bdr sticky top-0 z-10">
        <div className="w-2 h-8 rounded-full shrink-0" style={{ background: STATUS_COLOR[status] }} />
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-base text-ink truncate">{form.name || client.name}</h2>
          <p className="text-xs" style={{ color: STATUS_COLOR[status] }}>{STATUS_LABEL[status]}</p>
        </div>
        <button onClick={onClose} className="md:hidden btn-ghost text-lg px-2">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-s2 rounded-lg py-2">
            <p className="text-lg font-bold text-ink-2">{daysSinceCreated}</p>
            <p className="text-[10px] text-ink-3">建立天數</p>
          </div>
          <div className="bg-s2 rounded-lg py-2">
            <p className="text-lg font-bold text-ink-2">{daysSinceContact ?? '—'}</p>
            <p className="text-[10px] text-ink-3">距上次聯繫</p>
          </div>
          <div className={`rounded-lg py-2 ${client.missedCalls >= 5 ? 'bg-danger/10' : 'bg-s2'}`}>
            <p className={`text-lg font-bold ${client.missedCalls >= 5 ? 'text-danger' : 'text-ink-2'}`}>
              {client.missedCalls || 0}
            </p>
            <p className="text-[10px] text-ink-3">未接次數</p>
          </div>
        </div>

        {client.missedCalls >= 5 && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger">
            ⚠️ 未接次數達 {client.missedCalls} 次，建議考慮從名單中移除
          </div>
        )}

        {/* Basic info — always editable, auto-save on blur/change */}
        <section className="card p-4 space-y-2">
          <h3 className="font-semibold text-sm text-ink-2 mb-1">基本資料</h3>
          <ImeInput value={form.name || ''} onChange={(e) => setField('name', e.target.value)}
            onBlur={() => flushSave()} placeholder="公司/客戶名稱" className="w-full font-medium" />
          <ImeInput value={form.phone || ''} onChange={(e) => setField('phone', e.target.value)}
            onBlur={() => flushSave()} placeholder="電話" className="w-full" />
          <ImeInput value={form.email || ''} onChange={(e) => setField('email', e.target.value)}
            onBlur={() => flushSave()} placeholder="Email" className="w-full" />
          <div className="grid grid-cols-2 gap-2">
            <select value={form.catId || ''} onChange={(e) => setField('catId', e.target.value)} className="w-full text-sm">
              <option value="">（未分類）</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={form.stageId || ''} onChange={(e) => setField('stageId', e.target.value)} className="w-full text-sm">
              <option value="">（未設進度）</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <select value={form.intentLevel || 0} onChange={(e) => setField('intentLevel', Number(e.target.value))} className="w-full text-sm">
            {INTENT_LABELS.map((l, i) => <option key={i} value={i}>意願度：{l}</option>)}
          </select>
          <textarea value={form.notes || ''} onChange={(e) => setField('notes', e.target.value)}
            onBlur={() => flushSave()} placeholder="備註" rows={2} className="w-full resize-none text-sm" />
        </section>

        {/* Custom fields */}
        {customFields.length > 0 && (
          <section className="card p-4 space-y-2">
            <h3 className="font-semibold text-sm text-ink-2">自訂欄位</h3>
            {customFields.map((field) => (
              <div key={field.id} className="flex items-center gap-2 text-sm">
                <span className="text-xs font-medium w-20 shrink-0" style={{ color: FIELD_COLORS[field.colorIdx || 0] }}>
                  {field.name}
                </span>
                <input
                  type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                  value={form.customFieldValues?.[field.id] || ''}
                  onChange={(e) => setField('customFieldValues', {
                    ...(form.customFieldValues || {}),
                    [field.id]: e.target.value,
                  })}
                  onBlur={() => flushSave()}
                  className="flex-1 text-sm"
                />
              </div>
            ))}
          </section>
        )}

        {/* Next follow-up date */}
        <section className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm text-ink-2">📅 下次追蹤日期</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={client.nextDate || ''}
              onChange={(e) => setNextDate(e.target.value)}
              className="text-sm"
            />
            {client.nextDate && (
              <a
                href={googleCalendarUrl({ title: `追蹤：${client.name}`, date: client.nextDate, notes: client.notes || '' })}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-outline text-xs px-2 py-1"
                title="加入 Google 日曆"
              >
                📆 加入行事曆
              </a>
            )}
            <span className="text-xs text-ink-3">快速：</span>
            {QUICK_DATES.map(({ label, days }) => (
              <button key={label} onClick={() => setNextDate(addDays(today(), days))} className="btn-outline text-xs px-2 py-1">
                {label}
              </button>
            ))}
          </div>
        </section>

        {/* Contact actions */}
        <section className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm text-ink-2">📞 聯繫操作</h3>
          <textarea
            value={logInput}
            onChange={(e) => setLogInput(e.target.value)}
            placeholder="聯繫備註（可留空）"
            rows={2}
            className="w-full resize-none text-sm"
          />
          <div className="flex gap-2 flex-wrap">
            <button onClick={handleContacted} className="btn-primary text-sm flex-1">✅ 已聯繫</button>
            <button onClick={handleMissedCall} className="btn-outline text-sm flex-1">
              📵 未接 ({client.missedCalls || 0})
            </button>
          </div>
          {client.lastContact && (
            <p className="text-xs text-ink-3">上次聯繫：{formatDateFull(client.lastContact)}</p>
          )}
        </section>

        {/* Timer section */}
        <section className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm text-ink-2">⏰ 計時提醒</h3>
            <button onClick={() => setShowAddTimer(!showAddTimer)} className="btn-outline text-xs">
              {showAddTimer ? '取消' : '+ 新增提醒'}
            </button>
          </div>

          {showAddTimer && (
            <div className="space-y-2 bg-s2 rounded-lg p-3">
              <input
                value={timerNote}
                onChange={(e) => setTimerNote(e.target.value)}
                placeholder="提醒內容"
                className="w-full text-sm"
              />
              <input
                type="datetime-local"
                value={timerTime}
                min={dayjs().format('YYYY-MM-DDTHH:mm')}
                onChange={(e) => setTimerTime(e.target.value)}
                className="w-full text-sm"
              />
              <button onClick={handleAddTimer} className="btn-primary text-xs w-full">確認新增</button>
            </div>
          )}

          {clientTimers.length === 0 && !showAddTimer && (
            <p className="text-xs text-ink-3">無待確認提醒</p>
          )}
          {clientTimers.map((t) => (
            <div key={t.id} className="flex items-center justify-between text-xs bg-s2 rounded-lg px-3 py-2">
              <span className="text-ink-2">{t.note}</span>
              <span className="text-ink-3 shrink-0 ml-2">{dayjs(t.triggerAt).format('MM/DD HH:mm')}</span>
            </div>
          ))}
        </section>

        {/* Contact log */}
        {(client.log || []).length > 0 && (
          <section className="card p-4">
            <h3 className="font-semibold text-sm text-ink-2 mb-3">聯繫記錄</h3>
            <div className="space-y-2">
              {[...(client.log || [])].reverse().slice(0, 20).map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 text-sm">
                  <span className={`text-xs mt-0.5 shrink-0 ${entry.type === 'missed' ? 'text-danger' : 'text-ok'}`}>
                    {entry.type === 'missed' ? '📵' : '✅'}
                  </span>
                  <div>
                    <p className="text-ink-2">{entry.text}</p>
                    <p className="text-[10px] text-ink-3">{formatDateFull(entry.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Archive / Danger zone */}
        <section className="card p-4 space-y-3 border-danger/20">
          {/* Archive toggle */}
          {client.archived ? (
            <button
              onClick={() => onSave({ ...client, archived: false })}
              className="text-ok text-sm hover:underline"
            >
              ♻️ 恢復追蹤
            </button>
          ) : (
            <button
              onClick={() => onSave({ ...client, archived: true, nextDate: '' })}
              className="text-ink-3 text-sm hover:text-ink-2 hover:underline"
            >
              📁 封存（不再追蹤）
            </button>
          )}

          <div className="border-t border-bdr/40" />

          {!showDeleteConfirm ? (
            <button onClick={() => setShowDeleteConfirm(true)} className="text-danger text-sm hover:underline">
              🗑 刪除此客戶
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-danger font-medium">確定要刪除「{client.name}」嗎？此操作無法還原。</p>
              <div className="flex gap-2">
                <button onClick={() => onDelete(client.id)} className="btn-danger text-sm flex-1">確定刪除</button>
                <button onClick={() => setShowDeleteConfirm(false)} className="btn-outline text-sm flex-1">取消</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-ink-3 w-14 shrink-0 text-xs mt-0.5">{label}</span>
      <span className="text-ink-2 flex-1">{value}</span>
    </div>
  );
}
