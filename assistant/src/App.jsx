import { useState, Component } from 'react';
import { useApp } from './context';
import Header from './components/Header';
import JournalPage from './components/journal/JournalPage';
import CrmPage from './components/crm/CrmPage';
import SalaryPage from './components/salary/SalaryPage';
import CalendarPage from './components/calendar/CalendarPage';
import SettingsPanel from './components/SettingsPanel';
import TimerModal from './components/TimerModal';

const LOCK_KEY = 'app_unlocked_session';
const CORRECT_PIN = '1998';

// ── Lock Screen ───────────────────────────────────────────────────────────────
function LockScreen({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (pin === CORRECT_PIN) {
      sessionStorage.setItem(LOCK_KEY, '1');
      onUnlock();
    } else {
      setError(true);
      setShake(true);
      setPin('');
      setTimeout(() => setShake(false), 500);
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#fdf6ee',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Noto Sans TC', system-ui, sans-serif",
    }}>
      <style>{`
        @keyframes lockShake {
          0%,100%{transform:translateX(0)}
          20%{transform:translateX(-8px)}
          40%{transform:translateX(8px)}
          60%{transform:translateX(-6px)}
          80%{transform:translateX(6px)}
        }
        .lock-shake { animation: lockShake 0.45s ease; }
      `}</style>

      <div style={{
        background: '#fff8f0', border: '1px solid #f0d9b8',
        borderRadius: 20, padding: '40px 32px', width: '100%', maxWidth: 320,
        boxShadow: '0 8px 32px rgba(180,120,60,0.12)', textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>🔐</div>
        <h2 style={{ color: '#2c1a08', fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>業務系統</h2>
        <p style={{ color: '#b88860', fontSize: 13, margin: '0 0 28px' }}>請輸入密碼以繼續</p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => { setPin(e.target.value); setError(false); }}
            placeholder="••••"
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '12px 16px', fontSize: 22, textAlign: 'center',
              letterSpacing: 8, border: `2px solid ${error ? '#d03030' : '#f0d9b8'}`,
              borderRadius: 12, background: '#fef0dc', color: '#2c1a08',
              outline: 'none', marginBottom: 8,
            }}
            className={shake ? 'lock-shake' : ''}
          />
          {error && (
            <p style={{ color: '#d03030', fontSize: 12, margin: '0 0 12px' }}>密碼錯誤，請再試一次</p>
          )}
          <button
            type="submit"
            style={{
              width: '100%', padding: '12px', marginTop: 8,
              background: '#c9670a', color: '#fff', border: 'none',
              borderRadius: 12, fontSize: 15, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            解鎖
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Error Boundary — 任何子元件炸掉都能顯示有意義的訊息 ──────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err) {
    return { error: err };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'sans-serif', background: '#fdf6ee', minHeight: '100vh' }}>
          <h2 style={{ color: '#c03030' }}>⚠️ 發生錯誤，請重新整理頁面</h2>
          <pre style={{ background: '#fdeaea', padding: '1rem', borderRadius: 8, fontSize: 12, overflowX: 'auto' }}>
            {String(this.state.error)}
            {'\n'}
            {this.state.error?.stack}
          </pre>
          <p style={{ color: '#7a5030', fontSize: 14 }}>
            若持續出現，請按 F12 → Console 截圖後回報。
          </p>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: '8px 20px', background: '#c9670a', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          >
            重試
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main App ──────────────────────────────────────────────────────────────────
function AppInner() {
  const { loading, storageMode, timers } = useApp();
  const [tab, setTab] = useState('crm');
  const [showSettings, setShowSettings] = useState(false);
  const [openClientId, setOpenClientId] = useState(null);
  const [showTimerPanel, setShowTimerPanel] = useState(false);

  const timerPendingCount = timers.filter((t) => !t.confirmedAt).length;
  const timerHasHistory = timers.some((t) => t.confirmedAt);

  function handleOpenClient(clientId) {
    setOpenClientId(clientId);
    setTab('crm');
  }

  function handleSetTab(t) {
    if (t !== 'crm') setOpenClientId(null);
    setTab(t);
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#fdf6ee' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            border: '4px solid #f0d9b8', borderTopColor: '#c9670a',
            animation: 'spin 0.8s linear infinite', margin: '0 auto 16px',
          }} />
          <p style={{ color: '#b88860', fontSize: 14 }}>載入中…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg font-sans text-ink">
      {/* 儲存模式提示：僅記憶體模式才是真正無法保存 */}
      {storageMode === 'memory' && (
        <div style={{ background: '#fdeaea', borderBottom: '1px solid #f0c0c0', padding: '8px 16px', fontSize: 12, color: '#a02020', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>
            ⚠️ <strong>目前無法保存資料</strong>（瀏覽器封鎖了本機儲存，重新整理後將遺失）。
            請改用 <strong>https</strong> 網址開啟，或在瀏覽器設定允許此網站儲存資料。
          </span>
          <button
            onClick={() => setShowSettings(true)}
            style={{ background: '#c03030', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
          >
            立即下載備份
          </button>
        </div>
      )}
      {storageMode === 'local' && (
        <div style={{ background: '#fff5e8', borderBottom: '1px solid #f0d9b8', padding: '6px 16px', fontSize: 12, color: '#7a5030' }}>
          💾 相容儲存模式（資料已保存於此瀏覽器）。容量較有限，建議定期到「設定 → 備份還原」下載備份。
        </div>
      )}

      <Header
        tab={tab}
        setTab={handleSetTab}
        onSettings={() => setShowSettings(true)}
        timerPendingCount={timerPendingCount}
        timerHasHistory={timerHasHistory}
        onTimerBell={() => setShowTimerPanel(true)}
      />

      <main className="pb-20 md:pb-0">
        <div className="anim-fade-in" key={tab}>
          {tab === 'journal' && <JournalPage />}
          {tab === 'crm' && <CrmPage openClientId={openClientId} />}
          {tab === 'calendar' && <CalendarPage onOpenClient={handleOpenClient} />}
          {tab === 'salary' && <SalaryPage />}
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-s1 border-t border-bdr flex z-30 pb-safe">
        {[
          { key: 'journal', icon: '📓', label: '日誌' },
          { key: 'crm', icon: '👥', label: '客戶' },
          { key: 'calendar', icon: '📅', label: '日曆' },
          { key: 'salary', icon: '💰', label: '薪資' },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => handleSetTab(item.key)}
            className={`flex-1 flex flex-col items-center py-2.5 gap-0.5 transition-colors ${
              tab === item.key ? 'text-accent' : 'text-ink-3'
            }`}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        ))}
        <button
          onClick={() => setShowSettings(true)}
          className="flex-1 flex flex-col items-center py-2.5 gap-0.5 text-ink-3"
        >
          <span className="text-lg leading-none">⚙️</span>
          <span className="text-[10px] font-medium">設定</span>
        </button>
      </nav>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      <TimerModal showPanel={showTimerPanel} setShowPanel={setShowTimerPanel} />
    </div>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem(LOCK_KEY) === '1'
  );

  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;

  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
