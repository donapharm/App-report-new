# SPEC GỘP — chốt MỘT đường cấu hình phạt (Claude review, 2026-07-30)

**Kết luận review:** giữ **bản của bot** cho *store cấu hình phạt* và *tổng hợp toàn đội*; giữ **bản trên `main`** cho *phần giải thích cho nhân viên*. **Xoá phần trùng của Claude.** Lý do và việc cụ thể ở dưới.

Hai nhánh cùng tách từ `0d3e559`:
- `main` = `9e5fb91` (Claude): `beb4ce7` nhãn C45 + 4 ngữ cảnh · `d92807f` cấu hình phạt qua tầng đè của Thưởng · `b71f3f1` test HTTP + siết session.
- `origin/feat/penalty-formula-editor-20260730` = `59dc9d3` (bot): `1bd1ba9` tổng hợp toàn đội · `59dc9d3` store phạt riêng có version.

## 1. VÌ SAO GIỮ STORE CỦA BOT (không giữ của Claude)

Claude đọc hết `server/src/employeePenaltyPolicy.js` (354 dòng) và so với bản mình. Bản bot **mạnh hơn đúng ở những chỗ quyết định tiền và dấu vết**:

| Tiêu chí | Bot (`employeePenaltyPolicy`) | Claude (tầng đè của Thưởng) |
|---|---|---|
| Lưu version | **Full snapshot** từng version → đọc lại kỳ cũ là ra đúng bản của kỳ đó | Patch đè nhiều tầng → phải suy lại, khó chứng minh |
| Lịch sử audit | **Append-only, KHÔNG cắt** | **Cắt còn 2.000 bản ghi** ⇒ đúng phát hiện Medium của review |
| File cấu hình hỏng | **Fail rõ** `PENALTY_POLICY_STORE_CORRUPT` | **Âm thầm quay về mức mặc định** — nguy hiểm: mức phạt đổi mà không ai biết |
| Ghi audit lỗi | **Rollback lại policy** để không tồn tại thay đổi thiếu audit | Không có |
| Quyền sửa | **Chỉ CEO** (`PENALTY_POLICY_CEO_REQUIRED`) | Mọi admin |
| ID bản ghi | **Backend tự sinh** | Nhận `payload.id` từ client ⇒ có thể trùng khoá làm hỏng store |
| Không hồi tố | Chặn tạo version cho kỳ **trước tháng hiện tại** | Chỉ chặn theo ngày trừ thật |
| Dùng lại version cũ | Có, và **so từng tham số** với version nguồn | Không có |
| Giai đoạn hiệu lực | Có `effectiveFrom/effectiveTo` | Chỉ có `effectiveFrom` |

Ba dòng in đậm ở cột phải là **lỗi thật của bản Claude**, không phải khác biệt về gu. Vì vậy **xoá bản Claude**, không cố giữ cả hai.

## 2. VIỆC PHẢI LÀM — theo từng file

### 2.1 XOÁ hẳn (phần trùng của Claude)
- `server/src/employeeBonusPolicy.js`: **gỡ toàn bộ phần phạt** — `PENALTY_LAYERS`, `PENALTY_KEYS`, nhánh phạt trong `normalizePatch`, phần phạt trong `mergeConfig`, `require('./employeePenalty')`, và các trường phạt trong `rawConfig` nếu không còn ai dùng. Trả file về đúng vai "cấu hình **Thưởng**".
- `server/src/routes.js`: **xoá** `penaltyPolicySnapshot`, `penaltyPolicyPreviews`, hai route `/admin/penalty-policies*` **của Claude**, và khối `penalty` trong `GET /admin/bonus-policies`. Chỉ còn route của bot.
- `server/test/penaltyPolicyEditable.test.js` và `server/test/penaltyPolicyHttp.test.js`: **xoá** (khoá đường đã bỏ). Xem 2.3 để biết phần nào phải chuyển sang bộ test của bot **trước khi xoá**.
- `web/src/api.js`: bỏ `adminPenaltyPolicyPreview`/`adminPenaltyPolicySave` của Claude nếu tên/đường dẫn khác của bot; giữ đúng một cặp.
- `web/src/pages/Target.jsx`: giữ **editor của bot** (có 3 nút `✅ Duyệt / ❌ Không duyệt / 📝 Ý kiến khác`), bỏ `PenaltyPolicyPanel` bản Claude.
- `server/src/employeePenaltyAggregate.js`: giữ **bản bot** (`aggregatePenaltySummaries`), bỏ hàm `aggregate` bản Claude.

### 2.2 GIỮ LẠI của Claude — GHÉP VÀO (bot chưa có)
1. **`server/src/penaltyDisplay.js` (giữ nguyên file).** Đây là việc số 1 CEO yêu cầu và nhánh bot **không có** (kiểm chứng: `EmployeeCost.jsx` của bot có **0** lần chữ "Lương tăng thêm"). Nó sinh từ config: tên cột `C45 (Lương tăng thêm)`, bảng 4 ngữ cảnh (`range`/`effect`), ví dụ tiền theo số thật của NV, câu mô tả chế độ kỳ. **Không nằm trong `FORMULA_SOURCES`** — sửa lời giải thích không phải nâng version.
   - Đính vào payload phạt self-scoped: `c45Label`, `modeText`, `tiers` (như `routes.js` trên `main` đang làm).
   - Nguồn config phải là **cấu hình đã resolve của bot** cho kỳ đó, KHÔNG phải seed.
2. **`web/src/pages/EmployeeCost.jsx` — hộp giải thích phạt.** Ghép từ `main`: tiêu đề có `{c45Label}`, hộp **"Phạt trừ ở đâu?"**, mục **"Khi nào bị phạt? (4 ngữ cảnh)"** tô đậm bậc NV đang đứng + ví dụ tiền. Kèm CSS `.employee-cost-penalty-c45-note`, `.employee-cost-penalty-tier*` trong `web/src/styles.css` và `tiers`/`c45Label`/`modeText` trong `web/src/employeeCostModel.js`.
3. **Danh sách NV đang ở bậc bị phạt (`atRisk`)** trong tổng hợp toàn đội: mỗi dòng gồm mã NV · tên · % đạt · tiền phạt · **số doanh thu cần thêm trước VAT**, sắp theo % tăng dần. CEO bấm ô "Phạt dự kiến" là biết ngay phải nhắc ai và nhắc con số nào. Bot chưa có.
4. **Test HTTP dùng middleware quyền THẬT.** Test HTTP của bot **thay `auth.requireAuth` bằng hàm giả** nên không đi qua đường xác thực thật (không có ca **401**). Chuyển ca này từ `penaltyPolicyHttp.test.js` của Claude sang bộ test của bot: phát token thật bằng `auth.issueToken`, kiểm **401 khi không token**, **403 với NV sale**, 200 với CEO. Giữ nguyên các ca CEO-only/`canEdit` của bot.
5. **Không "đốt" preview của người khác.** Khi một phiên lạ gửi `previewId` không thuộc mình: trả 409 nhưng **KHÔNG xoá** preview đó — nếu xoá thì bất kỳ ai gọi sai một lần là làm mất bản mô phỏng hợp lệ của CEO. Chỉ chủ đúng phiên mới được xoá. Kèm 1 test.
6. **Rào chắn tỷ lệ đánh sai số.** Bot đang cho `ratePct` 0–100. Gõ `30` thay vì `0,3` là **mất trọn C45** của cả đội. Thêm: **chặn cứng > 5%** (mã lỗi riêng, thông báo tiếng Việt rõ) và **cảnh báo hiện trong preview khi > 1%** ("cao gấp N lần mức đang áp dụng — xác nhận lại"). Không chặn ở 1% để CEO vẫn có quyền quyết.

### 2.3 Test bắt buộc bổ sung (các điểm review còn lại)
- `vat.db` đổi giữa preview và save ⇒ preview **hết hiệu lực** (đã có chữ ký nguồn Xu, cần test).
- Ghi audit lỗi ⇒ **policy phải rollback**, không tồn tại thay đổi thiếu audit.
- Lịch sử audit **vượt 2.000 sự kiện vẫn không bị cắt**.
- Gửi `copiedFromVersion` nhưng sửa tham số ⇒ **bị từ chối** (`PENALTY_POLICY_COPY_SOURCE_MISMATCH`).
- File policy/audit hỏng ⇒ `PENALTY_POLICY_STORE_CORRUPT`, **không** âm thầm về seed.
- Nhân viên KHÔNG có dòng chi phí nào vẫn phải nằm trong tổng hợp toàn đội (không "mất số lặng lẽ").
- Ô KPI ở "Tất cả NV": khi tổng chặt là `null` thì hiện **số tạm tính + nhãn coverage**, KHÔNG để ô trống và KHÔNG hiện 0đ.

## 3. VERSION + VÂN TAY (làm một lần, cuối cùng)
Hai nhánh **đều** nâng `FORMULA_VERSION` lên `v3.4` với nội dung khác nhau ⇒ hai `sourceHash` khác nhau. Đây chính là "blocker" bot thấy.
- **Giữ nhãn `v3.4`** cho bản gộp: **chưa có nhân viên nào từng thấy số v3.4** (production còn v3.3), nên không có ai bị đổi số sau lưng.
- Sau khi gộp xong: chạy `server/test/bonusFormulaVersion.test.js`, lấy **"vân tay hiện tại"** trong thông báo lỗi, ghi vào `bonus_formula_lock.json`, chạy lại cho XANH.
- `employee_bonus_tiers.json`: `version` + `note` phải ghi `v3.4` và nói rõ **"cách tính tiền P1/P2 không đổi; v3.4 mở cấu hình phạt có version"**.
- Ghi **một** mục `CHANGELOG.md` cho lần gộp: giữ gì của ai, xoá gì, vì sao.

## 4. NGHIỆM THU trước khi xin deploy
1. Full suite hai bên: `server` và `web`, **không chạy chọn lọc**. Đỏ đúng mức nền (3 fixture `authTrustedDevice` thiếu `users.json`; các ca PDF nếu server có `pdfinfo` thì phải XANH). `bonusFormulaVersion` **XANH**.
2. `grep -rn "penalty" server/src/employeeBonusPolicy.js` ⇒ **không còn dòng nào** (đã gỡ hẳn đường trùng).
3. Chỉ còn **một** cặp route cấu hình phạt; `grep -rn "penaltyPolicyPreviews" server/src` ⇒ rỗng.
4. `GET` cấu hình phạt (token CEO) trả: `c45Label = "C45 (Lương tăng thêm)"`, đủ **4 bậc** kèm `range`/`effect`, `canEdit` đúng theo vai (CEO true, admin false).
5. `GET /api/employee-cost?emp=ALL` trả tổng hợp có **`atRisk`** kèm số doanh thu cần thêm.
6. Ảnh 3 màn: hộp "Cách tính Phạt" sửa được + 3 nút duyệt · 4 ô KPI ở "Tất cả NV" có số · hộp giải thích của 1 NV có **"C45 (Lương tăng thêm)"** và bảng 4 ngữ cảnh.

## 5. QUY TẮC LÀM VIỆC (để không lặp lại chuyện hôm nay)
- **`git pull origin main` TRƯỚC MỖI ĐỢT.** Hai bản trùng nhau hôm nay chỉ vì cả hai cùng làm việc 2 và việc 4 từ cùng một điểm tách mà không ai biết bên kia đang làm.
- Nhận việc là **báo trước phạm vi file** sẽ đụng, để bên kia tránh.
- Deploy vẫn **DỪNG** theo `DIRECTIVE_DEPLOY_V34_20260730.md` cho tới khi mục 4 ở trên xanh hết.
