import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context';
import { localNow } from '../utils/date';
import { generateId } from '../utils/crm';
import dayjs from 'dayjs';

const ALERT_STYLE = `
@keyframes timerPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(201,103,10,0.5); }
  50% { box-shadow: 0 0 0 20px rgba(201,103,10,0); }
}
@keyframes bellShake {
  0%,100% { transform: rotate(0); }
  15% { transform: rotate(14deg); }
  30% { transform: rotate(-12deg); }
  45% { transform: rotate(10deg); }
  60% { transform: rotate(-8deg); }
  75% { transform: rotate(5deg); }
}
.timer-pulse { animation: timerPulse 1.2s ease-out infinite; }
.bell-shake { animation: bellShake 0.8s ease infinite; }
`;

export default function TimerModal({ showPanel, setShowPanel }) {
  const { timers, saveTimer, deleteTimer } = useApp();
  const confirmedTimers = timers
    .filter((t) => t.confirmedAt)
    .sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt))
    .slice(0, 20);
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

  // Check for newly expired timers every 15s — send browser notification + beep
  useEffect(() => {
    function check() {
      const now = dayjs();
      timers.forEach((t) => {
        if (!t.confirmedAt && dayjs(t.triggerAt).isBefore(now) && !notifiedIds.has(t.id)) {
          setNotifiedIds((prev) => new Set([...prev, t.id]));
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('⏰ 計時提醒到了！', { body: t.note || t.clientName || '請確認提醒' });
          }
          // Beep via Web Audio API
          try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            [0, 0.25, 0.5].forEach((delay) => {
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain); gain.connect(ctx.destination);
              osc.frequency.value = 880;
              gain.gain.setValueAtTime(0.3, ctx.currentTime + delay);
              gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.3);
              osc.start(ctx.currentTime + delay);
              osc.stop(ctx.currentTime + delay + 0.3);
            });
          } catch {}
        }
      });
    }
    check();
    intervalRef.current = setInterval(check, 15000);
    return () => clearInterval(intervalRef.current);
  }, [timers, notifiedIds]);

  const confirmAll = useCallback(async () => {
    for (const t of expiredTimers) {
      await saveTimer({ ...t, confirmedAt: localNow() });
    }
  }, [expiredTimers, saveTimer]);

  const confirmOne = useCallback(async (timer) => {
    await saveTimer({ ...timer, confirmedAt: localNow() });
  }, [saveTimer]);

  const snoozeAll = useCallback(async (minutes) => {
    const newTrigger = dayjs().add(minutes, 'minute').toISOString();
    for (const t of expiredTimers) {
      await saveTimer({ ...t, triggerAt: newTrigger });
    }
    // Allow re-notification after snooze
    setNotifiedIds((prev) => {
      const next = new Set(prev);
      expiredTimers.forEach((t) => next.delete(t.id));
      return next;
    });
  }, [expiredTimers, saveTimer]);

  const SNOOZE_OPTIONS = [
    { label: '5分', minutes: 5 },
    { label: '15分', minutes: 15 },
    { label: '30分', minutes: 30 },
    { label: '1小時', minutes: 60 },
  ];

  return (
    <>
      <style>{ALERT_STYLE}</style>

      {/* ── Expired timers — centered blocking alert ── */}
      {expiredTimers.length > 0 && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />

          {/* Alert card */}
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <div
              className="bg-s1 rounded-2xl border-2 border-accent w-full max-w-sm p-6 timer-pulse"
              style={{ boxShadow: '0 8px 40px rgba(201,103,10,0.35)' }}
            >
              {/* Icon + title */}
              <div className="text-center mb-4">
                <div className="text-6xl mb-2 bell-shake inline-block">⏰</div>
                <h2 className="text-xl font-bold text-accent">計時提醒到了！</h2>
              </div>

              {/* Timer list */}
              <div className="space-y-2 mb-5 max-h-48 overflow-y-auto">
                {expiredTimers.map((t) => (
                  <div key={t.id} className="flex items-center justify-between bg-accent/10 rounded-xl px-4 py-3 gap-2">
                    <div className="min-w-0 flex-1">
                      {t.clientName && (
                        <p className="font-bold text-accent text-base leading-tight truncate">👤 {t.clientName}</p>
                      )}
                      <p className="font-semibold text-ink text-sm leading-tight truncate mt-0.5">{t.note || '提醒'}</p>
                      <p className="text-xs text-ink-3 mt-0.5">{dayjs(t.triggerAt).format('MM/DD HH:mm')}</p>
                    </div>
                    {expiredTimers.length > 1 && (
                      <button
                        onClick={() => confirmOne(t)}
                        className="text-xs text-accent/70 hover:text-accent shrink-0"
                      >
                        確認此項
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Confirm button */}
              <button
                onClick={confirmAll}
                className="btn-primary w-full text-base py-3 font-bold mb-3"
              >
                ✅ 我知道了
              </button>

              {/* Snooze options */}
              <div>
                <p className="text-xs text-ink-3 text-center mb-2">— 或延後提醒 —</p>
                <div className="grid grid-cols-4 gap-2">
                  {SNOOZE_OPTIONS.map(({ label, minutes }) => (
                    <button
                      key={minutes}
                      onClick={() => snoozeAll(minutes)}
                      className="btn-outline text-xs py-2 rounded-xl hover:bg-accent/10 hover:border-accent hover:text-accent transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}


      {/* ── Upcoming timers panel ── */}
      {showPanel && (
        <>
          <div className="overlay" onClick={() => setShowPanel(false)} />
          <div className="fixed bottom-0 left-0 right-0 md:right-6 md:left-auto md:bottom-6 md:w-80 bg-s1 rounded-t-2xl md:rounded-2xl border border-bdr shadow-panel z-50 p-4 anim-slide-up md:anim-scale-in max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h3 className="font-semibold text-ink">🔔 計時提醒</h3>
              <button onClick={() => setShowPanel(false)} className="text-ink-3 hover:text-ink text-lg">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
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

              {upcomingTimers.length === 0 && (
                <p className="text-center text-ink-3 text-sm py-4">暫無計時提醒</p>
              )}

              <div className="pt-1">
                <p className="text-xs font-semibold text-ink-3 mb-1.5">新增提醒</p>
                <AddTimerForm onAdd={async (t) => { await saveTimer(t); }} />
              </div>

              {confirmedTimers.length > 0 && (
                <div className="pt-2 border-t border-bdr/50">
                  <p className="text-xs font-semibold text-ink-3 mb-1.5">已確認歷史（{confirmedTimers.length}）</p>
                  <div className="space-y-1.5">
                    {confirmedTimers.map((t) => (
                      <div key={t.id} className="bg-s2 rounded-lg px-3 py-2">
                        {t.clientName && (
                          <p className="text-xs font-semibold text-accent truncate">👤 {t.clientName}</p>
                        )}
                        <p className="text-xs text-ink-2 truncate">{t.note || '提醒'}</p>
                        <p className="text-[10px] text-ink-3 mt-0.5">
                          確認：{dayjs(t.confirmedAt).format('MM/DD HH:mm')}
                          　設定：{dayjs(t.triggerAt).format('MM/DD HH:mm')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="提醒內容" className="w-full text-sm" />
      <div className="flex gap-1.5">
        <input type="datetime-local" value={time} min={minDate} onChange={(e) => setTime(e.target.value)} className="flex-1 text-sm" />
        <button onClick={handleAdd} className="btn-primary text-xs px-2 shrink-0">加入</button>
      </div>
    </div>
  );
}
