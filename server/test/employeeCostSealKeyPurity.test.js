'use strict';
/**
 * KHOÁ ĐÓNG DẤU PHẢI THUẦN NỘI DUNG — ca kiểm ĐỘNG, dựng thật rồi so khoá.
 *
 * Bối cảnh (bot audit đợt 12): bản trước tôi thêm "số đời dữ liệu" để bắt cảnh
 * A→B→A, và ghi rõ trong chú thích rằng số đời TUYỆT ĐỐI không được vào khoá. Hai
 * file `routes.js`/`employeeCostClosedSeal.js` khi đọc bằng mắt (và bằng ca kiểm
 * đọc-chữ của tôi) đều sạch. Nhưng ngay tại CHỖ GỌI thì khoá lại sinh ra từ chuỗi
 * ĐÃ GỘP số đời:
 *
 *     const truoc = mocDoi();               // = vân tay nội dung + số đời
 *     const khoaDung = khoaDauTheoVanTay(truoc);   // ⇒ khoá bẩn
 *
 * Hậu quả bot đo được: dấu ghi bằng khoá có số đời, còn đường TRA dấu ở đầu request
 * dùng khoá thuần nội dung ⇒ hai khoá không bao giờ gặp nhau. Dấu đóng xong là mồ
 * côi; mỗi lần mở màn lại dựng lại từ đầu và lại đóng thêm một dấu nữa. Cơ chế
 * chống-nhảy-số coi như không tồn tại — trong khi mọi chú thích đều nói ngược lại.
 *
 * Bài học: ca kiểm ĐỌC CHỮ không bắt được lỗi ở chỗ gọi. Ca này dựng THẬT, bắt lấy
 * khoá mà app dùng để TRA và khoá mà app dùng để GHI, rồi so bằng nhau. Và so cả sau
 * khi sổ đời đã nhích — vì đó chính là thứ từng làm hai khoá lệch nhau.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AUTH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'report-seal-key-auth-'));
process.env.AUTH_DATA_DIR = AUTH_DIR;
process.env.DATA_HUB_UNIT_GROUPS_CACHE_FILE = path.join(os.tmpdir(), 'report-seal-key-no-lkg.json');

const store = require('../src/store');
const employeeCost = require('../src/employeeCost');
const catalogManagement = require('../src/catalogManagement');
const closedSeal = require('../src/employeeCostClosedSeal');
const router = require('../src/routes');

function invokeEmployeeCost(query, session) {
  const layer = router.stack.find((c) => c.route?.path === '/employee-cost' && c.route?.methods?.get);
  assert.ok(layer, 'missing GET /employee-cost');
  const handlers = layer.route.stack.slice(1).map((item) => item.handle);
  return new Promise((resolve, reject) => {
    let index = 0;
    const req = { query: { ...query }, session: { ...session }, headers: {}, body: {}, params: {}, ip: '127.0.0.1' };
    const res = {
      statusCode: 200,
      headersSent: false,
      set() { return this; },
      setHeader() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
      send(body) { resolve({ status: this.statusCode, body }); },
      end() { resolve({ status: this.statusCode }); },
    };
    const next = (error) => {
      if (error) return reject(error);
      const handler = handlers[index++];
      if (!handler) return reject(new Error('route ended without response'));
      try { Promise.resolve(handler(req, res, next)).catch(next); } catch (cause) { next(cause); }
    };
    next();
  });
}

test('khoá TRA dấu và khoá GHI dấu phải TRÙNG NHAU — kể cả sau khi sổ đời đã nhích', async () => {
  const goc = {
    employeeCostDataSignature: store.employeeCostDataSignature,
    targetRoster: store.targetRoster,
    getForSession: employeeCost.getForSession,
    getSnapshot: catalogManagement.getSnapshot,
    read: closedSeal.read,
    write: closedSeal.write,
    isSealable: closedSeal.isSealable,
  };

  const khoaDaTra = [];
  const khoaDaGhi = [];

  store.employeeCostDataSignature = () => 'slot-co-dinh';
  store.targetRoster = () => [{ emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true }];
  catalogManagement.getSnapshot = async () => ({ rows: [], catalog: [] });
  employeeCost.getForSession = async ({ requestedEmp }, options) => employeeCost.emptyRangePayload(
    requestedEmp,
    employeeCost.parseMonthRange({ from: options.from, to: options.to }),
  );
  // Tra thì ghi lại khoá rồi trả RỖNG, để lượt nào cũng đi hết đường dựng + đóng dấu.
  closedSeal.read = (key) => { khoaDaTra.push(key); return null; };
  closedSeal.write = async (key) => { khoaDaGhi.push(key); return true; };
  closedSeal.isSealable = () => true;

  // Một kho tiền có thật trên đĩa để còn nhích được sổ đời của nó.
  const khoTien = path.join(AUTH_DIR, 'cost_rates_local.json');
  const NOI_DUNG = JSON.stringify({ rows: [] });
  fs.writeFileSync(khoTien, NOI_DUNG);

  const phien = { emp_code: 'ADMIN02', role: 'admin', name: 'Admin 2' };
  const truyVan = { emp: 'ALL', from: '2026-07', to: '2026-07', page: '1', pageSize: '20', sortDir: 'asc' };

  try {
    const lan1 = await invokeEmployeeCost(truyVan, phien);
    assert.equal(lan1.status, 200);
    assert.ok(khoaDaTra.length > 0, 'phải có tra dấu ở đầu request (kỳ 07.2026 đã khoá sổ)');
    assert.ok(khoaDaGhi.length > 0, 'dựng xong kỳ đã khoá sổ thì phải đóng dấu');
    assert.equal(khoaDaGhi[0], khoaDaTra[0],
      'khoá GHI phải bằng đúng khoá TRA — lệch là dấu mồ côi, tra không bao giờ thấy');

    /* Nhích sổ đời mà KHÔNG đổi nội dung: ghi lại y nguyên bằng fs (giả tiến trình
     * khác) ⇒ inode/mtime đổi, băm nội dung không đổi. Đây đúng là tình huống từng
     * làm khoá ghi và khoá tra lệch nhau. */
    fs.writeFileSync(khoTien, NOI_DUNG);

    const soDaTra = khoaDaTra.length;
    const lan2 = await invokeEmployeeCost(truyVan, phien);
    assert.equal(lan2.status, 200);
    assert.ok(khoaDaTra.length > soDaTra, 'lượt sau vẫn phải tra dấu');
    assert.equal(khoaDaTra[khoaDaTra.length - 1], khoaDaGhi[0],
      'sổ đời nhích mà khoá phải y nguyên — nếu không, dấu vừa đóng lượt trước thành vô dụng');
  } finally {
    store.employeeCostDataSignature = goc.employeeCostDataSignature;
    store.targetRoster = goc.targetRoster;
    employeeCost.getForSession = goc.getForSession;
    catalogManagement.getSnapshot = goc.getSnapshot;
    closedSeal.read = goc.read;
    closedSeal.write = goc.write;
    closedSeal.isSealable = goc.isSealable;
  }
});

/* ── BOT AUDIT ĐỢT 13 ─────────────────────────────────────────────────────── */

/* A1 — DỰNG ĐỜI B MÀ CẤT DƯỚI KHOÁ ĐỜI A.
 * Khoá bộ nhớ đệm chốt từ lúc vào request (đời A). Nếu lượt dựng 1 gặp nguồn đổi rồi
 * lượt 2 dựng đúng đời B, bản B vẫn được người gọi cất dưới khoá A. Nguồn quay lại A
 * ⇒ khoá A trúng ⇒ app phục vụ số của đời B mãi mãi, không dựng lại, không ai hay. */
test('A1 nguồn đổi giữa lúc dựng ⇒ KHÔNG được cất bản đời mới dưới khoá đời cũ', async () => {
  const goc = {
    employeeCostDataSignature: store.employeeCostDataSignature,
    targetRoster: store.targetRoster,
    getForSession: employeeCost.getForSession,
    getSnapshot: catalogManagement.getSnapshot,
    read: closedSeal.read,
    write: closedSeal.write,
  };

  let chuKy = 'a1-doi-A';
  let soLanDung = 0;
  store.employeeCostDataSignature = () => chuKy;
  store.targetRoster = () => [{ emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true }];
  catalogManagement.getSnapshot = async () => ({ rows: [], catalog: [] });
  employeeCost.getForSession = async ({ requestedEmp }, options) => {
    soLanDung += 1;
    chuKy = 'a1-doi-B'; // nguồn nhảy sang đời B NGAY GIỮA lúc fan-out
    return employeeCost.emptyRangePayload(
      requestedEmp,
      employeeCost.parseMonthRange({ from: options.from, to: options.to }),
    );
  };
  closedSeal.read = () => null;
  closedSeal.write = async () => true;

  const phien = { emp_code: 'ADMIN02', role: 'admin', name: 'Admin 2' };
  const truyVan = { emp: 'ALL', from: '2026-07', to: '2026-07', page: '1', pageSize: '20', sortDir: 'asc' };

  try {
    let hong = null;
    let ketQua = null;
    try { ketQua = await invokeEmployeeCost(truyVan, phien); } catch (error) { hong = error; }
    const chan = hong || (ketQua && ketQua.status >= 500);
    assert.ok(chan, 'nguồn rời khỏi đời lúc vào request ⇒ phải DỪNG, không được trả bản lệch khoá');

    // Nguồn quay lại đời A. Nếu bản B đã lỡ nằm dưới khoá A thì lượt này sẽ KHÔNG dựng.
    chuKy = 'a1-doi-A';
    const truocKhiDung = soLanDung;
    let hong2 = null;
    try { await invokeEmployeeCost(truyVan, phien); } catch (error) { hong2 = error; }
    assert.ok(soLanDung > truocKhiDung || hong2,
      'nguồn quay lại đời A mà app trả ngay không dựng ⇒ đúng là đang phục vụ bản đời B cất nhầm ngăn');
  } finally {
    store.employeeCostDataSignature = goc.employeeCostDataSignature;
    store.targetRoster = goc.targetRoster;
    employeeCost.getForSession = goc.getForSession;
    catalogManagement.getSnapshot = goc.getSnapshot;
    closedSeal.read = goc.read;
    closedSeal.write = goc.write;
  }
});

/* A2 — TRA DẤU LẦN HAI VẪN DÙNG KHOÁ SỚM.
 * `sealKey` chụp TRƯỚC khối catalog; catalog làm mới LKG thì đổi chữ ký nguồn sang B.
 * Nếu giữa hai lần tra có ai đó đóng dấu cho đời A, lần tra thứ hai (nằm trong thân
 * hàm dựng) vẫn dùng khoá A, trúng, và trả nguyên bản đời A: `builds = 0`. */
test('A2 sau khi catalog ổn định sang đời B, KHÔNG được tra dấu bằng khoá đời A', async () => {
  const goc = {
    employeeCostDataSignature: store.employeeCostDataSignature,
    targetRoster: store.targetRoster,
    getForSession: employeeCost.getForSession,
    getSnapshot: catalogManagement.getSnapshot,
    read: closedSeal.read,
    write: closedSeal.write,
  };

  let chuKy = 'a2-doi-A';
  let soLanDung = 0;
  let khoaSom = null;
  const DAU_DOI_A = { nguon: 'dau-doi-A', employees: [], rows: [] };

  store.employeeCostDataSignature = () => chuKy;
  store.targetRoster = () => [{ emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true }];
  catalogManagement.getSnapshot = async () => ({ rows: [], catalog: [] });
  employeeCost.getForSession = async ({ requestedEmp }, options) => {
    soLanDung += 1;
    return employeeCost.emptyRangePayload(
      requestedEmp,
      employeeCost.parseMonthRange({ from: options.from, to: options.to }),
    );
  };
  /* Lần tra ĐẦU (đường tắt, khoá sớm = đời A): chưa có dấu. Ngay lúc đó nguồn nhảy
   * sang đời B, rồi dấu của đời A "xuất hiện" — đúng cảnh bot dựng. Lần tra sau mà
   * còn dùng khoá A là trúng ngay và trả nguyên số của đời cũ.
   *
   * ‼ Cửa sổ đổi đời phải mở NGAY TẠI ĐÂY, không được nhờ `catalogManagement.getSnapshot`.
   * Bản đầu của ca này nhờ getSnapshot đổi chữ ký, nhưng catalog có bộ nhớ riêng theo
   * kỳ: chạy chung file thì ca trước đã nạp sẵn kỳ 2026-07 nên stub KHÔNG hề được gọi,
   * chữ ký không đổi, hai khoá trùng nhau — và ca kiểm "xanh" vì một lý do hoàn toàn
   * khác với thứ nó định kiểm. Chạy riêng thì xanh, chạy chung thì đỏ. */
  closedSeal.read = (key) => {
    if (khoaSom === null) { khoaSom = key; chuKy = 'a2-doi-B'; return null; }
    return key === khoaSom ? DAU_DOI_A : null;
  };
  closedSeal.write = async () => true;

  const phien = { emp_code: 'ADMIN03', role: 'admin', name: 'Admin 3' };
  const truyVan = { emp: 'ALL', from: '2026-07', to: '2026-07', page: '1', pageSize: '20', sortDir: 'asc' };

  try {
    let hong = null;
    try { await invokeEmployeeCost(truyVan, phien); } catch (error) { hong = error; }
    assert.equal(hong, null, 'đời B là đời hợp lệ của request này — không có lý do gì phải lỗi');
    assert.ok(soLanDung > 0,
      'phải DỰNG THẬT ở đời B; nếu builds = 0 nghĩa là đã trả nguyên con dấu của đời A');
  } finally {
    store.employeeCostDataSignature = goc.employeeCostDataSignature;
    store.targetRoster = goc.targetRoster;
    employeeCost.getForSession = goc.getForSession;
    catalogManagement.getSnapshot = goc.getSnapshot;
    closedSeal.read = goc.read;
    closedSeal.write = goc.write;
  }
});

/* ── BOT AUDIT ĐỢT 14 ─────────────────────────────────────────────────────── */

// Khung dùng chung cho ba ca dưới: chỉ khác cách `closedSeal.read` cư xử.
function dungKhung({ chuKyDau, read, write }) {
  const goc = {
    employeeCostDataSignature: store.employeeCostDataSignature,
    targetRoster: store.targetRoster,
    getForSession: employeeCost.getForSession,
    getSnapshot: catalogManagement.getSnapshot,
    read: closedSeal.read,
    write: closedSeal.write,
  };
  const trangThai = { chuKy: chuKyDau, soLanDung: 0 };
  store.employeeCostDataSignature = () => trangThai.chuKy;
  store.targetRoster = () => [{ emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true }];
  catalogManagement.getSnapshot = async () => ({ rows: [], catalog: [] });
  employeeCost.getForSession = async ({ requestedEmp }, options) => {
    trangThai.soLanDung += 1;
    return employeeCost.emptyRangePayload(
      requestedEmp,
      employeeCost.parseMonthRange({ from: options.from, to: options.to }),
    );
  };
  closedSeal.read = (key) => read(key, trangThai);
  closedSeal.write = write || (async () => true);
  trangThai.traLai = () => {
    store.employeeCostDataSignature = goc.employeeCostDataSignature;
    store.targetRoster = goc.targetRoster;
    employeeCost.getForSession = goc.getForSession;
    catalogManagement.getSnapshot = goc.getSnapshot;
    closedSeal.read = goc.read;
    closedSeal.write = goc.write;
  };
  return trangThai;
}

const PHIEN_ADMIN = { emp_code: 'ADMIN04', role: 'admin', name: 'Admin 4' };
const TRUY_VAN_T07 = { emp: 'ALL', from: '2026-07', to: '2026-07', page: '1', pageSize: '20', sortDir: 'asc' };
const DAU_DOI_CU = { nguon: 'dau-doi-cu', employees: [], rows: [] };

/* A3a — KHE HỞ GIỮA "CHỐT KHOÁ" VÀ "ĐỌC XONG DẤU", ĐƯỜNG TẮT.
 * Khoá chốt theo đời A rồi mới đi đọc. Nguồn nhảy sang B ngay trong lúc đọc ⇒ đọc
 * trúng dấu A, app trả 200 với số đời A trong khi nguồn thật đã là B, builds = 0. */
test('A3a nguồn đổi ngay lúc tra dấu SỚM ⇒ bỏ đường tắt, phải dựng thật', async () => {
  let lanTra = 0;
  const tt = dungKhung({
    chuKyDau: 'a3a-doi-A',
    read: (key, state) => {
      lanTra += 1;
      if (lanTra === 1) { state.chuKy = 'a3a-doi-B'; return DAU_DOI_CU; } // đổi đời NGAY trong lúc đọc
      return null;
    },
  });
  try {
    let hong = null;
    try { await invokeEmployeeCost(TRUY_VAN_T07, PHIEN_ADMIN); } catch (error) { hong = error; }
    assert.equal(hong, null, 'đời B là đời hợp lệ — đường tắt bỏ đi thì vẫn phải dựng được');
    assert.ok(tt.soLanDung > 0,
      'builds = 0 nghĩa là đã phục vụ nguyên con dấu của đời A trong khi nguồn đã sang B');
  } finally { tt.traLai(); }
});

/* A3b — CÙNG KHE HỞ, NHƯNG Ở LẦN TRA THỨ HAI (trong thân hàm dựng).
 * Chỗ này khoá bộ nhớ đệm đã chốt theo `vanTayLucVao` nên không còn đường lui rẻ:
 * nguồn đã đổi thì phải DỪNG, không được trả dấu của đời cũ. */
test('A3b nguồn đổi ngay lúc tra dấu TRONG THÂN HÀM DỰNG ⇒ phải dừng, không trả dấu đời cũ', async () => {
  let lanTra = 0;
  const tt = dungKhung({
    chuKyDau: 'a3b-doi-A',
    read: (key, state) => {
      lanTra += 1;
      if (lanTra === 1) return null;              // đường tắt: chưa có dấu
      state.chuKy = 'a3b-doi-B';                  // đổi đời NGAY trong lúc đọc lần hai
      return DAU_DOI_CU;
    },
  });
  try {
    let hong = null;
    let ketQua = null;
    try { ketQua = await invokeEmployeeCost(TRUY_VAN_T07, PHIEN_ADMIN); } catch (error) { hong = error; }
    const chan = hong || (ketQua && ketQua.status >= 500);
    assert.ok(chan, 'nguồn đổi giữa lúc đọc dấu ⇒ phải dừng, TUYỆT ĐỐI không trả dấu của đời cũ');
  } finally { tt.traLai(); }
});

/* A4 — ĐỔI CÁCH TÍNH TIỀN MÀ KHOÁ CON DẤU KHÔNG ĐỔI.
 * `APP_BUILD_VERSION` là `package.json.version`, đứng yên hàng chục commit. Bot đổi
 * `EMPLOYEE_COST_DERIVED_BASE` cho C44 phải ra 10.000 thay vì 6.000 mà khoá y hệt ⇒
 * app đọc lại dấu cũ và trả 6.000. Ở kỳ đã khoá sổ thì sai vĩnh viễn. */
test('A4 đổi cấu hình tính tiền ⇒ khoá con dấu BẮT BUỘC phải đổi', async () => {
  const bienCu = process.env.EMPLOYEE_COST_DERIVED_BASE;
  const khoaDaTra = [];
  const tt = dungKhung({
    chuKyDau: 'a4-chu-ky-co-dinh', // dữ liệu ĐỨNG YÊN; chỉ cấu hình tính tiền đổi
    read: (key) => { khoaDaTra.push(key); return null; },
  });
  try {
    delete process.env.EMPLOYEE_COST_DERIVED_BASE;
    await invokeEmployeeCost(TRUY_VAN_T07, PHIEN_ADMIN);
    const khoaTruoc = khoaDaTra[khoaDaTra.length - 1];

    process.env.EMPLOYEE_COST_DERIVED_BASE = 'c44:c41';
    await invokeEmployeeCost(TRUY_VAN_T07, PHIEN_ADMIN);
    const khoaSau = khoaDaTra[khoaDaTra.length - 1];

    assert.ok(khoaTruoc && khoaSau, 'phải bắt được khoá ở cả hai lượt');
    assert.notEqual(khoaSau, khoaTruoc,
      'đổi cấu hình tính tiền mà khoá y nguyên ⇒ app phục vụ lại con số tính bằng công thức đã bị thay');
  } finally {
    if (bienCu === undefined) delete process.env.EMPLOYEE_COST_DERIVED_BASE;
    else process.env.EMPLOYEE_COST_DERIVED_BASE = bienCu;
    tt.traLai();
  }
});

/* Căn cước phải nhạy với CẢ BA nguồn đổi, và không được để lộ giá trị biến — trong
 * đám biến đó có khoá API, mà khoá con dấu thì nằm trong file và trong log. */
test('A4b căn cước công thức: nhạy với biến + file cấu hình, và KHÔNG lộ giá trị', () => {
  const formulaIdentity = require('../src/employeeCostFormulaIdentity');
  const bienCu = process.env.EMPLOYEE_COST_DERIVED_BASE;
  try {
    delete process.env.EMPLOYEE_COST_DERIVED_BASE;
    const goc = formulaIdentity.identity();

    process.env.EMPLOYEE_COST_DERIVED_BASE = 'c44:c41';
    const sauDoiBien = formulaIdentity.identity();
    assert.notEqual(sauDoiBien, goc, 'đổi biến điều khiển công thức ⇒ căn cước phải đổi');

    const BI_MAT = 'sieu-bi-mat-khong-duoc-lo-12345';
    process.env.EMPLOYEE_COST_DERIVED_BASE = BI_MAT;
    const canCuoc = formulaIdentity.identity();
    assert.ok(!canCuoc.includes(BI_MAT),
      'căn cước CHỈ được chứa băm — trong nhóm biến này có khoá API, lộ vào khoá dấu là rò ra file và log');

    // Sửa file cấu hình ⇒ căn cước phải đổi (bậc thưởng, mẫu cột… đều nằm ở đây).
    delete process.env.EMPLOYEE_COST_DERIVED_BASE;
    const tam = path.join(os.tmpdir(), `formula-identity-${process.pid}.json`);
    fs.writeFileSync(tam, JSON.stringify({ v: 1 }));
    process.env.EMPLOYEE_COST_TEMPLATE_CONFIG = tam;
    formulaIdentity.forgetCache();
    const voiFile1 = formulaIdentity.identity();
    fs.writeFileSync(tam, JSON.stringify({ v: 2 }));
    formulaIdentity.forgetCache();
    assert.notEqual(formulaIdentity.identity(), voiFile1,
      'sửa file cấu hình tính tiền ⇒ căn cước phải đổi');
    delete process.env.EMPLOYEE_COST_TEMPLATE_CONFIG;
    formulaIdentity.forgetCache();
  } finally {
    if (bienCu === undefined) delete process.env.EMPLOYEE_COST_DERIVED_BASE;
    else process.env.EMPLOYEE_COST_DERIVED_BASE = bienCu;
  }
});
