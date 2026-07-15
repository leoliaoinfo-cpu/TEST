import { useState } from 'react';
import {
  getClientStatus, STATUS_COLOR, STATUS_LABEL, CAT_COLORS, FIELD_COLORS, generateId,
  EVENT_TYPES, QUICK_EVENT_KEYS, DELIVERY_FOLLOWUP_DAYS, DELIVERY_TODO_TEMPLATE,
} from '../../utils/crm';
import { today, formatDateFull, addDays, QUICK_DATES } from '../../utils/date';
import { useApp } from '../../context';
import dayjs from 'dayjs';

const INTENT_LABELS = ['未評估', '低', '中', '高', '非常高'];
const INTENT_COLORS = ['#b88860', '#808020', '#2080a0', '#2a8a50', '#c9670a'];

export default function ClientDetail({ client, cats, stages, onClose, onSave, onDelete }) {
  const { customFields, saveTimer, timers, updateClient } = useApp();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...client });
  const [logInput, setLogInput] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddTimer, setShowAddTimer] = useState(false);
  const [timerNote, setTimerNote] = useState('');
  const [timerTime, setTimerTime] = useState('');
  const [eventType, setEventType] = useState(null);
  const [eventNote, setEventNote] = useState('');
  const [eventAmount, setEventAmount] = useState('');
  const [signingNote, setSigningNote] = useState(client.signingNote || '');
  const [todoInput, setTodoInput] = useState('');

  const status = getClientStatus(client);
  const cat = cats.find((c) => c.id === client.catId);
  const stage = stages.find((s) => s.id === client.stageId);
  const daysSinceContact = client.lastContact ? dayjs().diff(dayjs(client.lastContact), 'day') : null;
  const daysSinceCreated = dayjs().diff(dayjs(client.createdAt), 'day');

  // Timers belonging to this client
  const clientTimers = timers.filter((t) => t.clientId === client.id && !t.confirmedAt);

  function setField(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSave() {
    await onSave(form);
    setEditing(false);
  }

  async function handleContacted() {
    const t = today();
    const logEntry = {
      id: generateId('log'),
      date: t,
      text: logInput.trim() || '已聯繫',
      type: 'contact',
    };
    await updateClient(client.id, (c) => ({
      ...c,
      lastContact: t,
      missedCalls: 0,
      log: [...(c.log || []), logEntry],
    }));
    setLogInput('');
  }

  async function handleMissedCall() {
    await updateClient(client.id, (c) => ({
      ...c,
      missedCalls: (c.missedCalls || 0) + 1,
      log: [
        ...(c.log || []),
        { id: generateId('log'), date: today(), text: '致電未接', type: 'missed' },
      ],
    }));
  }

  // ── 業務流程事件（報價/看車試乘/貸款補件/下訂/交車/售後回訪/LINE 摘要）──────
  async function handleAddEvent() {
    if (!eventType) return;
    const t = today();
    const def = EVENT_TYPES[eventType];
    const entry = {
      id: generateId('log'),
      date: t,
      type: eventType,
      text: eventNote.trim() || def.label,
    };
    const amount = Number(eventAmount);
    if (def.hasAmount && amount > 0) entry.amount = amount;

    // 交車：自動建立 3 / 7 / 30 天售後回訪提醒，並把下次追蹤設為 3 天後
    const isDelivery = eventType === 'delivery';
    if (isDelivery) {
      for (const n of DELIVERY_FOLLOWUP_DAYS) {
        await saveTimer({
          id: generateId('timer'),
          clientId: client.id,
          clientName: client.name,
          note: `交車後 ${n} 天售後回訪`,
          triggerAt: dayjs().add(n, 'day').hour(9).minute(0).second(0).toISOString(),
          confirmedAt: null,
        });
      }
    }

    await updateClient(client.id, (c) => ({
      ...c,
      lastContact: t,
      missedCalls: 0,
      log: [...(c.log || []), entry],
      ...(isDelivery ? { nextDate: addDays(t, DELIVERY_FOLLOWUP_DAYS[0]) } : {}),
    }));
    setEventType(null);
    setEventNote('');
    setEventAmount('');
  }

  // ── 即將簽約：置頂 / 重點備註 / 簽約前待辦 ─────────────────────────────────
  async function togglePinned() {
    await updateClient(client.id, (c) => ({ ...c, pinned: !c.pinned }));
  }

  async function saveSigningNote() {
    if ((client.signingNote || '') !== signingNote) {
      await updateClient(client.id, (c) => ({ ...c, signingNote }));
    }
  }

  async function addTodo() {
    const text = todoInput.trim();
    if (!text) return;
    await updateClient(client.id, (c) => ({
      ...c,
      todos: [...(c.todos || []), { id: generateId('todo'), text, done: false }],
    }));
    setTodoInput('');
  }

  async function toggleTodo(id) {
    await updateClient(client.id, (c) => ({
      ...c,
      todos: (c.todos || []).map((td) => td.id === id ? { ...td, done: !td.done } : td),
    }));
  }

  async function removeTodo(id) {
    await updateClient(client.id, (c) => ({
      ...c,
      todos: (c.todos || []).filter((td) => td.id !== id),
    }));
  }

  /** 套用交車待辦範本（跳過已存在的同名項目） */
  async function applyTodoTemplate() {
    await updateClient(client.id, (c) => {
      const existing = new Set((c.todos || []).map((td) => td.text));
      const additions = DELIVERY_TODO_TEMPLATE
        .filter((text) => !existing.has(text))
        .map((text) => ({ id: generateId('todo'), text, done: false }));
      return { ...c, todos: [...(c.todos || []), ...additions] };
    });
  }

  async function handleAddTimer() {
    if (!timerNote.trim() || !timerTime) return;
    await saveTimer({
      id: generateId('timer'),
      clientId: client.id,
      clientName: client.name,
      note: timerNote.trim(),
      triggerAt: new Date(timerTime).toISOString(),
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
          <h2 className="font-bold text-base text-ink truncate">{client.name}</h2>
          <p className="text-xs" style={{ color: STATUS_COLOR[status] }}>{STATUS_LABEL[status]}</p>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={togglePinned}
            title={client.pinned ? '取消置頂' : '置頂（即將簽約）'}
            className={`btn text-xs ${client.pinned ? 'bg-accent/15 text-accent' : 'btn-outline'}`}
          >
            📌{client.pinned ? '已置頂' : ''}
          </button>
          {editing ? (
            <>
              <button onClick={handleSave} className="btn-primary text-xs">儲存</button>
              <button onClick={() => { setEditing(false); setForm({ ...client }); }} className="btn-outline text-xs">取消</button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="btn-outline text-xs">編輯</button>
          )}
          <button onClick={onClose} className="md:hidden btn-ghost text-lg px-2">✕</button>
        </div>
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

        {/* Basic info */}
        <section className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm text-ink-2">基本資料</h3>
          {editing ? (
            <div className="space-y-2">
              <input value={form.name || ''} onChange={(e) => setField('name', e.target.value)} placeholder="姓名" className="w-full" />
              <input value={form.phone || ''} onChange={(e) => setField('phone', e.target.value)} placeholder="電話" className="w-full" />
              <input value={form.lineId || ''} onChange={(e) => setField('lineId', e.target.value)} placeholder="LINE ID" className="w-full" />
              <input value={form.email || ''} onChange={(e) => setField('email', e.target.value)} placeholder="Email" className="w-full" />
              <input value={form.address || ''} onChange={(e) => setField('address', e.target.value)} placeholder="地址（公司/交車地點）" className="w-full" />
              <input value={form.source || ''} onChange={(e) => setField('source', e.target.value)} placeholder="來源（FB、路過、轉介紹…）" className="w-full" />
              <div className="grid grid-cols-2 gap-2">
                <select value={form.catId || ''} onChange={(e) => setField('catId', e.target.value)} className="w-full">
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value={form.stageId || ''} onChange={(e) => setField('stageId', e.target.value)} className="w-full">
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <select value={form.intentLevel || 0} onChange={(e) => setField('intentLevel', Number(e.target.value))} className="w-full">
                {INTENT_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
              </select>
              <textarea value={form.notes || ''} onChange={(e) => setField('notes', e.target.value)} placeholder="備註" rows={2} className="w-full resize-none" />
            </div>
          ) : (
            <div className="space-y-1.5 text-sm">
              <InfoRow label="電話" value={
                client.phone
                  ? <a href={`tel:${client.phone}`} className="text-accent underline">{client.phone}</a>
                  : '—'
              } />
              <InfoRow label="LINE" value={client.lineId || '—'} />
              <InfoRow label="Email" value={client.email || '—'} />
              <InfoRow label="地址" value={
                client.address
                  ? <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}`}
                      target="_blank" rel="noreferrer" className="text-accent underline"
                    >{client.address} 🗺</a>
                  : '—'
              } />
              <InfoRow label="來源" value={client.source || '—'} />
              <InfoRow label="分類" value={cat ? (
                <span className="badge" style={{ background: CAT_COLORS[cat.colorIdx % 7] + '20', color: CAT_COLORS[cat.colorIdx % 7] }}>
                  {cat.name}
                </span>
              ) : '—'} />
              <InfoRow label="進度" value={stage?.name || '—'} />
              <InfoRow label="意願度" value={
                <span style={{ color: INTENT_COLORS[client.intentLevel || 0] }} className="font-medium">
                  {INTENT_LABELS[client.intentLevel || 0]}
                </span>
              } />
              <InfoRow label="備註" value={<span className="text-ink-2 whitespace-pre-wrap">{client.notes || '—'}</span>} />
            </div>
          )}
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
                {editing ? (
                  <input
                    type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                    value={form.customFieldValues?.[field.id] || ''}
                    onChange={(e) => setField('customFieldValues', {
                      ...(form.customFieldValues || {}),
                      [field.id]: e.target.value,
                    })}
                    className="flex-1 text-sm"
                  />
                ) : (
                  <span className="text-ink-2">{client.customFieldValues?.[field.id] || '—'}</span>
                )}
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

        {/* 業務流程事件 */}
        <section className="card p-4 space-y-3">
          <h3 className="font-semibold text-sm text-ink-2">🚛 業務進度記錄</h3>
          <div className="flex gap-1.5 flex-wrap">
            {QUICK_EVENT_KEYS.map((key) => {
              const def = EVENT_TYPES[key];
              const active = eventType === key;
              return (
                <button
                  key={key}
                  onClick={() => { setEventType(active ? null : key); setEventNote(''); setEventAmount(''); }}
                  className={`btn text-xs px-2 py-1 border ${active ? 'text-white' : ''}`}
                  style={active
                    ? { background: def.color, borderColor: def.color }
                    : { borderColor: def.color + '60', color: def.color }}
                >
                  {def.icon} {def.label}
                </button>
              );
            })}
          </div>

          {eventType && (
            <div className="space-y-2 bg-s2 rounded-lg p-3 anim-fade-in">
              <textarea
                value={eventNote}
                onChange={(e) => setEventNote(e.target.value)}
                placeholder={`${EVENT_TYPES[eventType].label}內容（車型、條件、結果…）`}
                rows={2}
                className="w-full resize-none text-sm"
              />
              {EVENT_TYPES[eventType].hasAmount && (
                <input
                  type="number"
                  value={eventAmount}
                  onChange={(e) => setEventAmount(e.target.value)}
                  placeholder="金額（元，選填）"
                  className="w-full text-sm"
                />
              )}
              {eventType === 'delivery' && (
                <p className="text-xs text-ink-3">
                  🔔 記錄交車後會自動建立 {DELIVERY_FOLLOWUP_DAYS.join(' / ')} 天售後回訪提醒
                </p>
              )}
              <button onClick={handleAddEvent} className="btn-primary text-xs w-full">
                {EVENT_TYPES[eventType].icon} 記錄「{EVENT_TYPES[eventType].label}」
              </button>
            </div>
          )}
        </section>

        {/* 即將簽約：重點備註 + 簽約前待辦 */}
        {client.pinned && (
          <section className="card p-4 space-y-3 border-accent/40">
            <h3 className="font-semibold text-sm text-accent">📌 即將簽約</h3>
            <textarea
              value={signingNote}
              onChange={(e) => setSigningNote(e.target.value)}
              onBlur={saveSigningNote}
              placeholder="重點備註（價格底線、關鍵條件、注意事項…）"
              rows={2}
              className="w-full resize-none text-sm"
            />
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-ink-2">
                  簽約前待辦
                  {(client.todos || []).length > 0 && (
                    <span className="text-ink-3 font-normal ml-1">
                      （{(client.todos || []).filter((td) => td.done).length}/{(client.todos || []).length}）
                    </span>
                  )}
                </p>
                <button onClick={applyTodoTemplate} className="text-xs text-accent hover:underline">
                  ＋套用交車待辦範本
                </button>
              </div>
              <div className="space-y-1">
                {(client.todos || []).map((td) => (
                  <div key={td.id} className="flex items-center gap-2 text-sm group">
                    <input type="checkbox" checked={td.done} onChange={() => toggleTodo(td.id)} className="shrink-0" />
                    <span className={`flex-1 ${td.done ? 'line-through text-ink-3' : 'text-ink-2'}`}>{td.text}</span>
                    <button onClick={() => removeTodo(td.id)} className="text-danger/40 hover:text-danger text-xs">✕</button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <input
                  value={todoInput}
                  onChange={(e) => setTodoInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addTodo(); }}
                  placeholder="新增待辦（保險、車貸文件…）"
                  className="flex-1 text-sm"
                />
                <button onClick={addTodo} className="btn-outline text-xs">加入</button>
              </div>
            </div>
          </section>
        )}

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

        {/* 互動時間軸 */}
        {(client.log || []).length > 0 && (
          <section className="card p-4">
            <h3 className="font-semibold text-sm text-ink-2 mb-3">📜 互動時間軸</h3>
            <div className="space-y-0">
              {[...(client.log || [])].reverse().slice(0, 50).map((entry, idx, arr) => {
                const def = EVENT_TYPES[entry.type] || EVENT_TYPES.contact;
                return (
                  <div key={entry.id} className="flex gap-3 text-sm relative">
                    {/* Timeline rail */}
                    <div className="flex flex-col items-center shrink-0 w-6">
                      <span className="text-sm leading-none mt-0.5">{def.icon}</span>
                      {idx < arr.length - 1 && <div className="w-px flex-1 bg-bdr my-1" />}
                    </div>
                    <div className="pb-3 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                          style={{ background: def.color + '18', color: def.color }}>
                          {def.label}
                        </span>
                        <span className="text-[10px] text-ink-3">{formatDateFull(entry.date)}</span>
                        {entry.amount > 0 && (
                          <span className="text-[10px] font-semibold text-accent">
                            NT$ {entry.amount.toLocaleString('zh-TW')}
                          </span>
                        )}
                      </div>
                      <p className="text-ink-2 mt-0.5 whitespace-pre-wrap break-words">{entry.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Danger zone */}
        <section className="card p-4 border-danger/20">
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
