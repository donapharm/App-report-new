import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { employeeCostDataQualityView, normalizeEmployeeCostDataQuality, dataQualityTypeLabel } from '../src/employeeCostDataQualityModel.js';

const payload = {
  from: '2026-07', to: '2026-07', scope: { admin: true },
  sources: { productMasterCrosswalk: { status: 'ready', source: 'app_sale_s2s', rowCount: 1 } },
  summary: { exceptionCount: 3, redCount: 2, yellowCount: 1, revenueAffected: 15_000_000, redRevenueAffected: 13_000_000 },
  items: [
    { key: 'unit', type: 'UNIT_UNKNOWN', severity: 'yellow', productCode: 'P3', productName: 'Thuốc C', unitCode: '999', unitLabels: ['999.BV lạ'], employeeCodes: ['DN001'], routes: ['CL'], revenueAffected: 2_000_000, lineCount: 1, cause: 'Mã đơn vị chưa có trong danh mục.', action: 'Bổ sung danh mục đơn vị.', repairSource: 'App Sale / danh mục đơn vị' },
    { key: 'uom', type: 'UOM_MISMATCH', severity: 'red', productCode: 'P2', productName: 'Thuốc B', unitCode: '002', unitLabels: ['002.BV Đồng Nai'], employeeCodes: ['DN002'], routes: ['TW'], revenueAffected: 3_000_000, lineCount: 2, invalidValue: 'Hộp ≠ Viên', cause: 'ĐVT sale khác catalog.', action: 'Đối chiếu quy đổi.', repairSource: 'App Sale / catalog' },
    { key: 'missing', type: 'PRODUCT_MISSING', severity: 'red', productCode: 'P1', productName: 'Thuốc Á', unitCode: '001', unitLabels: ['001.BV Tâm Đức'], employeeCodes: ['DN001'], routes: ['CL'], revenueAffected: 10_000_000, lineCount: 4, cause: 'Có doanh thu nhưng chưa có tỷ lệ.', action: 'DataHub nhập tỷ lệ.', repairSource: 'DataHub' },
  ],
};

test('DQ view keeps severity priority then affected revenue and Vietnamese labels', () => {
  const view = employeeCostDataQualityView(payload);
  assert.deepEqual(view.items.map((item) => item.key), ['missing', 'uom', 'unit']);
  assert.equal(view.filteredSummary.redCount, 2);
  assert.equal(view.filteredSummary.revenueAffected, 15_000_000);
  assert.equal(dataQualityTypeLabel('UOM_MISMATCH'), 'ĐVT không khớp');
});

test('DQ filters are accent-insensitive and cover type/severity/employee/unit/route/source', () => {
  assert.equal(employeeCostDataQualityView(payload, { q: 'tam duc' }).items[0].key, 'missing');
  assert.equal(employeeCostDataQualityView(payload, { type: 'UNIT_UNKNOWN', severity: 'yellow' }).items[0].key, 'unit');
  assert.equal(employeeCostDataQualityView(payload, { employee: 'dn002', route: 'tw' }).items[0].key, 'uom');
  assert.equal(employeeCostDataQualityView(payload, { unit: 'dong nai', repairSource: 'catalog' }).items[0].key, 'uom');
});

test('DQ normalization drops unsupported rules and does not surface forbidden cost fields', () => {
  const model = normalizeEmployeeCostDataQuality({ items: [
    { type: 'PRODUCT_MISSING', productCode: 'P1', unitCode: '001', C32: 9, C47: 8, percent: 7 },
    { type: 'ROUTE_MISSING', productCode: 'P2', unitCode: '002' },
  ] });
  assert.equal(model.items.length, 1);
  assert.equal(/C32|C47|percent/i.test(JSON.stringify(model)), false);
});

test('DQ model exposes unavailable UOM source without dropping other exceptions', () => {
  const model = normalizeEmployeeCostDataQuality({
    sources: { productMasterCrosswalk: { status: 'source_unavailable', message: 'provider down' } },
    items: [{ type: 'BID_PRICE_INVALID', productCode: 'P1', unitCode: '001', severity: 'red' }],
  });
  assert.equal(model.uomRuleUnavailable, true);
  assert.equal(model.sources.productMasterCrosswalk.status, 'source_unavailable');
  assert.match(model.sources.productMasterCrosswalk.message, /provider down/);
  assert.equal(model.items.length, 1);
});

test('DQ model keeps unverified UOM separate from definitive mismatch', () => {
  const view = employeeCostDataQualityView({
    sources: { productMasterCrosswalk: { status: 'source_unavailable' } },
    items: [{
      type: 'UOM_CONVERSION_UNVERIFIED', severity: 'yellow', productCode: 'P1', unitCode: 'U1',
      invalidValue: 'Gói ↔ Gam', revenueAffected: 500,
    }],
  });
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].type, 'UOM_CONVERSION_UNVERIFIED');
  assert.equal(dataQualityTypeLabel(view.items[0].type), 'Quy đổi ĐVT chưa xác minh');
  assert.equal(view.items.some((item) => item.type === 'UOM_MISMATCH'), false);
});

test('Employee Cost dashboard and existing bell expose DQ API, exports and deep link', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  const bell = fs.readFileSync(new URL('../src/CeoNotificationBell.jsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
  assert.match(page, /Kiểm soát dữ liệu/);
  assert.match(page, /employeeCostDataQuality/);
  assert.match(page, /downloadEmployeeCostDataQuality/);
  assert.match(page, /addEventListener\('app:navigate'/);
  assert.match(page, /event\.detail\.view === 'dq'/);
  assert.match(page, /code !== 'UNALLOCATED'/);
  assert.match(page, /data-source-status="source_unavailable"/);
  assert.match(page, /Các quy tắc kiểm soát dữ liệu khác vẫn hoạt động/);
  assert.match(bell, /employeeCostDataQualitySummary/);
  assert.match(bell, /dq\.redCount/);
  assert.match(api, /employee-cost\/data-quality/);
  assert.match(api, /Authorization: 'Bearer ' \+ getToken\(\)/);
});
