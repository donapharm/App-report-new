const test = require('node:test');
const assert = require('node:assert/strict');
const gaps = require('../src/employeeCostGaps');

const roster = [{ emp_code: 'DN001', name: 'A' }, { emp_code: 'DN007', name: 'B' }];
const session = { emp_code: 'CEO', role: 'ceo' };
// DN001 lấy được nguồn (có 1 mã thiếu %), DN007 lỗi nguồn.
const fetchCost = async (empCode) => (empCode === 'DN007'
  ? { outcome: 'upstream_unavailable', payload: {} }
  : {
    outcome: 'ok',
    payload: {
      empCode, from: '2026-07', to: '2026-07',
      periods: [{ period: '2026-07', columns: [{ key: 'c36', label: 'CP (%)' }], rows: [] }],
    },
  });
const revenueRowsFor = async () => [];
const catalogRowsFor = async () => [{ c5: 'MA1', c7: 'ĐV1', c16: 'Thuoc' }];

test('1 NV lỗi nguồn KHÔNG làm trắng cả worklist, và được nêu đích danh', async () => {
  const out = await gaps.buildForSession({
    session, scope: {}, roster, from: '2026-07', to: '2026-07',
    fetchCost, revenueRowsFor, catalogRowsFor, auditImpl: () => {},
  });
  // Vẫn trả về được (không ném lỗi làm trắng màn).
  assert.ok(Array.isArray(out.items));
  // Nêu đích danh NV lỗi nguồn.
  assert.deepEqual(out.unavailable.employees, ['DN007']);
  assert.equal(out.unavailable.count, 1);
  assert.match(out.unavailable.note, /DN007/);
  // TUYỆT ĐỐI không suy ra "thiếu %" cho NV lỗi nguồn.
  assert.equal(out.pairs.some((pair) => pair.employeeCode === 'DN007'), false);
  assert.equal(out.coverageByEmployee.some((entry) => entry.employeeCode === 'DN007'), false);
});

test('mọi NV lấy được nguồn thì không có cảnh báo thiếu', async () => {
  const out = await gaps.buildForSession({
    session, scope: {}, roster: [{ emp_code: 'DN001', name: 'A' }], from: '2026-07', to: '2026-07',
    fetchCost, revenueRowsFor, catalogRowsFor, auditImpl: () => {},
  });
  assert.equal(out.unavailable.count, 0);
  assert.equal(out.unavailable.note, '');
});
