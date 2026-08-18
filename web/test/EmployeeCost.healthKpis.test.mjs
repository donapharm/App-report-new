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

test('projection giữ phép cân doanh thu để khối cảnh báo có thể render', () => {
  const model = employeeCostViewModel({
    empCode: 'ALL', allEmployees: true, from: '2026-07', to: '2026-07', periods: [],
    revenueRecon: {
      total: 1000, shown: 700, missingByUnavailable: 200, missingUnassigned: 100, unassignedRowCount: 2,
      gap: 0, balanced: true, rowCount: 9,
      unavailableEmployees: [{ empCode: 'NV01', revenue: 200 }, { empCode: '', revenue: 999 }],
    },
  });
  assert.deepEqual(model.revenueRecon, {
    unavailable: false,
    reason: '',
    total: 1000,
    shown: 700,
    missingByUnavailable: 200,
    missingUnassigned: 100,
    unassignedRowCount: 2,
    gap: 0,
    balanced: true,
    rowCount: 9,
    unavailableEmployees: [{ empCode: 'NV01', revenue: 200 }],
  });
});

test('projection fail-closed khi phép cân không có hoặc báo unavailable', () => {
  assert.equal(employeeCostViewModel({ periods: [] }).revenueRecon, null);
  const model = employeeCostViewModel({ periods: [], revenueRecon: { unavailable: true, reason: 'source unavailable' } });
  assert.equal(model.revenueRecon.unavailable, true);
  assert.equal(model.revenueRecon.reason, 'source unavailable');
  assert.equal(model.revenueRecon.total, null);
  assert.equal(model.revenueRecon.balanced, null);
});

test('JSX ba KPI chỉ truyền card.value/card.sub từ payload, không có công thức frontend', () => {
  const source = fs.readFileSync(path.join(here, '../src/pages/EmployeeCost.jsx'), 'utf8');
  const start = source.indexOf('{/* Hàng sức khoẻ chỉ dành cho ALL/CEO.');
  const end = source.indexOf('</div>', start);
  assert.ok(start >= 0 && end > start, 'không tìm thấy block KPI sức khoẻ');
  const block = source.slice(start, end);
  // Cho phép DUY NHẤT rèm che trình bày (maskMoneyInText) bọc ngoài; vẫn cấm mọi công thức.
  assert.match(block, /value=\{maskMoneyInText\(card\.value\)\}/);
  assert.match(block, /sub=\{maskMoneyInText\(card\.sub\)\}/);
  assert.doesNotMatch(block, /card\.(?:value|sub)\s*[*/+-]/);
  assert.doesNotMatch(block, /(?:Math\.|Number\(|parseFloat\(|parseInt\()/);
});

const page = fs.readFileSync(path.join(here, '../src/pages/EmployeeCost.jsx'), 'utf8');

/* ── TIỀN CHẠY ĐI ĐÂU: phép cân doanh thu hiện thẳng lên màn (CEO 10/08/2026) ──
 * CEO: *"doanh thu thực tế của T07.2026 đâu phải số này… giờ nó đang nằm ở đâu?
 * Mất mẹ nó doanh thu chạy đi đâu mất không còn đủ."*                            */

test('‼ màn nói rõ tổng kỳ · đang hiện · thiếu vì đâu — không bắt CEO tự đoán', () => {
  assert.match(page, /Doanh thu kỳ này KHÔNG lên bảng đủ — đây là chỗ phần thiếu đang nằm/);
  assert.match(page, /Tổng doanh thu kỳ \(kho App Report\)/);
  assert.match(page, /Đang hiện trên bảng/);
  assert.match(page, /Của NV <b>chưa lấy được %<\/b>/);
  assert.match(page, /Dòng <b>chưa gán được nhân viên<\/b>/);
});

test('fallback ALL vẫn hiện số đã phân bổ và nói thật mẫu số toàn đội', () => {
  assert.match(page, /model\.summary\.revenueBeforeVatTotal/);
  assert.match(page, /revenueAllocatedRowCount/);
  assert.match(page, /số dòng chưa gán: chưa đối soát được/);
  assert.match(page, /NV có dữ liệu/);
  assert.match(page, /NV chưa có nguồn/);
  assert.doesNotMatch(page, /\$\{team\.assigned\}\/\$\{team\.total\} NV có target/);
});

test('mỗi nguyên nhân kèm ĐÚNG cách sửa — hai nguyên nhân, hai việc khác nhau', () => {
  assert.match(page, /vào Danh mục QL bấm <b>"Đồng bộ % chi phí"<\/b> cho kỳ này/);
  assert.match(page, /xem tab <b>"Kiểm soát dữ liệu"<\/b>, đây là việc gán NV cho dòng, không phải lỗi %/);
});

test('‼ cân vẫn lệch thì NÓI RA, không im lặng làm tròn', () => {
  assert.match(page, /Cân vẫn lệch <b data-sensitive="">/);
  assert.match(page, /chưa giải thích được bằng hai nguyên nhân trên, báo Claude/);
});

test('mọi số tiền trong phép cân nằm dưới con mắt che số', () => {
  const block = page.slice(page.indexOf('Doanh thu kỳ này KHÔNG lên bảng đủ'), page.indexOf('staleEmpCodes.length'));
  const bolds = block.match(/<b data-sensitive="">/g) || [];
  assert.ok(bolds.length >= 4, 'tiền phải nằm dưới con mắt');
  assert.doesNotMatch(block, /<b>\{formatEmployeeCostCell/, 'không được để số tiền trần');
});

/* ── DOANH THU KHÔNG ĐƯỢC PHỤ THUỘC NGUỒN CHI PHÍ (CEO 10/08 09:00) ───────────
 * Cùng kỳ T07 ĐÃ CHỐT SỔ, doanh thu tụt 20,03 tỷ → 3,28 tỷ chỉ vì số NV lấy được %
 * giảm từ 11 xuống 2. Doanh thu là dữ liệu CỦA App Report và luôn đủ — không đời
 * nào doanh thu một kỳ đã chốt lại đổi vì DataHub trả chậm.                      */

test('‼ ô doanh thu lấy TỔNG KỲ từ kho doanh thu, không lấy tổng của bảng chi phí', () => {
  assert.match(page, /const reconTotalBeforeVat = model\?\.revenueRecon && !model\.revenueRecon\.unavailable/);
  assert.match(page, /value=\{formatEmployeeCostCell\(reconTotalBeforeVat \?\? model\.summary\.revenueBeforeVatTotal, moneyColumn\)\}/);
  assert.match(page, /KHÔNG đổi theo nguồn chi phí/);
});

test('nhãn ô đổi theo nguồn số — "TỔNG KỲ" khác "đã phân bổ", không nhận nhầm', () => {
  assert.match(page, /reconTotalBeforeVat != null \? 'Doanh thu chưa VAT · TỔNG KỲ' : 'Doanh thu chưa VAT · đã phân bổ'/);
});

test('vẫn đối chiếu được: phần đang hiện trên bảng nằm ở dòng phụ khi hai số khác nhau', () => {
  assert.match(page, /đang hiện trên bảng: \$\{formatEmployeeCostCell\(model\.revenueRecon\.shown \/ VAT_DIVISOR, moneyColumn\)\}/);
  assert.match(page, /model\.revenueRecon\.shown !== model\.revenueRecon\.total/);
});

test('chưa soát được kho doanh thu ⇒ lùi về số cũ, KHÔNG bịa tổng kỳ', () => {
  assert.match(page, /Number\.isFinite\(Number\(model\.revenueRecon\.total\)\) && Number\(model\.revenueRecon\.total\) > 0/);
  assert.match(page, /\? Number\(model\.revenueRecon\.total\) \/ VAT_DIVISOR\s*\n\s*: null;/);
});
