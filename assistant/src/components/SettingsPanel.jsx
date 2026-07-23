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

// ── Universal raw-text parser ─────────────────────────────────────────────────
// Works on ANY copy-paste shape (tabs, spaces, mobile-flattened tables, paged
// lists): every whitespace-separated token is classified first, then a state
// machine assembles records. A company-name token starts a record; phones,
// regions and contacts attach to the current record until the next company.

// Contact-person titles — a token ending with these is a contact, never a company
const TITLE_RE = /(先生|小姐|太太|女士|經理|老闆|店長|主任|醫師|藥師|會計|副理|協理|特助|秘書|總監)$/;
// Exact noise words: table headers, yes/no flags, status words
const NOISE_EXACT = new Set([
  '申請轉單', '公司名稱', '類型', '地區', '電話', '手機', '狀態', '權重分數',
  '開發原因', '業務', '連絡人', '聯絡人', '是', '否', '未接通', '開發中',
  '再追蹤', '沒網站', '沒手機版', '未開發', '已收資料', 'FB買廣告', '朋友介紹',
  '網路來電諮詢', '有手機號碼', '已結案', 'SSL', '查網址', '網站簡陋',
  '國外主機', '無店鋪店家', '區域型店家', '轉單客戶', '簡訊', '營業', '日期', '建立',
]);
// Noise by prefix: status/date rows, pagination footers, field labels
const NOISE_PREFIX_RE = /^(開發中|建立日期|轉移日期|查詢結果|搜尋條件|搜尋總筆數|開發主因|可能性重覆|方案[:：]|續約[:：]|開發[:：]|轉移[:：]|報價[:：]?|廣告[:：]?|已加LINE|共【?\d+】?筆|MMRWD|入口相關|未放關鍵字|開錯關鍵字|接洽不到|網路廣告|買消費性|Flash|個人網址|無店鋪|區域型)/;
// Noise if contained anywhere: product/plan types and 開發原因 reason strings
const NOISE_ANY_RE = /(網站製作|曝光計畫|分身行銷|快模|沒網站|沒手機版|關鍵字|入口相關行業|轉單客戶|手機版\+電腦版)/;
// Fully anchored — a loose prefix match would swallow dashed phone numbers
// like 02-23456789 or 0912-345-678
const DATE_RE = /^\d{2,4}[-\/.]\d{1,2}([-\/.]\d{1,2})?$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;
const REGION_RE = /^[一-鿿]{1,3}[市縣區]$/;
const NOT_REGION_RE = /(超市|夜市|菜市)$/;
// 2-3 char CJK companies are rare; allow them only with a shop-ish ending
const BIZ_SHORT_RE = /[行社店廠局坊軒閣苑莊舖鋪]$/;

// Classify one whitespace-separated token
function classifyToken(tok, reps) {
  if (!tok) return { type: 'noise' };
  if (reps.has(tok)) return { type: 'noise' };
  if (NOISE_EXACT.has(tok)) return { type: 'noise' };
  if (DATE_RE.test(tok) || TIME_RE.test(tok)) return { type: 'noise' };

  // Numeric-ish tokens → phone / masked phone / plain-number noise
  if (/^[\d\-();,.X ]+$/i.test(tok)) {
    const digits = tok.replace(/[^\dX]/gi, '');
    if (/^0\d{7,9}$/.test(digits)) return { type: 'phone', value: digits };
    if (/X/i.test(digits)) return { type: 'masked' };
    return { type: 'noise' }; // scores (80/205), page numbers, lone zeros
  }

  if (NOISE_PREFIX_RE.test(tok)) return { type: 'noise' };
  if (NOISE_ANY_RE.test(tok)) return { type: 'noise' };
  // Parenthesised fragments like （未滿5組） — but keep real companies
  if (/^[（(]/.test(tok) && !/(公司|有限|企業)/.test(tok)) return { type: 'noise' };

  if (REGION_RE.test(tok) && !NOT_REGION_RE.test(tok)) return { type: 'region', value: tok };
  if (tok.length <= 6 && TITLE_RE.test(tok)) return { type: 'title', value: tok };
  // Short pure-CJK token without a shop-ish ending → person name (rep/contact)
  if (/^[一-鿿]{2,3}$/.test(tok) && !BIZ_SHORT_RE.test(tok)) return { type: 'person', value: tok };
  // Anything else with CJK or ≥2 latin letters is a company name
  if (tok.length >= 2 && (/[一-鿿]/.test(tok) || /[A-Za-z]{2,}/.test(tok))) {
    return { type: 'company', value: tok };
  }
  return { type: 'noise' };
}

// Single parsing pass with a known set of rep names to ignore
function coreParse(text, reps) {
  const records = [];
  let cur = null;
  let curLine = -1;
  let masked = 0;

  text.split('\n').forEach((line, li) => {
    let lastWasCompany = false;
    line.split(/[\s　]+/).forEach((raw) => {
      const tok = raw.trim();
      if (!tok) return;
      const cls = classifyToken(tok, reps);

      if (cls.type === 'masked') { masked++; lastWasCompany = false; return; }
      if (cls.type === 'noise') { lastWasCompany = false; return; }
      if (cls.type === 'phone') {
        if (cur) {
          if (!cur.phone) cur.phone = cls.value;
          else if (!cur.phone2 && cls.value !== cur.phone) cur.phone2 = cls.value;
        }
        lastWasCompany = false; return;
      }
      if (cls.type === 'region') {
        if (cur && !cur.region) cur.region = cls.value;
        lastWasCompany = false; return;
      }
      if (cls.type === 'title') {
        if (cur && !cur.contact) cur.contact = cls.value;
        lastWasCompany = false; return;
      }
      if (cls.type === 'person') {
        // A bare person name counts as the contact only right after the company
        // (≤2 lines) — later ones are sales-rep columns, not contacts.
        if (cur && !cur.contact && li - curLine <= 2) cur.contact = cls.value;
        lastWasCompany = false; return;
      }
      // company token → new record; merge split latin names on the same line
      if (lastWasCompany && cur && curLine === li) {
        cur.name += ' ' + cls.value;
      } else {
        cur = { name: cls.value, contact: '', phone: '', phone2: '', region: '' };
        curLine = li;
        records.push(cur);
      }
      lastWasCompany = true;
    });
  });
  return { records, masked };
}

// Count 2-3 char CJK person-name tokens that lead a line — candidates for the
// rep-name record separator used by the vertical export format.
function countLeadingPersons(text) {
  const counts = {};
  text.split('\n').forEach((line) => {
    const tok = line.trim().split(/[\s　]+/)[0] || '';
    if (/^[一-鿿]{2,3}$/.test(tok) && !NOISE_EXACT.has(tok)
        && !TITLE_RE.test(tok) && !REGION_RE.test(tok) && !BIZ_SHORT_RE.test(tok)) {
      counts[tok] = (counts[tok] || 0) + 1;
    }
  });
  return counts;
}

function parseRawCrmText(text, markerInput = '') {
  const manual = new Set(markerInput.split(/[,，\s]+/).filter(Boolean));

  // Pass 1: parse with manual reps only, to estimate the record count
  const pass1 = coreParse(text, manual);
  const estimate = Math.max(pass1.records.length, 1);

  // A token leading ≥⅓ of the records' lines is a rep-name separator, not data
  const reps = new Set(manual);
  Object.entries(countLeadingPersons(text)).forEach(([tok, n]) => {
    if (n >= Math.max(2, Math.ceil(estimate / 3))) reps.add(tok);
  });

  const { records, masked } = reps.size > manual.size ? coreParse(text, reps) : pass1;

  // Dedupe by company name (dumps flag 可能性重覆名單) — merge missing fields
  const byName = new Map();
  for (const r of records) {
    const prev = byName.get(r.name);
    if (prev) {
      if (!prev.phone) { prev.phone = r.phone; prev.phone2 = prev.phone2 || r.phone2; }
      if (!prev.contact) prev.contact = r.contact;
      if (!prev.region) prev.region = r.region;
    } else {
      byName.set(r.name, r);
    }
  }

  const final = [...byName.values()].map((r) => ({
    name: r.name,
    contact: r.contact,
    phone: r.phone,
    note: [r.region && `地區：${r.region}`, r.phone2 && `另一電話：${r.phone2}`]
      .filter(Boolean).join('，'),
  }));

  return { records: final, markers: [...reps], masked, merged: records.length - final.length };
}

export default function SettingsPanel({ onClose }) {
  const {
    cats, stages, customFields, saveCats, saveStages, saveCustomFields, reloadAll, saveClient,
    backupInfo, linkBackupFile, reactivateBackup, unlinkBackupFile, restoreFromBackupFile,
  } = useApp();
  const [autoBackupMsg, setAutoBackupMsg] = useState('');

  async function handleLinkBackup() {
    try {
      const name = await linkBackupFile();
      setAutoBackupMsg(`✅ 已連結「${name}」，之後每次變動都會自動保存`);
    } catch (e) {
      if (e?.name !== 'AbortError') setAutoBackupMsg('❌ 連結失敗：' + (e?.message || e));
    }
  }
  async function handleReactivate() {
    const ok = await reactivateBackup();
    setAutoBackupMsg(ok ? '✅ 已重新啟用自動備份' : '❌ 未取得權限');
  }
  async function handleRestoreFromFile() {
    if (!confirm('從備份檔還原會覆蓋現有所有資料，確定繼續？')) return;
    try {
      await restoreFromBackupFile();
      setAutoBackupMsg('✅ 已從備份檔還原所有資料');
    } catch (e) {
      if (e?.name !== 'AbortError') setAutoBackupMsg('❌ 還原失敗：' + (e?.message || e));
    }
  }
  async function handleUnlink() {
    await unlinkBackupFile();
    setAutoBackupMsg('已取消自動備份連結');
  }
  const [activeSection, setActiveSection] = useState('backup');
  const [status, setStatus] = useState('');
  const [archiveStatus, setArchiveStatus] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasteStatus, setPasteStatus] = useState('');
  const [rawText, setRawText] = useState('');
  const [repMarker, setRepMarker] = useState(''); // manual rep-name override
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
    const { records, markers, masked, merged } = parseRawCrmText(rawText, repMarker);
    setPreview(records.map((r) => ({ ...r, import: true })));
    if (records.length === 0) {
      setImportStatus('❌ 解析不到任何資料，請確認貼上的內容包含公司名稱');
    } else {
      const parts = [`🔍 解析出 ${records.length} 筆`];
      if (markers.length > 0) parts.push(`已略過業務姓名：${markers.join('、')}`);
      if (masked > 0) parts.push(`省略 ${masked} 個遮罩電話`);
      if (merged > 0) parts.push(`合併 ${merged} 筆重複`);
      setImportStatus(parts.join('，'));
    }
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
        notes: [r.contact && `聯絡人：${r.contact}`, r.note].filter(Boolean).join('，'),
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
              {/* ── Durable auto-backup (star feature) ── */}
              <div className="card p-4 space-y-3 border-2 border-accent/30">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-ink">🛡️ 自動保存到硬碟檔案</h3>
                  {backupInfo?.linked && backupInfo.permission === 'granted' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ok/15 text-ok font-medium">運作中</span>
                  )}
                </div>

                {!backupInfo?.supported ? (
                  <p className="text-xs text-ink-3 leading-relaxed">
                    此瀏覽器不支援自動檔案保存（建議用電腦版 Chrome 或 Edge）。
                    請改用下方「下載備份」定期手動保存。
                  </p>
                ) : !backupInfo.linked ? (
                  <>
                    <p className="text-xs text-ink-3 leading-relaxed">
                      連結一個硬碟上的備份檔，<strong>之後每次資料變動都會自動寫入</strong>，完全不用手動匯出。
                      建議把檔案存在 <strong>Google Drive／OneDrive／Dropbox 同步資料夾</strong>，
                      即使清除瀏覽器或換電腦，資料都還在。
                    </p>
                    <button onClick={handleLinkBackup} className="btn-primary text-sm">
                      🔗 連結自動備份檔案（一次設定，永久自動保存）
                    </button>
                  </>
                ) : (
                  <>
                    <div className="bg-s2 rounded-lg px-3 py-2 text-xs space-y-1">
                      <p className="text-ink-2">📄 檔案：<strong>{backupInfo.name}</strong></p>
                      {backupInfo.lastSaved && (
                        <p className="text-ink-3">上次自動保存：{dayjs(backupInfo.lastSaved).format('MM/DD HH:mm:ss')}</p>
                      )}
                    </div>
                    {backupInfo.permission !== 'granted' && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-2">
                        <p className="text-xs text-amber-700">⚠️ 瀏覽器重啟後需重新授權，才能繼續自動保存。</p>
                        <button onClick={handleReactivate} className="btn-primary text-xs">重新啟用自動備份</button>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button onClick={handleRestoreFromFile} className="btn-outline text-xs">📥 從備份檔還原</button>
                      <button onClick={handleUnlink} className="btn-ghost text-xs text-ink-3">取消連結</button>
                    </div>
                  </>
                )}

                <div className="flex items-center gap-2 pt-1 border-t border-bdr/40">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${backupInfo?.persisted ? 'bg-ok/15 text-ok' : 'bg-s3 text-ink-3'}`}>
                    {backupInfo?.persisted ? '✓ 已啟用防清除保護' : '一般儲存'}
                  </span>
                  <span className="text-[10px] text-ink-3">
                    {backupInfo?.persisted ? '瀏覽器不會自動清除本系統資料' : '瀏覽器可能在空間不足時清除資料'}
                  </span>
                </div>

                {autoBackupMsg && <p className="text-sm text-ink-2 bg-s2 rounded-lg px-3 py-2">{autoBackupMsg}</p>}
              </div>

              <div className="card p-4 space-y-3">
                <h3 className="font-semibold text-ink">手動備份與還原</h3>
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
                  將舊系統複製的名單貼在下方（任何格式皆可：直式名單、表格、分頁列表），
                  系統會自動解析<strong>公司名稱、聯絡人、電話、地區</strong>，
                  遮罩電話（如 0985869XXX）會自動省略。解析後可逐筆勾選要匯入的資料。
                </p>
                <ImeInput
                  value={repMarker}
                  onChange={(e) => setRepMarker(e.target.value)}
                  placeholder="業務姓名（留空＝自動偵測，多位業務以逗號分隔）"
                  className="w-full text-xs"
                />
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
                            {[r.contact && `聯絡人：${r.contact}`, r.phone || '（無電話）', r.note].filter(Boolean).join('　')}
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
