import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/* ── BẢNG DANH MỤC PHẢI TỰ KHAI KỲ CỦA NÓ (CEO yêu cầu 10/08/2026) ───────────
 * CEO: *"Đáng lẽ khi chọn kỳ phụ trách ở trên là T07.2026 thì ở dưới bảng danh mục
 * cột phụ trách từ kỳ nó cũng phải nhảy theo, hoặc làm sao để nhìn thấy bảng dưới
 * chính xác là của T07.2026, còn chuyển kỳ thì nó cho biết bảng của tháng mấy chứ."*
 *
 * Hai điều phải giữ mãi:
 *  1. Nhìn vào bảng là biết kỳ nào — kể cả khi đã cuộn qua ô "Kỳ" ở đầu trang.
 *  2. Cột "Phụ trách từ kỳ" KHÔNG phải kỳ của bảng; nó là kỳ NV bắt đầu nhận cặp,
 *     nên nó KHÔNG nhảy theo ô "Kỳ" — và màn phải nói ra điều đó thay vì để đoán.
 */

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

test('bảng danh mục có nhãn kỳ dán ngay trên đầu bảng', () => {
  assert.match(page, /function CatalogPeriodBanner/);
  assert.match(page, /Bảng danh mục KỲ \{tablePeriod \|\| '—'\}/);
  // Cả hai bảng (CEO/admin và nhân viên) đều phải có, không được sót màn nào.
  assert.ok((page.match(/<CatalogPeriodBanner /g) || []).length >= 2,
    'cả bảng admin lẫn bảng nhân viên phải khai kỳ');
});

test('nhãn kỳ của bảng admin lấy đúng kỳ CỦA BẢNG, không lấy kỳ vừa bấm', () => {
  // Bảng có thể đang giữ kỳ cũ (kỳ mới tải hỏng). Lấy kỳ vừa bấm là nói dối.
  assert.match(page, /<CatalogPeriodBanner tablePeriod=\{hubToUi\(period\)\} selectedPeriod=\{selectedPeriod\}/);
  assert.match(page, /<AdminView data=\{data\} period=\{uiToHub\(shownPeriod \|\| period\)\} selectedPeriod=\{period\}/);
});

test('lệch kỳ ⇒ nhãn nói thẳng bảng dưới CHƯA đổi, không im lặng', () => {
  const banner = page.slice(page.indexOf('function CatalogPeriodBanner'), page.indexOf('/** Chọn số dòng tối đa'));
  assert.match(banner, /const mismatch = !!selectedPeriod && !!tablePeriod && selectedPeriod !== tablePeriod/);
  assert.match(banner, /is-mismatch/);
  assert.match(banner, /bảng dưới VẪN là kỳ \$\{tablePeriod\}/);
  assert.match(css, /\.catalog-period-banner\.is-mismatch/, 'trạng thái lệch phải có CSS riêng, nhìn là thấy');
});

test('nói rõ cột "Phụ trách từ kỳ" mang nghĩa KHÁC kỳ của bảng', () => {
  const banner = page.slice(page.indexOf('function CatalogPeriodBanner'), page.indexOf('/** Chọn số dòng tối đa'));
  assert.match(banner, /kỳ nhân viên BẮT ĐẦU nhận cặp/);
  // Tiêu đề cột cũng phải tự giải nghĩa — không phải ai cũng rê chuột vào tooltip.
  assert.ok((page.match(/catalog-col-since/g) || []).length >= 2, 'cả hai bảng đều gắn lớp tiêu đề');
  assert.ok((page.match(/<small>kỳ NV bắt đầu nhận<\/small>/g) || []).length >= 2);
  assert.match(css, /\.catalog-col-since small/);
});

test('thanh trang DÍNH đầu màn mang theo huy hiệu kỳ — cuộn xa vẫn biết đang đọc kỳ nào', () => {
  assert.match(page, /function Pager\(\{ page, pageCount, total, onPage, location, period = '' \}\)/);
  assert.match(page, /catalog-pager-period/);
  assert.ok((page.match(/<Pager [^>]*period=\{/g) || []).length >= 4,
    'mọi thanh trang của danh mục đều phải mang kỳ');
  assert.match(css, /\.catalog-pager-period \{/);
});

test('mọi lớp CSS mới đều có định nghĩa — không để giao diện trơ', () => {
  for (const cls of ['catalog-period-banner', 'catalog-period-banner-count', 'catalog-pager-period', 'catalog-col-since']) {
    assert.match(css, new RegExp(`\\.${cls}\\b`), `thiếu CSS cho .${cls}`);
  }
});
