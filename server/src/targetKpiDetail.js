'use strict';

const TARGET_SOURCE_LABELS = Object.freeze({
  manual: 'Sửa tay',
  upload: 'Upload',
  carryover: 'Nhân bản kỳ trước',
  appsale: 'App Sale',
  ai: 'AI đề xuất',
  legacy: 'Dữ liệu kế thừa',
});

function monthLabel(ky) {
  const [month, year] = String(ky || '').split('.');
  return month && year ? `T${month}/${year}` : String(ky || '');
}

// Build a read-only explanation for exactly one employee. The supplied summary
// and resolver remain the owners of every amount and percentage in the result.
function buildTargetKpiDetail({ ky, scope, empCode, targetKpiSummary, resolveTargets }) {
  const code = String(empCode || '').trim().toUpperCase();
  if (!code) throw new Error('Thiếu mã nhân viên để đọc chi tiết target.');
  const summary = targetKpiSummary(ky, scope, [code]);
  const months = (summary.quarter_kys || []).map((monthKy) => {
    const resolved = resolveTargets({ ky: monthKy, empCodes: [code] })
      .find((row) => String(row.emp_code || '').trim().toUpperCase() === code);
    const month = monthKy === ky ? summary.month : targetKpiSummary(monthKy, scope, [code]).month;
    const assigned = Number(month.target || 0) > 0;
    return {
      ky: monthKy,
      label: monthLabel(monthKy),
      target: month.target,
      achieved: month.achieved,
      pct: month.pct,
      assigned,
      source: assigned ? (resolved?.source || null) : null,
      source_label: assigned ? (resolved?.source_label || TARGET_SOURCE_LABELS[resolved?.source] || resolved?.source || 'Nguồn chưa đặt tên') : 'Chưa giao target',
      source_ky: assigned ? (resolved?.source_ky || resolved?.ky || monthKy) : null,
      reference: assigned ? resolved?.reference === true : false,
    };
  });
  const selectedMonth = months.find((item) => item.ky === ky) || {
    ky,
    label: monthLabel(ky),
    ...summary.month,
    assigned: Number(summary.month.target || 0) > 0,
    source: null,
    source_label: Number(summary.month.target || 0) > 0 ? 'Nguồn chưa đặt tên' : 'Chưa giao target',
    source_ky: null,
    reference: false,
  };
  const assignedLabels = months.filter((item) => item.assigned).map((item) => item.label);
  const unassignedLabels = months.filter((item) => !item.assigned).map((item) => item.label);
  const calculationLabel = 'Target quý = trung bình các tháng đã giao';
  const clarification = assignedLabels.length
    ? `${calculationLabel}: ${assignedLabels.join(' + ')}${unassignedLabels.length ? ` (${unassignedLabels.join('/')} chưa giao target)` : ''}. Doanh thu và % đạt quý dùng cùng trung bình này.`
    : `${calculationLabel}: quý chưa có tháng nào được giao target${unassignedLabels.length ? ` (${unassignedLabels.join('/')} chưa giao target)` : ''}.`;
  return {
    emp_code: code,
    ky,
    basis: 'revenue_before_vat',
    basis_label: 'Target và doanh thu đều so trước VAT.',
    month: selectedMonth,
    quarter: {
      label: summary.quarter_label,
      target: summary.quarter.target,
      achieved: summary.quarter.achieved,
      pct: summary.quarter.pct,
      months,
      unassigned_kys: months.filter((item) => !item.assigned).map((item) => item.ky),
      calculation: 'average_assigned_months',
      calculation_label: calculationLabel,
      clarification,
    },
  };
}

module.exports = { buildTargetKpiDetail, TARGET_SOURCE_LABELS };
