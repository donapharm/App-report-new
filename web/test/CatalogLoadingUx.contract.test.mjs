import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLatestRequestGate } from '../src/requestCoordinator.js';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');

test('đổi kỳ KHÔNG đập bảng cũ về vòng quay (CEO 08/08: "quay như vậy thì rất kẹt")', () => {
  const load = page.slice(page.indexOf('async function load(selected = period)'), page.indexOf('useEffect(() => { api.periods()'));
  // Bản cũ gọi setData(null) ngay đầu ⇒ cả trang trắng. Không được quay lại.
  assert.doesNotMatch(load, /setData\(null\)/, 'không được xoá dữ liệu cũ trước khi tải');
  assert.match(load, /setLoadingPeriod\(selected\)/);
  assert.match(load, /finally \{[\s\S]*if \(request\.isLatest\(\)\) setLoadingPeriod\(''\);[\s\S]*\}/);
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

test('đổi kỳ liên tục chỉ cho request mới nhất ghi dữ liệu/lỗi/loading state', () => {
  const load = page.slice(page.indexOf('async function load(selected = period)'), page.indexOf('useEffect(() => { api.periods()'));
  assert.match(page, /createLatestRequestGate/);
  assert.match(load, /const request = loadGateRef\.current\.next\(\)/);
  assert.ok((load.match(/if \(!request\.isLatest\(\)\) return;/g) || []).length >= 2, 'chặn cả dữ liệu chính và metadata cũ');
  assert.match(load, /if \(request\.isLatest\(\)\) setError\(e\.message\)/);
  assert.match(load, /if \(request\.isLatest\(\)\) setLoadingPeriod\(''\)/);
  assert.match(page, /loadGateRef\.current\?\.cancel\(\)/, 'unmount phải vô hiệu request còn treo');
});

test('request kỳ cũ resolve sau không thể ghi đè kỳ mới', async () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  };
  const gate = createLatestRequestGate();
  const commits = [];
  const run = async (pending) => {
    const request = gate.next();
    const value = await pending.promise;
    if (request.isLatest()) commits.push(value);
  };
  const oldPeriod = deferred();
  const newPeriod = deferred();
  const oldRun = run(oldPeriod);
  const newRun = run(newPeriod);
  newPeriod.resolve('08.2026');
  await newRun;
  oldPeriod.resolve('07.2026');
  await oldRun;
  assert.deepEqual(commits, ['08.2026']);
});

test('bảng % kho cục bộ theo cùng luật: đổi kỳ giữ bảng cũ', () => {
  const panel = page.slice(page.indexOf('function CostRatesTablePanel'), page.indexOf('function CostRatesSyncCard'));
  assert.doesNotMatch(panel, /setData\(null\); setError\(''\)/, 'không đập bảng % về trắng khi đổi kỳ');
  assert.match(panel, /bảng dưới vẫn là bản vừa xem/);
  // Huỷ đúng cách khi đổi kỳ liên tục — tránh kết quả kỳ cũ ghi đè kỳ mới.
  assert.match(panel, /let alive = true/);
  assert.match(panel, /if \(alive\) setData\(result\)/);
});
