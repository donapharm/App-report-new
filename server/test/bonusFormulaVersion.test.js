'use strict';
// KHOÁ SỐ HIỆU CÔNG THỨC THƯỞNG (CEO chốt 2026-07-29).
//
// Hai việc test này bảo vệ:
//  1. Nhãn version chỉ có MỘT nguồn: employeeBonus.FORMULA_VERSION. File cấu hình
//     và mọi chữ hiện trên màn hình đều phải khớp. Trước đây nút bấm ghi "v3.2"
//     còn tiêu đề hộp sửa tay ghi "v3.1" nên CEO không biết mình đang sửa bản nào.
//  2. SỬA CÁCH TÍNH THƯỞNG => PHẢI NÂNG VERSION. Dấu vân tay của phần mã tính
//     thưởng được chốt trong config/bonus_formula_lock.json. Đổi công thức mà
//     quên nâng version thì test này đỏ, kèm hướng dẫn sửa.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const employeeBonus = require('../src/employeeBonus');
const LOCK_FILE = path.join(ROOT, 'config', 'bonus_formula_lock.json');
// Mã quyết định số tiền thưởng. Thêm file mới có ảnh hưởng công thức thì thêm vào đây.
const FORMULA_SOURCES = ['src/employeeBonus.js', 'src/employeeBonusPolicy.js', 'src/employeePenalty.js', 'src/employeePenaltyAggregate.js', 'src/employeePenaltyPolicy.js', 'src/xuPolicy.js'];
const FORMULA_CONFIG_KEYS = [
  'base', 'baseTiers', 'priorityThresholdPct', 'priorityRates', 'autoGroupTargets', 'totalCapPct',
  'penaltyTiers', 'penaltyEffectiveFrom', 'penaltyWarnFrom', 'penaltyEnabled', 'xuPenalty',
];

// Bỏ chú thích cả dòng + dòng trống: sửa lời giải thích thì KHÔNG bắt nâng version,
// nhưng đụng vào một ký tự mã tính toán là vân tay đổi ngay.
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim() && !line.trim().startsWith('//'))
    .join('\n');
}

function formulaFingerprint() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'employee_bonus_tiers.json'), 'utf8'));
  const parts = FORMULA_SOURCES.map((rel) => `${rel}\n${stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'))}`);
  parts.push(JSON.stringify(Object.fromEntries(FORMULA_CONFIG_KEYS.map((key) => [key, config[key] ?? null]))));
  return crypto.createHash('sha256').update(parts.join('\n---\n')).digest('hex');
}

test('số hiệu công thức chỉ có một nguồn và đúng dạng vN.N', () => {
  assert.match(employeeBonus.FORMULA_VERSION, /^v\d+\.\d+$/);
});

test('file cấu hình mang đúng số hiệu công thức đang chạy', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'employee_bonus_tiers.json'), 'utf8'));
  assert.ok(String(config.version).includes(employeeBonus.FORMULA_VERSION.replace(/^v/, 'v')),
    `employee_bonus_tiers.json ghi "${config.version}" nhưng công thức đang chạy là ${employeeBonus.FORMULA_VERSION}`);
  assert.ok(String(config.note).includes(employeeBonus.FORMULA_VERSION),
    'phần "note" mô tả công thức cũng phải ghi đúng số hiệu');
});

test('‼ đổi cách tính thưởng thì PHẢI nâng version (khoá vân tay)', () => {
  const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
  assert.equal(lock.version, employeeBonus.FORMULA_VERSION,
    'bonus_formula_lock.json phải chốt đúng version đang chạy');
  const now = formulaFingerprint();
  assert.equal(now, lock.sourceHash, [
    '',
    'CÁCH TÍNH THƯỞNG ĐÃ THAY ĐỔI so với bản đã chốt.',
    `  version đang chốt : ${lock.version}`,
    `  vân tay đã chốt   : ${lock.sourceHash}`,
    `  vân tay hiện tại  : ${now}`,
    'Bắt buộc làm đủ 3 bước (CEO chốt 29/07):',
    '  1. Nâng FORMULA_VERSION trong server/src/employeeBonus.js (vd v3.2 -> v3.3)',
    '  2. Cập nhật "version" + "note" trong server/config/employee_bonus_tiers.json',
    '  3. Ghi version + vân tay mới vào server/config/bonus_formula_lock.json và ghi 1 mục CHANGELOG.md',
  ].join('\n'));
});

test('giao diện Target không còn nhãn version chết cứng', () => {
  const src = fs.readFileSync(path.join(ROOT, '..', 'web', 'src', 'pages', 'Target.jsx'), 'utf8');
  // Bỏ dòng khai báo giá trị dự phòng — chỗ duy nhất được phép ghi thẳng số hiệu.
  const body = src.split('\n').filter((line) => !line.includes('BONUS_FORMULA_VERSION_FALLBACK =')).join('\n');
  assert.doesNotMatch(body, /Thưởng v\d+\.\d+|Thưởng dự kiến v\d+\.\d+|mặc định v\d+\.\d+/,
    'nhãn version trên màn hình phải lấy từ API, không ghi thẳng vào JSX');
  assert.match(src, /const BONUS_FORMULA_VERSION_FALLBACK = '([^']+)'/);
  const fallback = /const BONUS_FORMULA_VERSION_FALLBACK = '([^']+)'/.exec(src)[1];
  assert.equal(fallback, employeeBonus.FORMULA_VERSION, 'giá trị dự phòng của web phải khớp backend');
});

test('lưu xong phải nạp lại số của trang cha và giữ hộp số trên màn hình', () => {
  const src = fs.readFileSync(path.join(ROOT, '..', 'web', 'src', 'pages', 'Target.jsx'), 'utf8');
  assert.match(src, /<BonusPolicyPanel ky=\{ky\} employees=\{data\?\.rows \|\| \[\]\} onSaved=\{onTargetsChanged\} \/>/,
    'hộp Cấu hình Thưởng phải báo cho trang cha nạp lại số sau khi lưu');
  const save = /async function save\(\) \{[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(save, /await onSaved\?\.\(\)/, 'save() phải gọi onSaved');
  assert.match(save, /saved: true/, 'sau khi lưu phải hiện lại số thực tế, không xoá trắng hộp preview');
  assert.doesNotMatch(save, /setPreview\(null\); await load\(\);/, 'không được xoá số rồi bỏ mặc màn hình trống');
});

test('backend phơi số hiệu công thức ra cả 2 route giao diện đang dùng', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'src', 'routes.js'), 'utf8');
  assert.match(routes, /bonusFormulaVersion: employeeBonus\.FORMULA_VERSION/, '/admin/targets');
  assert.match(routes, /formulaVersion: employeeBonus\.FORMULA_VERSION/, '/admin/bonus-policies');
});

test('lưu cấu hình thưởng xong backend phải xoá cache, nếu không API vẫn trả số cũ', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'src', 'routes.js'), 'utf8');
  const save = /router\.post\('\/admin\/bonus-policies', [\s\S]*?\n\}\);/.exec(routes)[0];
  assert.match(save, /employeeBonusPolicy\.savePreview\(preview, actor\);\s*\n\s*clearTargetDependentCache\(\);/,
    'phải xoá cache NGAY SAU khi ghi cấu hình mới');
});
