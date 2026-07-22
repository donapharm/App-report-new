# DIRECTIVE — SỬA Vùng/Tỉnh: bỏ đoán-từ-tên rủi ro, dùng nguồn chính thức (review #144 `0156c5d`)

> Claude Code giao Report Bot. Review #144 (filters): **all-fix + Nhóm mã ĐV + Tuyến = PASS**. Riêng **Vùng/Tỉnh** (`province.js`)
> đang **đoán theo tên + viết tắt** — trái directive #144 ("không suy đoán tỉnh từ tên") và **gán sai được**. Sửa trước khi deploy.

## 1. VẤN ĐỀ
`province.js` giải tỉnh 3 tầng, **tầng 3 = đoán**:
- **ABBR** `dn→Đồng Nai`, `bp→Bình Phước` — **`ĐN` cũng là Đà Nẵng** → nhầm.
- **KEYWORDS theo tên huyện** — có trùng liên tỉnh: `tan phu` (Đồng Nai) **cũng là Q.Tân Phú TP.HCM**; `tan chau`,
  `chau thanh`… tương tự → gán sai.
- Facet ghi `source:'official_row_catalog_or_config'` nhưng thực tế có phần đoán → **sai provenance**.
- **Hệ quả:** lọc theo tỉnh trả **sai/sót đơn vị** (quản lý địa bàn lệch). *(Không ảnh hưởng số tiền — tỉnh chỉ là chiều lọc.)*

## 2. SỬA (ưu tiên an toàn)
1. **BỎ hẳn tầng viết tắt (ABBR `dn`/`bp`…).** Quá nhiều nhầm, không giữ.
2. **Tỉnh chỉ lấy từ NGUỒN CHÍNH THỨC:**
   - (a) `row.province` — cột "Tỉnh" nếu file upload có; hoặc
   - (b) map `server/config/unit_province.json` (mã đơn vị → tỉnh).
   - Không có (a)/(b) → **`province = ''` → nhóm "Chưa gán tỉnh"** (trung thực, không đoán).
3. **Nếu CEO muốn giữ đoán-theo-tên** cho tiện: chỉ giữ **cụm KHÔNG trùng liên tỉnh**, và **bắt buộc gắn cờ
   `provinceGuessed: true`** → FE hiện **"tạm đoán · cần xác nhận"**, và `source` phải phản ánh đúng (vd `guessed_from_name`).
   Mặc định **KHÔNG** tính "tạm đoán" là chính thức.
4. **Sửa nhãn `source`** cho đúng thực tế từng giá trị (official vs guessed). Không dán "official" cho giá trị đoán.

## 3. KHUYẾN NGHỊ CHUẨN NHẤT
- **Điền `unit_province.json`** (map toàn bộ mã đơn vị → tỉnh) — chính xác 100%, không đoán. CEO/nghiệp vụ duyệt 1 lần,
  dùng mãi. Bot có thể xuất danh sách mã đơn vị chưa gán tỉnh để điền nhanh (giống worklist gap).

## 4. NGHIỆM THU
1. Không còn gán tỉnh bằng viết tắt; đơn vị chưa có nguồn → "Chưa gán tỉnh" (không đoán bừa).
2. Nếu giữ đoán-tên (tùy chọn): giá trị đoán có cờ + nhãn "tạm đoán", `source` đúng; mặc định lọc "chính thức" không lẫn đoán.
3. Lọc theo tỉnh trả đúng đơn vị của nguồn chính thức. Test provenance cập nhật theo hành vi mới. Build PASS.

## 5. GHI CHÚ — #145 CHƯA LÀM
- Đợt `0156c5d` là **#144** (all-fix + 3 filters). **#145** (phân trang pill 20 dòng · pager lên đầu · xem theo ngày) **chưa
  implement** — làm tiếp cùng nhánh. Directive: `DIRECTIVE_EMP_COST_PAGER_DAYVIEW.md`.
