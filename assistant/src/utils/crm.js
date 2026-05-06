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
  hot: '逾半年',
  cold: '逾一年',
};

export function getClientStatus(client) {
  const now = dayjs();
  const created = dayjs(client.createdAt);
  const lastContact = client.lastContact ? dayjs(client.lastContact) : null;
  const nextDate = client.nextDate ? dayjs(client.nextDate) : null;

  const daysSinceCreated = now.diff(created, 'day');
  const daysSinceContact = lastContact ? now.diff(lastContact, 'day') : null;

  if (!lastContact && daysSinceCreated >= 180) return 'cold';
  if (daysSinceContact !== null && daysSinceContact >= 365) return 'cold';
  if (daysSinceContact !== null && daysSinceContact >= 180) return 'hot';

  // 待聯繫：nextDate 已到期，且上次聯繫早於 nextDate（或從未聯繫）
  // 若已在 nextDate 當天或之後聯繫，視為已處理 → 追蹤中
  if (nextDate && !nextDate.isAfter(now, 'day')) {
    const contactedAfterDue = lastContact && !lastContact.isBefore(nextDate, 'day');
    if (!contactedAfterDue) return 'warn';
  }

  return 'ok';
}

export function clientMatchesFilter(client, filter, cats, stages) {
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
    if (!lastContact && daysSinceCreated >= 180) return true;
    if (daysSinceContact !== null && daysSinceContact >= 180) return true;
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
