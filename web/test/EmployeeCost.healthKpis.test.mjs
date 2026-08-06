import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { employeeCostViewModel } from '../src/employeeCostModel.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('projection giữ nguyên ba chuỗi KPI do backend sở hữu, không tự suy số', () => {
  const cards = [
    { key: 'costRevenueRatio', label: 'CP/DT · hiệu quả chi phí', available: true, value: '7,4%', sub: 'chi phí gốc · kỳ trước: —', tone: 'employee-cost-tone-base' },
    { key: 'unallocatedRevenue', label: 'Doanh thu chưa phân bổ NV', available: true, value: '1.795.600đ · 1 dòng', sub: 'cách ly: 1.795.600đ · thiếu danh mục: 0đ', tone: 'employee-cost-tone-penalty-soft', action: 'open_data_quality' },
    { key: 'targetForecast', label: 'Dự báo đạt target cuối tháng', available: true, value: 'Dự báo: ~105,0% target', sub: 'cần 47đ/ngày làm việc · còn 19 ngày làm việc', tone: 'employee-cost-tone-target' },
  ];
  const model = employeeCostViewModel({
    empCode: 'ALL', allEmployees: true, from: '2026-08', to: '2026-08', periods: [],
    healthKpis: { period: '2026-08', today: '2026-08-05', backendOwned: true, cards },
  });
  assert.equal(model.healthKpis.backendOwned, true);
  assert.deepEqual(model.healthKpis.cards.map(({ key, value, sub }) => ({ key, value, sub })),
    cards.map(({ key, value, sub }) => ({ key, value, sub })));
  assert.equal(model.healthKpis.cards[1].action, 'open_data_quality');
});

test('projection loại card/tone/action ngoài hợp đồng backend', () => {
  const model = employeeCostViewModel({
    periods: [],
    healthKpis: { cards: [
      { key: 'unknown', value: '999%' },
      { key: 'costRevenueRatio', label: 'CP/DT', value: '—', tone: 'arbitrary-class', action: 'mutate_money' },
    ] },
  });
  assert.equal(model.healthKpis.cards.length, 1);
  assert.equal(model.healthKpis.cards[0].tone, 'employee-cost-tone-neutral');
  assert.equal(model.healthKpis.cards[0].action, '');
});

test('JSX ba KPI chỉ truyền card.value/card.sub từ payload, không có công thức frontend', () => {
  const source = fs.readFileSync(path.join(here, '../src/pages/EmployeeCost.jsx'), 'utf8');
  const start = source.indexOf('{/* Hàng sức khoẻ chỉ dành cho ALL/CEO.');
  const end = source.indexOf('</div>', start);
  assert.ok(start >= 0 && end > start, 'không tìm thấy block KPI sức khoẻ');
  const block = source.slice(start, end);
  assert.match(block, /value=\{card\.value\}/);
  assert.match(block, /sub=\{card\.sub\}/);
  assert.doesNotMatch(block, /card\.(?:value|sub)\s*[*/+-]/);
  assert.doesNotMatch(block, /(?:Math\.|Number\(|parseFloat\(|parseInt\()/);
});
