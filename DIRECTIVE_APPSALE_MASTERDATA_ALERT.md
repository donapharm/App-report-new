# DIRECTIVE — App Sale phải TỰ BÁO Telegram khi thiếu dữ liệu gốc (CEO chốt 2026-07-26)

> Claude Code (kiến trúc) soạn cho **bot App Sale**. Người nhận cảnh báo: **CEO + VP018**.
> **Nguyên tắc CEO:** *"Bắt ngay tại thời điểm đơn hàng thực thi xong — xử lý tại gốc, không để treo."*
> Khuôn mẫu đã chạy thật: `server/src/employeeCostSourceAlert.js` (App Report) — **sao chép cơ chế**, đổi nội dung.

## 0. Vì sao có directive này
Ngày 26/07 App Report phát hiện **7 exception · 114.163.000đ doanh thu** không tính được chi phí. Truy ra
**toàn bộ đều là thiếu dữ liệu gốc bên App Sale**:
- 1 mã đơn vị chưa có trong danh mục (`175.BVĐK Vũng Tàu`) — **91.975.200đ**;
- 6 dòng thiếu **hệ số quy đổi ĐVT** trong danh mục *"hàng nhiều mã"* (Ống↔Gói/ống · Viên↔Gói · Gói↔Gam).

Vấn đề **không phải** ở chỗ có lỗi, mà ở chỗ **lỗi nằm im nhiều ngày** cho tới khi CEO tự mở báo cáo và tự phát hiện.
Sửa gốc = **App Sale tự la lên ngay lúc đơn hàng chạy qua chỗ thiếu dữ liệu**.

## 1. BẮT TẠI GỐC — thời điểm kích hoạt
Ngay **sau khi đơn hàng thực thi xong** (đơn đã ghi nhận thành công), App Sale kiểm dữ liệu gốc của **chính các dòng
trong đơn đó**. Phát hiện thiếu → **nhắn Telegram ngay**, không chờ báo cáo cuối kỳ, không chờ ai hỏi.
- **Không được chặn/huỷ đơn.** Đơn vẫn ghi bình thường — cảnh báo là việc song song. Lỗi gửi tin **tuyệt đối không**
  làm hỏng luồng đặt hàng (bọc try/catch, chỉ log).

## 2. CÁC LOẠI THIẾU PHẢI BÁO
| # | Loại | Điều kiện phát hiện | Sửa ở đâu |
|---|---|---|---|
| 1 | **Đơn vị chưa nhận diện** | mã đơn vị trên dòng đơn không có trong **danh mục đơn vị** | Danh mục đơn vị App Sale |
| 2 | **Mã phụ chưa gắn mã gốc** | mã QLNB không có dòng trong *"hàng nhiều mã"* → chưa quy được về mã gốc | Danh mục "hàng nhiều mã" |
| 3 | **Thiếu hệ số quy đổi ĐVT** | có dòng mã phụ↔mã gốc nhưng **ĐVT khác nhau** mà cột **Hệ số** trống/0 | Cột "Hệ số" |
| 4 | **Quan hệ mã mơ hồ** | 1 mã phụ trỏ **nhiều** mã gốc, hoặc hệ số mâu thuẫn giữa các dòng | Danh mục "hàng nhiều mã" |

> Loại 2–4 chính là nguồn App Report đọc qua `GET /api/integrations/app-report/product-master-crosswalk`
> (App Report **đã build sẵn**, chờ App Sale mở). Loại 1 thuộc danh mục đơn vị.

## 3. NỘI DUNG TIN NHẮN (bắt buộc)
Phải **nêu đích danh** để người nhận hành động được ngay, không phải đi dò:
```
⚠️ App Sale — THIẾU DỮ LIỆU GỐC (phát hiện lúc đơn hàng thực thi)
Đơn: <mã đơn> · <thời điểm> · NV: <mã NV>
Loại: Thiếu hệ số quy đổi ĐVT
Mã QLNB: G3.ĐY.QĐ141.121.N3.179 (Bát trần) — ĐVT Ống ↔ Gói/ống, cột Hệ số đang trống
Đơn vị: CÔNG TY CỔ PHẦN BỆNH VIỆN ĐỒNG NAI -2
Hệ quả: App Report KHÔNG tính được chi phí cho dòng này (fail-closed, không tính sai).
Sửa tại: App Sale → Quản trị → Admin Data Hub → "Hàng nhiều mã" → điền cột Hệ số.
```
- **CẤM đưa vào tin:** số tiền chi phí, tỷ lệ %, cột `C32`–`C47`, PII (SĐT/CCCD/email). Doanh thu ảnh hưởng thì
  **được** (người nhận là CEO/VP018). Có test chặn như bên App Report.

## 4. NHỊP GỬI — giống hệt cơ chế "chưa có % chi phí" đã chạy
1. **Lần đầu:** ngay khi phát hiện (tại thời điểm đơn thực thi xong).
2. **Nhắc lại mỗi 6 GIỜ** nếu **vẫn chưa fix** — báo đỏ, kèm số lần đã nhắc + tổng doanh thu đang bị treo.
3. **Chỉ gửi khi TRẠNG THÁI ĐỔI hoặc tới hạn 6h** — không spam mỗi đơn hàng. Gom theo *khoá lỗi*
   (`loại + mã + đơn vị`), không nhắn trùng cùng một lỗi.
4. **BÁO HOÀN THÀNH khi fix xong:**
```
✅ App Sale — ĐÃ FIX XONG
Mã QLNB G3.ĐY.QĐ141.121.N3.179 đã có Hệ số quy đổi (1 Gói = 5 Ống).
Tổng thời gian treo: 6 giờ 20 phút. App Report sẽ tự tính lại chi phí cho các dòng liên quan.
```
   → CEO biết việc đã khép, **không phải tự đi kiểm tra lại**.

## 5. NGƯỜI NHẬN
- **CEO** và **VP018** — qua Telegram.
- Chỉ 2 người này (dữ liệu vận hành nội bộ). NV thường **không** nhận.
- Chưa cấu hình được Telegram/chưa liên kết tài khoản → **no-op im lặng**, ghi log; không được làm hỏng luồng đơn.

## 6. YÊU CẦU KỸ THUẬT (fail-safe, bất di)
1. **Không chặn đơn hàng** vì thiếu dữ liệu gốc — chỉ cảnh báo.
2. **Không bao giờ đoán/tự điền** hệ số hay mã gốc. Thiếu là báo, **không suy ra**.
3. Gửi tin lỗi → **chỉ log**, không ném ra ngoài, không retry vô hạn.
4. **Audit mọi cảnh báo**: thời điểm, loại lỗi, mã, đơn liên quan, đã gửi cho ai, lần nhắc thứ mấy, thời điểm fix xong.
5. Trạng thái lưu bền (qua restart) để không mất mốc 6h và không nhắn lại từ đầu.

## 7. NGHIỆM THU (phải diễn tập, nộp log)
1. Tạo đơn có mã đơn vị lạ → **CEO+VP018 nhận tin trong vòng 1 phút**, tin nêu đúng mã đơn vị + chỗ sửa.
2. Tạo đơn có mã phụ thiếu hệ số (ĐVT khác nhau) → nhận tin đúng loại 3, nêu đúng cặp ĐVT.
3. Để nguyên không fix → **đúng 6h sau có tin nhắc lại**, không có tin thừa ở giữa.
4. Tạo thêm 5 đơn cùng lỗi đó → **KHÔNG** sinh 5 tin (chỉ gom 1 khoá lỗi).
5. Fix dữ liệu → **nhận tin ✅ ĐÃ FIX XONG**, sau đó **im lặng hoàn toàn**.
6. Tắt Telegram token → luồng đặt hàng **vẫn chạy bình thường**, chỉ ghi log.
7. Kiểm tin nhắn **không chứa** %/chi phí/C32–C47/PII.

## 8. LIÊN THÔNG
Sau khi App Sale mở `product-master-crosswalk` + điền đủ hệ số → App Report **tự hết** 6 exception ĐVT và
**tự khớp mọi hàng mới về sau** (App Report đã có `appSaleProductCrosswalk.js`, chỉ chờ nguồn).
Mã đơn vị `175.BVĐK Vũng Tàu` xử riêng ở danh mục đơn vị.
