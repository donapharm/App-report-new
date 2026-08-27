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
  const req = { query: { ...query }, session: { ...session }, headers: {}, body: {}, params: {}, ip: '127.0.0.1' };
  return router.employeeCostAllTestServices.employeeCostAllPayload(req, {
    bypassClosedPeriodGuard: true,
    rosterOverride: store.targetRoster(),
  }).then((body) => ({ status: 200, body }));
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

/* ── BOT AUDIT ĐỢT 15 ─────────────────────────────────────────────────────── */

/* A5 — DANH SÁCH MODULE VIẾT TAY LÀ MÔ HÌNH SAI.
 *
 * Bản trước tôi liệt kê tay 18 module "tính tiền". Bot sửa `paymentSchedule.js` cho
 * tiền đợt 2 đổi 54.000.000đ → 45.000.000đ: căn cước KHÔNG đổi, khoá KHÔNG đổi, app
 * vẫn trả 54.000.000đ. Và còn thiếu `paymentTeamSummary.js`, `routes.js`, cùng các
 * mắt xích target / tạm ứng lương / sổ thanh toán / analytics / đối soát.
 *
 * Vấn đề không nằm ở việc tôi liệt kê ẩu, mà ở chỗ danh sách tay đòi hỏi MỌI người sửa
 * code về sau phải nhớ cập nhật nó — quên thì không có gì kêu lên, chỉ có một con số
 * sai được đóng dấu vĩnh viễn. Nên nay băm TOÀN BỘ `src/**.js`.
 *
 * Ca này canh đúng tính chất đó: một file .js MỚI TINH trong `src/` — thứ mà không
 * danh sách viết tay nào có thể biết trước — cũng phải làm căn cước đổi. */
test('A5 file .js MỚI trong src/ cũng phải làm căn cước đổi — không còn danh sách để mà sót', () => {
  const formulaIdentity = require('../src/employeeCostFormulaIdentity');
  const fileTam = path.join(__dirname, '..', 'src', '__canCuocKiemTra.tmp.js');
  try {
    formulaIdentity.forgetCache();
    const truoc = formulaIdentity.identity();

    fs.writeFileSync(fileTam, 'module.exports = { tienDot2: () => 45000000 };\n');
    formulaIdentity.forgetCache();
    const sauThemFile = formulaIdentity.identity();
    assert.notEqual(sauThemFile, truoc,
      'thêm một module sinh ra tiền mà căn cước không đổi ⇒ đúng lỗ bot bẻ được với paymentSchedule.js');

    fs.writeFileSync(fileTam, 'module.exports = { tienDot2: () => 54000000 };\n');
    formulaIdentity.forgetCache();
    assert.notEqual(formulaIdentity.identity(), sauThemFile,
      'SỬA con số trong module đó cũng phải làm căn cước đổi');
  } finally {
    try { fs.unlinkSync(fileTam); } catch { /* đã xoá rồi thì thôi */ }
    formulaIdentity.forgetCache();
  }
});

/* Biến môi trường vẫn phải chọn lọc (không băm cả `process.env` vì có PORT/PATH/PWD
 * đổi mỗi lần khởi động). Nhưng lọc theo TIỀN TỐ, không theo tên — biến MỚI cùng họ
 * phải tự được phủ, không phải nhớ cập nhật file căn cước. */
test('A5b biến môi trường MỚI cùng họ tự động được phủ, và vẫn không lộ giá trị', () => {
  const formulaIdentity = require('../src/employeeCostFormulaIdentity');
  const TEN_MOI = 'EMPLOYEE_COST_MOT_BIEN_CHUA_TUNG_CO';
  const BI_MAT = 'gia-tri-bi-mat-khong-duoc-lo-98765';
  try {
    formulaIdentity.forgetCache();
    const truoc = formulaIdentity.identity();

    process.env[TEN_MOI] = 'x';
    assert.notEqual(formulaIdentity.identity(), truoc,
      'biến mới cùng họ phải tự được phủ — nếu phải khai tên thì lại quay về bẫy danh sách tay');

    process.env[TEN_MOI] = BI_MAT;
    const canCuoc = formulaIdentity.identity();
    assert.ok(!canCuoc.includes(BI_MAT),
      'căn cước CHỈ chứa băm — nhóm biến này có khoá API, lộ vào khoá dấu là rò ra file dấu và log');
  } finally {
    delete process.env[TEN_MOI];
    formulaIdentity.forgetCache();
  }
});

/* ── BOT AUDIT ĐỢT 16 ─────────────────────────────────────────────────────── */

/* A6 — TÔI SỬA MÔ HÌNH Ở MỘT CHỖ RỒI ĐỂ NGUYÊN MÔ HÌNH SAI Ở CHỖ BÊN CẠNH.
 *
 * Đợt 15 tôi bỏ được danh sách module viết tay (băm cả `src/`). Nhưng với `data/` thì
 * vẫn giữ đúng cái bẫy đó: chỉ nhặt hai file chính sách, viện cớ "thư mục có dữ liệu
 * biến động". Bot tìm ra ngay `data/holidays.json` — đổi lịch nghỉ làm dự báo target
 * đi từ 104,5% → 110,0% mà căn cước y hệt ⇒ dấu cũ tiếp tục phục vụ số cũ.
 *
 * Nay quét CẢ `data/`, chỉ loại trừ thư mục biến động có lý do. Ca này canh cả hai
 * mặt, vì bỏ sót và churn hỏng theo hai kiểu khác hẳn nhau. */
test('A6 đổi file dữ liệu tĩnh trong data/ (lịch nghỉ) ⇒ căn cước PHẢI đổi', () => {
  const formulaIdentity = require('../src/employeeCostFormulaIdentity');
  const p = path.join(__dirname, '..', 'data', 'holidays.json');
  const cu = fs.existsSync(p) ? fs.readFileSync(p) : null;
  try {
    formulaIdentity.forgetCache();
    const truoc = formulaIdentity.identity();

    fs.writeFileSync(p, JSON.stringify({ dates: [{ date: '2026-09-02', name: 'Quốc khánh' }] }));
    formulaIdentity.forgetCache();
    assert.notEqual(formulaIdentity.identity(), truoc,
      'lịch nghỉ đổi ⇒ dự báo target đổi ⇒ căn cước BẮT BUỘC phải đổi, nếu không dấu cũ phục vụ số cũ');

    if (cu !== null) {
      fs.writeFileSync(p, cu);
      formulaIdentity.forgetCache();
      assert.equal(formulaIdentity.identity(), truoc,
        'trả lại nguyên trạng ⇒ căn cước phải quay về đúng như cũ (băm theo nội dung, không theo giờ sửa)');
    }
  } finally {
    if (cu !== null) fs.writeFileSync(p, cu);
    formulaIdentity.forgetCache();
  }
});

/* A6b — MẶT NGƯỢC LẠI. Quét cả `data/` mà quên loại trừ thư mục biến động thì khoá đổi
 * mỗi lượt bấm ⇒ dấu không bao giờ tra lại được ⇒ quay lại đúng bệnh "mở màn nào cũng
 * dựng lại 24 giây". Đây là lý do phải loại trừ `AUTH_DATA_DIR` và `data/uploads`.
 *
 * ‼ BỐN KHO TIỀN nằm trong `AUTH_DATA_DIR` và CỐ Ý không băm ở đây: chúng đã được phủ
 * bởi `closedSeal.rateStoreFingerprint()` theo NỘI DUNG SỐ (bỏ `fetchedAt`). Băm lại
 * bằng byte thô là dựng lại đúng lỗi churn đã mất một vòng để gỡ. */
test('A6b ghi file biến động (nhật ký đăng nhập) KHÔNG được làm căn cước đổi', () => {
  const formulaIdentity = require('../src/employeeCostFormulaIdentity');
  const thuMucAuth = process.env.AUTH_DATA_DIR || path.join(__dirname, '..', 'data', 'auth');
  const p = path.join(thuMucAuth, 'audit_auth.json');
  const daCo = fs.existsSync(p);
  const cu = daCo ? fs.readFileSync(p) : null;
  try {
    fs.mkdirSync(thuMucAuth, { recursive: true });
    formulaIdentity.forgetCache();
    const truoc = formulaIdentity.identity();

    for (let i = 0; i < 3; i += 1) {
      fs.writeFileSync(p, JSON.stringify({ lan: i, ghiChu: 'mỗi lần đăng nhập là một lượt ghi' }));
      formulaIdentity.forgetCache();
      assert.equal(formulaIdentity.identity(), truoc,
        'nhật ký đăng nhập làm đổi căn cước ⇒ khoá đổi mỗi lượt bấm ⇒ dấu vô dụng, dựng lại hoài');
    }
  } finally {
    if (daCo) fs.writeFileSync(p, cu); else { try { fs.unlinkSync(p); } catch { /* chưa từng có */ } }
    formulaIdentity.forgetCache();
  }
});

/* A6c — CĂN CƯỚC PHẢI ỔN ĐỊNH GIỮA HAI LẦN KHỞI ĐỘNG. Nếu nó đổi mỗi lần nạp lại
 * module thì con dấu không bao giờ tra lại được sau khi restart — đúng thứ cơ chế này
 * sinh ra để tránh. */
test('A6c không đụng gì thì nạp lại module bao nhiêu lần căn cước vẫn y nguyên', () => {
  const duong = require.resolve('../src/employeeCostFormulaIdentity');
  /* ‼ PHẢI TRẢ MODULE VỀ CHỖ CŨ. Xoá cache rồi bỏ đó là để lại một quả mìn: `routes.js`
   * đã giữ bản CŨ từ lúc nạp, còn cache thì cầm bản MỚI. Ca nào sau này thay hàm trên
   * bản mới sẽ không với tới được `routes` — và nó hỏng ÂM THẦM, ca kiểm cứ xanh trong
   * khi thứ nó tưởng đang kiểm thì không hề bị kiểm. Đã mất một vòng vì đúng chuyện này
   * (ca A11 bên dưới). */
  const banGoc = require.cache[duong];
  const lan = [];
  try {
    for (let i = 0; i < 5; i += 1) {
      delete require.cache[duong];
      lan.push(require('../src/employeeCostFormulaIdentity').identity());
    }
  } finally {
    require.cache[duong] = banGoc;
  }
  assert.equal(new Set(lan).size, 1, `căn cước phải giống hệt cả 5 lần nạp, đang ra: ${[...new Set(lan)].join(' | ')}`);
  assert.equal(require('../src/employeeCostFormulaIdentity'), banGoc.exports,
    'phải trả đúng bản module mà routes.js đang giữ, không để lại bản lạ trong cache');
});

/* ── BOT AUDIT ĐỢT 17 ─────────────────────────────────────────────────────── */

/* A7 — `require()` FILE DỮ LIỆU LÀ CĂN CƯỚC NÓI DỐI.
 * `require` nhớ vĩnh viễn trong vòng đời tiến trình. Sửa `holidays.json` trên đĩa thì
 * căn cước chuyển sang đời B, nhưng tiến trình đang chạy vẫn tính bằng lịch đời A còn
 * kẹt trong bộ nhớ. Bot đo: cùng khoá B mà hai tiến trình cho 104,5% và 110,0%.
 * Căn cước lúc đó mô tả file trên đĩa chứ không mô tả thứ đang thực sự được dùng. */
test('A7 không module nào trong src/ được `require()` file dữ liệu/cấu hình', () => {
  const srcDir = path.join(__dirname, '..', 'src');
  const xau = [];
  for (const ten of fs.readdirSync(srcDir)) {
    if (!ten.endsWith('.js')) continue;
    const noiDung = fs.readFileSync(path.join(srcDir, ten), 'utf8');
    // Bỏ chú thích trước khi soi: file này có nhắc tới lối cũ trong phần giải thích.
    const ma = noiDung.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/require\(\s*['"][^'"]*\.\.\/(data|config)\/[^'"]*\.json['"]\s*\)/.test(ma)) xau.push(ten);
  }
  assert.deepEqual(xau, [],
    `\`require\` nhớ vĩnh viễn ⇒ sửa file trên đĩa mà tiến trình vẫn tính bằng bản cũ, `
    + `trong khi căn cước đã đổi. Đọc tại thời điểm gọi. File vi phạm: ${xau.join(', ')}`);
});

test('A7b tiến trình ĐANG CHẠY phải thấy lịch nghỉ vừa sửa, không cần khởi động lại', () => {
  const vnWorkingDays = require('../src/vnWorkingDays');
  const p = path.join(__dirname, '..', 'data', 'holidays.json');
  const cu = fs.readFileSync(p);
  try {
    assert.equal(vnWorkingDays.calendarStatus(2029).calendarMissing, true, 'chưa có lịch 2029');
    fs.writeFileSync(p, JSON.stringify({ dates: [{ date: '2029-01-01', name: 'Tết Dương lịch' }] }));
    assert.equal(vnWorkingDays.calendarStatus(2029).calendarMissing, false,
      'sửa lịch trên đĩa mà tiến trình vẫn nói "chưa có" ⇒ căn cước và phép tính đang lệch nhau');
  } finally {
    fs.writeFileSync(p, cu);
  }
});

/* A7c — VÙNG QUÉT PHẢI ỔN ĐỊNH TRƯỚC FILE DO CHÍNH APP GHI RA.
 * Trên PROD `data/` là 524 file / 1,03 GB; quét cả thư mục làm căn cước mất 7 giây và
 * churn theo `*_lkg.json` / `*_state.json`. Nay chỉ lấy tầng trên cùng và bỏ đuôi file
 * do app tự ghi. */
test('A7c file trạng thái do app tự ghi KHÔNG được làm căn cước đổi', () => {
  const formulaIdentity = require('../src/employeeCostFormulaIdentity');
  const p = path.join(__dirname, '..', 'data', 'catalog_management_lkg.json');
  const daCo = fs.existsSync(p);
  const cu = daCo ? fs.readFileSync(p) : null;
  try {
    fs.writeFileSync(p, JSON.stringify({ updatedAt: '2026-08-11T10:00:00.000Z' }));
    formulaIdentity.forgetCache();
    const truoc = formulaIdentity.identity();
    fs.writeFileSync(p, JSON.stringify({ updatedAt: '2026-08-11T20:00:00.000Z' }));
    formulaIdentity.forgetCache();
    assert.equal(formulaIdentity.identity(), truoc,
      'app ghi trạng thái ⇒ khoá đổi ⇒ dấu trượt ⇒ dựng lại — đúng bệnh cơ chế này sinh ra để chữa');
    assert.equal(formulaIdentity.dangTinCay().tinCay, true, 'vùng quét bình thường thì phải đáng tin');
  } finally {
    if (daCo) fs.writeFileSync(p, cu); else { try { fs.unlinkSync(p); } catch { /* chưa từng có */ } }
    formulaIdentity.forgetCache();
  }
});

/* A11 — CHỐT LÀM RỒI PHẢI CẮM DÂY.
 * Đợt 17 tôi thêm hạn mức vùng quét 200 file / 32 MB và viết hẳn `dangTinCay()` để khi
 * vượt thì ngừng đóng dấu... rồi không gọi nó ở đâu cả. Bot ép căn cước sang trạng thái
 * không đáng tin: app vẫn ghi dấu như thường. Một cái chốt không ai gọi thì không phải
 * chốt, chỉ là chú thích dài — và chú thích thì không chặn được gì.
 *
 * Ca này kiểm ĐỘNG: ép `dangTinCay()` trả false rồi đòi khoá phải là null. Khoá null
 * thì cả đường TRA lẫn đường GHI đều tắt, nên chỉ cần chặn một chỗ. */
test('A11 căn cước không đáng tin ⇒ khoá đóng dấu phải là null (cả tra lẫn ghi)', async () => {
  const formulaIdentity = require('../src/employeeCostFormulaIdentity');
  const goc = {
    dangTinCay: formulaIdentity.dangTinCay,
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
  store.employeeCostDataSignature = () => 'a11-co-dinh';
  store.targetRoster = () => [{ emp_code: 'DN001', name: 'NV 1', role: 'sale', has_target: true }];
  catalogManagement.getSnapshot = async () => ({ rows: [], catalog: [] });
  employeeCost.getForSession = async ({ requestedEmp }, options) => employeeCost.emptyRangePayload(
    requestedEmp,
    employeeCost.parseMonthRange({ from: options.from, to: options.to }),
  );
  closedSeal.read = (key) => { khoaDaTra.push(key); return null; };
  closedSeal.write = async (key) => { khoaDaGhi.push(key); return true; };
  closedSeal.isSealable = () => true;
  // Vùng quét phình ra ngoài dự kiến ⇒ không ai giải thích nổi khoá này gồm những gì.
  formulaIdentity.dangTinCay = () => ({ tinCay: false, vuotNguong: { soFile: 524, soByte: 1_036_645_241 } });

  const phien = { emp_code: 'ADMIN02', role: 'admin', name: 'Admin 2' };
  const truyVan = { emp: 'ALL', from: '2026-07', to: '2026-07', page: '1', pageSize: '20', sortDir: 'asc' };
  try {
    const ketQua = await invokeEmployeeCost(truyVan, phien);
    assert.equal(ketQua.status, 200, 'không đáng tin thì mất đường tắt, KHÔNG được gãy cả màn');
    assert.deepEqual(khoaDaGhi, [],
      'căn cước không đáng tin mà vẫn ghi dấu ⇒ đóng băng vĩnh viễn một con số không ai truy được nguồn');
    assert.ok(khoaDaTra.every((key) => key == null),
      'đường tra cũng phải tắt — tra bằng khoá không đáng tin thì trúng dấu nào cũng không tin được');
  } finally {
    formulaIdentity.dangTinCay = goc.dangTinCay;
    store.employeeCostDataSignature = goc.employeeCostDataSignature;
    store.targetRoster = goc.targetRoster;
    employeeCost.getForSession = goc.getForSession;
    catalogManagement.getSnapshot = goc.getSnapshot;
    closedSeal.read = goc.read;
    closedSeal.write = goc.write;
    closedSeal.isSealable = goc.isSealable;
  }
});
