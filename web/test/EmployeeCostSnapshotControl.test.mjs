import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  EmployeeCostSnapshotControl,
  INITIAL_T07_BUTTON_LABEL,
  snapshotActivationDecision,
} from '../src/employeeCostSnapshotControl.js';

const initialStatus = {
  state: 'failed', syncing: false, complete: false, locked: false,
  rosterCount: 0, availableCount: 0, initialGenerationAllowed: true,
};

function render(overrides = {}) {
  return renderToStaticMarkup(React.createElement(EmployeeCostSnapshotControl, {
    admin: true, view: 'cost', selectedEmp: 'ALL', period: '2026-07',
    periodLabel: '07/2026', controlEnabled: true, status: initialStatus,
    syncing: false, onAction() {}, ...overrides,
  }));
}

test('enabled=false contract can render the exact T07 initial button when controlEnabled=true', () => {
  const html = render();
  assert.match(html, new RegExp(`<button[^>]*>${INITIAL_T07_BUTTON_LABEL}</button>`));
  assert.match(html, /Bản chi phí trên máy · kỳ 07\/2026/);
  assert.doesNotMatch(html, /đang có 0\/0 NV|Dựng lại bản tiền thiếu|Đồng bộ lại/);
});

test('initial control is absent outside exact T07, for one employee, or when initial is not allowed', () => {
  assert.equal(render({ period: '2026-08' }), '');
  assert.equal(render({ selectedEmp: 'DN001' }), '');
  assert.equal(render({ controlEnabled: false, status: { ...initialStatus, initialGenerationAllowed: false } }), '');
});

test('regular enabled snapshot control keeps its prior labels and guards', () => {
  const regular = { ...initialStatus, state: 'ready', complete: true, locked: false, rosterCount: 19, availableCount: 19, initialGenerationAllowed: false };
  assert.match(render({ period: '2026-08', periodLabel: '08/2026', status: regular }), />Đồng bộ lại<\/button>/);
  assert.equal(render({ view: 'gaps', status: regular }), '');
  assert.equal(render({ admin: false, status: regular }), '');
});

test('touch activation fires on pointerup and suppresses its synthetic click', () => {
  const touch = snapshotActivationDecision(0, 'pointerup', 'touch', 1_000);
  assert.deepEqual(touch, { activate: true, lastPointerAt: 1_000 });
  assert.equal(snapshotActivationDecision(touch.lastPointerAt, 'click', '', 1_100).activate, false);
  assert.equal(snapshotActivationDecision(touch.lastPointerAt, 'click', '', 1_900).activate, true);
});

test('mouse and keyboard retain the normal click path', () => {
  assert.equal(snapshotActivationDecision(0, 'pointerup', 'mouse', 1_000).activate, false);
  assert.equal(snapshotActivationDecision(0, 'click', '', 1_000).activate, true);
});

// CEO 23/08 13:30 trên laptop: "nút bấm không đáp ứng, bấm hai ba lần vẫn vậy".
// Chuột phát pointerup rồi click ngay sau đó; nếu pointerup của chuột cũng ghi mốc
// chống-trùng thì chính cú click của nó bị chặn ⇒ chuột chết hẳn.
test('chuột vẫn bấm được: pointerup của chuột KHÔNG được chặn cú click ngay sau', () => {
  const step1 = snapshotActivationDecision(0, 'pointerup', 'mouse', 1_000);
  assert.equal(step1.activate, false);
  assert.equal(step1.lastPointerAt, 0, 'pointerup chuột không được ghi mốc chống-trùng');
  const step2 = snapshotActivationDecision(step1.lastPointerAt, 'click', undefined, 1_005);
  assert.equal(step2.activate, true, 'click của chuột phải chạy');
});

test('chạm vẫn chống được click trùng ngay sau pointerup', () => {
  const step1 = snapshotActivationDecision(0, 'pointerup', 'touch', 2_000);
  assert.equal(step1.activate, true);
  assert.equal(step1.lastPointerAt, 2_000);
  const step2 = snapshotActivationDecision(step1.lastPointerAt, 'click', undefined, 2_010);
  assert.equal(step2.activate, false, 'click trùng sau cú chạm phải bị chặn');
});

test('click rời rạc sau cú chạm cũ hơn 800 ms vẫn chạy', () => {
  const step = snapshotActivationDecision(2_000, 'click', undefined, 3_000);
  assert.equal(step.activate, true);
});
