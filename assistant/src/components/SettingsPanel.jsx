import { useState, useRef } from 'react';
import { db } from '../db';
import { useApp } from '../context';

const HELP_CARDS = [
  { icon: '📓', title: '工作日誌', desc: '每日追蹤開發、提案進度，記錄接通/未接數量，計算成交業績。' },
  { icon: '👥', title: '客戶追蹤 CRM', desc: '管理所有客戶聯繫狀態、分類、意願度與追蹤日期。' },
  { icon: '💡', title: '客戶狀態', desc: '🟢追蹤中 / 🟡待聯繫（到期）/ 🟠逾半年 / 🔴逾一年。' },
  { icon: '⏰', title: '計時提醒', desc: '設定到期時間，到期後強制彈出 Modal 確認，並支援瀏覽器通知。' },
  { icon: '💰', title: '薪資計算', desc: '輸入當月成交案件，自動依公式計算底薪、各項獎金與總薪資。' },
  { icon: '📊', title: '績效總覽', desc: '年度/月度視覺化圖表，一眼掌握業績趨勢。' },
  { icon: '💾', title: '備份與還原', desc: '下載 JSON 備份所有資料，或上傳 JSON 檔案進行還原。' },
  { icon: '📦', title: '舊版資料匯入', desc: '支援匯入舊版格式 { _v:1, crm, jnl, sal } 的 JSON 備份。' },
];

export default function SettingsPanel({ onClose }) {
  const { reloadAll } = useApp();
  const [status, setStatus] = useState('');
  const [archiveStatus, setArchiveStatus] = useState('');
  const fileRef = useRef(null);
  const legacyRef = useRef(null);

  async function handleExport() {
    try {
      const data = await db.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `business-assistant-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus('✅ 備份下載成功');
    } catch (e) {
      setStatus('❌ 備份失敗：' + e.message);
    }
  }

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data._v === 1) {
        await db.importLegacy(data);
      } else {
        await db.importAll(data);
      }
      await reloadAll();
      setStatus('✅ 還原成功，已重新載入資料');
    } catch (err) {
      setStatus('❌ 還原失敗：' + err.message);
    }
    e.target.value = '';
  }

  async function handleLegacyImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await db.importLegacy(data);
      await reloadAll();
      setStatus('✅ 舊版資料匯入成功');
    } catch (err) {
      setStatus('❌ 舊版匯入失敗：' + err.message);
    }
    e.target.value = '';
  }

  async function handleArchive() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 3);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    try {
      const count = await db.archiveJournalBefore(cutoffStr);
      setArchiveStatus(`✅ 已封存 ${count} 筆舊日誌（${cutoffStr} 之前）`);
    } catch (e) {
      setArchiveStatus('❌ 封存失敗：' + e.message);
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-s1 border-l border-bdr shadow-panel z-50 flex flex-col anim-slide-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bdr">
          <h2 className="font-bold text-lg text-ink">⚙️ 設定</h2>
          <button onClick={onClose} className="btn-ghost text-xl leading-none px-2 py-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Backup section */}
          <section className="card p-4 space-y-3">
            <h3 className="font-semibold text-ink">💾 資料備份與還原</h3>
            <div className="flex flex-wrap gap-2">
              <button onClick={handleExport} className="btn-primary">
                ⬇️ 下載備份 (.json)
              </button>
              <button onClick={() => fileRef.current?.click()} className="btn-outline">
                ⬆️ 還原備份
              </button>
              <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
            </div>
            <p className="text-xs text-ink-3">還原會覆蓋現有所有資料，請先下載備份。</p>

            <hr className="border-bdr" />

            <h4 className="font-medium text-ink-2 text-sm">📦 舊版資料匯入（v1 格式）</h4>
            <button onClick={() => legacyRef.current?.click()} className="btn-outline text-sm">
              匯入舊版 JSON
            </button>
            <input ref={legacyRef} type="file" accept=".json" className="hidden" onChange={handleLegacyImport} />
            <p className="text-xs text-ink-3">支援格式：{'{ _v:1, crm, jnl, sal }'}</p>

            {status && (
              <p className="text-sm text-ink-2 bg-s2 rounded-lg px-3 py-2">{status}</p>
            )}
          </section>

          {/* Archive section */}
          <section className="card p-4 space-y-3">
            <h3 className="font-semibold text-ink">🗄 日誌封存</h3>
            <p className="text-xs text-ink-3">將 3 個月前的日誌封存，可加速載入。歷史查詢不受影響。</p>
            <button onClick={handleArchive} className="btn-outline text-sm">封存舊日誌</button>
            {archiveStatus && (
              <p className="text-sm text-ink-2 bg-s2 rounded-lg px-3 py-2">{archiveStatus}</p>
            )}
          </section>

          {/* Help cards */}
          <section>
            <h3 className="font-semibold text-ink mb-3">📖 使用說明</h3>
            <div className="grid gap-3">
              {HELP_CARDS.map((c, i) => (
                <div key={i} className="card p-3">
                  <div className="flex items-start gap-3">
                    <span className="text-xl mt-0.5">{c.icon}</span>
                    <div>
                      <p className="font-medium text-sm text-ink">{c.title}</p>
                      <p className="text-xs text-ink-3 mt-0.5 leading-relaxed">{c.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <p className="text-center text-xs text-ink-3 pb-2">業務助理 v2.0 • 純單機版</p>
        </div>
      </div>
    </>
  );
}
