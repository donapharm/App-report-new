'use strict';
/**
 * ĐÓNG DẤU CHI PHÍ KỲ ĐÃ KHOÁ SỔ — giải pháp dứt điểm vụ "T07 nhảy loạn xạ"
 * (CEO đòi 10/08/2026, ngày thứ ba).
 *
 * Bệnh: tổng của màn ALL = cộng sổ từng NV; ai không kịp trong hạn thì dòng của họ
 * không lên bảng ⇒ tổng đổi theo số người kịp về (5 người → 499 dòng; 9 người →
 * 1.191 dòng; 0 người → 0 dòng). Vá tốc độ làm hiếm đi chứ không dứt.
 *
 * Chữa: kỳ đã khoá sổ, dựng được bản ĐỦ CẢ ĐỘI thì đóng dấu; từ đó phục vụ nguyên bản.
 *
 * Ba điều tuyệt đối không được sai, mỗi điều một ca dưới đây:
 *   ① không bao giờ đóng dấu bản THIẾU người
 *   ② nguồn đổi ⇒ dấu hết hiệu lực
 *   ③ kỳ CHƯA khoá sổ ⇒ không đóng dấu
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshSeal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closed-seal-'));
  const saved = process.env.AUTH_DATA_DIR;
  process.env.AUTH_DATA_DIR = dir;
  for (const mod of ['../src/persist', '../src/employeeCostClosedSeal']) {
    delete require.cache[require.resolve(mod)];
  }
  const seal = require('../src/employeeCostClosedSeal');
  if (saved === undefined) delete process.env.AUTH_DATA_DIR;
  else process.env.AUTH_DATA_DIR = saved;
  return { seal, dir };
}

const T07 = { from: '2026-07', to: '2026-07', months: ['2026-07'] };
const SIG = 'slot-run301-abc';
const banDu = { periods: [{ period: '2026-07', match: { unavailableEmployeeCount: 0 } }], tong: 30982248913 };
const banThieu = {
  periods: [{ period: '2026-07', match: { unavailableEmployeeCount: 16, unavailableEmployees: ['DN005'] } }],
  tong: 7103965427,
};

test('kỳ đã khoá sổ + bản ĐỦ ⇒ đóng dấu, và phục vụ NGUYÊN BẢN mãi về sau', () => {
  const { seal } = freshSeal();
  const key = seal.keyFor({ ...T07, closed: true, dataSignature: SIG });
  assert.ok(key, 'kỳ đã khoá sổ thì phải có khoá dấu');
  assert.equal(seal.read(key), null, 'chưa đóng thì chưa có gì');

  assert.equal(seal.write(key, banDu, { complete: true }), true);
  assert.deepEqual(seal.read(key), banDu);
  // Đọc mười lần vẫn đúng một con số — đây chính là thứ CEO đòi.
  for (let i = 0; i < 10; i += 1) assert.deepEqual(seal.read(key), banDu);
  assert.ok(seal.sealedAt(key), 'phải ghi lại mốc đóng dấu');
});

// ① Điều nguy hiểm nhất: đóng dấu nhầm bản thiếu = biến lỗi tạm thành số sai vĩnh viễn.
test('① TUYỆT ĐỐI không đóng dấu bản THIẾU người', () => {
  const { seal } = freshSeal();
  const key = seal.keyFor({ ...T07, closed: true, dataSignature: SIG });
  assert.equal(seal.write(key, banThieu, { complete: false }), false);
  assert.equal(seal.read(key), null, 'bản thiếu không được để lại dấu vết nào');
  // Kể cả khi người gọi quên truyền cờ.
  assert.equal(seal.write(key, banThieu, {}), false);
  assert.equal(seal.read(key), null);
});

// ② Nguồn thay bản thì con số cũ không còn đúng nữa.
test('② nguồn đổi ⇒ chữ ký đổi ⇒ dấu cũ hết hiệu lực', () => {
  const { seal } = freshSeal();
  const cu = seal.keyFor({ ...T07, closed: true, dataSignature: 'slot-cu' });
  seal.write(cu, banDu, { complete: true });
  const moi = seal.keyFor({ ...T07, closed: true, dataSignature: 'slot-moi' });
  assert.notEqual(moi, cu);
  assert.equal(seal.read(moi), null, 'nguồn mới phải dựng lại, không xài dấu của nguồn cũ');
  assert.deepEqual(seal.read(cu), banDu, 'dấu của nguồn cũ vẫn còn cho đúng nguồn đó');
});

// ③ Kỳ đang chạy thì doanh thu còn về, đóng băng là sai.
test('③ kỳ CHƯA khoá sổ ⇒ không có khoá dấu, không đóng băng gì', () => {
  const { seal } = freshSeal();
  assert.equal(seal.keyFor({ from: '2026-08', to: '2026-08', months: ['2026-08'], closed: false, dataSignature: SIG }), null);
  assert.equal(seal.write(null, banDu, { complete: true }), false, 'không khoá thì không ghi');
});

test('thiếu chữ ký nguồn ⇒ không đóng dấu (không biết dấu thuộc bản dữ liệu nào)', () => {
  const { seal } = freshSeal();
  assert.equal(seal.keyFor({ ...T07, closed: true, dataSignature: '' }), null);
  assert.equal(seal.keyFor({ ...T07, closed: true, dataSignature: null }), null);
});

test('khoảng nhiều tháng: chỉ đóng dấu khi TẤT CẢ tháng đều đã khoá sổ', () => {
  const { seal } = freshSeal();
  const ca = { from: '2026-06', to: '2026-07', months: ['2026-06', '2026-07'], dataSignature: SIG };
  assert.ok(seal.keyFor({ ...ca, closed: true }), 'cả hai đã khoá ⇒ đóng được');
  assert.equal(seal.keyFor({ ...ca, closed: false }), null, 'còn một tháng chưa khoá ⇒ không đóng');
  // Khoảng khác nhau phải ra khoá khác nhau, không lẫn số của nhau.
  assert.notEqual(
    seal.keyFor({ ...ca, closed: true }),
    seal.keyFor({ ...T07, closed: true, dataSignature: SIG }),
  );
});

test('giữ tối đa vài kỳ, bỏ dấu cũ nhất — không phình mãi', () => {
  const { seal } = freshSeal();
  for (let i = 0; i < seal.MAX_SEALS + 3; i += 1) {
    const key = seal.keyFor({ from: `2026-${String(i + 1).padStart(2, '0')}`, to: `2026-${String(i + 1).padStart(2, '0')}`, months: [`2026-${String(i + 1).padStart(2, '0')}`], closed: true, dataSignature: SIG });
    seal.write(key, { thu: i }, { complete: true });
  }
  const dau = seal.keyFor({ from: '2026-01', to: '2026-01', months: ['2026-01'], closed: true, dataSignature: SIG });
  assert.equal(seal.read(dau), null, 'dấu cũ nhất đã bị bỏ');
  const cuoi = seal.keyFor({ from: `2026-${String(seal.MAX_SEALS + 3).padStart(2, '0')}`, to: `2026-${String(seal.MAX_SEALS + 3).padStart(2, '0')}`, months: [`2026-${String(seal.MAX_SEALS + 3).padStart(2, '0')}`], closed: true, dataSignature: SIG });
  assert.deepEqual(seal.read(cuoi), { thu: seal.MAX_SEALS + 2 }, 'dấu mới nhất còn nguyên');
});

test('routes.js phải nối đúng: chỉ đóng dấu bản KHÔNG degraded', () => {
  const src = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(src, /closedSeal\.keyFor\(/);
  assert.match(src, /!employeeCostAllDegraded\(built\)/,
    'điều kiện đóng dấu PHẢI là bản sạch — đây là hàng rào chính');
  assert.match(src, /closedSeal\.write\(sealKey, built, \{ complete: true \}\)/);
  assert.match(src, /memoGet\(employeeCostAllCacheKey\(req, 'base'\), EMPLOYEE_COST_ALL_BASE_TTL_MS, buildMergedSealed,/,
    'đường bảng UI phải đi qua bản có đóng dấu');
});
