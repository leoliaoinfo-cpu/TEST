/** All salary calculation formulas per spec */

const BASE_TIERS = [
  { min: 1500000, base: 34000 },
  { min: 1200000, base: 32000 },
  { min: 900000, base: 30000 },
  { min: 700000, base: 29500 },
  { min: 0, base: 27000 },
];

const ENTRANCE_BONUSES = [2500, 3500, 4500, 5500, 6500];
const COUNT_BONUS = [0, 500, 800, 1100, 1400];
const PLANNER_BONUS = [0, 3000, 5000, 8000, 12000];

export function calcBase(prevThreeMonthsPerf) {
  const total = prevThreeMonthsPerf.reduce((s, v) => s + (v || 0), 0);
  for (const tier of BASE_TIERS) {
    if (total >= tier.min) return { base: tier.base, prevTotal: total };
  }
  return { base: 27000, prevTotal: total };
}

export function calcPerformanceLevel(totalPerf) {
  if (totalPerf >= 500000) return 4;
  if (totalPerf >= 400000) return 3;
  if (totalPerf >= 300000) return 2;
  if (totalPerf >= 200000) return 1;
  return 0;
}

export function calcEntranceBonus(caseCount) {
  let total = 0;
  for (let i = 0; i < caseCount; i++) {
    total += ENTRANCE_BONUSES[Math.min(i, 4)];
  }
  return total;
}

export function calcExcessBonus(cases) {
  return cases.reduce((total, c) => {
    const excess = Math.max(0, (c.perf || 0) - 50000);
    return total + excess * 0.1;
  }, 0);
}

export function calcSalary(cases, prevThreeMonthsPerf) {
  const { base, prevTotal } = calcBase(prevThreeMonthsPerf);
  const totalPerf = cases.reduce((s, c) => s + (c.perf || 0), 0);
  const caseCount = cases.length;
  const level = calcPerformanceLevel(totalPerf);

  const entranceBonus = calcEntranceBonus(caseCount);
  const excessBonus = calcExcessBonus(cases);
  const superExcessBonus = Math.round(totalPerf * 0.01);
  const countBonus = totalPerf >= 65000 ? COUNT_BONUS[level] : 0;
  const plannerBonus = PLANNER_BONUS[level];
  const deduction = 973;

  const total = base + entranceBonus + excessBonus + superExcessBonus + countBonus + plannerBonus - deduction;

  return {
    base,
    prevTotal,
    totalPerf,
    caseCount,
    level,
    entranceBonus,
    excessBonus,
    superExcessBonus,
    countBonus,
    plannerBonus,
    deduction,
    total: Math.round(total),
  };
}

export function getCountBonusLabel(level) {
  return COUNT_BONUS[level] ?? 0;
}
export function getPlannerBonusLabel(level) {
  return PLANNER_BONUS[level] ?? 0;
}

export function formatMoney(n) {
  return n == null ? '—' : n.toLocaleString('zh-TW');
}
