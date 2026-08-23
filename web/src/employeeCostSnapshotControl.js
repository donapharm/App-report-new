import React from 'react';

export const INITIAL_T07_BUTTON_LABEL = 'Tạo bản tiền T07 đầu tiên';

export function snapshotActivationDecision(lastPointerAt, eventType, pointerType, now = Date.now()) {
  if (eventType === 'pointerup') {
    return { activate: pointerType === 'touch' || pointerType === 'pen', lastPointerAt: now };
  }
  if (eventType === 'click' && now - Number(lastPointerAt || 0) < 800) {
    return { activate: false, lastPointerAt };
  }
  return { activate: eventType === 'click', lastPointerAt };
}

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
  const activationRef = React.useRef({ lastPointerAt: 0, running: false });
  const decision = employeeCostSnapshotControlDecision({ admin, view, selectedEmp, period, controlEnabled, status });
  if (!decision.visible) return null;
  const busy = syncing || status.syncing;
  const details = decision.initial
    ? React.createElement('p', null, 'Chưa có generation gốc. Hệ thống chỉ publish khi dựng đủ toàn bộ roster.')
    : React.createElement('p', null,
      status.fetchedAt ? `Số chốt lúc ${new Date(status.fetchedAt).toLocaleString('vi-VN')} · ` : '',
      status.complete ? `đủ ${status.availableCount}/${status.rosterCount} NV` : `đang có ${status.availableCount}/${status.rosterCount} NV`,
      status.locked ? ' · kỳ đã khoá' : '', '.');
  const activate = (event) => {
    const activation = snapshotActivationDecision(
      activationRef.current.lastPointerAt,
      event.type,
      event.pointerType,
    );
    activationRef.current.lastPointerAt = activation.lastPointerAt;
    if (!activation.activate || activationRef.current.running) return;
    if (event.type === 'pointerup') event.preventDefault();
    activationRef.current.running = true;
    Promise.resolve(onAction()).finally(() => { activationRef.current.running = false; });
  };
  return React.createElement('div', { className: 'card employee-cost-snapshot-status', 'data-snapshot-state': status.state },
    React.createElement('div', null,
      React.createElement('div', { className: 'section-head' }, `Bản chi phí trên máy · kỳ ${periodLabel}`),
      details,
      !decision.initial && reasonText ? React.createElement('small', null, reasonText) : null,
      message ? React.createElement('small', { role: 'status' }, message) : null,
      error ? React.createElement('small', { role: 'alert' }, error) : null),
    React.createElement('button', {
      type: 'button', className: 'btn', disabled: busy || (!decision.initial && status.locked && status.complete),
      onPointerUp: activate, onClick: activate,
    }, busy ? 'Đang đồng bộ…' : decision.label));
}
