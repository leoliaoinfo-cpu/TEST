import { useState } from 'react';
import { useApp } from './context';
import Header from './components/Header';
import JournalPage from './components/journal/JournalPage';
import CrmPage from './components/crm/CrmPage';
import SalaryPage from './components/salary/SalaryPage';
import SettingsPanel from './components/SettingsPanel';
import TimerModal from './components/TimerModal';

export default function App() {
  const { loading } = useApp();
  const [tab, setTab] = useState('crm');
  const [showSettings, setShowSettings] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-bdr border-t-accent animate-spin mx-auto mb-4" />
          <p className="text-ink-3 text-sm">載入中…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg font-sans text-ink">
      {/* Desktop top header */}
      <Header tab={tab} setTab={setTab} onSettings={() => setShowSettings(true)} />

      {/* Main content — bottom padding for mobile nav */}
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
