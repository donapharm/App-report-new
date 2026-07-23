# Claude Code review — App Report #162

- Thời điểm: 24/07/2026 06:55 GMT+7
- Chế độ: read-only, không deploy/restart/chỉnh file
- Nhánh: `review/employee-cost-diemxu-consume-162`
- Implementation: `0c1da00`
- LIVE parity evidence: `618f6f7`

Đã review xong toàn bộ contract, code backend/FE, test và bằng chứng parity (read-only). Dưới đây là kết luận.

---

**VERDICT: PASS**

**EVIDENCE**
- **Contract App VAT SSOT** đúng: `GET {VAT_BASE}/api/khoan/dashboard?month&year&emp_code`, header `Bearer VAT_SERVICE_TOKEN`, `rule_version=khoan-ssot-v2026-05-r1` (`employeeVatKhoan.js:5,150-160`). `VAT_BASE`/`VAT_SERVICE_TOKEN` chỉ ở `.env.example` backend (dòng 99-103), không có biến `VITE_*`.
- **Self-scope 2 lớp:** route `/employee-cost/diem-xu` dùng `auth.requireAuth` + `resolveScopedEmployee` (sale bị ép `scope.empCode`, bỏ `?emp=`); `getForSession` ép lại `scope.empCode` lần nữa; `projectDashboard` chỉ nhận payload khi `emp_code` khớp + `viewAll===false` + đúng month/year/quarter (`routes.js:685-707`, `employeeVatKhoan.js:96-108,215-217`). Admin chọn NV lạ ngoài roster → 400. Test `sale spoofed emp is ignored` xác nhận.
- **Fail-closed, không bịa số:** thiếu config → không gọi network (`not_configured`); 401/400 → payload rỗng `note:"chưa lấy được điểm/xu kỳ này"`, không có `phat_du_kien`; 502/timeout → retry backoff hữu hạn rồi rỗng; timeout hard-cap 5s phủ cả lúc đọc body; **audit fail → fail-closed** (`employeeVatKhoan.js:118-136,158-196,228-240`).
- **Token backend-only + log sạch:** log `upstream unavailable` chỉ ghi actor/emp/kỳ/outcome/attempts, cố ý bỏ URL/token/header/body (`:242-247`); FE `api.js` chỉ mang session bearer của chính user, **không** có token/URL App VAT (test `route contract` khẳng định).
- **Projection không tự tính lại:** `projectDashboard` chỉ copy + validate; chế độ ALL là **tổng hiển thị** projection từng NV, `pct` set `null`, fail-closed nếu 1 NV rỗng hoặc lệch rule_version (`:251-258`).
- **UI display-only:** 3 KPI điểm/xu/phạt + nguồn+rule_version; dòng cấn trừ "Chi phí gốc − cấn trừ thiếu xu = còn lại" (`employeeVatKhoanModel.js:54-63`, `EmployeeCost.jsx:280-298`), nhãn "không ghi DataHub/payroll", chặn ghép sai kỳ nhiều tháng; cảnh báo sớm khi `pctQuy<90%`.
- **Parity 4 NV kỳ 06/2026 (`artifacts/…-162.json`):** `all_exact_match:true`, mọi diff `0`; **DN009 phạt `13.800.000đ` khớp** (`13.800.000/600.000=23=floor(47,5/2)`, App VAT tính, App Report chỉ hiển thị). Security: `full_token_leaked:false`, `token_prefix_leaked:false`. Gates ghi 13/13 server, 5/5 web, build PASS.
- Test `server/test/employeeVatKhoan.test.js` (13 case) bao phủ đủ: parse kỳ, projection exact/drop field auth, fail-closed identity/scope/period, spoof, 401/400, timeout 5s + stalled body, retry backoff, audit không token, ALL fail-closed. CHANGELOG khớp mô tả implementation.

**RISKS**
- Không tự chạy được `test`/`build` trong phiên này (plan-mode chặn phê duyệt lệnh); kết luận PASS dựa trên đọc code+test + artifact parity + CHANGELOG. Đề nghị bên deploy chạy lại `npm test`/build 1 lần trước khi cắt.
- Parity mới xác thực **kỳ 06/2026 / 4 NV**; các NV/kỳ khác chưa đối chiếu (chấp nhận được vì projection thuần copy + validate chặt).
- Phụ thuộc App VAT giữ đúng schema (`diem/xu/pct/phat_du_kien/rules.penalty`); nếu App VAT đổi field, App Report fail-closed sang "chưa lấy được điểm/xu" (an toàn, không bịa) — cần theo dõi để không mất KPI im lặng.

**DEPLOY_DECISION: READY_FOR_DEPLOY_APPROVAL** — không còn blocker kỹ thuật. Trước khi bật LIVE: đảm bảo `.env` production đặt `VAT_BASE`/`VAT_SERVICE_TOKEN` (secret không commit), chạy lại test/build 1 lượt xác nhận. Tôi không tự deploy/restart.
