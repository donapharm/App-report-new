import React from 'react';

export const INITIAL_T07_BUTTON_LABEL = 'Tạo bản tiền T07 đầu tiên';

export function employeeCostSnapshotControlDecision({ admin, view, selectedEmp, period, controlEnabled, status }) {
  if (!admin || view !== 'cost' || selectedEmp !== 'ALL' || controlEnabled !== true || !status) return { visible: false };
  const initial = status.initialGenerationAllowed === true;
  if (initial && period !== '2026-07') return { visible: false };
  return {
    visible: true,
    initial,
    label: initial ? INITIAL_T07_BUTTON_LABEL : status.locked ? 'Dựng lại bản tiền thiếu' : 'Đồng bộ lại',
  };
}

export function EmployeeCostSnapshotControl({
  admin, view, selectedEmp, period, periodLabel, controlEnabled, status,
  syncing, reasonText = '', message = '', error = '', onAction,
}) {
  const decision = employeeCostSnapshotControlDecision({ admin, view, selectedEmp, period, controlEnabled, status });
  if (!decision.visible) return null;
  const busy = syncing || status.syncing;
  const details = decision.initial
    ? React.createElement('p', null, 'Chưa có generation gốc. Hệ thống chỉ publish khi dựng đủ toàn bộ roster.')
    : React.createElement('p', null,
      status.fetchedAt ? `Số chốt lúc ${new Date(status.fetchedAt).toLocaleString('vi-VN')} · ` : '',
      status.complete ? `đủ ${status.availableCount}/${status.rosterCount} NV` : `đang có ${status.availableCount}/${status.rosterCount} NV`,
      status.locked ? ' · kỳ đã khoá' : '', '.');
  return React.createElement('div', { className: 'card employee-cost-snapshot-status', 'data-snapshot-state': status.state },
    React.createElement('div', null,
      React.createElement('div', { className: 'section-head' }, `Bản chi phí trên máy · kỳ ${periodLabel}`),
      details,
      !decision.initial && reasonText ? React.createElement('small', null, reasonText) : null,
      message ? React.createElement('small', { role: 'status' }, message) : null,
      error ? React.createElement('small', { role: 'alert' }, error) : null),
    React.createElement('button', {
      type: 'button', className: 'btn', disabled: busy || (!decision.initial && status.locked && status.complete), onClick: onAction,
    }, busy ? 'Đang đồng bộ…' : decision.label));
}
