import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');

test('đổi kỳ KHÔNG đập bảng cũ về vòng quay (CEO 08/08: "quay như vậy thì rất kẹt")', () => {
  const load = page.slice(page.indexOf('async function load(selected = period)'), page.indexOf('useEffect(() => { api.periods()'));
  // Bản cũ gọi setData(null) ngay đầu ⇒ cả trang trắng. Không được quay lại.
  assert.doesNotMatch(load, /setData\(null\)/, 'không được xoá dữ liệu cũ trước khi tải');
  assert.match(load, /setLoadingPeriod\(selected\)/);
  assert.match(load, /finally \{ setLoadingPeriod\(''\); \}/);
});

test('tải hỏng thì GIỮ bảng cũ + báo lỗi, không về màn trắng', () => {
  const load = page.slice(page.indexOf('async function load(selected = period)'), page.indexOf('useEffect(() => { api.periods()'));
  const katch = load.slice(load.indexOf('catch (e)'));
  assert.match(katch, /setError\(e\.message\)/);
  assert.doesNotMatch(katch, /setData\(/, 'lỗi không được đụng tới dữ liệu đang hiển thị');
});

test('đang tải mà đã có bảng ⇒ chỉ dải mảnh, và NÓI RÕ bảng dưới là kỳ nào', () => {
  assert.match(page, /catalog-loading-strip/);
  assert.match(page, /Đang tải danh mục kỳ <b>\{loadingPeriod\}<\/b>/);
  // Không được để người đọc tưởng số trên màn đã là kỳ vừa chọn.
  assert.match(page, /shownPeriod && shownPeriod !== loadingPeriod/);
  assert.match(page, /Bảng dưới vẫn là <b>kỳ \{shownPeriod\}<\/b>/);
});

test('lần đầu chưa có gì để giữ ⇒ khung chờ NÓI đang chờ cái gì, không phải vòng quay trơ', () => {
  assert.match(page, /catalog-first-load/);
  assert.match(page, /Đang tải danh mục kỳ \{loadingPeriod \|\| period\} từ Data Hub/);
  assert.match(page, /27\.700 cặp/, 'nói rõ vì sao lâu');
});

test('bảng % kho cục bộ theo cùng luật: đổi kỳ giữ bảng cũ', () => {
  const panel = page.slice(page.indexOf('function CostRatesTablePanel'), page.indexOf('function CostRatesSyncCard'));
  assert.doesNotMatch(panel, /setData\(null\); setError\(''\)/, 'không đập bảng % về trắng khi đổi kỳ');
  assert.match(panel, /bảng dưới vẫn là bản vừa xem/);
  // Huỷ đúng cách khi đổi kỳ liên tục — tránh kết quả kỳ cũ ghi đè kỳ mới.
  assert.match(panel, /let alive = true/);
  assert.match(panel, /if \(alive\) setData\(result\)/);
});

test('‼ CẤM bịa số trong chữ giao diện — mọi con số trên màn phải là số THẬT', () => {
  // CEO 09/08: câu chờ ghi "khoảng 27.700 cặp" (Claude viết cứng), CEO đọc thành số
  // liệu thật rồi hỏi vì sao lệch 19 dòng so với 27.719 thực tế. Trong app mà nguyên
  // tắc là "không dòng nào biến mất lặng lẽ", một con số bịa làm hỏng lòng tin vào
  // MỌI con số khác.
  const literals = page.match(/>\s*[^<>{}]*\b2[0-9][.,][0-9]{3}\b[^<>{}]*</g) || [];
  assert.deepEqual(literals, [], 'không được viết cứng số dòng/cặp vào chữ giao diện');
  assert.doesNotMatch(page, /khoảng <b>[\d.,]+/);
});
