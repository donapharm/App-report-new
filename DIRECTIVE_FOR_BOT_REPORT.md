# CHỈ THỊ CHO BOT REPORT

> File này là **mệnh lệnh/đề xuất** từ phiên Claude đã build App Report, gửi cho bot report (hoặc bất kỳ phiên Claude nào) làm tiếp. Đọc `CLAUDE.md` + `HANDOFF.md` trước, rồi theo đúng chỉ thị dưới đây.

## Nguyên tắc BẤT DI BẤT DỊCH (không được vi phạm)
1. **Quyền quyết ở BACKEND.** Mọi truy vấn đi qua `auth.scopeOf(session)`. NV sale chỉ thấy dữ liệu `emp_code` của mình. KHÔNG chuyển logic quyền ra frontend.
2. **KHÔNG hardcode PII/danh sách nhân viên** trong bundle frontend.
3. **AI không bịa số.** Số do `analytics.js`/`smart.js` tính. LLM chỉ diễn giải trên FACTS đã tính (`llm.js`). Không đưa dữ liệu thô cho LLM.
4. **Export đi qua backend** + kiểm quyền.
5. **KHÔNG mở lại** các nghiệp vụ đã cắt (VAT, Fleet/Drive, Kho master, Điều chuyển NV, gửi thưởng tự động). App Report chỉ đọc/hiển thị báo cáo.
6. **KHÔNG đụng hệ thống app CŨ đang chạy** ở server Linux khi chưa được CEO đồng ý.

## Việc PHẢI làm, theo thứ tự ưu tiên
1. **Nối dữ liệu thật (3 dây `// TODO(LIVE)`):**
   - `store.getRows()` đọc slot `active` trong `upload_slots.json` thay cho `report_rows.json` mẫu.
   - `auth.js`: thay `mockLogin` bằng OTP (3848) + SSO verify (3862).
   - `store.getTargets()`: nối `/api/targets` thật + fallback `V_TEM_TARGET_BONUS`.
2. **Thay logo/QR thật:** bỏ `logo-dnpharma.png` + `zalo-oa-qr.png` vào `web/public/` (xem `web/public/README-assets.md`).
3. **Siết CORS** trong `server/src/index.js` về đúng domain nội bộ.
4. **Session bền** (đang lưu RAM) → chuyển KV/Redis nếu chạy nhiều instance.
5. **Deploy** theo `DEPLOY_CLOUDFLARE.md` (Pages + Tunnel + Access).

## Trước khi báo "xong" bất kỳ việc gì
- Chạy `npm run setup && npm run dev`, tự kiểm bằng cả tài khoản **CEO** và **1 NV sale**.
- Xác nhận NV sale vẫn KHÔNG thấy dữ liệu người khác (test phân quyền).
- Nếu sửa backend: kiểm lại các endpoint bằng tài khoản sale phải trả 403 ở route admin.

## Khi bí / cần quyết định lớn
- Ghi rõ phương án + đánh đổi, để CEO mang về phiên Claude kiến trúc (phiên này) review trước khi làm tiếp. KHÔNG tự ý đổi kiến trúc/quyền.
