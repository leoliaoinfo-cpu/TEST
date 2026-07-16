import { useState, useEffect } from 'react';
import { db } from '../../db';
import { generateId, formatMoney } from '../../utils/crm';
import dayjs from 'dayjs';

/**
 * 報價單產生器：填車型與項目價格 → 產生美觀的報價單（固定淺色，方便截圖給客人）。
 * 新增模式（quote=null）會把總額寫入客戶時間軸；傳入既有 quote 則為編輯模式。
 */
export default function QuoteModal({ client, quote, onSaveQuote, onClose }) {
  const isEdit = !!quote;
  const [model, setModel] = useState(quote?.model || '');
  const [items, setItems] = useState(() =>
    quote?.items?.length
      ? quote.items.map((it) => ({ ...it, price: String(it.price) }))
      : [{ id: generateId('qi'), name: '車輛售價', price: '' }]
  );
  const [note, setNote] = useState(quote?.note || '');
  const [profile, setProfile] = useState({ name: '', phone: '' });

  // 業務署名記在本機，下次自動帶入
  useEffect(() => {
    db.get('settings', 'quoteProfile')
      .then((row) => { if (row) setProfile({ name: row.name || '', phone: row.phone || '' }); })
      .catch(() => {});
  }, []);

  function saveProfile(next) {
    setProfile(next);
    db.put('settings', { key: 'quoteProfile', ...next }).catch(() => {});
  }

  const total = items.reduce((s, it) => s + (Number(it.price) || 0), 0);
  const validItems = items.filter((it) => it.name.trim() && Number(it.price) > 0);

  function setItem(id, patch) {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  function addItem() {
    setItems((list) => [...list, { id: generateId('qi'), name: '', price: '' }]);
  }

  function removeItem(id) {
    setItems((list) => (list.length > 1 ? list.filter((it) => it.id !== id) : list));
  }

  async function handleRecord() {
    await onSaveQuote({
      id: quote?.id || generateId('quote'),
      date: quote?.date || dayjs().format('YYYY-MM-DD'),
      model: model.trim(),
      items: validItems.map((it) => ({ id: it.id, name: it.name.trim(), price: Number(it.price) })),
      note: note.trim(),
      total,
      text: `報價單：${model.trim() || '未填車型'}｜${validItems.map((i) => i.name.trim()).join('、')}`,
    });
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="fixed inset-0 z-50 overflow-y-auto p-4 flex items-start justify-center">
        <div className="bg-s1 rounded-2xl shadow-panel border border-bdr w-full max-w-md p-4 anim-scale-in my-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-lg text-ink">🧾 {isEdit ? '編輯報價單' : '報價單產生器'}</h3>
            <button onClick={onClose} className="btn-ghost text-xl leading-none px-2 py-1">✕</button>
          </div>

          {/* 輸入區 */}
          <div className="space-y-2 mb-4">
            <input value={model} onChange={(e) => setModel(e.target.value)}
              placeholder="車型（例：KIA 卡旺 K2500 標準貨斗）" className="w-full text-sm" />
            {items.map((it) => (
              <div key={it.id} className="flex gap-2">
                <input value={it.name} onChange={(e) => setItem(it.id, { name: e.target.value })}
                  placeholder="項目（配備 / 保險 / 領牌…）" className="flex-1 text-sm min-w-0" />
                <input type="number" min="0" value={it.price}
                  onChange={(e) => setItem(it.id, { price: e.target.value })}
                  placeholder="金額" className="w-28 text-sm" />
                <button onClick={() => removeItem(it.id)}
                  className="text-danger/50 hover:text-danger shrink-0 px-1">✕</button>
              </div>
            ))}
            <button onClick={addItem} className="btn-outline text-xs">＋ 新增項目</button>
            <input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="備註（有效期限、交車條件…）" className="w-full text-sm" />
            <div className="flex gap-2">
              <input value={profile.name} onChange={(e) => saveProfile({ ...profile, name: e.target.value })}
                placeholder="業務姓名" className="flex-1 text-sm min-w-0" />
              <input value={profile.phone} onChange={(e) => saveProfile({ ...profile, phone: e.target.value })}
                placeholder="聯絡電話" className="flex-1 text-sm min-w-0" />
            </div>
          </div>

          {/* 報價單預覽 — 固定淺色，截圖給客人用 */}
          <div className="rounded-xl overflow-hidden shadow-panel mx-auto" style={{ maxWidth: 360, background: '#ffffff' }}>
            <div style={{ background: '#5f7f96', padding: '14px 20px' }}>
              <p style={{ color: '#ffffff', fontSize: 18, fontWeight: 700, letterSpacing: 6 }}>報 價 單</p>
              <p style={{ color: '#d7e2ea', fontSize: 11, marginTop: 2 }}>
                {dayjs(quote?.date || undefined).format('YYYY 年 M 月 D 日')}
              </p>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <p style={{ color: '#8fa0ac', fontSize: 11 }}>致</p>
              <p style={{ color: '#2e3a42', fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
                {client?.name || '貴賓'}
              </p>
              {model.trim() && (
                <div style={{ background: '#eef1f4', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                  <p style={{ color: '#5f7f96', fontSize: 13, fontWeight: 700 }}>🚛 {model}</p>
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {validItems.map((it) => (
                    <tr key={it.id} style={{ borderBottom: '1px solid #e3e9ed' }}>
                      <td style={{ color: '#5a6b77', fontSize: 13, padding: '7px 0' }}>{it.name}</td>
                      <td style={{ color: '#2e3a42', fontSize: 13, padding: '7px 0', textAlign: 'right', fontWeight: 500 }}>
                        {formatMoney(Number(it.price))}
                      </td>
                    </tr>
                  ))}
                  {validItems.length === 0 && (
                    <tr><td style={{ color: '#8fa0ac', fontSize: 12, padding: '10px 0', textAlign: 'center' }} colSpan={2}>
                      （尚未輸入項目）
                    </td></tr>
                  )}
                </tbody>
              </table>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                borderTop: '2px solid #5f7f96', marginTop: 8, paddingTop: 10,
              }}>
                <span style={{ color: '#5a6b77', fontSize: 13, fontWeight: 600 }}>總計</span>
                <span style={{ color: '#5f7f96', fontSize: 22, fontWeight: 800 }}>
                  NT$ {formatMoney(total)}
                </span>
              </div>
              {note.trim() && (
                <p style={{ color: '#8fa0ac', fontSize: 11, marginTop: 10, whiteSpace: 'pre-wrap' }}>※ {note}</p>
              )}
              {(profile.name || profile.phone) && (
                <div style={{ borderTop: '1px solid #e3e9ed', marginTop: 12, paddingTop: 10, textAlign: 'right' }}>
                  <p style={{ color: '#5a6b77', fontSize: 12, fontWeight: 600 }}>{profile.name}</p>
                  {profile.phone && <p style={{ color: '#8fa0ac', fontSize: 11 }}>📞 {profile.phone}</p>}
                </div>
              )}
            </div>
          </div>

          <p className="text-center text-xs text-ink-3 mt-3">📸 直接截圖上方報價單傳給客人</p>
          <div className="flex gap-2 mt-3">
            <button onClick={onClose} className="btn-outline flex-1">關閉</button>
            <button onClick={handleRecord} disabled={total <= 0}
              className="btn-primary flex-1 disabled:opacity-40">
              💲 {isEdit ? '儲存修改' : '記錄報價'}（NT$ {formatMoney(total)}）
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
