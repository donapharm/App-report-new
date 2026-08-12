import test from 'node:test';
import assert from 'node:assert/strict';
import { employeeCostViewModel } from '../src/employeeCostModel.js';

/**
 * ĐỊNH NGHĨA VẬN HÀNH, KHÔNG PHẢI DANH SÁCH TÊN TRƯỜNG.
 *
 * Bot audit đợt 17 vòng 6 đưa cho tôi thứ quý nhất của cả đợt — một phép ĐO thay cho
 * một danh sách:
 *
 *     Số nào ĐỔI GIÁ TRỊ khi giảm một người góp số, thì số đó là TỔNG TOÀN ĐỘI.
 *
 * Họ dò được **112 chỗ đổi, 85 chỗ vẫn còn số**. Danh sách tên trường tôi viết tay bắt
 * được 27. Đây là lần thứ SÁU trong đợt tôi vá cái danh sách thay vì bỏ mô hình danh
 * sách đi: module → file → thư mục → ô hiển thị → cách viết tên → tên trường.
 *
 * Ca kiểm này KHÔNG liệt kê gì cả. Nó dựng hai model — một đủ 21 người, một thiếu một
 * người — rồi **duyệt cả cây** và bắt mọi lá đổi giá trị. Mỗi lá đổi phải hoặc bị chặn,
 * hoặc nằm trong vùng số-của-từng-người. Thêm trường tổng mới ở bất kỳ đâu về sau, ca
 * này tự bắt, không ai phải nhớ quay lại sửa test.
 */

/* Vùng số CỦA TỪNG NGƯỜI — được phép đổi mà không bị chặn, vì đó là số thật của những
 * người ĐÃ có dữ liệu. Bớt một người thì danh sách ngắn đi là đúng, không phải lỗi. */
const VUNG_TUNG_NGUOI = [
  /(^|\.)employeeSubtotals(\.|\[|$)/,
  /(^|\.)employees(\.|\[|$)/,
  /(^|\.)rows(\.|\[|$)/,
  /(^|\.)unavailableEmployees(\.|\[|$)/,
  /(^|\.)staleEmployees(\.|\[|$)/,
  /(^|\.)thieuNguoiCodes(\.|\[|$)/,
];

/* Số ĐẾM và số cấu trúc — đổi là đúng và PHẢI đổi, vì màn hình cần nói "thiếu 1/21".
 * Chặn mấy số này mới là sai: người xem mất luôn thông tin ai vắng. */
const SO_DEM = new Set([
  'unavailableEmployeeCount', 'unavailablePairs', 'staleEmployeeCount', 'contributors',
  'appliedContributors', 'xuContributors', 'unavailableCount', 'employeeCount',
  'xuEmployeeCount', 'matchedRows', 'totalRows', 'rowCount', 'filteredRows',
  'dynamicCount', 'lineCount', 'rate', 'threshold', 'complete', 'thieuNguoi',
  'pageCount', 'page', 'pageSize', 'totalPages',
]);

const laVungTungNguoi = (duong) => VUNG_TUNG_NGUOI.some((mau) => mau.test(duong));

/** Duyệt cả cây, trả về map đường-dẫn → giá trị lá. */
function duyetLa(nut, duong = '$', ra = new Map()) {
  if (nut === null || typeof nut !== 'object') { ra.set(duong, nut); return ra; }
  if (Array.isArray(nut)) {
    nut.forEach((con, i) => duyetLa(con, `${duong}[${i}]`, ra));
    ra.set(`${duong}.length`, nut.length);
    return ra;
  }
  for (const [khoa, con] of Object.entries(nut)) duyetLa(con, `${duong}.${khoa}`, ra);
  return ra;
}

const soTien = (giaTri) => typeof giaTri === 'number' && Number.isFinite(giaTri);
// Chuỗi có định dạng tiền/tỷ lệ: "1.444.932.127đ", "110,9%", "31.812.041 ₫"…
// Số NGẮN cũng là số: bot bắt "95%", "0%", "0 ₫" lọt qua bản `{2,}` trước.
// Ký hiệu tiền đứng TRƯỚC hay SAU đều được — bot bắt `₫1.000`, `VND 1.000`, `12 ngàn`.
const chuoiCoSo = (giaTri) => typeof giaTri === 'string'
  && /\d/.test(giaTri) && /(đ|₫|VND|%|tỷ|triệu|ngàn|nghìn)/i.test(giaTri);

function payload({ thieu = [] } = {}) {
  const gopSo = 21 - thieu.length;
  const heSo = gopSo / 21;
  const tien = (goc) => Math.round(goc * heSo);
  const match = {
    matchedRows: 100, totalRows: 100, rate: 100, threshold: 90,
    unavailableEmployeeCount: thieu.length, unavailableEmployees: thieu,
  };
  const cotTam = {
    c36: tien(123_136_637), c41: tien(90_000_000), c43: tien(12_000_000),
    c44: tien(6_000_000), c45: tien(7_599_706),
  };
  const tomTat = () => ({
    reliable: true, annualLabels: ['C44'],
    monthlyTotal: tien(30_982_248_913), periodTotal: tien(30_982_248_913),
    provisionalMonthlyTotal: tien(1_444_932_127), provisionalPeriodTotal: tien(1_444_932_127),
    annualTotal: tien(500_000_000), provisionalAnnualTotal: tien(500_000_000),
    columnTotals: { ...cotTam }, provisionalColumnTotals: { ...cotTam },
  });
  return {
    empCode: 'ALL', allEmployees: true, from: '2026-07', to: '2026-07',
    match,
    summary: tomTat(),
    penalty: {
      aggregate: true, employeeCount: 21, contributors: gopSo, complete: thieu.length === 0,
      total: tien(458_482), provisionalTotal: tien(458_482),
      baseTotal: tien(30_982_248_913), afterPenaltyTotal: tien(30_981_790_431),
      c45Amount: tien(7_599_706), provisionalC45Amount: tien(7_599_706),
      targetAmount: tien(11_527_638_470), provisionalTargetAmount: tien(11_527_638_470),
      xuAmount: tien(1_800_000), provisionalXuAmount: tien(1_800_000),
      appliedAmount: tien(458_482),
    },
    bonus: {
      configured: true,
      month: { amount: tien(31_812_041), base: tien(22_194_285), priority: tien(9_617_756) },
      quarter: { amount: tien(3_373_262) },
    },
    target: { available: true, month: { target: tien(11_527_638_470), achieved: tien(12_783_190_669), pct: 110.9 * heSo } },
    /* Tên trường lấy đúng bản THẬT của model (đã dump ra để xem), không đoán. Đoán sai
     * thì model chuẩn hoá về `undefined` và ca kiểm xanh vì không có gì để so — đúng
     * kiểu "xanh vì lý do sai" đã dính ba lần trong đợt này. */
    paymentTeam: {
      period: '2026-07', invariantOk: true, rows: [], excluded: [],
      totals: {
        employees: gopSo,
        total: tien(30_982_248_913), received: tien(30_500_000_000),
        outstanding: tien(400_000_000), firstAdvance: tien(300_000_000),
        second: tien(200_000_000), final: tien(100_000_000), c44: tien(6_000_000),
        employeesWithoutFirstAdvance: 3, overdueEmployees: 2,
        overdueAmount: tien(50_000_000),
      },
    },
    healthKpis: {
      period: '2026-07', today: '2026-08-12', backendOwned: true,
      cards: [{
        key: 'costRevenueRatio', label: 'Tỷ lệ chi phí/doanh thu',
        value: `${(4.7 * heSo).toFixed(1)}%`,
        sub: `trên ${gopSo} NV`, tone: heSo === 1 ? 'ok' : 'warn',
      }, {
        // Tiền/tỷ lệ dạng NGẮN — bot bắt "95%", "0%", "0 ₫" lọt qua regex `{2,}` cũ.
        key: 'targetCoverage', label: 'Phủ target',
        value: `${Math.round(95 * heSo)}%`, sub: '', tone: 'ok',
      }, {
        key: 'conLai', label: 'Còn lại', value: `${thieu.length === 0 ? 0 : 9} ₫`, sub: '', tone: 'ok',
      }, {
        // Đúng chuỗi bot chụp được trên màn.
        key: 'tongDong', label: 'Tổng', value: `${tien(1_000_000)}đ · ${gopSo * 100} dòng`, sub: '', tone: 'ok',
      }, {
        key: 'doanhSo', label: 'Doanh số', value: `${(30.9 * heSo).toFixed(1)} tỷ`, sub: '', tone: 'ok',
      }, {
        // Bốn dạng bot bắt ở vòng 9 — ký hiệu tiền đứng TRƯỚC số, và đơn vị "ngàn".
        key: 'kyHieuTruoc', label: 'Ký hiệu trước', value: `₫${tien(1_000)}`, sub: '', tone: 'ok',
      }, {
        key: 'vndTruoc', label: 'VND trước', value: `VND ${tien(1_000)}`, sub: '', tone: 'ok',
      }, {
        key: 'vndSau', label: 'VND sau', value: `${tien(1_000)} VND`, sub: '', tone: 'ok',
      }, {
        key: 'ngan', label: 'Ngàn', value: `${tien(12)} ngàn`, sub: '', tone: 'ok',
      }],
    },
    revenueRecon: { total: tien(32_000_000_000), shown: tien(32_000_000_000), gap: 0, balanced: true },
    search: { query: '', filteredRows: 2091, totalRows: 2091 },
    periods: [{
      period: '2026-07', columns: [], rows: [],
      summary: tomTat(),
      match: { ...match },
      employeeSubtotals: Array.from({ length: gopSo }, (unused, i) => ({
        employeeCode: `DN${String(i + 1).padStart(3, '0')}`, employeeName: `NV ${i + 1}`,
        rowCount: 1, monthlyTotal: 1_000_000,
      })),
      /* Bộ đếm PHẢI sống sót — bot bắt bản trước chặn oan `pageCount` và bốn bộ đếm.
       * `pageCount` nằm ở `pagination` của TỪNG KỲ, không phải `search` — đã dump hình
       * thật ra để xem, không đoán. */
      pagination: { page: 2, pageSize: 50, pageCount: 7, filteredRows: 2091, totalRows: 2091 },
      daily: {
        reliable: true, dates: ['2026-07-01'],
        totals: [{ date: '2026-07-01', monthlyTotal: tien(9_000_000) }],
      },
    }],
  };
}

test('PHÉP ĐO: mọi số đổi khi giảm một NV đều phải bị chặn — trừ số của từng người và số đếm', () => {
  const du = duyetLa(employeeCostViewModel(payload()));
  const thieu = duyetLa(employeeCostViewModel(payload({ thieu: ['DN021'] })));

  const conSo = [];
  for (const [duong, giaTriDu] of du) {
    const giaTriThieu = thieu.get(duong);
    if (giaTriDu === giaTriThieu) continue;              // không đổi ⇒ không phải tổng đội
    if (laVungTungNguoi(duong)) continue;                // số của từng người, được phép
    const ten = duong.split('.').pop().replace(/\[\d+\]$/, '');
    if (SO_DEM.has(ten) || ten === 'length') continue;   // số đếm, PHẢI đổi
    if (!soTien(giaTriThieu) && !chuoiCoSo(giaTriThieu)) continue; // đã chặn rồi
    conSo.push(`${duong}: đủ=${giaTriDu} → thiếu=${giaTriThieu}`);
  }

  assert.deepEqual(conSo, [],
    'Còn số TỔNG ĐỘI chưa chặn. Định nghĩa: số nào đổi khi giảm một người góp thì là tổng đội.\n'
    + conSo.join('\n'));
});

test('RANH GIỚI: đủ người thì không số nào bị chặn oan', () => {
  const model = employeeCostViewModel(payload());
  assert.equal(model.thieuNguoi, false);
  assert.equal(model.summary.periodTotal, 30_982_248_913);
  assert.equal(model.paymentTeam.totals.total, 30_982_248_913);
  assert.equal(model.healthKpis.cards[0].value, '4.7%');
  assert.equal(model.bonus.month.amount, 31_812_041);
});

test('RANH GIỚI: bộ đếm và số trang KHÔNG được chặn oan khi thiếu người', () => {
  const model = employeeCostViewModel(payload({ thieu: ['DN021'] }));
  const trang = model.periods[0].pagination;
  // Bot chụp được: trang thật 2/7 biến thành 2/1 và nút "Sang trang" bị khoá.
  assert.equal(trang.page, 2, 'đang ở trang 2 thì phải còn là trang 2');
  assert.equal(trang.pageCount, 7, 'trang 2/7 thành 2/1 là khoá luôn nút Sang trang');
  assert.equal(trang.pageSize, 50, 'mất cỡ trang thì bảng vỡ');
  assert.equal(trang.totalRows, 2091, 'vẫn phải biết bảng có bao nhiêu dòng');
  assert.equal(model.search.totalRows, 2091, 'ô tìm kiếm cũng cần số dòng');
  assert.equal(model.match.unavailableEmployeeCount, 1, 'và vẫn phải nói được thiếu mấy người');
  // Hai bộ đếm bot thấy biến mất trên màn: "2 NV quá hạn", "3 NV chưa ứng".
  const tong = model.paymentTeam.totals;
  assert.equal(tong.overdueEmployees, 2, '"2 NV quá hạn" không được biến mất');
  assert.equal(tong.employeesWithoutFirstAdvance, 3, '"3 NV chưa ứng" không được biến mất');
  assert.equal(tong.employees, 20, 'số người có số vẫn phải đọc được');
});

test('RANH GIỚI: số của TỪNG NGƯỜI và số ĐẾM phải sống sót khi thiếu người', () => {
  const model = employeeCostViewModel(payload({ thieu: ['DN021'] }));
  const phu = model.periods[0].employeeSubtotals;
  assert.equal(phu.length, 20, 'còn 20 người có số thì phải liệt kê đủ 20');
  assert.equal(phu[0].monthlyTotal, 1_000_000, 'số của chính người đó — chặn đi là giấu dữ liệu đang có');
  assert.equal(model.match.unavailableEmployeeCount, 1, 'phải đếm được thiếu mấy người');
  assert.deepEqual(model.match.unavailableEmployees, ['DN021'], 'và phải nói được thiếu AI');
  assert.equal(model.penalty.employeeCount, 21, 'ngưỡng của kỳ vẫn phải đọc được');
});
