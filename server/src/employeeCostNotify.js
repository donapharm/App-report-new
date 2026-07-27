'use strict';
/**
 * employeeCostNotify — tin "tổng chi phí bán hàng bạn nhận" (CEO chốt 2026-07-27).
 *
 * ‼ NGOẠI LỆ CÓ KIỂM SOÁT của luật "báo cáo không chứa chi phí":
 *   - SELF-SCOPED tuyệt đối: mỗi NV chỉ nhận số CỦA CHÍNH MÌNH.
 *   - KHÔNG có bản tổng cho CEO/admin qua kênh này (muốn xem tổng thì mở app).
 *   - Số do DataHub tính (SSOT); module này chỉ định dạng chữ, không tự tính tiền.
 *
 * ‼ CEO chốt: khi số còn TẠM TÍNH (chưa gán đủ %) thì VẪN gửi, nhưng BẮT BUỘC
 *   gắn nhãn TẠM TÍNH + nêu còn bao nhiêu mã chờ gán %. Không được gửi trần trụi.
 */
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'notif_cost_state.json');

const moneyShort = (n) => `${Math.round(Number(n || 0)).toLocaleString('vi-VN')}đ`;
// ‼ PHẢI chặn null/'' trước: Number(null) === 0 trong JS, nên nếu dùng thẳng
//   Number.isFinite(Number(v)) thì tổng bị KHÓA fail-closed (null) sẽ biến thành
//   "0đ" và gửi cho NV — đúng thứ tuyệt đối không được xảy ra.
const finite = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const dayText = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}` : String(iso || '');
};

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch { return {}; } };
const writeState = (o) => { try { fs.writeFileSync(STATE_FILE, JSON.stringify(o, null, 2), 'utf8'); } catch { /* ignore */ } };

function sentKey(kind, periodKey, empCode) {
  return `${kind}|${periodKey}|${String(empCode || '').toUpperCase()}`;
}
function alreadySent(kind, periodKey, empCode) {
  return !!readState()[sentKey(kind, periodKey, empCode)];
}
function markSent(kind, periodKey, empCode) {
  const state = readState();
  state[sentKey(kind, periodKey, empCode)] = new Date().toISOString();
  writeState(state);
}

/**
 * Rút gọn summary của employeeCostTable.transformReport thành thứ cần để nhắn.
 *  - reliable  -> dùng periodTotal (số đã chốt)
 *  - !reliable -> dùng provisionalPeriodTotal và BẮT BUỘC gắn nhãn tạm tính
 * Trả null khi không có số nào dùng được -> nơi gọi bỏ qua, không gửi "0đ".
 */
function totalFromSummary(summary = {}) {
  const reliable = summary.reliable !== false;
  const settled = finite(summary.periodTotal);
  const provisional = finite(summary.provisionalPeriodTotal);
  const amount = reliable && settled != null ? settled : provisional;
  if (amount == null) return null;
  return { amount, provisional: !reliable };
}

/**
 * Tin gửi 1 NV.
 *   kind: 'week' (lũy kế từ đầu tháng) | 'month' (trọn tháng)
 *   row : { emp_code, name, ky, from, to }
 *   total: kết quả totalFromSummary
 *   gaps : { pairs } số DÒNG (cặp đơn vị×mặt hàng) còn chờ gán %.
 *          Cố ý dùng "dòng" chứ không phải "mã": payload.match chỉ có
 *          matchedRows/totalRows, không có số mã gộp. Gọi đúng tên con số mình
 *          thực sự có, tránh lặp lại vụ lẫn lộn "13 mã" với "192 cặp".
 */
function messageFor({ kind, row = {}, total, gaps = {} } = {}) {
  if (!total) return null;
  const monthNo = String(row.ky || '').split('.')[0];
  const who = row.name || row.emp_code;
  const scope = kind === 'month'
    ? `Trọn tháng ${monthNo}`
    : `Lũy kế từ ${dayText(row.from)} đến ${dayText(row.to)}`;
  const lines = [
    `💰 [Tháng ${monthNo}] ${who} — tổng chi phí bán hàng bạn nhận`,
    `${scope}: ${moneyShort(total.amount)}`,
  ];
  if (total.provisional) {
    const pairs = finite(gaps.pairs);
    const detail = pairs > 0 ? ` — còn ${pairs.toLocaleString('vi-VN')} dòng chưa được gán tỷ lệ %` : '';
    lines.push(`⚠ TẠM TÍNH${detail}. Số cuối kỳ có thể thay đổi.`);
  }
  return lines.join('\n');
}

/** Tin báo khi KHÔNG lấy được nguồn chi phí của chính NV đó (fail-closed, không nêu số). */
function unavailableMessageFor(row = {}) {
  const monthNo = String(row.ky || '').split('.')[0];
  return `⚠ [Tháng ${monthNo}] ${row.name || row.emp_code}: hiện chưa lấy được dữ liệu chi phí của bạn nên `
    + 'chưa chốt được số. Đây là lỗi nguồn dữ liệu, KHÔNG phải bạn không có chi phí. '
    + 'Hệ thống sẽ báo lại khi có số.';
}

function subjectFor(kind, row = {}) {
  const monthNo = String(row.ky || '').split('.')[0];
  return kind === 'month'
    ? `DONAPHARM — Tổng chi phí tháng ${monthNo} (${row.emp_code})`
    : `DONAPHARM — Tổng chi phí lũy kế tháng ${monthNo} (${row.emp_code})`;
}

function htmlFor(text) {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = esc(text).split('\n').map((line) => `<p style="margin:6px 0">${line}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>`
    + `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:20px;`
    + `border:1px solid #d8eeee;border-radius:14px;color:#163235">${body}`
    + `<p style="font-size:12px;color:#667;margin-top:16px">Số của riêng bạn. `
    + `Nguồn: hệ thống nội bộ DONAPHARM.</p></div></body></html>`;
}

module.exports = {
  STATE_FILE,
  sentKey,
  alreadySent,
  markSent,
  totalFromSummary,
  messageFor,
  unavailableMessageFor,
  subjectFor,
  htmlFor,
};
