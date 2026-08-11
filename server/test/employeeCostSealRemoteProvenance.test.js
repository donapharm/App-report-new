'use strict';
/**
 * LAI LỊCH GÓI DỮ LIỆU QUA MẠNG — BỐN LỖ CỦA BOT AUDIT ĐỢT 17 VÒNG 4.
 *
 * Cả bốn CÙNG MỘT GỐC, và là lỗi tôi lặp suốt đợt này:
 * **vắng bằng chứng bị coi là bằng chứng vắng mặt.**
 * Chỗ nào không biết, tôi ghi thành "không có gì", rồi lượt sau đọc "không có gì" và
 * yên tâm phục vụ số cũ.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.AUTH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'report-seal-remote-'));
const seal = require('../src/employeeCostClosedSeal');
const employeeCostTable = require('../src/employeeCostTable');

/* ‼ DẤU PHÂN CÁCH PHẢI ĐÚNG BẢN THẬT. `loadScopes` ghép khoá bằng `\u001f`, bộ soi tách
 * bằng đúng ký tự đó. Ca kiểm dùng dấu khác thì `contractorCode` ra `undefined`, hai chuỗi
 * không bao giờ khớp, và ca kiểm "xanh vì luôn khác nhau" — tức xanh vì lý do SAI. Hôm nay
 * đã dính hai lần kiểu đó (A6c xoá cache, PeriodBlock cắt ngược). Viết dạng thoát cho nhìn
 * thấy được, đừng để ký tự điều khiển vô hình nằm trong mã. */
const SEP = '\u001f';
const ROSTER_2 = [{ emp_code: 'DN001', name: 'A' }, { emp_code: 'DN002', name: 'B' }];

function baoCao(empCode) {
  return {
    empCode, employeeName: empCode, from: '2026-07', to: '2026-07', sourceOutcome: 'ok',
    periods: [{
      period: '2026-07',
      columns: [{ key: 'c41', label: 'CP đặt hàng', kind: 'percent' }],
      rows: [{ c16: 'SP0', unitCode: 'DV1', c41: 0.01 }],
      summary: {}, match: {}, daily: { dates: [], totals: [] },
    }],
  };
}

const gopThat = (reports, remote) => {
  const merged = employeeCostTable.mergeEmployeeReports(reports, ROSTER_2);
  merged.revenueRecon = { total: 250, shown: 250, gap: 0, balanced: true };
  merged.remoteProvenance = remote;
  return merged;
};

const A64 = 'a'.repeat(64);
const B64 = 'b'.repeat(64);

/* A12 — SCOPE HỎI HỤT GÓI PHẢI ĐỂ LẠI DẤU VẾT.
 * `loadScope` trả `null` cho CẢ HAI cảnh: "không có gói cho scope này" và "hỏi nguồn
 * thất bại". Bản trước tôi bỏ qua cả hai ⇒ lai lịch co lại thành `[]` ⇒ bộ soi thấy
 * rỗng thì gật ngay, không hỏi ai. Bot dựng đúng cảnh đó: route trả nguyên dấu cũ
 * 12,5 · `builds=0` · **0 lượt hỏi metadata**. */
test('A12 lai lịch có `THIEU` ⇒ không đóng dấu, và mở dấu cũng không tin', async () => {
  const reports = [baoCao('DN001'), baoCao('DN002')];
  const coThieu = ['2026-07:CT01:THIEU'];
  assert.equal(seal.isSealable(gopThat(reports, coThieu), ROSTER_2, reports), false,
    'hỏi hụt gói mà vẫn đóng dấu = đóng băng một kỳ mà chính ta không biết đã dùng dữ liệu gì');
  assert.equal(await seal.remoteProvenanceStillValid({ remoteProvenance: coThieu }, {
    loadScopes: async () => new Map(), loadAllocationScopes: async () => new Map(),
  }), false, 'dấu đóng lúc đang hụt gói thì mở ra cũng không được tin');
});

test('A12b rỗng vẫn hợp lệ — nhưng chỉ còn ĐÚNG MỘT nghĩa: không có scope nào để lấy', () => {
  const reports = [baoCao('DN001'), baoCao('DN002')];
  assert.equal(seal.isSealable(gopThat(reports, []), ROSTER_2, reports), true,
    'kỳ không dùng gói từ xa nào là hợp lệ; nay "hỏi hụt" đã có chữ THIEU riêng nên không lẫn nữa');
});

/* A13 — `rc` KHÔNG ĐỦ ĐỂ PHÂN BIỆT HAI ENVELOPE HỢP LỆ.
 * Bot: hai envelope đều HỢP LỆ cho ra 12,5 và 9,5 mà `reconciliation_rows_checksum_v2`
 * y nguyên. Tuple phải ghim thêm `shadow_snapshot_checksum` và cặp `immutable_*`. */
test('A13 envelope đổi mà chỉ khác shadow/immutable checksum ⇒ vẫn phải vứt dấu', async () => {
  const khoa = `2026-07${SEP}CT01`;
  const goi = (shadowChecksum) => new Map([[khoa, {
    reconciliation_version: 3,
    reconciliation_rows_checksum_v2: A64, // KHÔNG đổi — đây là chỗ bẫy
    confirmed_at: '2026-08-01T00:00:00.000Z',
    shadow_snapshot_checksum: shadowChecksum,
    immutable_version: 3,
    immutable_checksum: shadowChecksum,
  }]]);
  const goiPhanBo = new Map([[khoa, { allocation_version: 4, allocation_checksum: B64 }]]);
  const cua = (shadowChecksum) => ({
    loadScopes: async () => goi(shadowChecksum),
    loadAllocationScopes: async () => goiPhanBo,
  });
  const dau = {
    remoteProvenance: [`2026-07:CT01:rv=3:rc=${A64}:ca=2026-08-01T00:00:00.000Z`
      + `:sc=${'d'.repeat(64)}:iv=3:ic=${'d'.repeat(64)}:av=4:ac=${B64}`],
  };
  assert.equal(await seal.remoteProvenanceStillValid(dau, cua('d'.repeat(64))), true,
    'y nguyên thì dấu còn dùng được');
  assert.equal(await seal.remoteProvenanceStillValid(dau, cua('e'.repeat(64))), false,
    'envelope đổi (12,5 → 9,5) mà `rc` y nguyên — phải bắt bằng shadow/immutable checksum');
});

/* A14 — BỘ SOI PHẢI HỎI NGUỒN THẬT, KHÔNG HỎI BẢN NHỚ.
 * Bộ soi đi qua đúng `loadScope` mà lượt dựng trước đã ghi vào bộ nhớ. Không bỏ qua bộ
 * nhớ thì nó đọc lại chính bản cũ rồi tự gật — xác nhận chính mình, không hỏi nguồn. */
test('A14 mọi lượt hỏi của bộ soi phải bỏ qua bộ nhớ đệm', async () => {
  const daNhan = [];
  await seal.remoteProvenanceStillValid(
    { remoteProvenance: [`2026-07:CT01:rv=3:rc=${A64}:ca=z:sc=s:iv=3:ic=s:av=4:ac=${B64}`] },
    {
      loadScopes: async (scopes, options) => { daNhan.push(options); return new Map(); },
      loadAllocationScopes: async (scopes, options) => { daNhan.push(options); return new Map(); },
    },
  );
  assert.ok(daNhan.length > 0, 'phải thật sự đi hỏi nguồn');
  assert.ok(daNhan.every((item) => item?.boQuaBoNho === true),
    'bỏ qua bộ nhớ, nếu không bộ soi chỉ đang xác nhận bản cũ của chính nó');
});

/* A15 — LÚC ĐÓNG DẤU LẤY ĐƯỢC, GIỜ HỎI LẠI KHÔNG RA ⇒ KHÔNG kết luận "vẫn đúng". */
test('A15 nguồn im lặng không phải là nguồn xác nhận', async () => {
  const khoa = `2026-07${SEP}CT01`;
  const dau = {
    remoteProvenance: [`2026-07:CT01:rv=3:rc=${A64}:ca=z:sc=s:iv=3:ic=s:av=4:ac=${B64}`],
  };
  assert.equal(await seal.remoteProvenanceStillValid(dau, {
    loadScopes: async () => new Map([[khoa, null]]),
    loadAllocationScopes: async () => new Map(),
  }), false, 'hỏi lại không ra thì dựng lại, đừng gật');
});

/* A16 — HAI CỬA NẠP GÓI PHẢI THẬT SỰ HIỂU `boQuaBoNho`.
 * Ca A14 chỉ kiểm bộ soi có TRUYỀN cờ; ca này kiểm phía nhận có ĐỌC nó. Truyền một cờ
 * mà đầu kia làm ngơ thì cũng như không — đúng kiểu `dangTinCay()` viết ra rồi quên cắm. */
test('A16 loadScope của cả hai module đều phải đọc cờ bỏ qua bộ nhớ', () => {
  for (const ten of ['employeeCostReconciliationShadow', 'employeeCostReconAllocationV4']) {
    const ma = fs.readFileSync(path.join(__dirname, '..', 'src', `${ten}.js`), 'utf8');
    assert.match(ma, /options\.boQuaBoNho/,
      `${ten} phải đọc cờ — truyền cờ mà đầu kia làm ngơ thì bộ soi vẫn đọc bản nhớ`);
    assert.match(ma, /!options\.boQuaBoNho && inFlight\.has\(cacheKey\)/,
      `${ten}: lượt đang bay cũng là bản cũ, cũng phải bỏ qua khi đang soi dấu`);
  }
});

/* A17 — CHỐT CHỐNG "XANH VÌ LÝ DO SAI". Nếu ca kiểm ghép khoá bằng dấu khác bản thật
 * thì mọi phép so đều lệch, nên mọi ca "phải vứt dấu" đều xanh — xanh vì luôn khác
 * nhau, không phải vì hàng rào chạy đúng. Ca này neo cả hai chiều. */
test('A17 đúng dấu phân cách thì KHỚP, sai dấu thì KHÔNG khớp', async () => {
  const dau = {
    remoteProvenance: [`2026-07:CT01:rv=3:rc=${A64}:ca=z:sc=s:iv=3:ic=s:av=4:ac=${B64}`],
  };
  const goi = {
    reconciliation_version: 3, reconciliation_rows_checksum_v2: A64, confirmed_at: 'z',
    shadow_snapshot_checksum: 's', immutable_version: 3, immutable_checksum: 's',
  };
  const phanBo = { allocation_version: 4, allocation_checksum: B64 };
  const cua = (sep) => ({
    loadScopes: async () => new Map([[`2026-07${sep}CT01`, goi]]),
    loadAllocationScopes: async () => new Map([[`2026-07${sep}CT01`, phanBo]]),
  });
  assert.equal(await seal.remoteProvenanceStillValid(dau, cua(SEP)), true,
    'đúng dấu thì phải KHỚP — ca này đỏ nghĩa là mọi ca "phải vứt dấu" khác đang xanh vì lý do sai');
  assert.equal(await seal.remoteProvenanceStillValid(dau, cua('|')), false,
    'sai dấu ⇒ không tách được mã nhà thầu ⇒ phải KHÔNG khớp, không được gật bừa');
});
