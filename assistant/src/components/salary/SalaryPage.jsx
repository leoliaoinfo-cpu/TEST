import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context';
import { calcSalary, formatMoney } from '../../utils/salary';
import { monthKey, getMonthsInYear } from '../../utils/date';
import { db } from '../../db';
import { generateId } from '../../utils/crm';
import dayjs from 'dayjs';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ComposedChart, Line, Cell,
} from 'recharts';

const LEVEL_LABELS = ['未達標', '等級1', '等級2', '等級3', '等級4'];
const LEVEL_COLORS = ['#b88860', '#808020', '#2080a0', '#2a8a50', '#c9670a'];

export default function SalaryPage() {
  const { loadSalaryMonth, saveSalaryMonth, salaryMonths } = useApp();
  const now = dayjs();
  const [year, setYear] = useState(now.year());
  const [month, setMonth] = useState(now.month() + 1);
  const [tab, setTab] = useState('calc');

  const key = monthKey(year, month);
  const monthData = salaryMonths[key] || { key, cases: [] };

  useEffect(() => {
    loadSalaryMonth(key);
  }, [key]);

  // Load prev 3 months for base salary calculation
  const [prevPerf, setPrevPerf] = useState([0, 0, 0]);
  useEffect(() => {
    async function load() {
      const results = [];
      for (let i = 1; i <= 3; i++) {
        const d = dayjs(`${year}-${String(month).padStart(2, '0')}-01`).subtract(i, 'month');
        const k = monthKey(d.year(), d.month() + 1);
        const entry = await db.get('salaryMonths', k);
        const total = (entry?.cases || []).reduce((s, c) => s + (c.perf || 0), 0);
        results.push(total);
      }
      setPrevPerf(results);
    }
    load();
  }, [year, month]);

  const salary = useMemo(() => calcSalary(monthData.cases || [], prevPerf), [monthData, prevPerf]);

  function addCase() {
    const updated = { ...monthData, cases: [...(monthData.cases || []), { id: generateId('case'), name: '', perf: 0 }] };
    saveSalaryMonth(updated);
  }

  function updateCase(id, patch) {
    const updated = {
      ...monthData,
      cases: (monthData.cases || []).map((c) => c.id === id ? { ...c, ...patch } : c),
    };
    saveSalaryMonth(updated);
  }

  function deleteCase(id) {
    const updated = { ...monthData, cases: (monthData.cases || []).filter((c) => c.id !== id) };
    saveSalaryMonth(updated);
  }

  return (
    <div className="max-w-3xl mx-auto p-3 md:p-5 space-y-4">
      {/* Header & year/month nav */}
      <div className="card p-3 flex items-center gap-3 flex-wrap">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="text-sm">
          {[now.year() - 1, now.year(), now.year() + 1].map((y) => (
            <option key={y} value={y}>{y} 年</option>
          ))}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="text-sm">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{m} 月</option>
          ))}
        </select>
        <div className="flex-1" />
        <div className="flex gap-1">
          {[
            { key: 'calc', label: '計算' },
            { key: 'year', label: '年度總覽' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`btn text-xs px-3 py-1.5 ${tab === t.key ? 'bg-accent text-white' : 'btn-outline'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'calc' && (
        <>
          {/* Cases input */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ink">📋 成交案件</h3>
              <button onClick={addCase} className="btn-primary text-xs">+ 新增案件</button>
            </div>

            {(monthData.cases || []).length === 0 && (
              <p className="text-center text-ink-3 text-sm py-4">尚無案件，點「新增案件」開始輸入</p>
            )}

            {(monthData.cases || []).map((c, idx) => (
              <div key={c.id} className="flex items-center gap-2">
                <span className="text-xs text-ink-3 w-6 shrink-0">#{idx + 1}</span>
                <input
                  value={c.name}
                  onChange={(e) => updateCase(c.id, { name: e.target.value })}
                  placeholder="客戶/案件名稱"
                  className="flex-1 text-sm"
                />
                <input
                  type="number" min="0" step="1000"
                  value={c.perf}
                  onChange={(e) => updateCase(c.id, { perf: Number(e.target.value) })}
                  placeholder="業績金額"
                  className="w-28 text-sm text-right"
                />
                <button onClick={() => deleteCase(c.id)} className="text-danger/50 hover:text-danger text-sm shrink-0">✕</button>
              </div>
            ))}

            {(monthData.cases || []).length > 0 && (
              <div className="flex justify-between text-sm font-medium pt-2 border-t border-bdr text-ink-2">
                <span>合計 {(monthData.cases || []).length} 件</span>
                <span className="text-accent">${formatMoney(salary.totalPerf)}</span>
              </div>
            )}
          </div>

          {/* Salary breakdown */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ink">💰 薪資明細</h3>
              <span
                className="text-xs font-bold px-2.5 py-1 rounded-full"
                style={{ background: LEVEL_COLORS[salary.level] + '20', color: LEVEL_COLORS[salary.level] }}
              >
                {LEVEL_LABELS[salary.level]}
              </span>
            </div>

            <div className="space-y-2">
              {[
                { label: '底薪', value: salary.base },
                { label: '入單獎', value: salary.entranceBonus },
                { label: '超額獎', value: Math.round(salary.excessBonus) },
                { label: '超超額獎', value: salary.superExcessBonus },
                { label: '件數獎金', value: salary.countBonus },
                { label: '規劃師加給', value: salary.plannerBonus },
                { label: '勞健保扣除', value: -salary.deduction, danger: true },
              ].map(({ label, value, danger }) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-ink-2">{label}</span>
                  <span className={`font-medium ${danger ? 'text-danger' : value > 0 ? 'text-ok' : 'text-ink-3'}`}>
                    {danger ? '−' : '+'} ${formatMoney(Math.abs(value))}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-bdr">
              <span className="font-bold text-ink">預估薪資</span>
              <span className="text-2xl font-bold text-accent">${formatMoney(salary.total)}</span>
            </div>
          </div>

          {/* Prev 3 months reference */}
          <div className="card p-4">
            <h4 className="font-semibold text-sm text-ink-2 mb-3">前三個月業績參考（底薪依據）</h4>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map((i) => {
                const d = dayjs(`${year}-${String(month).padStart(2, '0')}-01`).subtract(i, 'month');
                return (
                  <div key={i} className="bg-s2 rounded-lg p-2 text-center">
                    <p className="text-xs text-ink-3">{d.format('YYYY/MM')}</p>
                    <p className="text-sm font-semibold text-ink-2">${formatMoney(prevPerf[i - 1])}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {tab === 'year' && (
        <YearOverview year={year} />
      )}
    </div>
  );
}

// ── YearOverview ──────────────────────────────────────────────────────────────
function YearOverview({ year }) {
  const [monthlyData, setMonthlyData] = useState([]);

  useEffect(() => {
    async function load() {
      const results = [];
      for (let m = 1; m <= 12; m++) {
        const key = monthKey(year, m);
        const entry = await db.get('salaryMonths', key);
        const cases = entry?.cases || [];
        const totalPerf = cases.reduce((s, c) => s + (c.perf || 0), 0);
        const caseCount = cases.length;

        // Calculate salary for this month (simplified, without prev months)
        const prevPerfs = [];
        for (let i = 1; i <= 3; i++) {
          const pd = dayjs(`${year}-${String(m).padStart(2, '0')}-01`).subtract(i, 'month');
          const pk = monthKey(pd.year(), pd.month() + 1);
          const pe = await db.get('salaryMonths', pk);
          prevPerfs.push((pe?.cases || []).reduce((s, c) => s + (c.perf || 0), 0));
        }
        const sal = calcSalary(cases, prevPerfs);

        results.push({
          month: `${m}月`,
          totalPerf,
          caseCount,
          salary: sal.total,
          level: sal.level,
        });
      }
      setMonthlyData(results);
    }
    load();
  }, [year]);

  const totalYearPerf = monthlyData.reduce((s, m) => s + m.totalPerf, 0);
  const totalYearSalary = monthlyData.reduce((s, m) => s + m.salary, 0);
  const totalCases = monthlyData.reduce((s, m) => s + m.caseCount, 0);
  const bestMonth = monthlyData.reduce((best, m) => m.totalPerf > (best?.totalPerf || 0) ? m : best, null);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: '年度總業績', value: `$${formatMoney(totalYearPerf)}`, color: '#c9670a' },
          { label: '年度總薪資', value: `$${formatMoney(totalYearSalary)}`, color: '#2a8a50' },
          { label: '年度成交件數', value: `${totalCases} 件`, color: '#1a60a8' },
          { label: '最佳月份', value: bestMonth?.month || '—', color: '#9030a0' },
        ].map((s) => (
          <div key={s.label} className="card p-3 text-center">
            <p className="text-xs text-ink-3 mb-1">{s.label}</p>
            <p className="text-lg font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Monthly performance bar chart */}
      <div className="card p-4">
        <h4 className="font-semibold text-sm text-ink-2 mb-3">月度業績</h4>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthlyData} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0d9b8" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#b88860' }} />
            <YAxis tick={{ fontSize: 10, fill: '#b88860' }} tickFormatter={(v) => v >= 10000 ? `${v / 10000}萬` : v} />
            <Tooltip
              contentStyle={{ background: '#fffaf4', border: '1px solid #f0d9b8', borderRadius: 8, fontSize: 12 }}
              formatter={(v) => [`$${formatMoney(v)}`, '業績']}
            />
            <Bar dataKey="totalPerf" name="業績" radius={[4, 4, 0, 0]}>
              {monthlyData.map((entry, idx) => (
                <Cell key={idx} fill={LEVEL_COLORS[entry.level] || '#c9670a'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly salary chart */}
      <div className="card p-4">
        <h4 className="font-semibold text-sm text-ink-2 mb-3">月度薪資</h4>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={monthlyData} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0d9b8" />
            <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#b88860' }} />
            <YAxis tick={{ fontSize: 10, fill: '#b88860' }} tickFormatter={(v) => v >= 10000 ? `${v / 10000}萬` : v} />
            <Tooltip
              contentStyle={{ background: '#fffaf4', border: '1px solid #f0d9b8', borderRadius: 8, fontSize: 12 }}
              formatter={(v) => [`$${formatMoney(v)}`, '薪資']}
            />
            <Bar dataKey="salary" name="薪資" fill="#2a8a50" radius={[4, 4, 0, 0]} opacity={0.85} />
            <Line dataKey="salary" stroke="#c9670a" dot={false} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Monthly table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-s2">
            <tr>
              {['月份', '業績', '件數', '薪資', '等級'].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-ink-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthlyData.map((m, idx) => (
              <tr key={idx} className={idx % 2 === 0 ? '' : 'bg-s2/50'}>
                <td className="px-3 py-2 font-medium text-ink">{m.month}</td>
                <td className="px-3 py-2 text-ink-2">${formatMoney(m.totalPerf)}</td>
                <td className="px-3 py-2 text-ink-2">{m.caseCount}</td>
                <td className="px-3 py-2 font-medium" style={{ color: LEVEL_COLORS[m.level] }}>${formatMoney(m.salary)}</td>
                <td className="px-3 py-2">
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                    style={{ background: LEVEL_COLORS[m.level] + '20', color: LEVEL_COLORS[m.level] }}
                  >
                    {LEVEL_LABELS[m.level]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-s3 font-semibold">
            <tr>
              <td className="px-3 py-2 text-ink">合計</td>
              <td className="px-3 py-2 text-accent">${formatMoney(totalYearPerf)}</td>
              <td className="px-3 py-2 text-ink-2">{totalCases}</td>
              <td className="px-3 py-2 text-ok">${formatMoney(totalYearSalary)}</td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
