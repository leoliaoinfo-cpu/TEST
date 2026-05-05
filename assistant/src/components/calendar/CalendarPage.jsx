import { useState, useMemo } from 'react';
import { useApp } from '../../context';
import { today } from '../../utils/date';
import { STATUS_COLOR, CAT_COLORS } from '../../utils/crm';
import dayjs from 'dayjs';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export default function CalendarPage() {
  const { clients, timers, cats } = useApp();
  const [viewDate, setViewDate] = useState(() => dayjs());
  const [selectedDay, setSelectedDay] = useState(null);

  // Build event map: YYYY-MM-DD -> events[]
  const eventMap = useMemo(() => {
    const map = {};
    function add(dateStr, event) {
      if (!dateStr) return;
      const key = dayjs(dateStr).format('YYYY-MM-DD');
      if (!map[key]) map[key] = [];
      map[key].push(event);
    }

    // Client follow-ups (nextDate)
    clients.forEach((c) => {
      if (c.nextDate) {
        const cat = cats.find((ct) => ct.id === c.catId);
        const color = cat ? CAT_COLORS[cat.colorIdx % CAT_COLORS.length] : '#c9670a';
        add(c.nextDate, { type: 'client', label: c.name, color, sub: cat?.name, client: c });
      }
    });

    // Timer reminders
    timers.filter((t) => !t.confirmedAt).forEach((t) => {
      const timeStr = dayjs(t.triggerAt).format('HH:mm');
      add(t.triggerAt, {
        type: 'timer', label: t.note || t.clientName || '提醒',
        color: '#9030a0', sub: timeStr,
      });
    });

    return map;
  }, [clients, timers, cats]);

  // Build calendar grid
  const startOfGrid = viewDate.startOf('month').startOf('week');
  const endOfGrid = viewDate.endOf('month').endOf('week');
  const days = [];
  let d = startOfGrid;
  while (d.isBefore(endOfGrid) || d.isSame(endOfGrid, 'day')) {
    days.push(d);
    d = d.add(1, 'day');
  }
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  const todayStr = today();
  const selectedEvents = selectedDay ? (eventMap[selectedDay] || []) : [];

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 3.5rem)' }}>
      {/* Navigation bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-bdr bg-s1 shrink-0">
        <button onClick={() => setViewDate((v) => v.subtract(1, 'month'))} className="btn-ghost px-2 text-lg">‹</button>
        <h2 className="font-bold text-lg text-ink min-w-[120px] text-center">
          {viewDate.format('YYYY年 M月')}
        </h2>
        <button onClick={() => setViewDate((v) => v.add(1, 'month'))} className="btn-ghost px-2 text-lg">›</button>
        <button onClick={() => { setViewDate(dayjs()); setSelectedDay(todayStr); }} className="btn-outline text-xs px-2 py-1">
          今天
        </button>
        <div className="flex-1" />
        {/* Legend */}
        <div className="hidden md:flex items-center gap-3 text-xs text-ink-3">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#c9670a' }} />客戶追蹤</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: '#9030a0' }} />計時提醒</span>
        </div>
      </div>

      {/* Calendar + detail panel */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Grid */}
        <div className="flex-1 overflow-auto">
          <div className="min-w-[420px] h-full flex flex-col">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b border-bdr bg-s2 shrink-0">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`text-center text-xs font-semibold py-2 ${i === 0 ? 'text-danger/70' : i === 6 ? 'text-accent/70' : 'text-ink-3'}`}>
                  {w}
                </div>
              ))}
            </div>

            {/* Weeks */}
            <div className="flex-1">
              {weeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 border-b border-bdr" style={{ minHeight: 88 }}>
                  {week.map((day, di) => {
                    const key = day.format('YYYY-MM-DD');
                    const events = eventMap[key] || [];
                    const isToday = key === todayStr;
                    const isCurrentMonth = day.month() === viewDate.month();
                    const isSelected = selectedDay === key;
                    const isSun = di === 0;
                    const isSat = di === 6;

                    return (
                      <div
                        key={di}
                        onClick={() => setSelectedDay(isSelected ? null : key)}
                        className={`p-1 border-r border-bdr last:border-r-0 cursor-pointer transition-colors overflow-hidden
                          ${isSelected ? 'bg-accent/8' : isToday ? 'bg-amber-50/60' : 'hover:bg-s2'}
                          ${!isCurrentMonth ? 'opacity-35' : ''}`}
                      >
                        {/* Day number */}
                        <div className="flex items-center justify-center mb-0.5">
                          <span className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full leading-none
                            ${isToday ? 'bg-accent text-white' : isSun ? 'text-danger/80' : isSat ? 'text-accent/80' : 'text-ink-2'}`}>
                            {day.date()}
                          </span>
                        </div>

                        {/* Event chips */}
                        <div className="space-y-0.5">
                          {events.slice(0, 3).map((ev, i) => (
                            <div
                              key={i}
                              className="text-[10px] leading-tight px-1.5 py-0.5 rounded font-medium truncate"
                              style={{ background: ev.color + '22', color: ev.color, border: `1px solid ${ev.color}40` }}
                            >
                              {ev.type === 'timer' && <span className="mr-0.5">⏰</span>}
                              {ev.label}
                            </div>
                          ))}
                          {events.length > 3 && (
                            <div className="text-[10px] text-ink-3 pl-1">+{events.length - 3} 筆</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Day detail panel — sidebar on desktop, slide-up on mobile */}
        {selectedDay && (
          <aside className="border-t md:border-t-0 md:border-l border-bdr bg-s1 md:w-72 shrink-0 overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-bdr sticky top-0 bg-s1 z-10">
              <h3 className="font-semibold text-ink text-sm">
                {dayjs(selectedDay).format('M月D日 (dd)')}
              </h3>
              <button onClick={() => setSelectedDay(null)} className="text-ink-3 hover:text-ink">✕</button>
            </div>

            {selectedEvents.length === 0 ? (
              <div className="px-4 py-8 text-center text-ink-3 text-sm">無行程</div>
            ) : (
              <div className="p-3 space-y-2">
                {/* Group by type */}
                {['client', 'timer'].map((type) => {
                  const group = selectedEvents.filter((e) => e.type === type);
                  if (group.length === 0) return null;
                  return (
                    <div key={type}>
                      <p className="text-[10px] font-bold text-ink-3 uppercase tracking-wider px-1 mb-1.5">
                        {type === 'client' ? '📅 客戶追蹤' : '⏰ 計時提醒'}
                      </p>
                      <div className="space-y-1.5">
                        {group.map((ev, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-2 rounded-xl px-3 py-2.5"
                            style={{ background: ev.color + '14', borderLeft: `3px solid ${ev.color}` }}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-ink truncate">{ev.label}</p>
                              {ev.sub && (
                                <p className="text-xs text-ink-3 mt-0.5">{ev.sub}</p>
                              )}
                              {ev.client?.phone && (
                                <a
                                  href={`tel:${ev.client.phone}`}
                                  className="text-xs text-accent underline mt-0.5 block"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {ev.client.phone}
                                </a>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
