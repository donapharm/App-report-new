const test = require('node:test');
const assert = require('node:assert/strict');
const appSaleCst = require('../src/appSaleCst');

const NOW = Date.parse('2026-07-18T14:30:00.000Z');
const baseCst = (extra = {}) => ({
  unit_code: '002.BVĐK Thống Nhất ĐN',
  iit_code: 'G3.ĐY.QĐ141.145.N3.133',
  bid_package: 'G3.L1.QĐ141/27.02.25',
  remain_pct: 7.5,
  remain_qty: 22500,
  ...extra,
});
const sourceRow = (extra = {}) => appSaleCst.normalizeRow({
  unitCode: '002.BVĐK Thống Nhất ĐN',
  productCode: 'G3.ĐY.QĐ141.145.N3.133',
  route: 'CL',
  kyThau: '2025-2026',
  contractFrom: '2025-02-27T00:00:00.000Z',
  contractTo: '2027-02-27T00:00:00.000Z',
  laApThau: false,
  cstFormula: {
    cst30: 90000,
    cstChinh: 300000,
    daGiao: 277500,
    dangChoGiao: 0,
    dieuChuyen: 0,
    trangThai30: 'chua_du_dk',
  },
  ...extra,
});
const payload = (rows, generatedAt = '2026-07-18T14:00:00.000Z') => ({ rows, generatedAt });

test('C30 chỉ ghép đúng đơn vị + QLNB + kỳ thầu tuyến CL và CST dưới 10%', () => {
  const result = appSaleCst.enrichCstRowsWithC30([baseCst()], payload([sourceRow({ cstFormula: { cst30: 90000, trangThai30: 'du_dk_cho_ky' } })]), { now: NOW, allowPartial: true });
  assert.equal(result.meta.matched, 1);
  assert.equal(result.rows[0].route, 'CL');
  assert.deepEqual(
    {
      max: result.rows[0].c30.max_qty,
      candidate: result.rows[0].c30.candidate,
      actionable: result.rows[0].c30.actionable,
      status: result.rows[0].c30.status_label,
    },
    { max: 90000, candidate: true, actionable: true, status: 'Đủ điều kiện · chờ ký' },
  );
});

test('không suy diễn C30 đã dùng/còn lại từ daGiao hoặc CST chính', () => {
  const row = appSaleCst.enrichCstRowsWithC30([baseCst()], payload([sourceRow()]), { now: NOW, allowPartial: true }).rows[0];
  assert.equal(row.c30.used_qty, null);
  assert.equal(row.c30.remaining_qty, null);
  assert.equal(row.c30.delivered_qty, 277500);
});

test('nhận C30 đã dùng/còn lại khi nguồn trả field tường minh', () => {
  const src = sourceRow({ c30Used: 12000, c30Remaining: 78000 });
  const row = appSaleCst.enrichCstRowsWithC30([baseCst()], payload([src]), { now: NOW, allowPartial: true }).rows[0];
  assert.equal(row.c30.used_qty, 12000);
  assert.equal(row.c30.remaining_qty, 78000);
});

test('không ghép tuyến ngoài CL, áp thầu hoặc sai đúng khóa', () => {
  const rows = [
    sourceRow({ route: 'NCL' }),
    sourceRow({ laApThau: true }),
    sourceRow({ productCode: 'QLNB-KHAC' }),
  ];
  const result = appSaleCst.enrichCstRowsWithC30([baseCst()], payload(rows), { now: NOW, allowPartial: true });
  assert.equal(result.rows[0].c30, undefined);
  assert.equal(result.meta.matched, 0);
});

test('không ghép hai đơn vị chỉ trùng tiền tố ba số', () => {
  const result = appSaleCst.enrichCstRowsWithC30(
    [baseCst({ unit_code: '002.BỆNH VIỆN KHÁC' })],
    payload([sourceRow()]),
    { now: NOW, allowPartial: true },
  );
  assert.equal(result.rows[0].c30, undefined);
});

test('không ghép khi kỳ thầu/hợp đồng không tương thích hoặc thiếu kỳ', () => {
  const wrong = appSaleCst.enrichCstRowsWithC30(
    [baseCst({ bid_package: 'QĐ3231/18.12.23' })],
    payload([sourceRow({ kyThau: '2025-2026' })]),
    { now: NOW, allowPartial: true },
  );
  const missing = appSaleCst.enrichCstRowsWithC30(
    [baseCst({ bid_package: '' })],
    payload([sourceRow({ kyThau: '2025-2026' })]),
    { now: NOW, allowPartial: true },
  );
  assert.equal(wrong.rows[0].c30, undefined);
  assert.equal(missing.rows[0].c30, undefined);
});

test('không ghép khi nguồn thiếu ngày hợp đồng hoặc hợp đồng đã hết hiệu lực', () => {
  const missingDates = appSaleCst.enrichCstRowsWithC30(
    [baseCst()],
    payload([sourceRow({ contractFrom: null, contractTo: null })]),
    { now: NOW, allowPartial: true },
  );
  const expired = appSaleCst.enrichCstRowsWithC30(
    [baseCst()],
    payload([sourceRow({ contractFrom: '2025-01-01', contractTo: '2026-06-30' })]),
    { now: NOW, allowPartial: true },
  );
  assert.equal(missingDates.rows[0].c30, undefined);
  assert.equal(expired.rows[0].c30, undefined);
});

test('khóa trùng nhiều kỳ không được tự chọn để tránh gắn nhầm hợp đồng', () => {
  const result = appSaleCst.enrichCstRowsWithC30(
    [baseCst()],
    payload([sourceRow({ kyThau: '2025-2026' }), sourceRow({ kyThau: '2025-2027' })]),
    { now: NOW, allowPartial: true },
  );
  assert.equal(result.rows[0].c30, undefined);
  assert.equal(result.meta.ambiguous, 1);
});

test('nguồn quá hạn bị chặn, không hiển thị C30 cũ cho nhân viên', () => {
  const result = appSaleCst.enrichCstRowsWithC30(
    [baseCst()],
    payload([sourceRow()], '2026-07-09T09:58:28.729Z'),
    { now: NOW, allowPartial: true },
  );
  assert.equal(result.meta.stale, true);
  assert.equal(result.rows[0].c30, undefined);
});

test('nguồn ít dòng bất thường bị chặn dù timestamp còn mới', () => {
  const result = appSaleCst.enrichCstRowsWithC30(
    [baseCst()],
    payload([sourceRow()]),
    { now: NOW },
  );
  assert.equal(result.meta.complete, false);
  assert.equal(result.rows[0].c30, undefined);
});

test('nguồn chỉ ready khi tải đủ trang, đạt độ phủ và đủ số dòng tối thiểu', () => {
  const rows = Array.from({ length: appSaleCst.SOURCE_MIN_ROWS }, () => ({}));
  assert.equal(appSaleCst.payloadFreshness({ generatedAt: '2026-07-18T14:00:00.000Z', rows, transportComplete: true, coverageReady: true }, NOW).complete, true);
  assert.equal(appSaleCst.payloadFreshness({ generatedAt: '2026-07-18T14:00:00.000Z', rows, transportComplete: false, coverageReady: true }, NOW).complete, false);
  assert.equal(appSaleCst.payloadFreshness({ generatedAt: '2026-07-18T14:00:00.000Z', rows, transportComplete: true, coverageReady: false }, NOW).complete, false);
});

test('S2S tải đủ các trang và từ chối total thay đổi giữa chừng', async () => {
  const oldFetch = global.fetch;
  try {
    global.fetch = async (url) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      const rows = offset === 0 ? Array.from({ length: 500 }, (_, i) => ({ id: i })) : [{ id: 500 }];
      return { ok: true, json: async () => ({ generatedAt: '2026-07-18T14:00:00.000Z', total: 501, coverageReady: true, rows }) };
    };
    const payload = await appSaleCst.fetchAllPages({});
    assert.equal(payload.rows.length, 501);
    assert.equal(payload.transportComplete, true);

    global.fetch = async (url) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      return { ok: true, json: async () => ({ total: offset === 0 ? 501 : 502, coverageReady: true, rows: offset === 0 ? Array(500).fill({}) : [{}] }) };
    };
    await assert.rejects(() => appSaleCst.fetchAllPages({}), /total thay đổi/);
  } finally {
    global.fetch = oldFetch;
  }
});

test('CST từ 10% trở lên có metadata C30 nhưng không trở thành việc cần làm', () => {
  const row = appSaleCst.enrichCstRowsWithC30([baseCst({ remain_pct: 10 })], payload([sourceRow({ cstFormula: { cst30: 90000, trangThai30: 'du_dk_cho_ky' } })]), { now: NOW, allowPartial: true }).rows[0];
  assert.equal(row.c30.candidate, false);
  assert.equal(row.c30.actionable, false);
});

test('chỉ du_dk_cho_ky là việc cần làm; chưa đủ điều kiện và đã ký đều fail-closed', () => {
  for (const status of ['chua_du_dk', 'da_ky_hieu_luc', '', 'khong_ap_dung']) {
    const row = appSaleCst.enrichCstRowsWithC30(
      [baseCst()],
      payload([sourceRow({ cstFormula: { cst30: 90000, trangThai30: status } })]),
      { now: NOW, allowPartial: true },
    ).rows[0];
    assert.equal(row.c30.actionable, false, status || '<empty>');
  }
});

test('mapping Excel CST giữ đúng C30 nguồn và để trống field chưa có dữ liệu', () => {
  assert.deepEqual(
    appSaleCst.c30ExportFields({ c30: { max_qty: 90_000, used_qty: null, remaining_qty: 12_000, status_label: 'Đủ điều kiện · chờ ký' } }),
    { c30_route: 'CL', c30_max_qty: 90_000, c30_used_qty: '', c30_remaining_qty: 12_000, c30_status: 'Đủ điều kiện · chờ ký' },
  );
  assert.deepEqual(
    appSaleCst.c30ExportFields({}),
    { c30_route: '', c30_max_qty: '', c30_used_qty: '', c30_remaining_qty: '', c30_status: '' },
  );
});
