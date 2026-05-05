import dayjs from 'dayjs';

/** 取得本地今日日期 YYYY-MM-DD（GMT+8 安全，不受 UTC 偏移影響）*/
export function today() {
  return dayjs().format('YYYY-MM-DD');
}

/** 本地 ISO timestamp（用於 createdAt / updatedAt / log，取代 new Date().toISOString()）*/
export function localNow() {
  return dayjs().format('YYYY-MM-DDTHH:mm:ss');
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  return dayjs(dateStr).format('MM/DD');
}

export function formatDateFull(dateStr) {
  if (!dateStr) return '—';
  return dayjs(dateStr).format('YYYY/MM/DD');
}

export function formatDateTimeLocal(dateStr) {
  if (!dateStr) return '—';
  return dayjs(dateStr).format('YYYY/MM/DD HH:mm');
}

export function addDays(dateStr, n) {
  return dayjs(dateStr).add(n, 'day').format('YYYY-MM-DD');
}

export function diffDays(dateStr) {
  return dayjs().diff(dayjs(dateStr), 'day');
}

export function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function parseMonthKey(key) {
  const [y, m] = key.split('-');
  return { year: Number(y), month: Number(m) };
}

export function getLast30Days() {
  const days = [];
  for (let i = 29; i >= 0; i--) {
    days.push(dayjs().subtract(i, 'day').format('YYYY-MM-DD'));
  }
  return days;
}

export function getMonthsInYear(year) {
  return Array.from({ length: 12 }, (_, i) => monthKey(year, i + 1));
}

/** 產生 Google 日曆新增活動連結 */
export function googleCalendarUrl({ title, date, notes = '' }) {
  const d = dayjs(date);
  const dateStr = d.format('YYYYMMDD');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${dateStr}/${dateStr}`,
    details: notes,
  });
  return `https://calendar.google.com/calendar/r/eventedit?${params.toString()}`;
}

export const QUICK_DATES = [
  { label: '明天', days: 1 },
  { label: '3天後', days: 3 },
  { label: '1週', days: 7 },
  { label: '2週', days: 14 },
  { label: '1個月', days: 30 },
  { label: '3個月', days: 90 },
];
