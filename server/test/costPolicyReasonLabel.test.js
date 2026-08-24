'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const employeeCost = require('../src/employeeCost');

/* Claude review 24/08 trên candidate dd1824e. Bản đó thêm 4 outcome `rate_policy_*`
 * (đúng: tiền phải là `—` khi thiếu chính sách). NHƯNG `sourceFailureReason()` khi
 * đó rơi hết chúng vào `upstream_unavailable`, và màn hình dịch chuỗi đó thành
 * "nguồn tạm unavailable" — nghĩa là "chờ tí rồi thử lại". Sai đường: thiếu bảng tỷ
 * lệ thì chờ đến bao giờ cũng vô ích, phải DataHub công bố. Nói sai câu là đẩy
 * người dùng đi nhầm hướng — đúng lỗi đã lặp nhiều lần tuần này. */

const RATE_POLICY_CODES = [
  'rate_policy_missing', 'rate_policy_unavailable',
  'rate_policy_ambiguous', 'rate_policy_not_applicable',
];

test('thiếu bảng tỷ lệ KHÔNG bị gán nhầm thành nguồn chập chờn', () => {
  const sync = fs.readFileSync(path.join(__dirname, '..', 'src', 'employeeCostSnapshotSync.js'), 'utf8');
  const body = sync.slice(sync.indexOf('function sourceFailureReason'), sync.indexOf('function usableResult'));
  for (const code of RATE_POLICY_CODES) assert.match(body, new RegExp(code), `${code} phải được nhận diện riêng`);
  // Vẫn giữ kỷ luật danh sách trắng: chuỗi lạ vẫn phải rơi về upstream_unavailable.
  assert.match(body, /return 'upstream_unavailable';/);
  // Cho `value` đi thẳng ra ngoài CHỈ được phép sau phép so bằng tuyệt đối với đúng
  // bốn chuỗi cố định. Cấm khớp lỏng (`includes`/`startsWith`/regex) vì như vậy là
  // mở cửa cho chuỗi lạ từ nguồn chui thẳng lên màn hình.
  for (const code of RATE_POLICY_CODES) {
    assert.match(body, new RegExp(`value === '${code}'`), `${code} phải so bằng tuyệt đối`);
  }
  assert.doesNotMatch(body, /includes\('rate_policy|startsWith\('rate_policy|\/\^rate_policy/,
    'không được khớp lỏng chuỗi rate_policy — chỉ so bằng tuyệt đối');
});

test('bốn mã tỷ lệ đều KHÔNG nằm trong nhóm dùng được — tiền phải là dấu gạch', () => {
  for (const code of RATE_POLICY_CODES) {
    assert.equal(employeeCost.isUsableOutcome(code), false, `${code} không được coi là nguồn khoẻ`);
  }
  assert.equal(employeeCost.isUsableOutcome('ok'), true);
});

test('màn hình có câu tiếng Việt nói RÕ PHẢI LÀM GÌ cho từng mã tỷ lệ', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'pages', 'EmployeeCost.jsx'), 'utf8');
  const dict = page.slice(page.indexOf('SNAPSHOT_REASON_LABELS'), page.indexOf('UPSTREAM_REJECTED_NOTE'));
  for (const code of RATE_POLICY_CODES) assert.match(dict, new RegExp(`${code}:`), `${code} thiếu nhãn tiếng Việt`);
  assert.match(dict, /báo DataHub/, 'phải chỉ đúng nơi xử lý, không để người dùng ngồi chờ');
});

test('lớp lọc phía web không nuốt mất bốn mã này thành upstream_unavailable', () => {
  const model = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'employeeCostModel.js'), 'utf8');
  for (const code of RATE_POLICY_CODES) {
    assert.equal((model.match(new RegExp(`'${code}'`, 'g')) || []).length, 2,
      `${code} phải có trong CẢ HAI danh sách trắng của employeeCostModel`);
  }
});
