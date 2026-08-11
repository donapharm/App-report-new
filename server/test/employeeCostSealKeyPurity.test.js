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
