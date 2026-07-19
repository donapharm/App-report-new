'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { createDormantService } = require('../src/dormantService');
const { createDormantReportService } = require('../src/dormantReport');

function fixture({ count = 125, retention = 3 } = {}) {
  const files = new Map();
  const persist = {
    load(name, fallback) { return structuredClone(files.has(name) ? files.get(name) : fallback); },
    save(name, value) { files.set(name, structuredClone(value)); },
  };
  let asOf = '2026-07-19';
  const rows = Array.from({ length: count }, (_, i) => {
    const emp = i % 2 ? 'DN016' : 'DN001';
    return { emp_code: emp, employee_name: emp === 'DN016' ? 'Trần Thị Ngọc Ánh' : 'Đặng Xuân Trung', unit_code: `DV${i % 9}`, unit_name: `Bệnh viện Việt ${i % 9}`, iit_code: `QLNB-${i + 1}`, product_name: `Thuốc Việt ${i + 1}`, route: 'CL', date: '2026-04-01', revenue: 1000000 + i, quantity: 1 };
  });
  const cst = rows.map((r) => ({ ...r, bid_qty_initial: 100, remain_qty: 12, remain_amount: 999999999, bid_price: 88888, cp_total: 777, margin: 0.8, profit: 123, c30: { option_qty: 30, remaining_qty: 20, status_label: 'Có thể mua thêm', actionable: true } }));
  const store = {
    periodKys: () => ['04.2026', '07.2026'], listPeriods: () => [{ ky: '04.2026', dateTo: '2026-04-30' }, { ky: '07.2026', dateTo: asOf }],
    periodFreshness: () => ({ throughDate: asOf }),
    getRowsRange: ({ scope = {} }) => rows.filter((x) => !scope.empCode || x.emp_code === scope.empCode),
    getCst: ({ scope = {} } = {}) => cst.filter((x) => !scope.empCode || x.emp_code === scope.empCode),
  };
  let now = new Date('2026-07-19T12:00:00Z');
  const dormantService = createDormantService({ store, persist, clock: () => now });
  const report = createDormantReportService({ dormantService, persist, clock: () => now, retention, snapshotSecret: 'qlnb-report-test-signing-key-20260719-32bytes' });
  return { report, dormantService, files, rows, setNow(v) { now = new Date(v); }, setAsOf(v) { asOf = v; } };
}
const CEO = { emp_code: 'CEO', role: 'ceo', name: 'CEO' };
const ADMIN = { emp_code: 'ADM01', role: 'admin', name: 'Admin' };
const EMP = { emp_code: 'DN016', role: 'employee', name: 'Ánh' };
const OTHER = { emp_code: 'DN001', role: 'employee', name: 'Trung' };
const forbidden = new Set(['remain_amount', 'cp_total', 'cost', 'costs', 'bid_price', 'margin', 'profit', 'historical_revenue', 'revenue']);
function assertNoSensitive(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!forbidden.has(key.toLowerCase()), `sensitive field ${path}.${key}`);
    assertNoSensitive(child, `${path}.${key}`);
  }
}

test('current report uses full analyzeScope result, filters server-side and recursively sanitizes fields', () => {
  const f = fixture();
  const ceo = f.report.current({ session: CEO });
  assert.equal(ceo.items.length, 125, 'must not inherit summaryFor 100-row cap');
  assert.equal(ceo.kpis.dormant_total, 125);
  assertNoSensitive(ceo);
  assert.throws(() => f.report.current({ session: EMP, filters: { emp_code: 'DN001' } }), /Chỉ CEO/);
  const own = f.report.current({ session: EMP });
  assert.ok(own.items.length > 20, 'must not inherit employee 20-row cap');
  assert.ok(own.items.every((x) => x.emp_code === 'DN016'));
  assert.throws(() => f.report.current({ session: ADMIN }), (e) => e.status === 403 && e.code === 'DORMANT_REPORT_ROLE_REQUIRED');
  assert.throws(() => f.report.current({ session: EMP, template: 'ceo_meeting' }), /chỉ dành cho CEO/i);
  assert.equal(f.report.current({ session: CEO, filters: { unit_code: 'DV1', q: 'thuốc việt' }, template: 'ceo_meeting' }).items.every((x) => x.unit_code === 'DV1'), true);
});

test('detail blocks cross-scope keys and returns a full sanitized audit timeline', () => {
  const f = fixture({ count: 4 });
  const analyzed = f.dormantService.analyzeScope('DN016');
  const key = analyzed.items[0].key;
  const state = f.files.get('dormant_qlnb_state');
  state.items[key].audit.push({ at: '2026-07-20', actor: 'DN016', type: 'action_updated', changes: { status: 'contacted', next_follow_up: '2026-07-25', remain_amount: 10, bid_price: 20, note: 'Đã gọi bệnh viện' } });
  state.items[key].audit.push({ at: '2026-07-21', actor: 'DN016', type: 'action_updated', changes: { note: { cp_total: 123, margin: 0.8 }, days_idle: { profit: 99 } } });
  state.items[key].audit.push({ at: '2026-07-22', actor: 'DN016', type: 'action_updated', changes: { note: '1250000' } });
  f.files.set('dormant_qlnb_state', state);
  const detail = f.dormantService.detailFor({ key, empCode: 'DN016' });
  assert.equal(detail.item.audit.length, 4);
  assert.equal(detail.item.audit[1].changes.note, 'Đã gọi bệnh viện');
  assert.equal(detail.item.audit[2].changes.note, '');
  assert.equal(detail.item.audit[2].changes.days_idle, null);
  assert.equal(detail.item.audit[3].changes.note, '[Nội dung nhạy cảm đã được ẩn]');
  assert.equal(detail.item.initial_qty, 100);
  assert.equal(detail.item.remain_qty, 12);
  assert.equal(detail.item.remain_percent, 12);
  assert.equal(detail.item.c30_qty, 30);
  assert.equal(detail.item.c30_remaining_qty, 20);
  assert.equal(detail.item.c30_status, 'Có thể mua thêm');
  assert.equal(detail.item.date_precision, 'month');
  assert.equal(detail.item.dormant_cycle, 1);
  assert.equal(detail.item.action.action_cycle, 0);
  assert.equal(detail.item.review_status, 'unplanned');
  assertNoSensitive(detail);
  assert.throws(() => f.dormantService.detailFor({ key, empCode: 'DN001' }), (e) => e.status === 403);
  assert.equal(f.dormantService.detailFor({ key, isAdmin: true }).item.key, key);
});

test('snapshots dedupe unchanged state, retain a bounded immutable history and isolate scope', () => {
  const f = fixture({ count: 8, retention: 3 });
  const first = f.report.createSnapshot({ session: EMP, template: 'employee_work' });
  const duplicate = f.report.createSnapshot({ session: EMP, template: 'employee_work' });
  assert.equal(duplicate.id, first.id);
  assert.equal(duplicate.deduplicated, true);
  // State discovered for another employee must not churn this employee's
  // immutable snapshot when the authorized projection is unchanged.
  f.dormantService.analyzeScope('DN001');
  const afterOtherScopeChange = f.report.createSnapshot({ session: EMP, template: 'employee_work' });
  assert.equal(afterOtherScopeChange.id, first.id);
  assert.equal(afterOtherScopeChange.deduplicated, true);
  assert.equal(f.report.listSnapshots({ session: OTHER }).length, 0);
  assert.equal(f.report.listSnapshots({ session: ADMIN }).length, 0);
  assert.throws(() => f.report.getSnapshot({ id: first.id, session: OTHER }), (e) => e.status === 404);
  assert.throws(() => f.report.createSnapshot({ session: ADMIN }), /Chỉ CEO/);

  const originalName = first.report.items[0].product_name;
  f.rows.find((x) => x.emp_code === 'DN016').product_name = 'Tên đã đổi';
  f.setNow('2026-07-20T12:00:00Z'); f.report.createSnapshot({ session: EMP, template: 'employee_work' });
  f.rows.find((x) => x.emp_code === 'DN016').product_name = 'Tên đổi lần 2';
  f.setNow('2026-07-21T12:00:00Z'); f.report.createSnapshot({ session: EMP, template: 'employee_work' });
  f.rows.find((x) => x.emp_code === 'DN016').product_name = 'Tên đổi lần 3';
  f.setNow('2026-07-22T12:00:00Z'); f.report.createSnapshot({ session: EMP, template: 'employee_work' });
  assert.equal(f.report.listSnapshots({ session: EMP }).length, 3);
  // First snapshot was evicted by retention; a separate CEO snapshot remains
  // immutable when live rows subsequently change.
  const ceoSnap = f.report.createSnapshot({ session: CEO, template: 'ceo_meeting' });
  const savedName = ceoSnap.report.items[0].product_name;
  f.rows[0].product_name = 'Không được đổi snapshot';
  assert.equal(f.report.getSnapshot({ id: ceoSnap.id, session: CEO }).report.items[0].product_name, savedName);
  assert.notEqual(originalName, 'Tên đã đổi');
  const ceoEmployeeSnap = f.report.createSnapshot({ session: CEO, filters: { emp_code: 'DN016' }, template: 'standard' });
  assert.equal(ceoEmployeeSnap.scope.type, 'employee');
  assert.equal(f.report.listSnapshots({ session: EMP }).some((x) => x.id === ceoEmployeeSnap.id), false, 'CEO snapshots stay CEO-only even when filtered to one employee');
});

test('snapshot integrity fails closed after persisted content or permission metadata is changed', () => {
  const f = fixture({ count: 4 });
  const snapshot = f.report.createSnapshot({ session: EMP, template: 'employee_work' });
  const root = f.files.get('dormant_report_snapshots');
  root.snapshots[0].report.items[0].product_name = 'Nội dung đã bị sửa';
  root.snapshots[0].scope.emp_code = 'DN001';
  f.files.set('dormant_report_snapshots', root);
  assert.throws(() => f.report.getSnapshot({ id: snapshot.id, session: EMP }), (e) => e.status === 409 && e.code === 'SNAPSHOT_INTEGRITY_FAILED');
  assert.throws(() => f.report.listSnapshots({ session: EMP }), (e) => e.status === 409 && e.code === 'SNAPSHOT_INTEGRITY_FAILED');

  const f2 = fixture({ count: 4 });
  const second = f2.report.createSnapshot({ session: EMP, template: 'employee_work' });
  const secondRoot = f2.files.get('dormant_report_snapshots');
  secondRoot.snapshots[0].owner_scope_key = 'EMP:DN001';
  secondRoot.snapshots[0].dedupe_key = '0'.repeat(64);
  f2.files.set('dormant_report_snapshots', secondRoot);
  assert.throws(() => f2.report.getSnapshot({ id: second.id, session: EMP }), (e) => e.status === 409 && e.code === 'SNAPSHOT_INTEGRITY_FAILED');
});

test('snapshot operations fail closed without a strong server-side signing key', () => {
  const f = fixture({ count: 2 });
  const unsigned = createDormantReportService({ dormantService: f.dormantService, persist: { load: (name, fallback) => structuredClone(f.files.get(name) || fallback), save: (name, value) => f.files.set(name, structuredClone(value)) }, snapshotSecret: 'short' });
  assert.throws(() => unsigned.createSnapshot({ session: EMP }), (e) => e.status === 503 && e.code === 'SNAPSHOT_SIGNING_UNAVAILABLE');
  assert.throws(() => unsigned.listSnapshots({ session: EMP }), (e) => e.status === 503 && e.code === 'SNAPSHOT_SIGNING_UNAVAILABLE');
});

test('snapshot exports are reproducible and generate Vietnamese Excel/PDF in A4 landscape', async () => {
  const f = fixture({ count: 12, retention: 10 });
  const analyzed = f.dormantService.analyzeScope(null);
  const state = f.files.get('dormant_qlnb_state');
  Object.assign(state.items[analyzed.items[0].key], { status: 'debt_blocked', note: 'Vướng công nợ, không giao hàng; liên hệ lại đơn vị ngày 25/07.', next_follow_up: '2026-07-25', action_cycle: 2, action_updated_at: '2026-07-19T12:00:00Z' });
  Object.assign(state.items[analyzed.items[1].key], { status: 'other', note: 'Trao đổi chi phí và margin nội bộ', next_follow_up: '2026-07-25', action_cycle: 1, action_updated_at: '2026-07-19T12:00:00Z' });
  f.files.set('dormant_qlnb_state', state);
  const snapshot = f.report.createSnapshot({ session: CEO, template: 'ceo_meeting' });
  assert.equal(snapshot.report.items.find((x) => x.key === analyzed.items[1].key).action_note, '[Nội dung nhạy cảm đã được ẩn]');
  const x1 = await f.report.exportSnapshot({ id: snapshot.id, session: CEO, format: 'xlsx' });
  f.rows[0].product_name = 'Dữ liệu live đã thay đổi';
  const x2 = await f.report.exportSnapshot({ id: snapshot.id, session: CEO, format: 'xlsx' });
  assert.deepEqual(x2.buffer, x1.buffer);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(x1.buffer);
  assert.equal(wb.getWorksheet('Chi tiết QLNB').pageSetup.orientation, 'landscape');
  assert.equal(wb.getWorksheet('Chi tiết QLNB').getCell('G2').value.toString().includes('Thuốc Việt'), true);
  assert.equal(wb.getWorksheet('Chi tiết QLNB').getColumn('I').numFmt, 'dd/mm/yyyy');
  const pdf = await f.report.exportSnapshot({ id: snapshot.id, session: CEO, format: 'pdf' });
  const pdf2 = await f.report.exportSnapshot({ id: snapshot.id, session: CEO, format: 'pdf' });
  assert.deepEqual(pdf2.buffer, pdf.buffer);
  assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.buffer.length > 3000);
  if (process.env.QLNB_REPORT_QA_DIR) {
    fs.mkdirSync(process.env.QLNB_REPORT_QA_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.QLNB_REPORT_QA_DIR, 'bao-cao-qlnb-qa.xlsx'), x1.buffer);
    fs.writeFileSync(path.join(process.env.QLNB_REPORT_QA_DIR, 'bao-cao-qlnb-qa.pdf'), pdf.buffer);
  }
  await assert.rejects(() => f.report.exportSnapshot({ id: snapshot.id, session: OTHER, format: 'pdf' }), /Không tìm thấy snapshot/);
});
