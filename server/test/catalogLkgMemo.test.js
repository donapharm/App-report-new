'use strict';
/**
 * 26 GIÂY MÀN HÌNH QUAY — ĐỌC LẠI CÙNG MỘT FILE 377 MB NĂM LẦN.
 *
 * Bot audit đợt 17 vòng 7 đo tận nơi trên PROD:
 *   · đọc file LKG   14.100 ms
 *   · JSON.parse      9.443 ms
 *   · kiểm hợp lệ     2.455 ms
 *   · gọi mạng            0 ms
 * File LKG **377.416.106 byte**, và `readCache()` đọc + phân tích lại TOÀN BỘ cho MỖI
 * lượt gọi. Ba kỳ × nhiều chỗ gọi ⇒ nhai đi nhai lại. Đây là cái CEO chụp lúc 21:59.
 *
 * Ca kiểm ĐẾM SỐ LƯỢT ĐỌC ĐĨA thật, không đo giờ — đo giờ thì máy chậm máy nhanh sẽ
 * cho kết quả khác nhau, còn số lượt đọc là bất biến của thiết kế.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const THU_MUC = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-lkg-memo-'));
const FILE_LKG = path.join(THU_MUC, 'catalog_management_lkg.json');
process.env.CATALOG_MANAGEMENT_CACHE_FILE = FILE_LKG;

const catalogManagement = require('../src/catalogManagement');

/* ‼ FIXTURE PHẢI HỢP LỆ, NẾU KHÔNG CA KIỂM XANH GIẢ (bot audit vòng 8 — bắt đúng).
 * Bốn ca kiểm bản trước dùng fixture không qua nổi `assertCatalogSnapshotContract`, nên
 * `readCache` ném lỗi và trả `null` — mà ca kiểm chỉ ĐẾM LƯỢT ĐỌC ĐĨA nên vẫn xanh.
 * Chúng chứng minh đúng một điều: "không đọc đĩa hai lần khi không có gì để đọc".
 * Lần thứ SÁU trong đợt dính "xanh vì lý do sai". Nay: dựng fixture bằng CHÍNH đường
 * ghi của app, và mọi ca đều đòi snapshot KHÁC `null`. */
function ghiLkg(danhDau) {
  /* `c4` (mã nhà thầu) là bắt buộc — đường ghi thật từ chối nếu thiếu. Chính chỗ này
   * chứng minh vì sao phải dựng fixture bằng đường ghi của app: tôi tự bịa thì không
   * bao giờ biết mình thiếu trường gì, và ca kiểm cứ xanh. Đường ghi thật đòi đủ
   * `CRITICAL_CATALOG_SOURCE_FIELDS` = c4·c5·c7·c15·c16·c17·c25·c31. */
  const rows = [{
    c4: 'CT01', c5: `P${danhDau}`, c7: 'U1', c15: 'Hoạt chất', c16: `Thuốc ${danhDau}`,
    c17: '500mg', c25: 'Hộp', c31: 10_000, c10: 'N1',
    // Cặp (đơn vị, QLNB) phải có mặt trong catalog theo khoá `c7`+`c5`.
    type: 'product', unit_code: 'U1', unit_name: 'Đơn vị 1', qlnb_code: `P${danhDau}`, label: `L${danhDau}`,
  }];
  catalogManagement.writeCacheForTests({
    period: '07.2026', rows, catalog: rows,
    meta: { version: danhDau, checksum: String(danhDau).repeat(64).slice(0, 64) },
  });
}
ghiLkg(1);

assert.notEqual(catalogManagement.readCacheForTests('07.2026'), null,
  'fixture phải HỢP LỆ — trả null thì mọi ca dưới đây chỉ đang đếm lượt đọc của hư không');

/* ‼ CẤM `?.` Ở ĐÂY. Nếu hàm không được xuất ra thì `?.` biến mọi lượt gọi thành không
 * làm gì, số lượt đọc bằng 0, và ca kiểm XANH trong khi nó chưa hề kiểm gì. Đã dính
 * đúng kiểu này bốn lần trong đợt (A6c, PeriodBlock, dấu phân cách, fixture paymentTeam),
 * nên chốt thẳng: hàm phải tồn tại, gọi phải thật. */
assert.equal(typeof catalogManagement.readCacheForTests, 'function',
  'phải xuất `readCacheForTests` ra, nếu không ca kiểm này không kiểm được gì');
const docKy = (ky) => catalogManagement.readCacheForTests(ky);

/** Đếm số lượt ĐỌC file LKG từ đĩa trong lúc chạy `viec`. */
function demLuotDoc(viec) {
  const goc = fs.readFileSync;
  let dem = 0;
  fs.readFileSync = (duongDan, ...rest) => {
    if (String(duongDan) === FILE_LKG) dem += 1;
    return goc(duongDan, ...rest);
  };
  try { viec(); } finally { fs.readFileSync = goc; }
  return dem;
}

test('đọc LKG nhiều lượt trong cùng một request chỉ chạm đĩa MỘT lần', () => {
  catalogManagement.quenLkg();
  let cuoi = null;
  const luot = demLuotDoc(() => {
    for (let i = 0; i < 5; i += 1) cuoi = docKy('07.2026');
  });
  assert.notEqual(cuoi, null, 'phải trả snapshot THẬT, không phải null');
  assert.ok(luot <= 1, `đọc đĩa ${luot} lượt — phải nhớ bản đã phân tích, đây là 26 giây của CEO`);
});

test('cùng một kỳ hỏi năm lần ⇒ một lượt đọc; ba kỳ khác nhau ⇒ vẫn một lượt đọc', () => {
  catalogManagement.quenLkg();
  let coThat = 0;
  const luot = demLuotDoc(() => {
    for (const ky of ['07.2026', '06.2026', '05.2026', '07.2026', '07.2026']) {
      if (docKy(ky)) coThat += 1;
    }
  });
  assert.equal(coThat, 3, 'ba lượt hỏi 07.2026 phải ra snapshot thật, không phải null');
  assert.ok(luot <= 1,
    `ba kỳ khác nhau vẫn nằm trong CÙNG một file — đọc ${luot} lượt là đang nhai lại 377 MB`);
});

/* ‼ BẢN NHỚ PHẢI HẾT HIỆU LỰC KHI FILE ĐỔI. Khoá theo đường dẫn suông là sai: file bị
 * ghi đè tại chỗ thì đường dẫn y nguyên mà nội dung đã khác — đúng lỗi đã mất một vòng
 * để gỡ bên `persist`. Khoá phải gồm inode + cỡ + mtime + ctime. */
test('file LKG đổi ⇒ bản nhớ hết hiệu lực, lượt sau phải đọc lại', () => {
  catalogManagement.quenLkg();
  const truoc = docKy('07.2026');
  assert.equal(truoc.rows[0].c5, 'P1');
  ghiLkg(2);
  const sau = docKy('07.2026');
  assert.notEqual(sau, null);
  assert.equal(sau.rows[0].c5, 'P2',
    'file đã đổi mà vẫn trả nội dung cũ ⇒ CEO đọc số của danh mục cũ, sai im lặng');
});

test('snapshot kỳ không hết hạn theo đồng hồ: 200 lượt trong 5 phút chỉ dựng một lần', () => {
  ghiLkg(21);
  catalogManagement.quenLkg();
  catalogManagement.resetSnapshotBuildsForTests();
  const dateNow = Date.now;
  let now = dateNow();
  Date.now = () => now;
  try {
    const first = docKy('07.2026');
    assert.notEqual(first, null);
    for (let i = 0; i < 200; i += 1) {
      now += 1_500; // tổng đúng 5 phút
      assert.strictEqual(docKy('07.2026'), first);
    }
  } finally { Date.now = dateNow; }
  assert.equal(catalogManagement.snapshotBuildsForTests(), 1);
});

test('snapshot kỳ dựng lại đúng một lần khi căn cước file đổi', () => {
  ghiLkg(22);
  catalogManagement.quenLkg();
  catalogManagement.resetSnapshotBuildsForTests();
  assert.equal(docKy('07.2026').rows[0].c5, 'P22');
  ghiLkg(23);
  assert.equal(docKy('07.2026').rows[0].c5, 'P23');
  assert.equal(docKy('07.2026').rows[0].c5, 'P23');
  assert.equal(catalogManagement.snapshotBuildsForTests(), 2);
});

test('sau lần dựng đầu, 200 cache hit không có lượt đồng bộ nào quá 50ms', () => {
  ghiLkg(24);
  catalogManagement.quenLkg();
  assert.notEqual(docKy('07.2026'), null);
  let maxMs = 0;
  for (let i = 0; i < 200; i += 1) {
    const started = process.hrtime.bigint();
    assert.notEqual(docKy('07.2026'), null);
    maxMs = Math.max(maxMs, Number(process.hrtime.bigint() - started) / 1e6);
  }
  assert.ok(maxMs < 50, `cache hit đồng bộ dài nhất ${maxMs.toFixed(1)}ms`);
});

test('snapshot cache luôn bị chặn số entry, không phình theo số kỳ', () => {
  ghiLkg(25);
  catalogManagement.quenLkg();
  for (let month = 1; month <= 12; month += 1) docKy(`${String(month).padStart(2, '0')}.2026`);
  assert.ok(catalogManagement.snapshotCacheSizeForTests() <= 6);
});

test('quenLkg() phải thật sự xoá bản nhớ — chốt làm rồi phải cắm dây', () => {
  catalogManagement.quenLkg();
  assert.notEqual(docKy('07.2026'), null);
  catalogManagement.quenLkg();
  const luot = demLuotDoc(() => {
    assert.notEqual(docKy('07.2026'), null);
  });
  assert.equal(luot, 1, 'gọi quên rồi mà lượt sau không đọc lại ⇒ hàm quên không làm gì cả');
});


/* ── BOT AUDIT VÒNG 8 — BA LỖ CÒN LẠI CỦA BẢN NHỚ ────────────────────────────── */

/* B1 — BẢN TRẢ RA PHẢI ĐÓNG BĂNG. Nhiều lượt đọc dùng chung một object trong RAM; một
 * người gọi lỡ `push`/`sort` là mọi lượt sau ăn phải bản bẩn, và bẩn kiểu đó im lặng. */
test('B1 snapshot trả ra đã đóng băng SÂU — người gọi không làm bẩn được bản trong RAM', () => {
  // Ca trước đã ghi bản 2/3 — dựng lại mốc riêng để ca này không phụ thuộc thứ tự chạy.
  ghiLkg(7);
  catalogManagement.quenLkg();
  const snap = docKy('07.2026');
  assert.notEqual(snap, null);
  assert.ok(Object.isFrozen(snap), 'bản ngoài phải đóng băng');
  assert.ok(Object.isFrozen(snap.rows), 'mảng `rows` cũng phải đóng băng');
  assert.ok(Object.isFrozen(snap.rows[0]), 'từng dòng cũng phải — nông thì vẫn sửa được bên trong');
  assert.throws(() => { snap.rows[0].c16 = 'BẨN'; }, TypeError,
    'sửa được một dòng là làm bẩn bản dùng chung của mọi lượt đọc sau');
  assert.equal(docKy('07.2026').rows[0].c16, 'Thuốc 7', 'bản trong RAM phải còn sạch');
});

/* B2 — CĂN CƯỚC PHẢI ĐỦ `dev` VÀ NANO GIÂY. Mili giây không phân biệt được hai lần ghi
 * sát nhau; thiếu `dev` thì hai file khác thiết bị có thể trùng inode. */
test('B2 căn cước file gồm dev và nano giây, không phải mili giây', () => {
  const ma = fs.readFileSync(path.join(__dirname, '..', 'src', 'catalogManagement.js'), 'utf8');
  const than = ma.slice(ma.indexOf('function canCuocFile('), ma.indexOf('function quenLkg('));
  assert.match(than, /bigint: true/, 'phải dùng `stat` dạng bigint để có nano giây');
  assert.match(than, /st\.dev/, 'thiếu `dev` thì inode trùng nhau giữa hai thiết bị là chuyện thường');
  assert.match(than, /mtimeNs/, 'mili giây không phân biệt được hai lần ghi trong cùng một mili giây');
  assert.doesNotMatch(than, /mtimeMs/, 'còn dùng mili giây là còn lỗ');
});

/* B3 — HẬU KIỂM SAU KHI ĐỌC. File đổi ngay trong lúc đọc thì nội dung ta cầm không
 * thuộc căn cước nào cả; gắn nó vào căn cước cũ là tự tạo một bản nhớ nói dối. */
test('B3 file đổi NGAY TRONG LÚC đọc ⇒ không được nhớ bản trộn đời', () => {
  catalogManagement.quenLkg();
  const goc = fs.readFileSync;
  let daPha = false;
  fs.readFileSync = (duongDan, ...rest) => {
    const ra = goc(duongDan, ...rest);
    // Đổi file NGAY SAU khi đọc xong, trước khi hàm kịp hậu kiểm.
    if (String(duongDan) === FILE_LKG && !daPha) { daPha = true; fs.readFileSync = goc; ghiLkg(3); }
    return ra;
  };
  try {
    const snap = docKy('07.2026');
    assert.ok(daPha, 'ca kiểm phải thật sự chen được vào giữa');
    if (snap) {
      assert.equal(snap.rows[0].c5, 'P3',
        'nếu có trả bản nào thì phải là bản MỚI — trả bản cũ nghĩa là hậu kiểm không chạy');
    }
  } finally { fs.readFileSync = goc; }
});


/* B4 — HẠN GIỜ PHẢI THẢ RAM, KHÔNG CHỈ HẾT HIỆU LỰC.
 *
 * Bot audit vòng 10 đo tận nơi: sau **30 giây rảnh, 3/6 tiến trình vẫn giữ 1,36 GiB**;
 * phải tới 60–75 giây mới về 659 MiB. Vì hạn giờ của tôi chỉ được kiểm **lúc có người
 * gọi** — không ai gọi thì tham chiếu vào bản 377 MB vẫn còn, GC không được phép thu.
 *
 * Phân biệt hai thứ tôi từng gộp làm một:
 *   · hạn DÙNG LẠI — "bản này còn xài được không";
 *   · hạn GIỮ      — "còn nắm bộ nhớ này tới bao giờ".
 * Cái thứ hai phải CHỦ ĐỘNG bỏ tham chiếu, nếu không RAM chỉ về khi tình cờ có người gọi.
 */
test('B4 không hết hạn theo đồng hồ — 100 lượt file không đổi chỉ parse một lần', () => {
  assert.equal(typeof catalogManagement.conGiuBanPhanTichForTests, 'function',
    'phải xuất hàm soi tham chiếu, nếu không ca này chỉ đoán');
  catalogManagement.quenLkg();
  ghiLkg(9);
  assert.notEqual(docKy('07.2026'), null);
  assert.equal(catalogManagement.conGiuBanPhanTichForTests(), true,
    'vừa đọc xong thì đang giữ bản đã phân tích — đúng, đó là chỗ cứu 26 giây');

  const originalParse = JSON.parse;
  let parses = 0;
  JSON.parse = (...args) => { parses += 1; return originalParse(...args); };
  try { for (let i = 0; i < 100; i += 1) assert.notEqual(docKy('07.2026'), null); }
  finally { JSON.parse = originalParse; }
  assert.equal(parses, 0, 'đã có generation trong RAM thì 100 lượt không được parse lại theo đồng hồ');
  assert.equal(catalogManagement.conGiuBanPhanTichForTests(), true,
    'generation chỉ thay khi căn cước file đổi; worker tự thoát sẽ thu hồi monolith');
});

test('B4b `quenLkg()` bỏ generation ngay để lượt ghi chủ động không phục vụ bản cũ', () => {
  ghiLkg(10);
  catalogManagement.quenLkg();
  assert.equal(catalogManagement.conGiuBanPhanTichForTests(), false, 'quên là sạch ngay');
  assert.notEqual(docKy('07.2026'), null);
  assert.equal(catalogManagement.conGiuBanPhanTichForTests(), true,
    'đọc lại thì giữ lại — và hẹn giờ mới phải là hẹn của lần này, không phải lần trước');
});


/* B5 — TRÚNG BẢN NHỚ CŨNG PHẢI HẬU KIỂM (bot audit vòng 10).
 * Tôi hậu kiểm ở đường ĐỌC ĐĨA rồi tưởng xong, nhưng đường TRÚNG BẢN NHỚ vẫn giữ nguyên
 * khe cũ: lấy căn cước → tra bản nhớ → trả về. File đổi giữa ba bước đó thì ta trả kết
 * luận của đời cũ. Sửa một chỗ rồi để nguyên chỗ song song — đúng cái bệnh của cả đợt.
 */
test('B5 file đổi ngay sau khi tra bản nhớ ⇒ không được trả bản cũ', () => {
  ghiLkg(11);
  catalogManagement.quenLkg();
  assert.equal(docKy('07.2026').rows[0].c5, 'P11', 'nạp bản nhớ cho đời 11');

  /* ‼ Bản đầu tôi viết chỗ này bằng `arguments.callee` trong hàm mũi tên — nó ném lỗi,
   * `readCache` nuốt lỗi và trả `null`, rồi nhánh kiểm bị bỏ qua ⇒ ca kiểm XANH mà chưa
   * kiểm gì. Lần thứ TÁM trong đợt. Nay dùng hàm có TÊN, và chốt `ketQua` khác `null`
   * để không bao giờ xanh nhờ đường lỗi. */
  const goc = fs.statSync;
  let lanSoi = 0;
  function soiCoChen(duongDan, opt) {
    const ra = goc(duongDan, opt);
    if (String(duongDan) === FILE_LKG) {
      lanSoi += 1;
      // Ngay sau lượt soi ĐẦU (lượt lấy khoá bản nhớ), đổi file sang đời 12.
      if (lanSoi === 1) { fs.statSync = goc; ghiLkg(12); fs.statSync = soiCoChen; }
    }
    return ra;
  }
  fs.statSync = soiCoChen;
  let ketQua;
  try { ketQua = docKy('07.2026'); } finally { fs.statSync = goc; }

  assert.ok(lanSoi >= 2, `phải soi căn cước ÍT NHẤT HAI lần (lấy khoá + hậu kiểm), đang soi ${lanSoi}`);
  assert.notEqual(ketQua, null,
    'trả null nghĩa là đường lỗi đã nuốt mất phép kiểm — ca này khi ấy xanh vì lý do sai');
  assert.equal(ketQua.rows[0].c5, 'P12',
    'trả bản cũ P11 sau khi đĩa đã sang P12 ⇒ CEO đọc danh mục cũ, sai im lặng');
});
