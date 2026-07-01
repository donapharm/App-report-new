/**
 * ords.js — Adapter ORDS/Lumos (fallback doanh thu/target khi kỳ chưa có upload).
 *
 * MẶC ĐỊNH TẮT. Bật bằng env ORDS_SQL_API (chạy trên server nội bộ có mạng tới ORDS).
 * KHÔNG test được từ máy ngoài mạng công ty — đây là code sẵn để dev bật + kiểm trên server.
 *
 * Ghi chú cho người bật (TODO(LIVE)):
 *  - Xác nhận đúng format body/He của ORDS SQL API của công ty.
 *  - Xác nhận tên bảng/cột: SALES_REPORT / PHARMA_NEW.SALES_REPORT / V_TEM_TARGET_BONUS.
 *  - Thêm xác thực (basic/bearer) nếu ORDS yêu cầu (ORDS_AUTH).
 */
const SQL_API = process.env.ORDS_SQL_API || '';
const AUTH = process.env.ORDS_AUTH || ''; // ví dụ "Basic xxx" hoặc "Bearer xxx"

function isEnabled() { return !!SQL_API; }

// Cache kết quả theo kỳ để getRows (đồng bộ) đọc được sau khi warm.
const _cache = new Map(); // ky -> rows[]
const _pending = new Set();

// Chuẩn hoá 1 dòng ORDS về ReportRow của app.
function mapRow(r, ky) {
  return {
    ky,
    date: r.NGAY || r.DATE || ky,
    emp_code: String(r.EMP_NUMBER || r.MA_NV || r.EMP_CODE || '').trim().toUpperCase(),
    unit_code: r.DONVI || r.MA_DV || r.UNIT_CODE || null,
    unit_name: r.TEN_DV || r.TEN_VT || r.UNIT_NAME || null,
    iit_code: r.IIT_CODE || r.QLNB || null,
    product_name: r.TEN_THUOC || r.PRODUCT_NAME || null,
    quantity: Number(r.SO_LUONG || r.QUANTITY || 0),
    revenue: Number(r.REVENUE || r.TONG_TIEN || 0),
    bid_package: r.GOI_THAU || r.BID_PACKAGE || null,
    contractor_code: r.NCC || r.CONTRACTOR_CODE || null,
  };
}

/** Gọi ORDS lấy doanh thu 1 kỳ (async). Trả rows[] hoặc [] nếu lỗi. */
async function queryRows(ky) {
  if (!isEnabled()) return [];
  // ky dạng MM.YYYY -> tháng/năm
  const [mm, yyyy] = ky.split('.');
  const sql =
    `SELECT EMP_NUMBER, DONVI, TEN_DV, IIT_CODE, TEN_THUOC, SO_LUONG, REVENUE, GOI_THAU ` +
    `FROM SALES_REPORT ` +
    `WHERE EXTRACT(MONTH FROM NGAY)=${Number(mm)} AND EXTRACT(YEAR FROM NGAY)=${Number(yyyy)}`;
  try {
    const res = await fetch(SQL_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(AUTH ? { authorization: AUTH } : {}) },
      body: JSON.stringify({ statementText: sql, limit: 100000 }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    // ORDS SQL API thường trả { items: [{ resultSet: { items: [...] } }] } — dò linh hoạt:
    const items =
      data?.items?.[0]?.resultSet?.items ||
      data?.resultSet?.items ||
      data?.items ||
      [];
    return items.map((r) => mapRow(r, ky));
  } catch {
    return [];
  }
}

/** Đọc đồng bộ từ cache; nếu chưa có thì kích hoạt warm (không chặn) và trả []. */
function getRowsSyncCached(ky) {
  if (_cache.has(ky)) return _cache.get(ky);
  if (!_pending.has(ky)) {
    _pending.add(ky);
    queryRows(ky).then((rows) => { _cache.set(ky, rows); _pending.delete(ky); }).catch(() => _pending.delete(ky));
  }
  return [];
}

module.exports = { isEnabled, queryRows, getRowsSyncCached };
