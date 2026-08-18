'use strict';
/**
 * HẠN CHÓT CHO BẢN "TẤT CẢ NV" — CEO lo 04/08: *"cứ mỗi lần nó load là lại cảm giác
 * thấy sợ nó lỗi hay treo luôn thì toi."*
 *
 * Đo thật trước khi sửa: 21 NV ÷ 3 luồng = 7 đợt × 25,5s/NV ≈ 178 giây, trong khi
 * trình duyệt bỏ cuộc ở 45s và Cloudflare cắt ở 100s ⇒ chắc chắn đứt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../src/routes'), 'utf8');

const { mapWithDeadline, EMPLOYEE_COST_ALL_DEADLINE_MS, EMPLOYEE_COST_ALL_CONCURRENCY } = require('../src/requestDeadline');

const sleep = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));
const roster = Array.from({ length: 8 }, (unused, index) => ({ emp_code: `DN00${index + 1}` }));
const skip = (employee, reason) => ({ empCode: employee.emp_code, sourceOutcome: reason === 'error' ? 'source_error' : 'deadline' });

test('‼ nguồn treo ⇒ vẫn TRẢ trong hạn, không để người dùng chờ vô tận', async () => {
  const started = Date.now();
  const results = await mapWithDeadline(roster, 2, () => sleep(60_000, { ok: true }), {
    deadlineAt: Date.now() + 300, onSkip: skip,
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3_000, `phải trả sớm, thực tế ${elapsed}ms`);
  assert.equal(results.length, 8, 'đủ đầu người, không ai bốc hơi');
  assert.ok(results.every((row) => row.sourceOutcome === 'deadline'));
});

test('‼ NV chưa kịp lấy số KHÔNG được trả 0đ — phải là "chưa có số"', async () => {
  const results = await mapWithDeadline(roster, 2, () => sleep(60_000), {
    deadlineAt: Date.now() + 200, onSkip: skip,
  });
  for (const row of results) {
    assert.notEqual(row.sourceOutcome, 'ok');
    assert.equal(row.total, undefined, 'không được bịa ra con số nào');
    assert.ok(row.empCode, 'phải nêu đích danh NV để hiện lên băng đỏ');
  }
});

test('nguồn khoẻ thì KHÔNG cắt ai — vẫn lấy đủ số thật', async () => {
  const results = await mapWithDeadline(roster, 4, (employee) => sleep(20, { empCode: employee.emp_code, sourceOutcome: 'ok' }), {
    deadlineAt: Date.now() + 5_000, onSkip: skip,
  });
  assert.equal(results.filter((row) => row.sourceOutcome === 'ok').length, 8);
});

test('‼ một NV hỏng KHÔNG được kéo sập cả bảng đội', async () => {
  const results = await mapWithDeadline(roster, 3, (employee) => (employee.emp_code === 'DN003'
    ? Promise.reject(new Error('DataHub 500'))
    : sleep(10, { empCode: employee.emp_code, sourceOutcome: 'ok' })), {
    deadlineAt: Date.now() + 5_000, onSkip: skip,
  });
  assert.equal(results.length, 8);
  assert.equal(results.find((row) => row.empCode === 'DN003').sourceOutcome, 'source_error');
  assert.equal(results.filter((row) => row.sourceOutcome === 'ok').length, 7);
});

test('hết giờ thì KHÔNG bắt đầu thêm NV nào nữa — bắt đầu cũng không kịp trả', async () => {
  let started = 0;
  await mapWithDeadline(roster, 1, () => { started += 1; return sleep(120, { sourceOutcome: 'ok' }); }, {
    deadlineAt: Date.now() + 250, onSkip: skip,
  });
  assert.ok(started <= 3, `chỉ được khởi động số ít, thực tế ${started}`);
});

test('‼ hạn chót phải nhỏ hơn ngưỡng trình duyệt/Cloudflare bỏ cuộc', () => {
  assert.ok(EMPLOYEE_COST_ALL_DEADLINE_MS <= 40_000,
    `phải dưới 45s (trình duyệt bỏ cuộc), đang là ${EMPLOYEE_COST_ALL_DEADLINE_MS}ms`);
  assert.ok(EMPLOYEE_COST_ALL_DEADLINE_MS < 100_000, 'phải dưới 100s (Cloudflare cắt, lỗi 524)');
  assert.ok(EMPLOYEE_COST_ALL_CONCURRENCY >= 4, 'ít luồng quá thì 21 NV chia thành quá nhiều đợt');
  // ‼ Bản "Tất cả NV" BẮT BUỘC đi qua hạn chót — quay lại mapWithConcurrency là treo lại.
  assert.match(source, /mapWithDeadline\(roster, EMPLOYEE_COST_ALL_CONCURRENCY/);
});

test('‼ NV bị cắt phải HIỆN TÊN, không được biến mất khỏi bảng', () => {
  // Bản sửa đầu tiên trả `periods: []` ⇒ tầng gộp không thấy NV đó ở đâu cả, họ
  // biến mất khỏi bảng thay vì hiện trên băng đỏ. Đúng thứ CEO cấm tuyệt đối.
  assert.match(source, /employeeCost\.emptyRangePayload\(employee\.emp_code, range, note\)/,
    'phải dùng khung rỗng chuẩn có periods theo từng kỳ');
  assert.match(source, /stub\.sourceOutcome = reason === 'error' \? 'source_error' : 'deadline'/);
  assert.match(source, /KHÔNG phải 0đ/, 'ghi chú phải nói rõ chưa có số ≠ 0 đồng');
});

test('NV trả rỗng phải log đúng allowlist, không log URL/token/payload', () => {
  assert.match(source, /\[employee-cost\] NV trả rỗng/);
  const blocks = [...source.matchAll(/console\.warn\('\[employee-cost\] NV trả rỗng',[\s\S]*?\n\s*}\);/g)].map((match) => match[0]);
  assert.ok(blocks.length >= 2, 'phải log cả response rỗng và deadline\/error skip');
  for (const block of blocks) {
    assert.match(block, /empCode/); assert.match(block, /outcome/); assert.match(block, /elapsedMs/); assert.match(block, /deadline/);
    assert.doesNotMatch(block, /token|assignmentKey|employeeCostKey|url|payload/i);
  }
});
