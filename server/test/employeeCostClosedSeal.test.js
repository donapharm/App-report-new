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
  assert.match(src, /closedSeal\.isSealable\(built, roster, sealEvidenceReports\)/,
    'điều kiện đóng dấu PHẢI chặt: đủ cả đội và mọi NV ok đúng nghĩa');
  assert.match(src, /await closedSeal\.write\(khoaDung, built, \{ complete: true \}\)/,
    'ghi dấu bằng khoá của ĐỜI VỪA DỰNG, không phải đời lúc vào request');
  // Tra dấu phải nằm TRƯỚC khối catalog nặng, nếu không thì có dấu vẫn mất 29,8 giây.
  assert.ok(src.indexOf('const sealedEarly = closedSeal.read(sealKey)') < src.indexOf('const sharedCatalogRowsByPeriod'),
    'tra dấu phải đặt TRƯỚC khi dựng catalog');
  assert.match(src, /closedSeal\.rateStoreFingerprint\(\)/, 'vân tay phải gồm bốn kho tiền');
  assert.match(src, /employeeBonus\.FORMULA_VERSION/, 'và số hiệu công thức');
  assert.match(src, /APP_BUILD_VERSION/, 'và phiên bản app');
  assert.match(src, /memoGet\(employeeCostAllCacheKey\(req, 'base', vanTayLucVao\), EMPLOYEE_COST_ALL_BASE_TTL_MS, buildMergedSealed,/,
    'đường bảng UI phải đi qua bản có đóng dấu, dùng đúng con dấu của request');
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

test('★ HÌNH DẠNG THẬT: đủ đội + mọi NV ok ⇒ mới được đóng dấu', () => {
  const { seal } = freshSeal();
  const reports = [baoCao('DN001'), baoCao('DN002')];
  assert.equal(seal.isSealable(gopThat(reports), ROSTER_2, reports), true);
});

/* ‼ CA QUAN TRỌNG NHẤT — bot audit bắt đúng:
 * `mergeEmployeeReports(reports, roster)` dựng `merged.employees` **TỪ CHÍNH ROSTER**,
 * nên đối chiếu `merged.employees` với roster là **vòng tròn tự chứng minh**: thiếu hẳn
 * báo cáo của DN002 mà vẫn "đủ đội". Bản test cũ của tôi còn **SỬA TAY** trường đó để
 * ép nó đỏ — tức là test che lỗi thay vì phát hiện lỗi.
 * Nay bằng chứng lấy từ `reports` (báo cáo GỐC từng NV) nên không che được nữa. */
test('★ THIẾU HẲN báo cáo một NV ⇒ KHÔNG đóng dấu (cấm suy từ merged.employees)', () => {
  const { seal } = freshSeal();
  const chiMotNguoi = [baoCao('DN001')];
  const merged = gopThat(chiMotNguoi);
  assert.equal(merged.employees.length, 2,
    'bản gộp VẪN liệt kê đủ 2 người dù chỉ có 1 báo cáo — đúng cái bẫy bot chỉ ra');
  assert.equal(seal.isSealable(merged, ROSTER_2, chiMotNguoi), false,
    'chỉ có báo cáo của 1 người ⇒ TUYỆT ĐỐI không đóng dấu');
});

test('★ trễ hạn / lỗi nguồn / tỷ lệ cũ / trùng NV ⇒ KHÔNG đóng dấu', () => {
  const { seal } = freshSeal();
  const ca = (outcome) => {
    const r = [baoCao('DN001'), baoCao('DN002', { outcome })];
    return seal.isSealable(gopThat(r), ROSTER_2, r);
  };
  assert.equal(ca('deadline'), false, 'NV trễ hạn');
  assert.equal(ca('upstream_unavailable'), false, 'NV lỗi nguồn');
  assert.equal(ca('ok_stale_rates'), false, 'NV xài tỷ lệ CŨ');
  assert.equal(ca('before_go_live'), false, 'kỳ chưa lên app');

  const trung = [baoCao('DN001'), baoCao('DN001')];
  assert.equal(seal.isSealable(gopThat(trung), ROSTER_2, trung), false, 'trùng NV ⇒ không rõ lấy bản nào');

  const du = [baoCao('DN001'), baoCao('DN002')];
  assert.equal(seal.isSealable(gopThat(du), ROSTER_2, null), false, 'không có báo cáo gốc ⇒ fail closed');
  assert.equal(seal.isSealable(gopThat(du), [], du), false, 'không biết đội gồm ai ⇒ không dám đóng');
});

test('★ thiếu khối match hoặc thiếu periods ⇒ fail closed', () => {
  const { seal } = freshSeal();
  const reports = [baoCao('DN001'), baoCao('DN002')];
  const du = gopThat(reports);
  const khongMatch = { ...du, periods: du.periods.map((p) => ({ ...p, match: undefined })) };
  assert.equal(seal.isSealable(khongMatch, ROSTER_2, reports), false, 'không có match ⇒ không biết đủ hay thiếu ⇒ không đóng');
  assert.equal(seal.isSealable({ ...du, periods: [] }, ROSTER_2, reports), false, 'không có kỳ nào ⇒ không đóng');
  assert.equal(seal.isSealable({ ...du, rateStale: true }, ROSTER_2, reports), false, 'cờ rateStale ⇒ không đóng');
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

/* ── BA CA AUDIT ĐỢT 5 CỦA BOT ───────────────────────────────────────────── */

// (1) Thiếu `sourceOutcome` từng bị coi là `ok` — fail-OPEN, sai chiều.
test('⑦ báo cáo THIẾU sourceOutcome ⇒ KHÔNG được coi là ok', () => {
  const { seal } = freshSeal();
  const thieuTruong = baoCao('DN002');
  delete thieuTruong.sourceOutcome;
  const r = [baoCao('DN001'), thieuTruong];
  assert.equal(seal.isSealable(gopThat(r), ROSTER_2, r), false,
    'thiếu trường thì không có bằng chứng nào là ok ⇒ fail closed');

  const rong = baoCao('DN002'); rong.sourceOutcome = '';
  const r2 = [baoCao('DN001'), rong];
  assert.equal(seal.isSealable(gopThat(r2), ROSTER_2, r2), false, 'rỗng cũng không phải ok');
});

// (2) Kho lương/thanh toán đổi mà khoá dấu không đổi ⇒ phục vụ lại số cũ.
test('⑧ vân tay phủ ĐỦ BỐN kho, và nhận diện theo NỘI DUNG chứ không theo giờ sửa', () => {
  const { seal, dir } = freshSeal();
  assert.deepEqual([...seal.RATE_STORE_FILES],
    ['cost_rates_local', 'employee_cost_rate_snapshot', 'salary_advance_snapshot', 'payment_ledger']);

  const van = () => seal.rateStoreFingerprint({ DIR: dir });
  for (const f of seal.RATE_STORE_FILES) fs.writeFileSync(path.join(dir, `${f}.json`), JSON.stringify({ v: 111 }));
  const goc = van();

  /* (a) ĐỔI NỘI DUNG ⇒ vân tay PHẢI đổi. Đây là ca 111→222 bot tái hiện: bỏ hai file
   *     snapshot ra khỏi vân tay thì RAM memo, dấu đã ghi và snapshot đều phục vụ 111
   *     trong khi nguồn đã là 222. */
  for (const f of seal.RATE_STORE_FILES) {
    fs.writeFileSync(path.join(dir, `${f}.json`), JSON.stringify({ v: 222 }));
    assert.notEqual(van(), goc, `đổi NỘI DUNG ${f}.json ⇒ vân tay phải đổi`);
    fs.writeFileSync(path.join(dir, `${f}.json`), JSON.stringify({ v: 111 }));
    assert.equal(van(), goc, `trả lại nội dung cũ ⇒ vân tay phải quay về như cũ`);
  }

  /* (b) GHI LẠI Y NGUYÊN nội dung ⇒ vân tay KHÔNG được đổi. Đây là bẫy tôi từng sập:
   *     hai file snapshot do chính lượt dựng ghi ra; nếu nhận diện theo `mtime` thì mỗi
   *     lượt dựng tự huỷ khoá của mình ⇒ bộ nhớ đệm không bao giờ trúng ⇒ quay lại đúng
   *     bệnh "mở màn nào cũng dựng lại từ đầu". Ca warm-cache bắt được. */
  const truoc = van();
  for (const f of seal.RATE_STORE_FILES) {
    const p2 = path.join(dir, `${f}.json`);
    const noiDung = fs.readFileSync(p2, 'utf8');
    const sau = Date.now() / 1000 + 30;
    fs.writeFileSync(p2, noiDung);        // ghi lại y nguyên
    fs.utimesSync(p2, sau, sau);          // và ép giờ sửa nhảy hẳn
  }
  assert.equal(van(), truoc,
    'ghi lại CÙNG nội dung (dù giờ sửa nhảy) ⇒ vân tay PHẢI đứng yên, nếu không thì cache tự huỷ mỗi lượt');
});

// (3) Nguồn đổi GIỮA lúc fan-out ⇒ bản gộp trộn đời ⇒ cấm đóng dấu.
test('⑨ routes phải kiểm lại đời dữ liệu NGAY TRƯỚC khi đóng dấu', () => {
  const src = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.match(src, /const vanTayNguon = \(\) => \[/, 'phải có hàm chụp vân tay nguồn');
  assert.ok(
    src.indexOf('const sau = vanTayNguon();') < src.indexOf('closedSeal.isSealable(built, roster, sealEvidenceReports)'),
    'phải kiểm đời TRƯỚC khi xét điều kiện đóng dấu',
  );
  // Vân tay phải gồm ĐỦ bốn thành phần, không chỉ doanh thu.
  const ham = src.slice(src.indexOf('const vanTayNguon = () => ['), src.indexOf('const SO_LAN_DUNG_TOI_DA'));
  for (const phan of [
    'store.employeeCostDataSignature()',
    'closedSeal.rateStoreFingerprint()',
    'employeeBonus.FORMULA_VERSION',
    'APP_BUILD_VERSION',
  ]) {
    assert.ok(ham.includes(phan), `vân tay nguồn phải gồm ${phan}`);
  }
});

/* ── HAI CA AUDIT ĐỢT 6: ĐƯỜNG HIỂN THỊ SỐ SAI ───────────────────────────── */

// (1) Bộ nhớ đệm base giữ tới 6 GIỜ mà khoá không phủ bốn kho tiền ⇒ phục vụ số cũ.
test('⑩ khoá bộ nhớ đệm ALL phải phủ vân tay BỐN KHO TIỀN', () => {
  const src = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  const batDau = src.indexOf('function employeeCostAllCacheKey');
  const ham = src.slice(batDau, src.indexOf('\n}', batDau));
  assert.match(ham, /kho=\$\{String\(vanTay \?\? ''\)\}/,
    'khoá phải gắn vân tay kho, và vân tay đó là do NGƯỜI GỌI truyền vào');
  assert.doesNotMatch(ham, /closedSeal\.rateStoreFingerprint\(\)/,
    'hàm khoá TUYỆT ĐỐI không tự đi lấy vân tay lần nữa — đó là chỗ sinh ra lệch đời A/B');
});

// (2) Lệch đời thì TRƯỚC ĐÂY vẫn `return built` ⇒ bản trộn đời lên màn + vào cache
//     + xuất Excel. Và kỳ ĐANG MỞ có sealKey=null nên nhánh kiểm bị bỏ qua hẳn.
test('⑪ lệch đời ⇒ DỰNG LẠI, không trả bản trộn; cạn lượt ⇒ báo lỗi, không cache', () => {
  const src = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  const khoi = src.slice(src.indexOf('const vanTayNguon = () =>'), src.indexOf('// Export giữ nguyên đường audit'));

  assert.match(khoi, /const truoc = mocDoi\(\);[\s\S]*?const built = await buildMerged\(\);[\s\S]*?const sau = mocDoi\(\);/,
    'phải chụp MỐC ĐỜI (vân tay + đồng hồ chỉ tiến) TRƯỚC và SAU khi dựng — vân tay đơn thuần mù với A→B→A');
  assert.match(khoi, /persist\.observedGeneration\(\)/,
    'mốc đời phải gồm đồng hồ chỉ tiến, nếu không thì A→B→A lọt');
  assert.match(khoi, /if \(truoc !== sau\) \{[\s\S]{0,220}?continue;/,
    'lệch đời ⇒ dựng lại, TUYỆT ĐỐI không return bản trộn');
  assert.doesNotMatch(khoi, /sealKeySauKhiDung/,
    'cấm quay lại lối cũ: chặn đóng dấu mà vẫn trả bản trộn');
  assert.match(khoi, /EMPLOYEE_COST_SOURCE_DRIFT/,
    'cạn lượt ⇒ ném lỗi rõ ràng để memo vứt entry, không cache bản trộn');

  /* Kiểm đời KHÔNG được phụ thuộc `sealKey` — kỳ ĐANG MỞ (sealKey = null) cũng phải
   * được bảo vệ, mà đó mới là kỳ CEO xem hằng ngày. Soi đúng đoạn từ lúc chụp vân tay
   * đầu tới lúc quyết định, không lẫn phần tra dấu phía trên. */
  const batDauVong = khoi.indexOf('for (let lan = 1');
  const doanKiemDoi = khoi.slice(batDauVong, khoi.indexOf('const khoaDung =', batDauVong))
    // Bỏ chú thích rồi mới soi: lần trước bài kiểm bắt nhầm chữ `sealKey` nằm trong
    // một dòng giải thích, chứ code thì đúng. Test phải soi CODE, không soi văn xuôi.
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(doanKiemDoi.includes('if (truoc !== sau)'), 'phải tìm được đoạn kiểm đời');
  assert.doesNotMatch(doanKiemDoi, /sealKey/,
    'nhánh kiểm đời phải chạy cho MỌI kỳ, kể cả kỳ đang mở (sealKey = null)');
});

/* ── BA CA AUDIT ĐỢT 7: MỘT REQUEST CHỈ ĐƯỢC CHỤP VÂN TAY MỘT LẦN ────────── */

test('⑫ cả request dùng CHUNG một con dấu đời — không ai tự lấy lại', () => {
  const src = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  const than = src.slice(src.indexOf('const vanTayLucVao = vanTayNguon();'), src.indexOf('function monthInputForKy'));

  // base và view PHẢI dùng đúng một giá trị đã chụp, không gọi lại hàm chụp.
  assert.match(than, /employeeCostAllCacheKey\(req, 'base', vanTayLucVao\)/);
  assert.match(than, /employeeCostAllCacheKey\(req, 'view', vanTayLucVao\)/);
  assert.doesNotMatch(than, /employeeCostAllCacheKey\(req, '(base|view)'\)/,
    'cấm gọi khoá mà không truyền con dấu — đó là chỗ đời A lọt vào khoá đời B');
  /* HAI con dấu là CÓ CHỦ ĐÍCH: `vanTaySom` (trước catalog) chỉ cho đường tắt tra dấu
   * — trượt thì chỉ chậm; `vanTayLucVao` (sau khi catalog ổn định) cho mọi khoá cache,
   * cổng kiểm và khoá đóng dấu. Nhập hai cái làm một là chặn nhầm cả đường warm. */
  const src2 = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  assert.ok(src2.indexOf('const vanTaySom = vanTayNguon();') < src2.indexOf('const sharedCatalogRowsByPeriod'),
    'con dấu SỚM phải chụp trước khối catalog');
  assert.ok(src2.indexOf('const vanTayLucVao = vanTayNguon();') > src2.indexOf('const sharedCatalogRowsByPeriod'),
    'con dấu ỔN ĐỊNH phải chụp SAU khi catalog đã ổn định');
});

// Lượt 1 trượt A→B, lượt 2 dựng đúng B — mà ghi bằng khoá A thì khi nguồn quay lại A,
// app đọc dấu A và phục vụ số của đời B. Sai vĩnh viễn.
test('⑬ đóng dấu phải dùng khoá của CHÍNH đời vừa dựng, không phải đời lúc vào', () => {
  const src = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  const vong = src.slice(src.indexOf('for (let lan = 1; lan <= SO_LAN_DUNG_TOI_DA'), src.indexOf('EMPLOYEE_COST_SOURCE_DRIFT'));
  assert.match(vong, /const khoaDung = khoaDauTheoVanTay\(truoc\);/,
    'khoá đóng dấu sinh từ `truoc` — con dấu vừa được xác nhận đầu–cuối');
  assert.match(vong, /closedSeal\.write\(khoaDung, built, \{ complete: true \}\)/);
  assert.doesNotMatch(vong, /closedSeal\.write\(sealKey,/,
    'cấm ghi bằng sealKey chụp lúc vào request — đó là khoá của đời cũ');
});

test('⑭ self-heal phải qua ĐÚNG cổng kiểm bốn kho như đường thường', () => {
  const src = fs.readFileSync(require.resolve('../src/routes'), 'utf8');
  const khoi = src.slice(src.indexOf('if (paginate && prepareMemoReplace)'), src.indexOf('const buildMergedSealed'));
  assert.match(khoi, /const vanTayTruocSelfHeal = vanTayLucVao;/,
    'mốc so sánh phải là con dấu ĐÃ ỔN ĐỊNH sau catalog, không phải con dấu sớm');
  assert.match(khoi, /const vanTaySauSelfHeal = vanTayNguon\(\);/, 'chụp lại sau khi dựng');
  assert.match(khoi, /vanTayTruocSelfHeal !== vanTaySauSelfHeal[\s\S]{0,220}?throw/,
    'lệch đời ⇒ ném lỗi, KHÔNG publish bản trộn');
  assert.match(khoi, /vanTayNguon\(\) !== vanTayTruocSelfHeal[\s\S]{0,240}?throw/,
    'và kiểm lại lần cuối ngay trước khi publish');
  assert.match(khoi, /employeeCostAllCacheKey\(req, 'base', vanTayTruocSelfHeal\)/,
    'cache dưới đúng con dấu đã kiểm');
});
