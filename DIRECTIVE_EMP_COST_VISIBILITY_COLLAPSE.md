# DIRECTIVE — Thu gọn panel "Quản trị quyền tự xem chi phí" (UI, CEO 2026-07-22)

> Claude Code giao Report Bot. **Làm CÙNG nhánh review với fix C44** (deploy 1 lượt sau khi Claude duyệt).
> Chỉ UI/UX — KHÔNG đụng logic quyền/lưu công tắc/backend.

## 1. VẤN ĐỀ
Panel admin "Quản trị quyền tự xem chi phí" (phòng + 3 nhóm + 21 NV theo cá nhân) quá dài → đẩy **phần chính
(bảng chi phí)** xuống sâu. CEO muốn **ưu tiên phần chính**, panel công tắc chỉ mở khi cần thao tác.

## 2. YÊU CẦU
- Panel công tắc thành **thu gọn được**, **MẶC ĐỊNH THU GỌN** khi vào trang.
- **Header luôn hiện:** tiêu đề "Quản trị quyền tự xem chi phí" + tóm tắt ngắn (vd `21 NV · 3 nhóm · Toàn phòng: Tắt`)
  + **nút bật/thu gọn** (vd "Mở quản trị" ⇄ "Thu gọn"). Nút rõ ràng, bấm là mở/gập.
- **Khi THU GỌN:** ẩn toàn bộ phần điều khiển (ô Toàn phòng, 3 thẻ nhóm, danh sách 21 NV, nút "Lưu công tắc").
  Chỉ chừa header → **bảng chi phí đôn lên ngay dưới**.
- **Khi MỞ:** hiện đầy đủ như hiện tại (không đổi bố cục bên trong).
- **Nhớ trạng thái** theo admin (localStorage, vd `empCostVisibilityCollapsed`) — lần sau giữ đúng lựa chọn; **lần đầu = thu gọn**.
- Chỉ hiển thị cho ADMIN như hiện tại (panel vốn chỉ admin thấy).
- **Desktop + mobile** đều gọn; mobile panel càng cần thu gọn.

## 3. GIỮ NGUYÊN
- Toàn bộ **logic quyền/ưu tiên (cá nhân > nhóm > phòng), lưu công tắc, audit, backend** KHÔNG đổi — chỉ ẩn/hiện UI.
- Không đụng bảng chi phí, self-scope, C32/C47, C44 (fix C44 theo directive riêng).
- Nếu đang có thay đổi chưa lưu mà admin thu gọn: **giữ nguyên draft** (không mất), mở lại vẫn còn — hoặc nhắc "chưa lưu".

## 4. NGHIỆM THU
1. Vào trang (admin): panel công tắc **thu gọn sẵn**, bảng chi phí hiện cao lên đầu.
2. Bấm "Mở quản trị" → hiện đủ phòng/nhóm/21 NV/nút Lưu; bấm "Thu gọn" → gập lại. Reload → giữ trạng thái vừa chọn.
3. Mở panel, đổi 1 công tắc, Lưu → vẫn hoạt động đúng (logic không đổi). Draft không mất khi gập/mở.
4. Mobile + desktop đều gọn, không tràn.
5. Push cùng nhánh review (kèm fix C44); báo Claude review; chưa deploy.
