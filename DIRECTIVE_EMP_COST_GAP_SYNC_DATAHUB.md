# DIRECTIVE — Nút "Đồng bộ worklist thiếu % sang DataHub" (CEO 2026-07-25)

> Claude Code (kiến trúc) soạn cho Report Bot build phía App Report + giao DataHub team build cửa nhận.
> **Mục tiêu:** bỏ thao tác thủ công *xuất Excel → mở DataHub → nhập tay*. Thay bằng **1 nút "Đồng bộ sang
> DataHub"** ngay trong tab "Mặt hàng thiếu %": CEO bấm → App Report đẩy **danh sách mã thiếu %** (worklist)
> sang DataHub qua API S2S → CEO vào DataHub **điền % / ánh xạ mã** trên đúng danh sách đó.
> **KHÔNG đổi ranh giới:** App Report chỉ GỬI danh sách THIẾU %; **DataHub vẫn là nơi điền % (SSOT)**. App Report
> không giữ %, không tự ánh xạ. Điền xong bên DataHub → coverage App Report tự lên.

## 0. ‼ ĐIỂM CHẶN PHẢI BIẾT TRƯỚC (không phải build 1 đầu là xong)
- Hiện App Report → DataHub **chỉ có 1 cửa ghi**: `POST …/assignments/transfer` (điều chuyển phụ trách NV) —
  **KHÔNG dùng cho việc này**.
- **DataHub CHƯA có endpoint nhận worklist thiếu %.** Nút này cần **cả 2 đầu**:
  1. **App Report** (bot build theo directive này) — route push + UI nút.
  2. **DataHub** (team/bot DataHub build) — endpoint **nhận** worklist + màn cho CEO điền % trên danh sách nhận.
- ⇒ **Triển khai dạng dormant/fail-safe:** App Report build xong **giữ "ngủ an toàn"**; khi DataHub chưa mở cửa
  nhận thì nút báo rõ "DataHub chưa sẵn sàng", **không lỗi vỡ**, không kẹt. Bật thật khi DataHub xong cửa nhận +
  chốt contract. Không big-bang.

## 1. HỢP ĐỒNG API (S2S) — mô phỏng đúng `catalogManagement.transfer()`
### 1a. App Report route (bot build)
- `POST /api/employee-cost/gaps/sync-datahub` — **`requireAuth` + `requireAdmin` (CEO/ADMIN-only)**.
- Body từ frontend: `{ from, to, filters?, confirm:true }` (cùng range/filter đang xem ở tab gap).
- Backend **tự dựng lại worklist từ chính `employeeCostGaps`** (KHÔNG tin danh sách client gửi lên — chống giả mạo/
  chèn dòng). Dùng đúng payload `adminView`/`aggregatePairs` đang có.
- Gọi DataHub qua `fetchJson` (đã đính `x-assignment-key`), thêm header `x-app-report-actor` như `transfer()`;
  **timeout `DATA_HUB_TIMEOUT_MS`**; **KHÔNG auto-retry POST** (tránh tạo worklist trùng — giống ghi chú transfer).
- `configured()` = false → **503 thân thiện** ("DataHub chưa cấu hình…"), không ghi local.

### 1b. DataHub receiver (DataHub team build — cùng contract)
- `POST ${DATA_HUB_BASE_URL}/api/integrations/app-report/cost-gap-worklist`
- Auth: **`x-assignment-key: ${DATA_HUB_ASSIGNMENT_KEY}`** (đúng cơ chế các API tích hợp hiện tại).
- Nhận JSON (xem §2), trả **HTTP 2xx + JSON** `{ ok:true, worklist_id, received:<N> }`; lỗi trả `{ error:"…" }`.
- **Idempotent:** dedupe theo `worklist_checksum` (gửi lại cùng kỳ+checksum → cập nhật, không nhân đôi).

## 2. PAYLOAD (dùng ĐÚNG field gap thật — không cost/PII)
> **Kỳ = khoảng `from`/`to` (YYYY-MM), KHÔNG dùng `period` đơn lẻ.** Gap tool App Report vốn theo khoảng tháng; bản
> `period` đơn trước đây là rút gọn cũ — đã bỏ. Contract chuẩn thống nhất với `HANDOFF_DATAHUB_COST_GAP_RECEIVER.md`.
```json
{
  "from": "2026-06",
  "to": "2026-07",
  "actor": "CEO",
  "worklist_checksum": "<sha256 của items chuẩn hoá>",
  "coverage": { "matched_pairs": 171, "total_pairs": 184 },
  "items": [
    {
      "ma_qlnb": "<productCode>",
      "ten_hang": "<productName>",
      "don_vi_anh_huong": ["<unitLabel>", "..."],
      "so_don_vi": 3,
      "so_nv": 2,
      "doanh_thu_anh_huong": 123456789,
      "ly_do": "qd_mismatch | missing",
      "ma_catalog_goi_y": "<suggestedCatalogCode|null>"
    }
  ]
}
```
- **‼ TUYỆT ĐỐI KHÔNG chứa:** cột `%`/cost/margin/payout, `C32`/`C47` (denylist vĩnh viễn), PII (SĐT/CCCD/email/
  tên NV). Chỉ gửi **mã + thống kê ảnh hưởng + doanh thu** (doanh thu NV vốn đã thấy). Đây là danh sách **THIẾU %**,
  không phải số chi phí.
- `worklist_checksum` = SHA-256 trên `items` đã sort/chuẩn hoá (để DataHub idempotent + App Report audit truy vết).

## 3. FRONTEND (tab "Mặt hàng thiếu %", chỉ CEO/ADMIN)
- Thêm nút **"📤 Đồng bộ sang DataHub"** cạnh **"Xuất Excel"/"Xuất PDF"** (giữ cả 2 nút xuất — kênh dự phòng).
- Bấm → **modal PREVIEW** (theo mẫu catalog transfer): *"Gửi **N mã** (doanh thu ảnh hưởng **W**, kỳ **MM.YYYY**)
  sang DataHub để điền %."* + đúng 3 lựa chọn **✅ Duyệt · ❌ Không duyệt · 📝 Ý kiến khác**; **chỉ ✅ Duyệt** mới POST.
- Thành công → toast *"Đã gửi N mã sang DataHub. Vào DataHub để điền %."* + refresh audit.
- **Trạng thái nút:**
  - DataHub chưa cấu hình → nút **disabled** + tooltip *"Chưa cấu hình DataHub"*.
  - DataHub 404 (chưa build cửa nhận) → toast *"DataHub chưa mở cửa nhận worklist — dùng tạm Xuất Excel."* (dormant, không vỡ).
  - Lỗi mạng/timeout → *"DataHub phản hồi chậm, thử lại."* (không tự retry ngầm).

## 4. BẢO MẬT / FAIL-SAFE (bất di)
1. **CEO/ADMIN-only** (requireAdmin); NV không thấy nút, gọi route bị 403.
2. Worklist **dựng ở backend từ nguồn gap**, không tin body client.
3. **Không %/cost/PII/C32/C47** trong payload (assert trước khi gửi — fail-closed nếu lỡ dính).
4. **No auto-retry POST**; idempotent qua checksum; `configured()` sai → 503, không ghi local.
5. **Audit** mọi lần đồng bộ: actor · kỳ · số mã · checksum · kết quả DataHub (dùng `employee_cost_gap_audit` sẵn có).
6. Số nghiệp vụ/quyền không đổi; đây chỉ là **kênh chuyển danh sách**, không tính toán mới.

## 5. RANH GIỚI (giữ nguyên nguyên tắc gap tool)
- App Report: **phát hiện + đóng gói + GỬI** danh sách thiếu %. **DataHub: điền % / chuẩn hoá mã (SSOT).**
- App Report **không** tự ánh xạ, **không** tự điền %, **không** giữ raw cost. Sau khi DataHub cập nhật catalog →
  App Report sync catalog như hiện tại → coverage lên, **không sửa code**.

## 6. NGHIỆM THU
1. `configured()`=false → route trả 503 thân thiện; nút disabled + tooltip đúng.
2. Payload build từ backend, **assert 0 field cost/%/PII/C32/C47** (test chèn thử → fail-closed).
3. POST không auto-retry; gửi 2 lần cùng kỳ+checksum → DataHub dedupe (khi có cửa nhận).
4. CEO-only: NV gọi route → 403; nút không hiện với NV.
5. UI preview 3 nút, chỉ ✅ Duyệt mới POST; toast + audit đúng.
6. Dormant: DataHub 404 → thông báo rõ, không vỡ app; Xuất Excel/PDF vẫn chạy.
7. Test + build PASS; push nhánh review; báo Claude review; **chưa deploy** tới khi DataHub xong cửa nhận.

## 6-BIS. PHẠM VI CỘT % ĐƯỢC GHI (CEO chốt 2026-07-25)
Màn DataHub điền % chỉ ghi vào **đúng allowlist `C33–C46` CEO đang bật** (dùng chung allowlist động của bên đọc
"Chi phí của tôi" — `SPEC_REPORT_EMP_COST_SELFVIEW.md`):
- Ghi **động theo allowlist, không hardcode**; CEO đổi allowlist → áp dụng ngay (đọc↔ghi nhất quán).
- **`C32` (tổng) + `C47` (đầu ra): cấm ghi/cấm suy ra tuyệt đối** — hard-block ở DataHub.
- Giá trị **% theo từng dòng**, không cộng dồn.
- **App Report write-agnostic:** worklist chỉ nêu *mã cần chú ý*, không mang/không chỉ định cột nhận %. Việc chọn cột
  hoàn toàn ở allowlist DataHub (SSOT).

## 7. VIỆC DATAHUB (cross-app — chặn hard, phải làm song song)
- Build `POST /api/integrations/app-report/cost-gap-worklist` (auth `x-assignment-key`, idempotent theo checksum).
- Màn cho **CEO điền %/ánh xạ mã** trên đúng worklist nhận (thay việc nhập tay từ Excel), **ghi trong allowlist C33–C46
  (§6-BIS), C32/C47 hard-block**.
- Trả 2xx JSON khi nhận; báo App Report khi contract sẵn sàng để bật thật.
- Chốt contract §1b/§2 (**kỳ = `from`/`to`, không `period`**) với Claude trước khi 2 đầu đóng E2E.
