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
- **DataHub receiver đã deploy production** tại commit `cd821a46689ce8f124600d5295584479b5444f19`, endpoint
  `POST /api/integrations/app-report/cost-gap-worklist`; smoke local/HTTPS và boundary đã PASS, chưa có production write.
- ⇒ **App Report vẫn triển khai dormant/fail-safe:** code/cấu hình production hiện tại giữ nguyên cho tới khi CEO duyệt
  triển khai riêng. Sau triển khai cũng không tự gửi; worklist production đầu tiên chỉ phát sinh khi CEO trực tiếp bấm **✅ Duyệt**.

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
- Nhận JSON (xem §2). Receipt hợp lệ duy nhất:
  - lần mới: **HTTP 201** + `{ ok:true, worklist_id:<không-rỗng>, received:<đúng N>, deduped:false }`;
  - dedupe: **HTTP 200** + `{ ok:true, worklist_id:<không-rỗng>, received:<đúng N>, deduped:true }`.
- `received` phải là số nguyên đúng bằng số item gửi; `deduped` phải là boolean. Mọi 2xx/status/field/type khác fail-closed.
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
- Bấm → **modal PREVIEW** (theo mẫu catalog transfer): *"Gửi **N mã** (doanh thu ảnh hưởng **W**, kỳ **từ→đến**)
  sang DataHub để điền %."* + ô ghi chú (tuỳ chọn) + đúng 3 lựa chọn:
  - **✅ Duyệt** → POST `{confirm:true, note?}` — chỉ nút này gửi worklist đi.
  - **❌ Không duyệt** → đóng modal, không gọi gì.
  - **📝 Ý kiến khác** → POST `{action:'note', note}` — chỉ ghi audit, tạo **0 request** tới DataHub.
- Thành công → toast *"Đã gửi N mã sang DataHub. Vào DataHub để điền %."* + refresh audit.
- **Trạng thái nút:**
  - DataHub chưa cấu hình → nút **disabled** + tooltip *"Chưa cấu hình DataHub"*.
  - DataHub 404 (chưa build cửa nhận) → toast *"DataHub chưa mở cửa nhận worklist — dùng tạm Xuất Excel."* (dormant, không vỡ).
  - Lỗi mạng/timeout → *"DataHub phản hồi chậm, thử lại."* (không tự retry ngầm).

## 4. BẢO MẬT / FAIL-SAFE (bất di) — đã hiện thực + test
1. **CEO/ADMIN-only** (requireAdmin); NV không thấy nút, gọi route bị **403**.
2. Worklist **dựng ở backend từ nguồn gap**, không tin body client.
3. **Không %/cost/PII/C32/C47** trong payload (`assertNoForbiddenKeys` fail-closed trước khi gửi).
4. **Gate xác nhận:** route yêu cầu `confirm===true` (đặt SỚM trước khi dựng payload) + lớp `sync({confirmed})`; admin
   gọi thẳng API mà không Duyệt → **400**, không gửi.
5. **Validate phản hồi DataHub:** chỉ nhận `201 + deduped:false` lần mới hoặc `200 + deduped:true` khi trùng,
   đồng thời bắt buộc `ok===true`, `worklist_id` không rỗng, `received` là số nguyên đúng bằng số mã gửi và `deduped`
   là boolean. `{}`, mọi 2xx khác, thiếu/sai type/count/status đều → `GAP_SYNC_BAD_RESPONSE`.
6. **No auto-retry POST**; idempotent qua **checksum canonical** (sort đơn vị + sort items theo mã → độc lập thứ tự);
   `configured()` sai → 503 dormant, không ghi local.
7. **Giới hạn:** tháng ≤ 12 (route) · items ≤ 5000 · payload ≤ 1 MB → **413** rõ ràng.
8. **Audit MỌI outcome** (kể cả từ chối: not-confirmed/not-configured/empty/limit/forbidden/bad-response) vào
   `employee_cost_gap_sync_audit`: actor · role · kỳ · số mã · checksum · kết quả. `note` chỉ vào audit, **không** gửi DataHub.
9. Số nghiệp vụ/quyền không đổi; đây chỉ là **kênh chuyển danh sách**, không tính toán mới.

## 5. RANH GIỚI (giữ nguyên nguyên tắc gap tool)
- App Report: **phát hiện + đóng gói + GỬI** danh sách thiếu %. **DataHub: điền % / chuẩn hoá mã (SSOT).**
- App Report **không** tự ánh xạ, **không** tự điền %, **không** giữ raw cost. Sau khi DataHub cập nhật catalog →
  App Report sync catalog như hiện tại → coverage lên, **không sửa code**.

## 6. NGHIỆM THU — trạng thái candidate: ✅ PASS (bộ `npm run test:gap-sync` 25/25)
1. `configured()`=false → 503 dormant; nút disabled + tooltip *"Chưa cấu hình DataHub"* (GET gaps trả `sync.configured`).
2. Payload build từ backend, **assert 0 field cost/%/PII/C32/C47** (chèn thử c47 → fail-closed).
3. POST không auto-retry; gửi lại cùng kỳ+checksum → dedupe; **đảo thứ tự items → cùng checksum** (canonical).
4. CEO-only: NV gọi route → **403**; nút không hiện với NV.
5. UI đúng 3 nút: ✅ Duyệt → POST worklist; ❌ Không duyệt → đóng, 0 request; 📝 Ý kiến khác → chỉ ghi audit, 0 request. Không confirm → **400**, 0 request.
6. Chỉ `201/deduped:false` hoặc `200/deduped:true` với đủ receipt hợp lệ mới thành công; malformed 2xx → `GAP_SYNC_BAD_RESPONSE`; giới hạn tháng/items/payload → 413.
7. Dormant: DataHub 404 / unreachable / timeout → thông báo rõ, không vỡ app; Xuất Excel/PDF vẫn chạy.
8. Full gate candidate: server **385/385**, web **77/77**, mock/route gap-sync **25/25**, syntax PASS; production build và secret scan phải PASS trước khi trình CEO.
9. Giữ nhánh review cô lập; **không merge/push/deploy/restart** cho tới khi CEO duyệt triển khai riêng.

## 6-BIS. PHẠM VI CỘT % ĐƯỢC GHI (CEO chốt 2026-07-25)
Màn DataHub điền % chỉ ghi vào **đúng allowlist `C33–C46` CEO đang bật** (dùng chung allowlist động của bên đọc
"Chi phí của tôi" — `SPEC_REPORT_EMP_COST_SELFVIEW.md`):
- Ghi **động theo allowlist, không hardcode**; CEO đổi allowlist → áp dụng ngay (đọc↔ghi nhất quán).
- **`C32` (tổng) + `C47` (đầu ra): cấm ghi/cấm suy ra tuyệt đối** — hard-block ở DataHub.
- Giá trị **% theo từng dòng**, không cộng dồn.
- **App Report write-agnostic:** worklist chỉ nêu *mã cần chú ý*, không mang/không chỉ định cột nhận %. Việc chọn cột
  hoàn toàn ở allowlist DataHub (SSOT).

## 7. VIỆC DATAHUB (cross-app — chặn hard, phải làm song song)
- Receiver production đã deploy tại commit `cd821a46689ce8f124600d5295584479b5444f19` (auth `x-assignment-key`, idempotent theo checksum).
- Màn cho **CEO điền %/ánh xạ mã** trên đúng worklist nhận, chỉ ghi theo allowlist DataHub; C32/C47 hard-block.
- Giữ strict receipt contract §1b và kỳ `from`/`to`; không nới thành "mọi 2xx".
