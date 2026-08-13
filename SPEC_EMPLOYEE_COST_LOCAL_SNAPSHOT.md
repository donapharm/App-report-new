# SPEC — Chi phí NV: ĐỒNG BỘ VỀ MÁY rồi phục vụ tại chỗ (CEO yêu cầu sửa triệt để, 13/08/2026)

> CEO 13/08, 08:23: *"dữ liệu cứ nhảy loạn xạ, bây giờ tao chụp lại thì lại thiếu nhiều
> hơn… mày phải tìm cách sửa triệt để ngay cho tao, không sửa theo lối cũ nữa."*

## 1. Chẩn đoán — vì sao con số nhảy (một cơ chế, không phải nhiều lỗi)

Màn "Tất cả nhân viên" hiện nay là một **cuộc đua có hạn chót**:

- Mỗi lần mở màn, app fan-out hỏi DataHub **21 NV × 6 luồng**, tất cả chia chung **một
  deadline 25 giây** (`requestDeadline.js: EMPLOYEE_COST_ALL_DEADLINE_MS`).
- NV nào không kịp hạn ⇒ `sourceOutcome: 'deadline'` ⇒ bị coi là "chưa lấy được" ⇒ rớt
  khỏi màn (`routes.js:1418`).
- Trên PROD (`7870f10`), CPU bị **chẹn 60 giây mỗi lượt nguội** vì phân tích lại file
  catalog **377 MB ba lần** (bot đo 13/08: cold 60,255s). Deadline 25 giây **nổ ngay khi
  CPU còn đang bận** — các lượt hỏi chưa kịp chạy đã thua.
- Tiến trình còn **tự chết vì hết bộ nhớ** (log 11/08: `JavaScript heap out of memory`
  → `SIGABRT` → PM2 restart; restart counter 48). Mỗi lần restart là nguội lại từ đầu.

Hệ quả khớp đúng hai ảnh CEO chụp sáng 13/08:
- **08:23 — nguội** (vừa restart / cache hết hạn): thua đua hàng loạt ⇒ thiếu **15 NV**,
  màn in 1,44 tỷ của 6 người.
- **07:50 — ấm**: chỉ rớt mã hỏng thật ⇒ thiếu **2 NV** (DN024, VP004 — hai mã này có
  mặt trong MỌI danh sách thiếu ⇒ nghi **thiếu khoá** trong
  `APP_REPORT_EMPLOYEE_COST_KEYS`, cần kiểm riêng: `employeeCost.js:1178` trả
  `not_configured` TRƯỚC khi chạm mạng).

**Kết luận:** còn giữ kiến trúc *"mở màn là đi hỏi mạng trong một cuộc đua"* thì còn
nhảy. Mọi bản vá hiển thị chỉ làm app **nói thật khi thiếu**; không làm nó **hết thiếu**.

## 2. Nguyên tắc — CEO đã chốt cho danh mục, nay áp cho chi phí

CEO 09/08, về catalog: *"danh mục đã kéo về hẳn bên App Report rồi, sao mỗi lần refresh
nó cứ báo đang đồng bộ và gọi từ DataHub — tao nghĩ mày đang thiết kế sai."*

Áp nguyên nguyên tắc đó:

> **Kéo về máy một lần. Màn hình CHỈ đọc bản trên máy. Muốn bản mới: bấm "Đồng bộ lại"
> (hoặc cron nền). Màn hình KHÔNG BAO GIỜ gọi DataHub.**

## 3. Thiết kế

### 3.1 Kho snapshot
- File: `data/employee_cost_snapshots/<ky>.json`, ghi **atomic** qua `persist.js`.
- Nội dung: `{ period, fetchedAt, reports: [tối đa N NV theo roster], completeness:
  { du: boolean, thieu: { <ma>: <lyDo> } }, remoteProvenance, checksum }`.
- N lấy từ `store.targetRoster()` — KHÔNG ghi cứng 21 (T09 lên 25/30 NV tự theo).

### 3.2 Đồng bộ (tách hẳn khỏi đường xem)
- Kích hoạt: nút **"Đồng bộ lại"** + cron nền cho kỳ đang mở (mặc định 30 phút) + một
  lượt lúc khởi động nếu kỳ đang mở chưa có snapshot.
- **Gom DẦN từng NV** (nguyên tắc đã chốt ở `71489a9` — bỏ all-or-nothing): NV nào lấy
  được thì cập nhật phần người đó; NV hỏng ghi lý do (`not_configured` /
  `upstream_unavailable` / `deadline`…). **Không deadline chung** — từng NV timeout
  riêng, chạy nền, không ai ngồi chờ.
- **Bản thiếu không ghi đè phần ĐÃ CÓ**: chỉ thay dữ liệu của một NV khi lấy được bản
  MỚI HƠN của chính NV đó. Snapshot chỉ chuyển `du: true` khi đủ cả roster.

### 3.3 Phục vụ
- `GET /employee-cost` **chỉ đọc snapshot**. Không fan-out, không deadline, không gọi
  mạng. Mở màn < 1 giây, DataHub sống hay chết không ảnh hưởng.
- Đủ roster ⇒ hiện số + nhãn *"số chốt lúc HH:MM DD/MM — bấm Đồng bộ lại để cập nhật"*.
- Thiếu ⇒ các ô tổng toàn đội "Chưa đủ dữ liệu" (cơ chế `3a3a47d` giữ nguyên) + **lý do
  từng mã** (`894e982`) + nút Đồng bộ lại.

### 3.4 Bất biến (ca kiểm bắt buộc)
1. **Hai lần F5 liên tiếp không bấm Đồng bộ ⇒ cùng MỘT model, byte-for-byte.** Đây là
   định nghĩa của "hết nhảy loạn xạ".
2. Bản thiếu không bao giờ làm mất dữ liệu NV đã có trong snapshot trước.
3. Kỳ khoá sổ + snapshot đủ ⇒ snapshot bất biến (chính là "con dấu"; cơ chế seal hiện
   tại giữ nguyên trước mắt, gộp về sau).
4. Roster đổi (thêm NV) ⇒ snapshot cũ tự thành "thiếu" cho tới khi đồng bộ đủ người mới.

### 3.5 Bật/tắt & rollback
- Cờ `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT=1` bật đường mới; tắt là về nguyên đường cũ.
  Rollback = đổi một biến env + restart, một phút.

### 3.6 Ranh giới
- KHÔNG đụng kho doanh thu (đã có đường riêng, không nhảy).
- KHÔNG đổi cách tính thưởng/phạt — chỉ đổi **nguồn** `reports` (từ fetch sang snapshot).
- Tách LKG catalog theo kỳ vẫn là dự án riêng (giảm RAM/cold của **đồng bộ**, không còn
  ảnh hưởng đường xem sau spec này).

## 4. Chia việc
- **Bot (DevReport):** store + cron + route + nút Đồng bộ lại (có dữ liệu/khoá thật để
  thử). Interface: `docSnapshot(ky)`, `dongBoKy(ky, {chiNhungMa})`, `trangThaiDongBo(ky)`.
- **Claude:** review + bộ ca kiểm bất biến (đặc biệt bất biến số 1 và 2).

## 5. Thứ tự triển khai
1. Deploy `3a3a47d` (đã qua Gate 1) — giảm ngay cảnh thua đua (cold 60s → 13,5s) và
   thôi in số thiếu người.
2. Kiểm khoá DN024/VP004 (một phút — có thể xong ngay hôm nay).
3. Bot dựng snapshot store theo spec này (sau cờ, mặc định tắt) → audit → bật.
