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

function ghiLkg(rows) {
  fs.writeFileSync(FILE_LKG, JSON.stringify({
    source: 'data-hub-lkg',
    snapshots: {
      '07.2026': {
        period: '07.2026', rows, catalog: rows,
        meta: { version: 1, checksum: 'x'.repeat(64) },
      },
    },
  }));
}
ghiLkg([{ c5: 'P1', c7: 'U1', c16: 'Thuốc A' }]);

const catalogManagement = require('../src/catalogManagement');

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
  const luot = demLuotDoc(() => {
    for (let i = 0; i < 5; i += 1) docKy('07.2026');
  });
  assert.ok(luot <= 1, `đọc đĩa ${luot} lượt — phải nhớ bản đã phân tích, đây là 26 giây của CEO`);
});

test('cùng một kỳ hỏi năm lần ⇒ một lượt đọc; ba kỳ khác nhau ⇒ vẫn một lượt đọc', () => {
  catalogManagement.quenLkg();
  const luot = demLuotDoc(() => {
    for (const ky of ['07.2026', '06.2026', '05.2026', '07.2026', '07.2026']) {
      docKy(ky);
    }
  });
  assert.ok(luot <= 1,
    `ba kỳ khác nhau vẫn nằm trong CÙNG một file — đọc ${luot} lượt là đang nhai lại 377 MB`);
});

/* ‼ BẢN NHỚ PHẢI HẾT HIỆU LỰC KHI FILE ĐỔI. Khoá theo đường dẫn suông là sai: file bị
 * ghi đè tại chỗ thì đường dẫn y nguyên mà nội dung đã khác — đúng lỗi đã mất một vòng
 * để gỡ bên `persist`. Khoá phải gồm inode + cỡ + mtime + ctime. */
test('file LKG đổi ⇒ bản nhớ hết hiệu lực, lượt sau phải đọc lại', () => {
  catalogManagement.quenLkg();
  demLuotDoc(() => docKy('07.2026'));
  ghiLkg([{ c5: 'P2', c7: 'U2', c16: 'Thuốc B' }]);
  const luotSauKhiDoi = demLuotDoc(() => docKy('07.2026'));
  assert.equal(luotSauKhiDoi, 1,
    'file đã đổi mà vẫn phục vụ bản nhớ cũ ⇒ CEO đọc số của danh mục cũ, sai im lặng');
});

test('quenLkg() phải thật sự xoá bản nhớ — chốt làm rồi phải cắm dây', () => {
  catalogManagement.quenLkg();
  demLuotDoc(() => docKy('07.2026'));
  catalogManagement.quenLkg();
  const luot = demLuotDoc(() => docKy('07.2026'));
  assert.equal(luot, 1, 'gọi quên rồi mà lượt sau không đọc lại ⇒ hàm quên không làm gì cả');
});
