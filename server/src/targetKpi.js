'use strict';

function amount(mapByKy, ky, code) {
  const value = mapByKy.get(ky)?.get(code);
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

// Quarter KPI is intentionally normalized to one assigned month: each employee's
// target and achieved revenue are averaged over exactly the months with target > 0,
// then employee averages are summed for an admin/company view.
function summarizeAssignedQuarter({ ky, quarterKys = [], codes = [], targetByKy = new Map(), revenueByKy = new Map() } = {}) {
  const employees = codes.map((rawCode) => {
    const code = String(rawCode || '').trim().toUpperCase();
    const months = quarterKys.map((monthKy) => {
      const target = amount(targetByKy, monthKy, code);
      return { ky: monthKy, target, achieved: amount(revenueByKy, monthKy, code), assigned: target > 0 };
    });
    const assigned = months.filter((item) => item.assigned);
    return {
      code, months, assigned,
      target: assigned.length ? assigned.reduce((sum, item) => sum + item.target, 0) / assigned.length : 0,
      achieved: assigned.length ? assigned.reduce((sum, item) => sum + item.achieved, 0) / assigned.length : 0,
    };
  });
  const monthValue = (key) => Math.round(employees.reduce((sum, item) => sum + (item.months.find((row) => row.ky === ky)?.[key] || 0), 0));
  const monthTarget = monthValue('target');
  const monthAchieved = monthValue('achieved');
  const quarterTarget = Math.round(employees.reduce((sum, item) => sum + item.target, 0));
  const quarterAchieved = Math.round(employees.reduce((sum, item) => sum + item.achieved, 0));
  const single = employees.length === 1 ? employees[0] : null;
  const months = quarterKys.map((monthKy) => ({
    ky: monthKy,
    target: Math.round(employees.reduce((sum, item) => sum + (item.months.find((row) => row.ky === monthKy)?.target || 0), 0)),
    achieved: Math.round(employees.reduce((sum, item) => sum + (item.months.find((row) => row.ky === monthKy)?.achieved || 0), 0)),
    assigned: single ? single.months.find((row) => row.ky === monthKy)?.assigned === true
      : employees.some((item) => item.months.find((row) => row.ky === monthKy)?.assigned),
  }));
  return {
    month: { target: monthTarget, achieved: monthAchieved },
    quarter: {
      target: quarterTarget,
      achieved: quarterAchieved,
      calculation: 'average_assigned_months',
      calculation_label: 'Target quý = trung bình các tháng đã giao',
      assigned_kys: single ? single.assigned.map((item) => item.ky) : months.filter((item) => item.assigned).map((item) => item.ky),
      assigned_month_count: single ? single.assigned.length : null,
      months,
    },
  };
}

module.exports = { summarizeAssignedQuarter };
