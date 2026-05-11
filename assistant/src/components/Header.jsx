export default function Header({ tab, setTab, onSettings, timerPendingCount = 0, timerHasHistory = false, onTimerBell }) {
  const tabs = [
    { key: 'journal', icon: '📓', label: '工作日誌' },
    { key: 'crm', icon: '👥', label: '客戶追蹤' },
    { key: 'calendar', icon: '📅', label: '日曆' },
    { key: 'salary', icon: '💰', label: '薪資計算' },
  ];

  return (
    <header className="hidden md:flex items-center bg-s1 border-b border-bdr px-4 h-14 sticky top-0 z-30 shadow-card">
      <div className="mr-6 shrink-0">
        <span className="font-bold text-accent text-base tracking-tight">業務系統</span>
        <span className="text-[10px] text-ink-3 ml-1.5">著作權人：廖冠銘</span>
      </div>
      <nav className="flex gap-1 flex-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-accent/10 text-accent'
                : 'text-ink-2 hover:bg-s3 hover:text-ink'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
      {(timerPendingCount > 0 || timerHasHistory) && (
        <button
          onClick={onTimerBell}
          className="relative btn-ghost text-xl px-2 mr-1"
          title="計時提醒"
        >
          🔔
          {timerPendingCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-accent text-white text-[9px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-0.5 leading-none">
              {timerPendingCount}
            </span>
          )}
        </button>
      )}
      <button
        onClick={onSettings}
        className="btn-ghost gap-1.5 text-sm"
        title="設定"
      >
        ⚙️ 設定
      </button>
    </header>
  );
}
