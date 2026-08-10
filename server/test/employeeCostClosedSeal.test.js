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
const NGUON = { data: 'slot-run301', rates: 'kho:1:2:3', formula: 'v3.8', app: '2.0.0' };
const ROSTER = [{ emp_code: 'DN001' }, { emp_code: 'DN002' }];
const okEmp = (code) => ({ empCode: code, sourceOutcome: 'ok' });
const banDu = {
  periods: [{ period: '2026-07', match: { unavailableEmployeeCount: 0 }, employees: [okEmp('DN001'), okEmp('DN002')] }],
  tong: 30982248913,
};
const banThieu = {
  periods: [{ period: '2026-07', match: { unavailableEmployeeCount: 16, unavailableEmployees: ['DN005'] }, employees: [okEmp('DN001')] }],
  tong: 7103965427,
};

test('kỳ đã khoá sổ + bản ĐỦ ⇒ đóng dấu, và phục vụ NGUYÊN BẢN mãi về sau', async () => {
  const { seal } = freshSeal();
  const key = seal.keyFor({ ...T07, closed: true, sources: NGUON });
  assert.ok(key, 'kỳ đã khoá sổ thì phải có khoá dấu');
  assert.equal(seal.read(key), null, 'chưa đóng thì chưa có gì');

  assert.equal(await seal.write(key, banDu, { complete: true }), true);
  assert.deepEqual(seal.read(key), banDu);
  // Đọc mười lần vẫn đúng một con số — đây chính là thứ CEO đòi.
  for (let i = 0; i < 10; i += 1) assert.deepEqual(seal.read(key), banDu);
  assert.ok(seal.sealedAt(key), 'phải ghi lại mốc đóng dấu');
});

// ① Điều nguy hiểm nhất: đóng dấu nhầm bản thiếu = biến lỗi tạm thành số sai vĩnh viễn.
test('① TUYỆT ĐỐI không đóng dấu bản THIẾU người', async () => {
  const { seal } = freshSeal();
  const key = seal.keyFor({ ...T07, closed: true, sources: NGUON });
  assert.equal(await seal.write(key, banThieu, { complete: false }), false);
  assert.equal(seal.read(key), null, 'bản thiếu không được để lại dấu vết nào');
  // Kể cả khi người gọi quên truyền cờ.
  assert.equal(await seal.write(key, banThieu, {}), false);
  assert.equal(seal.read(key), null);
});

// ② Nguồn thay bản thì con số cũ không còn đúng nữa.
test('② nguồn đổi ⇒ chữ ký đổi ⇒ dấu cũ hết hiệu lực', async () => {
  const { seal } = freshSeal();
  const cu = seal.keyFor({ ...T07, closed: true, sources: { ...NGUON, data: 'slot-cu' } });
  await seal.write(cu, banDu, { complete: true });
  const moi = seal.keyFor({ ...T07, closed: true, sources: { ...NGUON, data: 'slot-moi' } });
  assert.notEqual(moi, cu);
  assert.equal(seal.read(moi), null, 'nguồn mới phải dựng lại, không xài dấu của nguồn cũ');
  assert.deepEqual(seal.read(cu), banDu, 'dấu của nguồn cũ vẫn còn cho đúng nguồn đó');
});

// ③ Kỳ đang chạy thì doanh thu còn về, đóng băng là sai.
test('③ kỳ CHƯA khoá sổ ⇒ không có khoá dấu, không đóng băng gì', async () => {
  const { seal } = freshSeal();
  assert.equal(seal.keyFor({ from: '2026-08', to: '2026-08', months: ['2026-08'], closed: false, sources: NGUON }), null);
  assert.equal(await seal.write(null, banDu, { complete: true }), false, 'không khoá thì không ghi');
});

test('thiếu chữ ký nguồn ⇒ không đóng dấu (không biết dấu thuộc bản dữ liệu nào)', async () => {
  const { seal } = freshSeal();
  assert.equal(seal.keyFor({ ...T07, closed: true, sources: { ...NGUON, rates: '' } }), null);
  assert.equal(seal.keyFor({ ...T07, closed: true, sources: null }), null);
});

test('khoảng nhiều tháng: chỉ đóng dấu khi TẤT CẢ tháng đều đã khoá sổ', async () => {
  const { seal } = freshSeal();
  const ca = { from: '2026-06', to: '2026-07', months: ['2026-06', '2026-07'], sources: NGUON };
  assert.ok(seal.keyFor({ ...ca, closed: true }), 'cả hai đã khoá ⇒ đóng được');
  assert.equal(seal.keyFor({ ...ca, closed: false }), null, 'còn một tháng chưa khoá ⇒ không đóng');
  // Khoảng khác nhau phải ra khoá khác nhau, không lẫn số của nhau.
  assert.notEqual(
    seal.keyFor({ ...ca, closed: true }),
    seal.keyFor({ ...T07, closed: true, sources: NGUON }),
  );
});

test('giữ tối đa vài kỳ, bỏ dấu cũ nhất — không phình mãi', async () => {
  const { seal } = freshSeal();
  for (let i = 0; i < seal.MAX_SEALS + 3; i += 1) {
    const key = seal.keyFor({ from: `2026-${String(i + 1).padStart(2, '0')}`, to: `2026-${String(i + 1).padStart(2, '0')}`, months: [`2026-${String(i + 1).padStart(2, '0')}`], closed: true, sources: NGUON });
    await seal.write(key, { thu: i }, { complete: true });
  }
  const dau = seal.keyFor({ from: '2026-01', to: '2026-01', months: ['2026-01'], closed: true, sources: NGUON });
  assert.equal(seal.read(dau), null, 'dấu cũ nhất đã bị bỏ');
  const cuoi = seal.keyFor({ from: `2026-${String(seal.MAX_SEALS + 3).padStart(2, '0')}`, to: `2026-${String(seal.MAX_SEALS + 3).padStart(2, '0')}`, months: [`2026-${String(seal.MAX_SEALS + 3).padStart(2, '0')}`], closed: true, sources: NGUON });
  assert.deepEqual(seal.read(cuoi), { thu: seal.MAX_SEALS + 2 }, 'dấu mới nhất còn nguyên');
});

test('routes.js phải nối đúng: chỉ đóng dấu bản KHÔNG degraded', () => {
  const src = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(src, /closedSeal\.keyFor\(/);
  assert.match(src, /closedSeal\.isSealable\(built, roster\)/,
    'điều kiện đóng dấu PHẢI chặt: đủ cả đội và mọi NV ok đúng nghĩa');
  assert.match(src, /await closedSeal\.write\(sealKey, built, \{ complete: true \}\)/);
  // Tra dấu phải nằm TRƯỚC khối catalog nặng, nếu không thì có dấu vẫn mất 29,8 giây.
  assert.ok(src.indexOf('const sealedEarly = closedSeal.read(sealKey)') < src.indexOf('const sharedCatalogRowsByPeriod'),
    'tra dấu phải đặt TRƯỚC khi dựng catalog');
  assert.match(src, /rates: closedSeal\.rateStoreFingerprint\(\)/, 'chữ ký phải gồm kho tỷ lệ');
  assert.match(src, /formula: employeeBonus\.FORMULA_VERSION/, 'và số hiệu công thức');
  assert.match(src, /app: APP_BUILD_VERSION/, 'và phiên bản app');
  assert.match(src, /memoGet\(employeeCostAllCacheKey\(req, 'base'\), EMPLOYEE_COST_ALL_BASE_TTL_MS, buildMergedSealed,/,
    'đường bảng UI phải đi qua bản có đóng dấu');
});

/* ── DỰNG DỮ LIỆU BẰNG CHÍNH HÀM GỘP THẬT ────────────────────────────────────
 * Bản test đầu tôi TỰ BỊA hình dạng (`period.employees`, `staleRateEmployees`) nên
 * nó xanh trong khi production sai: guard đọc trường không tồn tại ⇒ vòng lặp không
 * chạy ⇒ LUÔN trả true ⇒ sẵn sàng đóng dấu vĩnh viễn một con số thiếu người.
 * Bot audit bắt đúng. Nay mọi dữ liệu thử đi qua `mergeEmployeeReports` THẬT, nên
 * hình dạng có đổi là test đỏ ngay. */
const employeeCostTable = require('../src/employeeCostTable');

const ROSTER_2 = [{ emp_code: 'DN001', name: 'A' }, { emp_code: 'DN002', name: 'B' }];

function baoCao(empCode, { outcome = 'ok', rows = 1 } = {}) {
  return {
    empCode, employeeName: empCode, from: '2026-07', to: '2026-07',
    sourceOutcome: outcome,
    periods: [{
      period: '2026-07',
      columns: [{ key: 'c41', label: 'CP đặt hàng', kind: 'percent' }],
      rows: Array.from({ length: rows }, (_, i) => ({ c16: `SP${i}`, unitCode: 'DV1', c41: 0.01 })),
      summary: {}, match: {}, daily: { dates: [], totals: [] },
    }],
  };
}

const gopThat = (reports, roster = ROSTER_2) => employeeCostTable.mergeEmployeeReports(reports, roster);

test('★ HÌNH DẠNG THẬT: bản gộp ĐỦ ĐỘI + mọi NV ok ⇒ mới được đóng dấu', () => {
  const { seal } = freshSeal();
  const du = gopThat([baoCao('DN001'), baoCao('DN002')]);
  assert.equal(seal.isSealable(du, ROSTER_2), true, 'đủ đội, mọi NV ok ⇒ đóng dấu được');
});

test('★ HÌNH DẠNG THẬT: thiếu NV / trễ hạn / tỷ lệ cũ ⇒ TUYỆT ĐỐI không đóng dấu', () => {
  const { seal } = freshSeal();

  // Đây chính là ca mà guard cũ trả nhầm `true`.
  const treHan = gopThat([baoCao('DN001'), baoCao('DN002', { outcome: 'deadline' })]);
  assert.equal(seal.isSealable(treHan, ROSTER_2), false, 'có NV trễ hạn ⇒ KHÔNG đóng dấu');

  const nguonLoi = gopThat([baoCao('DN001'), baoCao('DN002', { outcome: 'upstream_unavailable' })]);
  assert.equal(seal.isSealable(nguonLoi, ROSTER_2), false, 'có NV lỗi nguồn ⇒ KHÔNG đóng dấu');

  const tyLeCu = gopThat([baoCao('DN001'), baoCao('DN002', { outcome: 'ok_stale_rates' })]);
  assert.equal(seal.isSealable(tyLeCu, ROSTER_2), false, 'có NV xài tỷ lệ CŨ ⇒ KHÔNG đóng dấu');

  // Thiếu hẳn báo cáo của một người.
  const thieuNguoi = employeeCostTable.mergeEmployeeReports([baoCao('DN001')], ROSTER_2);
  const chiCoMotNguoi = { ...thieuNguoi, employees: [{ empCode: 'DN001' }] };
  assert.equal(seal.isSealable(chiCoMotNguoi, ROSTER_2), false, 'danh sách NV không phủ hết đội ⇒ KHÔNG đóng dấu');

  assert.equal(seal.isSealable(gopThat([baoCao('DN001'), baoCao('DN002')]), []), false,
    'không biết đội gồm ai ⇒ không dám đóng');
});

test('★ thiếu khối match hoặc thiếu periods ⇒ fail closed', () => {
  const { seal } = freshSeal();
  const du = gopThat([baoCao('DN001'), baoCao('DN002')]);
  const khongMatch = { ...du, periods: du.periods.map((p) => ({ ...p, match: undefined })) };
  assert.equal(seal.isSealable(khongMatch, ROSTER_2), false, 'không có match ⇒ không biết đủ hay thiếu ⇒ không đóng');
  assert.equal(seal.isSealable({ ...du, periods: [] }, ROSTER_2), false, 'không có kỳ nào ⇒ không đóng');
  assert.equal(seal.isSealable({ ...du, rateStale: true }, ROSTER_2), false, 'cờ rateStale ⇒ không đóng');
});

// ⑤ Ghi đồng thời: đọc-sửa-ghi chồng nhau thì lượt sau ghi đè mất dấu lượt trước.
test('⑤ ghi ĐỒNG THỜI nhiều kỳ không được làm mất dấu nào', async () => {
  const { seal } = freshSeal();
  const keys = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'].map((m) => seal.keyFor({
    from: m, to: m, months: [m], closed: true, sources: NGUON,
  }));
  // Bắn cùng lúc, không chờ từng cái.
  await Promise.all(keys.map((key, i) => seal.write(key, { thu: i }, { complete: true })));
  keys.forEach((key, i) => {
    assert.deepEqual(seal.read(key), { thu: i }, `dấu thứ ${i} phải còn nguyên`);
  });
});

// ⑥ File tài chính: quyền chặt + phát hiện bị sửa tay.
test('⑥ file dấu phải quyền 0600, thư mục 0700, và LỆCH CHECKSUM thì bỏ dấu', async () => {
  const { seal, dir } = freshSeal();
  const key = seal.keyFor({ ...T07, closed: true, sources: NGUON });
  await seal.write(key, banDu, { complete: true });

  const f = path.join(dir, `${seal.FILE}.json`);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600, 'chỉ chủ tiến trình được đọc/ghi');
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700, 'thư mục cũng phải khoá');

  // Ai đó sửa tay con số trong file dấu.
  const rows = JSON.parse(fs.readFileSync(f, 'utf8'));
  rows[key].payload.tong = 99999999999;
  fs.writeFileSync(f, JSON.stringify(rows));
  delete require.cache[require.resolve('../src/persist')];

  assert.equal(seal.read(key), null, 'lệch checksum ⇒ coi như KHÔNG có dấu, dựng lại');
});
