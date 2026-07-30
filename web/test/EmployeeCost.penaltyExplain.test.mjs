// GIẢI THÍCH PHẠT CHO NHÂN VIÊN (CEO chốt 2026-07-30).
// CEO: "yêu cầu thêm cột c45 (lương tăng thêm) để nv biết rõ, họ không biết cột c45
// là cột gì. phần giải thích khi bấm ra phải rõ hơn để nv hình dung được các ngữ cảnh
// có thể bị phạt nếu không cố gắng."
// Test này khoá: (1) mọi chỗ nhắc C45 trong hộp giải thích đều dùng TÊN CỘT lấy từ
// backend, (2) có bảng 4 ngữ cảnh và đánh dấu bậc NV đang đứng, (3) frontend KHÔNG
// tự ghi mốc %/tỷ lệ phạt vào JSX.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { employeePenaltyViewModel } from '../src/employeeCostModel.js';

const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
const modal = /function PenaltyDetailModal[\s\S]*?\n}\n/.exec(page)?.[0] || '';

test('hộp giải thích phạt luôn gọi tên cột C45 theo nhãn backend', () => {
  assert.match(page, /const c45Label = penalty\.c45Label \|\| 'C45 \(Lương tăng thêm\)'/);
  assert.match(modal, /Chi tiết cách tính phạt · \{c45Label\}/);
  assert.match(modal, /Phạt theo target, trừ tại \{c45Label\}/);
  assert.match(modal, /\{c45Label\} gốc/);
  assert.match(modal, /Phạt trừ ở đâu\?/);
  assert.match(modal, /cột lương tăng thêm hằng tháng của bạn/);
  // Không còn nhãn trần "C45 gốc" khiến NV không biết đó là cột gì.
  assert.doesNotMatch(modal, /<span>C45 gốc/);
});

test('hộp giải thích có bảng 4 ngữ cảnh và mốc % do backend sinh', () => {
  assert.match(modal, /Khi nào bị phạt\? \(4 ngữ cảnh\)/);
  assert.match(modal, /penalty\.tiers\.map\(\(tier\) =>/);
  assert.match(modal, /BẠN ĐANG Ở ĐÂY/);
  assert.match(modal, /\{tier\.range\}/);
  assert.match(modal, /\{tier\.effect\}/);
  assert.match(modal, /\{tier\.example\}/);
  // Mốc %/tỷ lệ phạt tuyệt đối không được ghi thẳng vào JSX (chống lệch với config).
  assert.doesNotMatch(modal, /0,2%|0,3%|90%|70%|50%/);
});

test('view model nhận nhãn C45 + bảng bậc, và giữ đúng các trường tổng hợp của backend', () => {
  const single = employeePenaltyViewModel({
    mode: 'warn_only', tier: 't70_90', total: 1_000_000, appliedAmount: 0,
    c45Label: 'C45 (Lương tăng thêm)', modeText: 'Kỳ này CHỈ CẢNH BÁO',
    tiers: [{ tier: 't70_90', range: 'Từ 70% đến dưới 90%', effect: 'Trừ 0,2%…', example: 'Với số của bạn: …', ratePct: 0.2, active: true }],
  });
  assert.equal(single.c45Label, 'C45 (Lương tăng thêm)');
  assert.equal(single.modeText, 'Kỳ này CHỈ CẢNH BÁO');
  assert.equal(single.tiers.length, 1);
  assert.equal(single.tiers[0].active, true);
  assert.equal(single.tiers[0].range, 'Từ 70% đến dưới 90%');

  // Bản tổng hợp toàn đội do backend cộng (employeePenaltyAggregate): view model chỉ
  // đọc lại, KHÔNG tự cộng. Thiếu số thì giữ null, không biến thành 0đ.
  const team = employeePenaltyViewModel({
    mode: 'warn_only', total: null, provisionalTotal: 4_000_000, appliedAmount: 0,
    baseTotal: 500_000_000, afterPenaltyTotal: 500_000_000,
    employeeCount: 12, contributors: 11, unavailableCount: 1, unavailableEmployees: ['dn018'], complete: false,
    c45Label: 'C45 (Lương tăng thêm)',
  });
  assert.equal(team.total, null, 'chưa đủ số thì giữ null, không hiện 0đ');
  assert.equal(team.baseTotal, 500_000_000);
  assert.equal(team.employeeCount, 12);
  assert.equal(team.contributors, 11);
  assert.equal(team.unavailableCount, 1);
  assert.equal(team.complete, false);
  assert.equal(team.c45Label, 'C45 (Lương tăng thêm)');
});
