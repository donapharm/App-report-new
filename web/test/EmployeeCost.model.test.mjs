import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmployeeCostColumns, employeeCostViewModel, formatEmployeeCostCell } from '../src/employeeCostModel.js';

test('dynamic columns follow payload, prepend dimensions once, and block c32/c47', () => {
  const columns = buildEmployeeCostColumns([
    { key: 'c36', label: 'CP ctv (%)' },
    { key: 'c43', label: 'CP bs (%)' },
    { key: 'c47', label: 'Cấm' },
    { key: 'c32', label: 'Cấm' },
    { key: 'c5', label: 'Không lặp' },
  ]);
  assert.deepEqual(columns.map((column) => column.key), ['c5', 'c7', 'c16', 'c25', 'c36', 'c43']);
});

test('view model does not aggregate percentages and formats VN percent/money by metadata', () => {
  const model = employeeCostViewModel({
    empCode: 'DN001', columns: [{ key: 'c36', label: 'CP (%)' }],
    rows: [{ c5: 'QL1', c7: 'U1', c16: 'A', c25: 'Viên', c36: 8.5 }, { c5: 'QL2', c7: 'U2', c16: 'B', c25: 'Gói', c36: 3 }],
  });
  assert.equal(model.rows.length, 2);
  assert.equal(Object.hasOwn(model, 'total'), false);
  assert.equal(formatEmployeeCostCell(8.5, model.columns.at(-1)), '8,5%');
  assert.equal(formatEmployeeCostCell(1200000, { kind: 'money' }), '1.200.000đ');
});
