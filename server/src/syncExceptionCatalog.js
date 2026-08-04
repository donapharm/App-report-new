'use strict';
/**
 * DANH MỤC LÝ DO "CHƯA ĐỒNG BỘ" (SPEC_REVENUE_SYNC_EXCEPTIONS.md §2)
 *
 * Nguyên tắc số một của CEO: **KHÔNG DÒNG NÀO ĐƯỢC BIẾN MẤT LẶNG LẼ.**
 * Mỗi mã lý do BẮT BUỘC đủ 3 thứ — nghĩa · AI XỬ LÝ · LÀM GÌ. Cấm lý do chung
 * chung kiểu "không hợp lệ": người đọc phải làm được ngay, không phải đi hỏi.
 *
 * Đây là HỢP ĐỒNG giữa bên phân loại (materializer trên máy chủ) và màn hình.
 * Bot chỉ cần gắn đúng `code`; nghĩa/ai/làm gì lấy từ đây, không viết lại ở UI.
 */

// Bị LOẠI khỏi doanh thu — tiền không được tính.
const EXCLUDED = 'excluded';
// VÀO ĐỦ TIỀN nhưng thiếu thông tin ⇒ rơi khỏi bộ lọc. Nguy hiểm vì nhìn tổng thì
// đúng, lọc ra thì mất (vụ 175.BVĐK Vũng Tàu — 275,9 triệu).
const INCOMPLETE = 'incomplete';
// Chỉ ghi chú để theo dõi — VẪN TÍNH tiền.
const NOTE = 'note';

const CATALOG = Object.freeze({
  // ── CRM MISA ──────────────────────────────────────────────────────────────
  MISA_CHUA_GHI_DOANH_SO: { group: EXCLUDED, source: 'CRM_MISA', meaning: 'Bucket ngoài official/pending', owner: 'Kế toán', action: 'Ghi doanh số, hoặc xác nhận huỷ' },
  MISA_THIEU_NGAY_DOANH_THU: { group: EXCLUDED, source: 'CRM_MISA', meaning: 'Đã ghi doanh số, có tiền, nhưng thiếu ngày ghi doanh thu', owner: 'Kế toán MISA', action: 'Nhập ngày ghi doanh thu' },
  MISA_NGAY_NGOAI_KY: { group: NOTE, source: 'CRM_MISA', meaning: 'Ngày doanh thu thuộc kỳ khác', owner: '—', action: 'Chỉ để biết, sẽ vào kỳ của nó' },
  MISA_NGHI_DON_TEST: { group: EXCLUDED, source: 'CRM_MISA', meaning: 'Bị nghi là đơn test', owner: 'App Sale', action: 'Xác nhận thật/test rồi gỡ cờ' },
  MISA_TIEN_BANG_0: { group: EXCLUDED, source: 'CRM_MISA', meaning: 'Thành tiền bằng 0', owner: 'Kế toán', action: 'Kiểm lại đơn giá / số lượng' },
  // ── APP WEB đối tác ───────────────────────────────────────────────────────
  WEB_CHUA_CO_PHAN_HOI: { group: EXCLUDED, source: 'APP_WEB', meaning: 'Đối tác chưa phản hồi đơn', owner: 'NV phụ trách', action: 'Nhắc đối tác phản hồi' },
  WEB_GIAO_BANG_0: { group: EXCLUDED, source: 'APP_WEB', meaning: 'Có phản hồi nhưng số lượng giao bằng 0', owner: 'NV phụ trách', action: 'Xác nhận đã giao hay huỷ' },
  WEB_DON_TEST: { group: EXCLUDED, source: 'APP_WEB', meaning: 'Đơn gắn cờ test và chưa phản hồi', owner: 'App Sale', action: 'Gỡ cờ test' },
  WEB_NGAY_NGOAI_KY: { group: NOTE, source: 'APP_WEB', meaning: 'Ngày quy kỳ thuộc kỳ khác', owner: '—', action: 'Chỉ để biết' },
  WEB_SAI_NHOM: { group: EXCLUDED, source: 'APP_WEB', meaning: 'Nhóm đơn không phải PARTNER', owner: 'App Sale', action: 'Kiểm lại phân loại đơn' },
  WEB_HOLD_GOLIVE_DA_GIAO: { group: NOTE, source: 'APP_WEB', meaning: 'Đơn HOLD_GOLIVE nhưng đã giao thực — VẪN TÍNH tiền', owner: '—', action: 'Chỉ theo dõi, không phải lỗi' },
  // ── Vào đủ tiền nhưng THIẾU THÔNG TIN ────────────────────────────────────
  DON_VI_THIEU_DANH_MUC: { group: INCOMPLETE, source: '*', meaning: 'Mã đơn vị không có trong danh mục ⇒ mất tỉnh ⇒ biến mất khi lọc theo tỉnh', owner: 'DataHub / App Report', action: 'Thêm mã đơn vị vào danh mục' },
  MA_HANG_THIEU_DANH_MUC: { group: INCOMPLETE, source: '*', meaning: 'Mã QLNB không có trong danh mục', owner: 'DataHub', action: 'Thêm mã hàng' },
  NV_XUNG_DOT_ROSTER: { group: INCOMPLETE, source: '*', meaning: 'Mã nhân viên không khớp roster ⇒ dồn về UNALLOCATED', owner: 'Nhân sự', action: 'Sửa phân công' },
});

const GROUPS = Object.freeze({ EXCLUDED, INCOMPLETE, NOTE });

function describe(code) {
  const key = String(code || '').trim().toUpperCase();
  const item = CATALOG[key];
  if (item) return { code: key, known: true, ...item };
  // ‼ Mã lạ KHÔNG được nuốt. Hiện ra để người ta biết có thứ chưa khai báo —
  // đúng tinh thần "không dòng nào biến mất lặng lẽ".
  return {
    code: key || 'KHONG_RO', known: false, group: EXCLUDED, source: '*',
    meaning: 'Mã lý do chưa khai báo trong danh mục',
    owner: 'App Report', action: 'Khai báo mã lý do này vào syncExceptionCatalog.js',
  };
}

const isExcluded = (code) => describe(code).group === EXCLUDED;
const codes = () => Object.keys(CATALOG);

module.exports = { CATALOG, GROUPS, EXCLUDED, INCOMPLETE, NOTE, describe, isExcluded, codes };
