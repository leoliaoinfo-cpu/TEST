import { useState, useRef } from 'react';
import { db } from '../db';
import { useApp } from '../context';
import { today, addDays } from '../utils/date';
import { CAT_COLORS, FIELD_COLORS, FIELD_COLOR_NAMES, generateId } from '../utils/crm';
import { ImeInput } from './ImeInput';
import dayjs from 'dayjs';

const HELP_CARDS = [
  { icon: '📓', title: '工作日誌', desc: '每日追蹤開發、提案進度，記錄接通/未接數量，計算成交業績。' },
  { icon: '👥', title: '客戶追蹤 CRM', desc: '管理所有客戶聯繫狀態、分類、意願度與追蹤日期。' },
  { icon: '💡', title: '客戶狀態', desc: '🟢追蹤中 / 🟡待聯繫（到期）/ 🟠逾半年 / 🔴逾一年。' },
  { icon: '⏰', title: '計時提醒', desc: '可在客戶詳情頁設定提醒，到期後強制彈出 Modal 確認。' },
  { icon: '💰', title: '薪資計算', desc: '輸入當月成交案件，自動依公式計算底薪、各項獎金與總薪資。' },
  { icon: '📊', title: '績效總覽', desc: '年度/月度視覺化圖表，一眼掌握業績趨勢。' },
  { icon: '💾', title: '備份與還原', desc: '下載 JSON 備份所有資料，或上傳 JSON 檔案進行還原。' },
  { icon: '📦', title: '舊版資料匯入', desc: '支援匯入舊版格式 { _v:1, crm, jnl, sal } 的 JSON 備份。' },
];

const SECTION_KEYS = ['backup', 'import', 'cats', 'stages', 'fields', 'archive', 'help'];
const SECTION_LABELS = {
  backup: '💾 備份還原',
  import: '📥 名單匯入',
  cats: '🏷 客戶分類',
  stages: '📶 業務進度',
  fields: '✏️ 自訂欄位',
  archive: '🗄 日誌封存',
  help: '📖 使用說明',
};

// ── Raw text parser for old CRM format ───────────────────────────────────────
function parseRawCrmText(text) {
  const PHONE_RE = /^0\d{7,10}$/;
  const SKIP_RE = /^(否|是|開發中|再追蹤|未接通|方案：|續約：|MMRWD|開發:|轉移:|簡訊|業務|公司名稱|連絡人|已加LINE|狀態|報價|廣告|電話|類型|營業|日期|建立)/;

  // Split into blocks by "廖冠銘" marker lines
  const blocks = text.split(/\n?廖冠銘[\t ]*/);
  const records = [];

  blocks.forEach((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l && !SKIP_RE.test(l));
    if (lines.length === 0) return;

    // Company name: first meaningful line
    const company = lines[0];
    if (!company || company.length < 2) return;

    let contact = '';
    let phone = '';

    // Line after company: if it doesn't look like a phone or status, it's the contact
    if (lines[1] && !PHONE_RE.test(lines[1]) && !/^\d+$/.test(lines[1])) {
      // Split by tab in case "陳小姐\t否\t未接通"
      const parts = lines[1].split(/\t+/);
      if (parts[0] && !SKIP_RE.test(parts[0]) && parts[0] !== company) {
        contact = parts[0];
      }
    }

    // Find phone: a line that's purely digits starting with 0, length 8-11
    for (const l of lines.slice(1)) {
      const clean = l.split(/\s+/)[0]; // take first token
      if (PHONE_RE.test(clean)) { phone = clean; break; }
    }

    records.push({ name: company, contact, phone });
  });

  return records;
}

export default function SettingsPanel({ onClose }) {
  const { cats, stages, customFields, saveCats, saveStages, saveCustomFields, reloadAll, saveClient } = useApp();
  const [activeSection, setActiveSection] = useState('backup');
  const [status, setStatus] = useState('');
  const [archiveStatus, setArchiveStatus] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasteStatus, setPasteStatus] = useState('');
  const [rawText, setRawText] = useState('');
  const [preview, setPreview] = useState(null); // parsed records
  const [importStatus, setImportStatus] = useState('');
  const fileRef = useRef(null);
  const legacyRef = useRef(null);

  // ── Backup/Restore ──────────────────────────────────────────────────────
  async function handleExport() {
    try {
      const data = await db.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `business-assistant-backup-${today()}.json`;
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
      if (data._v === 1) await db.importLegacy(data);
      else await db.importAll(data);
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

  // ── Raw text import ──────────────────────────────────────────────────────
  function handleParseRaw() {
    const records = parseRawCrmText(rawText).map((r) => ({ ...r, import: true }));
    setPreview(records);
    setImportStatus(records.length > 0 ? '' : '❌ 解析不到任何資料，請確認格式');
  }

  async function handleImportRaw() {
    if (!preview || preview.length === 0) return;
    const defaultStageId = stages[0]?.id || '';

    // Find or create "匯入區" category
    let importCat = cats.find((c) => c.name === '匯入區');
    if (!importCat) {
      importCat = { id: generateId('cat'), name: '匯入區', colorIdx: 2, order: cats.length };
      await saveCats([...cats, importCat]);
    }
    const importCatId = importCat.id;

    let count = 0;
    for (const r of preview) {
      if (!r.import) continue;
      const client = {
        id: generateId('client'),
        name: r.name,
        phone: r.phone || '',
        notes: r.contact ? `聯絡人：${r.contact}` : '',
        catId: importCatId,
        stageId: '',
        intentLevel: 0,
        nextDate: addDays(today(), 1),
        log: [],
        missedCalls: 0,
        createdAt: dayjs().format('YYYY-MM-DDTHH:mm:ss'),
      };
      await saveClient(client);
      count++;
    }
    setImportStatus(`✅ 已匯入 ${count} 筆客戶至「匯入區」`);
    setPreview(null);
    setRawText('');
  }

  function togglePreviewRow(idx) {
    setPreview((prev) => prev.map((r, i) => i === idx ? { ...r, import: !r.import } : r));
  }

  async function handleArchive() {
    const cutoffStr = dayjs().subtract(3, 'month').format('YYYY-MM-DD');
    try {
      const count = await db.archiveJournalBefore(cutoffStr);
      setArchiveStatus(`✅ 已封存 ${count} 筆舊日誌（${cutoffStr} 之前）`);
    } catch (e) {
      setArchiveStatus('❌ 封存失敗：' + e.message);
    }
  }

  async function handlePasteImport() {
    if (!pasteText.trim()) { setPasteStatus('❌ 請先貼上 JSON 資料'); return; }
    try {
      const data = JSON.parse(pasteText.trim());
      if (data._v === 1) await db.importLegacy(data);
      else await db.importAll(data);
      await reloadAll();
      setPasteStatus('✅ 匯入成功，已重新載入資料');
      setPasteText('');
    } catch (err) {
      setPasteStatus('❌ 解析失敗：' + err.message);
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-s1 border-l border-bdr shadow-panel z-50 flex flex-col anim-slide-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bdr shrink-0">
          <h2 className="font-bold text-lg text-ink">⚙️ 設定</h2>
          <button onClick={onClose} className="btn-ghost text-xl leading-none px-2 py-1">✕</button>
        </div>

        {/* Section tabs */}
        <div className="flex gap-0.5 px-3 py-2 border-b border-bdr overflow-x-auto shrink-0">
          {SECTION_KEYS.map((k) => (
            <button
              key={k}
              onClick={() => setActiveSection(k)}
              className={`flex-none text-xs px-2.5 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
                activeSection === k ? 'bg-accent/10 text-accent' : 'text-ink-3 hover:bg-s3'
              }`}
            >
              {SECTION_LABELS[k]}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* ── Backup ── */}
          {activeSection === 'backup' && (
            <section className="space-y-4">
              <div className="card p-4 space-y-3">
                <h3 className="font-semibold text-ink">備份與還原</h3>
                <div className="flex flex-wrap gap-2">
                  <button onClick={handleExport} className="btn-primary">⬇️ 下載備份 (.json)</button>
                  <button onClick={() => fileRef.current?.click()} className="btn-outline">⬆️ 上傳還原</button>
                  <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
                </div>
                <p className="text-xs text-ink-3">還原會覆蓋現有所有資料，請先下載備份。</p>
                {status && <p className="text-sm text-ink-2 bg-s2 rounded-lg px-3 py-2">{status}</p>}
              </div>
              <div className="card p-4 space-y-3">
                <h3 className="font-semibold text-ink text-sm">舊版資料匯入（v1 格式）</h3>
                <button onClick={() => legacyRef.current?.click()} className="btn-outline text-sm">匯入舊版 JSON 檔案</button>
                <input ref={legacyRef} type="file" accept=".json" className="hidden" onChange={handleLegacyImport} />
                <p className="text-xs text-ink-3">支援格式：{'{ _v:1, crm, jnl, sal }'}</p>
              </div>
              <div className="card p-4 space-y-3">
                <h3 className="font-semibold text-ink text-sm">📋 貼上 JSON 匯入</h3>
                <p className="text-xs text-ink-3">將備份 JSON 直接貼上到下方，支援 v1 / v2 格式，自動識別。</p>
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder='貼上 JSON 資料（Ctrl+V）…'
                  rows={5}
                  className="w-full text-xs resize-y font-mono"
                />
                <button onClick={handlePasteImport} className="btn-primary text-sm">解析並匯入</button>
                {pasteStatus && <p className="text-sm text-ink-2 bg-s2 rounded-lg px-3 py-2">{pasteStatus}</p>}
              </div>
            </section>
          )}

          {/* ── Raw Import ── */}
          {activeSection === 'import' && (
            <section className="space-y-4">
              <div className="card p-4 space-y-3">
                <h3 className="font-semibold text-ink">📥 貼上名單匯入</h3>
                <p className="text-xs text-ink-3 leading-relaxed">
                  將舊系統複製的名單貼在下方，系統會自動解析<strong>公司名稱、聯絡人、電話</strong>。
                  解析後可逐筆勾選要匯入的資料。
                </p>
                <textarea
                  value={rawText}
                  onChange={(e) => { setRawText(e.target.value); setPreview(null); setImportStatus(''); }}
                  placeholder={'廖冠銘\n見晴動物醫院\n否\t開發中\n...'}
                  rows={8}
                  className="w-full text-xs resize-y font-mono"
                />
                <button onClick={handleParseRaw} className="btn-primary text-sm w-full">🔍 解析預覽</button>
              </div>

              {preview && preview.length > 0 && (
                <div className="card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-ink text-sm">解析結果 {preview.length} 筆</h4>
                    <div className="flex gap-2 text-xs">
                      <button onClick={() => setPreview((p) => p.map((r) => ({ ...r, import: true })))} className="text-accent hover:underline">全選</button>
                      <button onClick={() => setPreview((p) => p.map((r) => ({ ...r, import: false })))} className="text-ink-3 hover:underline">全消</button>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {preview.map((r, i) => (
                      <label key={i} className={`flex items-start gap-2 px-2 py-1.5 rounded-lg cursor-pointer ${r.import ? 'bg-ok/8' : 'hover:bg-s2'}`}>
                        <input
                          type="checkbox"
                          checked={!!r.import}
                          onChange={() => togglePreviewRow(i)}
                          className="mt-0.5 accent-accent shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-ink truncate">{r.name}</p>
                          <p className="text-[10px] text-ink-3">
                            {[r.contact && `聯絡人：${r.contact}`, r.phone].filter(Boolean).join('　')}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                  <button
                    onClick={handleImportRaw}
                    disabled={!preview.some((r) => r.import)}
                    className="btn-primary text-sm w-full disabled:opacity-40"
                  >
                    ✅ 匯入選取的 {preview.filter((r) => r.import).length} 筆
                  </button>
                </div>
              )}

              {importStatus && <p className="text-sm text-ink-2 bg-s2 rounded-lg px-3 py-2">{importStatus}</p>}
            </section>
          )}

          {/* ── Cats ── */}
          {activeSection === 'cats' && (
            <ListEditor
              title="客戶分類"
              items={cats}
              colors={CAT_COLORS}
              colorCount={7}
              onChange={saveCats}
            />
          )}

          {/* ── Stages ── */}
          {activeSection === 'stages' && (
            <ListEditor
              title="業務進度"
              items={stages}
              colors={CAT_COLORS}
              colorCount={7}
              onChange={saveStages}
            />
          )}

          {/* ── Custom Fields ── */}
          {activeSection === 'fields' && (
            <CustomFieldEditor
              fields={customFields}
              onChange={saveCustomFields}
            />
          )}

          {/* ── Archive ── */}
          {activeSection === 'archive' && (
            <div className="card p-4 space-y-3">
              <h3 className="font-semibold text-ink">日誌封存</h3>
              <p className="text-xs text-ink-3">將 3 個月前的日誌封存到獨立儲存，減少首頁載入負擔，歷史查詢不受影響。</p>
              <button onClick={handleArchive} className="btn-outline">封存 3 個月前日誌</button>
              {archiveStatus && <p className="text-sm text-ink-2 bg-s2 rounded-lg px-3 py-2">{archiveStatus}</p>}
            </div>
          )}

          {/* ── Help ── */}
          {activeSection === 'help' && (
            <div className="space-y-3">
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
              <p className="text-center text-xs text-ink-3 py-2">業務助理 v2.0 • 純單機版</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── ListEditor (shared for cats & stages) ────────────────────────────────────
function ListEditor({ title, items, colors, colorCount, onChange }) {
  const sorted = [...items].sort((a, b) => a.order - b.order);

  function addItem() {
    const newItem = { id: generateId('item'), name: '新分類', colorIdx: 0, order: sorted.length };
    onChange([...items, newItem]);
  }

  function updateItem(id, patch) {
    onChange(items.map((it) => it.id === id ? { ...it, ...patch } : it));
  }

  function deleteItem(id) {
    onChange(items.filter((it) => it.id !== id));
  }

  function moveItem(id, dir) {
    const list = [...sorted];
    const idx = list.findIndex((it) => it.id === id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    [list[idx].order, list[swapIdx].order] = [list[swapIdx].order, list[idx].order];
    onChange(list);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-ink">{title}</h3>
        <button onClick={addItem} className="btn-primary text-xs">+ 新增</button>
      </div>
      {sorted.length === 0 && (
        <p className="text-center text-ink-3 text-sm py-6">尚無項目</p>
      )}
      {sorted.map((item, idx) => (
        <div key={item.id} className="card p-3 flex items-center gap-2">
          {/* Color picker */}
          <div className="relative">
            <div
              className="w-5 h-5 rounded-full border-2 border-white shadow cursor-pointer shrink-0"
              style={{ background: colors[item.colorIdx % colorCount] }}
            />
            <select
              value={item.colorIdx}
              onChange={(e) => updateItem(item.id, { colorIdx: Number(e.target.value) })}
              className="absolute inset-0 opacity-0 cursor-pointer w-full"
            >
              {Array.from({ length: colorCount }, (_, i) => (
                <option key={i} value={i}>色 {i + 1}</option>
              ))}
            </select>
          </div>

          <ImeInput
            value={item.name}
            onChange={(e) => updateItem(item.id, { name: e.target.value })}
            className="flex-1 text-sm"
          />

          {/* Order buttons */}
          <button onClick={() => moveItem(item.id, -1)} disabled={idx === 0}
            className="text-ink-3 hover:text-ink disabled:opacity-20 text-xs px-1">↑</button>
          <button onClick={() => moveItem(item.id, 1)} disabled={idx === sorted.length - 1}
            className="text-ink-3 hover:text-ink disabled:opacity-20 text-xs px-1">↓</button>

          <button onClick={() => deleteItem(item.id)} className="text-danger/50 hover:text-danger text-sm ml-1">✕</button>
        </div>
      ))}
    </div>
  );
}

// ── CustomFieldEditor ─────────────────────────────────────────────────────────
function CustomFieldEditor({ fields, onChange }) {
  function addField() {
    const newField = { id: generateId('field'), name: '新欄位', type: 'text', colorIdx: 0 };
    onChange([...fields, newField]);
  }

  function updateField(id, patch) {
    onChange(fields.map((f) => f.id === id ? { ...f, ...patch } : f));
  }

  function deleteField(id) {
    onChange(fields.filter((f) => f.id !== id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-ink">自訂欄位</h3>
          <p className="text-xs text-ink-3 mt-0.5">會顯示在每個客戶的詳情頁中</p>
        </div>
        <button onClick={addField} className="btn-primary text-xs">+ 新增</button>
      </div>

      {fields.length === 0 && (
        <p className="text-center text-ink-3 text-sm py-6">尚無自訂欄位</p>
      )}

      {fields.map((field) => (
        <div key={field.id} className="card p-3 space-y-2">
          <div className="flex items-center gap-2">
            {/* Color picker */}
            <div className="relative shrink-0">
              <div
                className="w-5 h-5 rounded-full border-2 border-white shadow cursor-pointer"
                style={{ background: FIELD_COLORS[field.colorIdx || 0] }}
              />
              <select
                value={field.colorIdx || 0}
                onChange={(e) => updateField(field.id, { colorIdx: Number(e.target.value) })}
                className="absolute inset-0 opacity-0 cursor-pointer w-full"
              >
                {FIELD_COLORS.map((c, i) => (
                  <option key={i} value={i}>{FIELD_COLOR_NAMES[i]}</option>
                ))}
              </select>
            </div>
            <ImeInput
              value={field.name}
              onChange={(e) => updateField(field.id, { name: e.target.value })}
              placeholder="欄位名稱"
              className="flex-1 text-sm"
            />
            <select
              value={field.type || 'text'}
              onChange={(e) => updateField(field.id, { type: e.target.value })}
              className="text-xs py-1 w-20"
            >
              <option value="text">文字</option>
              <option value="number">數字</option>
              <option value="date">日期</option>
            </select>
            <button onClick={() => deleteField(field.id)} className="text-danger/50 hover:text-danger text-sm shrink-0">✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}
