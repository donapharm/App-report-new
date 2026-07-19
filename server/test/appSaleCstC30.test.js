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
  decisionNo: 'G3.L1.QĐ141/27.02.25',
  laApThau: false,
  cstFormula: {
    cst30: 90000,
    cstChinh: 300000,
    daGiao: 277500,
    dangChoGiao: 0,
    dieuChuyen: 0,
    trangThai30: 'co_the_mua_them',
  },
  ...extra,
});
const payload = (rows, generatedAt = '2026-07-18T14:00:00.000Z') => ({ rows, generatedAt });

test('normalize phân biệt field CST còn lại bị thiếu với số 0 hợp lệ', () => {
  assert.equal(sourceRow().slConLai, null);
  assert.equal(sourceRow({ slConLai: '   ', slTrungThau: '' }).slConLai, null);
  assert.equal(sourceRow({ slConLai: '   ', slTrungThau: '' }).slTrungThau, null);
  assert.equal(sourceRow({ slConLai: 0 }).slConLai, 0);
  assert.equal(sourceRow({ slConLai: 125 }).slConLai, 125);
  assert.throws(() => sourceRow({ slConLai: 'sai' }), /slConLai không hợp lệ/);
  assert.throws(() => sourceRow({ slTrungThau: 'sai' }), /slTrungThau không hợp lệ/);
});

test('C30 chỉ ghép đúng đơn vị + QLNB + quyết định C8 tuyến CL và CST dưới 10%', () => {
  const result = appSaleCst.enrichCstRowsWithC30([baseCst()], payload([sourceRow()]), { now: NOW, allowPartial: true });
  assert.equal(result.meta.matched, 1);
  assert.equal(result.rows[0].route, 'CL');
  assert.deepEqual(
    {
      option: result.rows[0].c30.option_qty,
      candidate: result.rows[0].c30.candidate,
      actionable: result.rows[0].c30.actionable,
      status: result.rows[0].c30.status_label,
    },
    { option: 90000, candidate: true, actionable: true, status: 'Có thể mua thêm' },
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

test('không ghép khi quyết định C8 không trùng hoặc bị thiếu', () => {
  const wrong = appSaleCst.enrichCstRowsWithC30(
    [baseCst({ bid_package: 'QĐ3231/18.12.23' })],
    payload([sourceRow()]),
    { now: NOW, allowPartial: true },
  );
  const missing = appSaleCst.enrichCstRowsWithC30(
    [baseCst({ bid_package: '' })],
    payload([sourceRow()]),
    { now: NOW, allowPartial: true },
  );
  assert.equal(wrong.rows[0].c30, undefined);
  assert.equal(missing.rows[0].c30, undefined);
});

test('chuẩn hóa dấu chấm/gạch của quyết định nhưng không suy diễn khác quyết định', () => {
  const matched = appSaleCst.enrichCstRowsWithC30(
    [baseCst()], payload([sourceRow({ decisionNo: 'G3 L1 QĐ141 27-02-25' })]), { now: NOW, allowPartial: true },
  );
  assert.equal(matched.rows[0].c30.option_qty, 90000);
});

test('khóa trùng cùng quyết định không được tự chọn để tránh dữ liệu C30 mơ hồ', () => {
  const result = appSaleCst.enrichCstRowsWithC30(
    [baseCst()],
    payload([sourceRow(), sourceRow({ cstFormula: { cst30: 60000, trangThai30: 'co_the_mua_them' } })]),
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

test('danh mục không đổi vẫn sẵn sàng khi S2S vừa kiểm chứng đầy đủ', () => {
  const normalized = appSaleCst.normalizePayload({
    ...payload([sourceRow()], '2026-07-09T09:58:28.729Z'),
    total: 1,
    transportComplete: true,
    coverageReady: true,
  }, 'test-live', { fetchedAt: '2026-07-18T14:25:00.000Z' });
  const freshness = appSaleCst.payloadFreshness(normalized, NOW);
  assert.equal(freshness.generatedAt, '2026-07-09T09:58:28.729Z', 'giữ ngày thay đổi dữ liệu gốc');
  assert.equal(freshness.checkedAt, '2026-07-18T14:25:00.000Z');
  assert.equal(freshness.stale, false, 'freshness phải theo lần S2S thành công');
});

test('cache fallback chỉ được dùng trong 24 giờ từ lần S2S thành công', () => {
  const fresh = appSaleCst.payloadFreshness({
    generatedAt: '2026-07-01T00:00:00.000Z',
    cachedAt: '2026-07-18T14:25:00.000Z',
    rows: [sourceRow()],
  }, NOW);
  const expired = appSaleCst.payloadFreshness({
    generatedAt: '2026-07-01T00:00:00.000Z',
    fetchedAt: '2026-07-17T13:00:00.000Z',
    rows: [sourceRow()],
  }, NOW);
  assert.equal(fresh.stale, false);
  assert.equal(expired.stale, true);
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
  const row = appSaleCst.enrichCstRowsWithC30([baseCst({ remain_pct: 10 })], payload([sourceRow()]), { now: NOW, allowPartial: true }).rows[0];
  assert.equal(row.c30.candidate, false);
  assert.equal(row.c30.actionable, false);
});

test('chỉ C30 thực tế dương từ CP Total mới là việc cần làm', () => {
  const actionable = appSaleCst.enrichCstRowsWithC30([baseCst()], payload([sourceRow()]), { now: NOW, allowPartial: true }).rows[0];
  assert.equal(actionable.c30.actionable, true);
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
    appSaleCst.c30ExportFields({ c30: { option_qty: 90_000, status_label: 'Có thể mua thêm' } }),
    { c30_route: 'CL', c30_option_qty: 90_000, c30_status: 'Có thể mua thêm' },
  );
  assert.deepEqual(
    appSaleCst.c30ExportFields({}),
    { c30_route: '', c30_option_qty: '', c30_status: '' },
  );
});
