import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context';
import { localNow } from '../utils/date';
import { generateId } from '../utils/crm';
import dayjs from 'dayjs';

export default function TimerModal() {
  const { timers, saveTimer, deleteTimer } = useApp();
  const [showPanel, setShowPanel] = useState(false);
  const [notifiedIds, setNotifiedIds] = useState(new Set());
  const intervalRef = useRef(null);

  const pendingTimers = timers.filter((t) => !t.confirmedAt);
  const expiredTimers = pendingTimers.filter((t) => dayjs(t.triggerAt).isBefore(dayjs()));
  const upcomingTimers = pendingTimers.filter((t) => !dayjs(t.triggerAt).isBefore(dayjs()));

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Check for newly expired timers every 15s and send browser notification
  useEffect(() => {
    function check() {
      const now = dayjs();
      timers.forEach((t) => {
        if (!t.confirmedAt && dayjs(t.triggerAt).isBefore(now) && !notifiedIds.has(t.id)) {
          setNotifiedIds((prev) => new Set([...prev, t.id]));
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('⏰ 計時提醒', { body: t.note || t.clientName || '提醒時間到！' });
          }
        }
      });
    }
    check();
    intervalRef.current = setInterval(check, 15000);
    return () => clearInterval(intervalRef.current);
  }, [timers, notifiedIds]);

  const confirmTimer = useCallback(async (timer) => {
    await saveTimer({ ...timer, confirmedAt: localNow() });
  }, [saveTimer]);

  if (pendingTimers.length === 0) return null;

  const badgeCount = expiredTimers.length || pendingTimers.length;
  const hasExpired = expiredTimers.length > 0;

  return (
    <>
      {/* Floating bell button */}
      <button
        onClick={() => setShowPanel(true)}
        className={`fixed bottom-24 right-4 md:bottom-6 rounded-full w-12 h-12 text-white shadow-panel z-40 flex items-center justify-center text-xl transition-colors ${
          hasExpired ? 'bg-danger animate-pulse' : 'bg-accent'
        }`}
        title="計時提醒"
      >
        🔔
        <span className={`absolute -top-1 -right-1 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 ${
          hasExpired ? 'bg-danger' : 'bg-accent'
        }`}>
          {badgeCount}
        </span>
      </button>

      {/* Notification panel */}
      {showPanel && (
        <>
          <div className="overlay" onClick={() => setShowPanel(false)} />
          <div className="fixed bottom-0 left-0 right-0 md:right-6 md:left-auto md:bottom-6 md:w-80 bg-s1 rounded-t-2xl md:rounded-2xl border border-bdr shadow-panel z-50 p-4 anim-slide-up md:anim-scale-in max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h3 className="font-semibold text-ink">🔔 計時提醒</h3>
              <button onClick={() => setShowPanel(false)} className="text-ink-3 hover:text-ink text-lg">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
              {/* Expired timers */}
              {expiredTimers.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-danger mb-1.5">⚠️ 已到期（{expiredTimers.length}）</p>
                  <div className="space-y-2">
                    {expiredTimers.map((t) => (
                      <div key={t.id} className="flex items-center justify-between bg-danger/10 border border-danger/20 rounded-lg px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink truncate">{t.note || t.clientName}</p>
                          <p className="text-xs text-ink-3">{dayjs(t.triggerAt).format('MM/DD HH:mm')}</p>
                        </div>
                        <div className="flex gap-1.5 ml-2 shrink-0">
                          <button onClick={() => confirmTimer(t)} className="btn-primary text-xs py-1 px-2">確認</button>
                          <button onClick={() => deleteTimer(t.id)} className="text-danger/60 hover:text-danger text-sm">✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Upcoming timers */}
              {upcomingTimers.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-ink-3 mb-1.5">即將到期（{upcomingTimers.length}）</p>
                  <div className="space-y-2">
                    {upcomingTimers.map((t) => (
                      <div key={t.id} className="flex items-center justify-between bg-s2 rounded-lg px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-ink truncate">{t.note || t.clientName}</p>
                          <p className="text-xs text-ink-3">{dayjs(t.triggerAt).format('MM/DD HH:mm')}</p>
                        </div>
                        <button onClick={() => deleteTimer(t.id)} className="text-danger/50 hover:text-danger text-sm ml-2 shrink-0">✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add timer form */}
              <div className="pt-1">
                <p className="text-xs font-semibold text-ink-3 mb-1.5">新增提醒</p>
                <AddTimerForm onAdd={async (t) => { await saveTimer(t); }} />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function AddTimerForm({ onAdd }) {
  const [note, setNote] = useState('');
  const [time, setTime] = useState('');

  function handleAdd() {
    if (!note.trim() || !time) return;
    onAdd({
      id: generateId('timer'),
      note: note.trim(),
      triggerAt: dayjs(time).toISOString(),
      confirmedAt: null,
      clientName: '',
    });
    setNote('');
    setTime('');
  }

  const minDate = dayjs().format('YYYY-MM-DDTHH:mm');

  return (
    <div className="space-y-1.5">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="提醒內容"
        className="w-full text-sm"
      />
      <div className="flex gap-1.5">
        <input
          type="datetime-local"
          value={time}
          min={minDate}
          onChange={(e) => setTime(e.target.value)}
          className="flex-1 text-sm"
        />
        <button onClick={handleAdd} className="btn-primary text-xs px-2 shrink-0">加入</button>
      </div>
    </div>
  );
}
