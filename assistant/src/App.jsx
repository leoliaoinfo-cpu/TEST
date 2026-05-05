import { useState, Component } from 'react';
import { useApp } from './context';
import Header from './components/Header';
import JournalPage from './components/journal/JournalPage';
import CrmPage from './components/crm/CrmPage';
import SalaryPage from './components/salary/SalaryPage';
import SettingsPanel from './components/SettingsPanel';
import TimerModal from './components/TimerModal';

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
  const { loading, dbUnavailable } = useApp();
  const [tab, setTab] = useState('crm');
  const [showSettings, setShowSettings] = useState(false);

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
      {/* DB 不可用提示（隱私模式 / file:// 限制）*/}
      {dbUnavailable && (
        <div style={{ background: '#fff5e8', borderBottom: '1px solid #f0d9b8', padding: '6px 16px', fontSize: 12, color: '#7a5030' }}>
          ⚠️ 儲存功能受限（瀏覽器安全設定）。資料不會被保存。建議改用
          <strong> http://localhost</strong> 方式開啟，或啟用 GitHub Pages。
        </div>
      )}

      <Header tab={tab} setTab={setTab} onSettings={() => setShowSettings(true)} />

      <main className="pb-20 md:pb-0">
        <div className="anim-fade-in" key={tab}>
          {tab === 'journal' && <JournalPage />}
          {tab === 'crm' && <CrmPage />}
          {tab === 'salary' && <SalaryPage />}
        </div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-s1 border-t border-bdr flex z-30 pb-safe">
        {[
          { key: 'journal', icon: '📓', label: '工作日誌' },
          { key: 'crm', icon: '👥', label: '客戶追蹤' },
          { key: 'salary', icon: '💰', label: '薪資計算' },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
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
      <TimerModal />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
