import dayjs from 'dayjs';

export const STATUS_COLOR = {
  ok: '#2a8a50',
  warn: '#c9670a',
  hot: '#e04000',
  cold: '#c03030',
};

export const STATUS_LABEL = {
  ok: '追蹤中',
  warn: '待聯繫',
  hot: '久未聯繫',
  cold: '冷掉了',
};

/** 追蹤規則預設值：超過 coldDays 天未聯繫 → 🟠久未聯繫；超過 deadDays 天 → 🔴冷掉了 */
export const DEFAULT_THRESHOLDS = { coldDays: 180, deadDays: 365 };

/** 清理使用者輸入的門檻：至少 1 天，且 deadDays 不小於 coldDays */
export function normalizeThresholds(t) {
  const coldDays = Math.max(1, Math.round(Number(t?.coldDays)) || DEFAULT_THRESHOLDS.coldDays);
  const deadDays = Math.max(coldDays, Math.round(Number(t?.deadDays)) || DEFAULT_THRESHOLDS.deadDays);
  return { coldDays, deadDays };
}

export function getClientStatus(client, thresholds) {
  const { coldDays, deadDays } = thresholds || DEFAULT_THRESHOLDS;
  const now = dayjs();
  const created = dayjs(client.createdAt);
  const lastContact = client.lastContact ? dayjs(client.lastContact) : null;
  const nextDate = client.nextDate ? dayjs(client.nextDate) : null;

  const daysSinceCreated = now.diff(created, 'day');
  const daysSinceContact = lastContact ? now.diff(lastContact, 'day') : null;

  if (!lastContact && daysSinceCreated >= coldDays) return 'cold';
  if (daysSinceContact !== null && daysSinceContact >= deadDays) return 'cold';
  if (daysSinceContact !== null && daysSinceContact >= coldDays) return 'hot';
  if (nextDate && !nextDate.isAfter(now, 'day')) return 'warn';
  return 'ok';
}

export function clientMatchesFilter(client, filter, thresholds) {
  const { coldDays } = thresholds || DEFAULT_THRESHOLDS;
  const now = dayjs();
  const lastContact = client.lastContact ? dayjs(client.lastContact) : null;
  const created = dayjs(client.createdAt);

  if (filter === 'all') return true;
  if (filter === 'pending') {
    const nextDate = client.nextDate ? dayjs(client.nextDate) : null;
    return nextDate != null && !nextDate.isAfter(now, 'day');
  }
  if (filter === 'cold') {
    const daysSinceCreated = now.diff(created, 'day');
    const daysSinceContact = lastContact ? now.diff(lastContact, 'day') : null;
    if (!lastContact && daysSinceCreated >= coldDays) return true;
    if (daysSinceContact !== null && daysSinceContact >= coldDays) return true;
    return false;
  }
  // catId filter
  if (filter.startsWith('cat:')) return client.catId === filter.slice(4);
  // stageId filter
  if (filter.startsWith('stage:')) return client.stageId === filter.slice(6);
  return true;
}

export function sortClients(clients, sortKey) {
  const pinned = clients.filter((c) => c.pinned);
  const rest = clients.filter((c) => !c.pinned);

  const sorted = rest.slice().sort((a, b) => {
    if (sortKey === 'nextDate') {
      const da = a.nextDate || '9999-99-99';
      const db_ = b.nextDate || '9999-99-99';
      return da.localeCompare(db_);
    }
    if (sortKey === 'lastContact') {
      const da = a.lastContact || '0000-00-00';
      const db_ = b.lastContact || '0000-00-00';
      return db_.localeCompare(da);
    }
    if (sortKey === 'name') return a.name.localeCompare(b.name, 'zh-TW');
    if (sortKey === 'intent') return (b.intentLevel || 0) - (a.intentLevel || 0);
    // default: createdAt desc
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });

  return [...pinned, ...sorted];
}

export const CAT_COLORS = [
  '#c9670a', '#2a8a50', '#1a60a8', '#9030a0',
  '#c04060', '#2080a0', '#808020',
];

export const FIELD_COLORS = [
  '#c9670a', '#2a8a50', '#1a60a8', '#9030a0',
  '#c03030', '#2080a0', '#808020', '#c04060',
  '#7a4010', '#505060',
];

export const FIELD_COLOR_NAMES = [
  '橘', '綠', '藍', '紫', '紅', '青', '橄', '粉', '棕', '灰',
];

export function generateId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── 業務流程事件（客戶時間軸）────────────────────────────────────────────────
export const EVENT_TYPES = {
  contact:   { icon: '✅', label: '已聯繫',   color: '#2a8a50' },
  missed:    { icon: '📵', label: '未接',     color: '#c03030' },
  line:      { icon: '💬', label: 'LINE 摘要', color: '#2080a0' },
  quote:     { icon: '💲', label: '報價',     color: '#c9670a', hasAmount: true },
  visit:     { icon: '🚚', label: '看車試乘', color: '#1a60a8' },
  loan:      { icon: '🏦', label: '貸款補件', color: '#9030a0' },
  order:     { icon: '📝', label: '下訂',     color: '#e04000', hasAmount: true },
  delivery:  { icon: '🔑', label: '交車',     color: '#2a8a50' },
  aftercare: { icon: '🤝', label: '售後回訪', color: '#808020' },
};

/** 客戶詳情頁快速記錄事件的按鈕順序（已聯繫/未接另有專屬按鈕） */
export const QUICK_EVENT_KEYS = ['line', 'quote', 'visit', 'loan', 'order', 'delivery', 'aftercare'];

/** 交車後自動建立的售後回訪天數 */
export const DELIVERY_FOLLOWUP_DAYS = [3, 7, 30];

/** 簽約～交車常見待辦範本（可一鍵套用到簽約前待辦） */
export const DELIVERY_TODO_TEMPLATE = [
  '保險規劃確認',
  '貸款對保 / 補件',
  '監理站驗車領牌',
  '配件安裝確認',
  '交車前整備清潔',
];
