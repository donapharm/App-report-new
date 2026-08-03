# SPEC — MỘT LUẬT DOANH THU DUY NHẤT (CEO chốt 2026-08-03)

> CEO: *"đề nghị mày thống nhất một bộ code để cho chuẩn, **tháng nào cũng tính đúng một công thức đó, nhảy tự động theo tháng, không có lệch** — chứ tao loay hoay với mấy vụ như này mệt lắm rồi."*

Đây là **luật gốc**. Mọi spec/directive khác về doanh thu phải phục tùng file này.

---

## 1. LUẬT — chỉ có MỘT

```
Doanh thu App Report  =  Ô "ĐÃ THỰC HIỆN" của App Sale
                      =  CRM đã xuất hoá đơn  +  Đối tác đã xuất/giao
```

Chi tiết, khớp từng chữ với App Sale:

| Nguồn | App Sale hiển thị | App Report đọc |
|---|---|---|
| **CRM MISA** | *"CRM — Thành tiền xuất hoá đơn"* · gồm **Đã ghi + Đề nghị ghi** | `misa_revenue_snapshot_lines`, `revenue_bucket in (official, pending)`, tiền = `invoice_export_amount` |
| **Đối tác WEB** | *"Đối tác — Thành tiền đã xuất giao hàng"* · **SL giao thực × đơn giá** | `partner_order_line_responses` (bản mới nhất mỗi order_item), tiền = `delivered_qty × price` |

**Quy kỳ (tính vào tháng nào):** theo **MỘT mốc ngày duy nhất** — ngày hoá đơn → ngày xác nhận giao.

---

## 2. BA ĐIỀU CẤM (đã trả giá bằng tiền thật)

**① CẤM App Report tự thêm bộ lọc App Sale không có.**
Ngày 02–03/08 thêm bộ lọc loại đơn nhập tay/Zalo ⇒ lệch **487.924.000đ**. App Sale **có** tính những đơn đó.
*App Sale là nguồn sự thật. App Report soi chiếu, không diễn giải lại.* Muốn đổi cách tính ⇒ **đổi ở App Sale trước**.

**② CẤM lọc kép theo ngày đặt (`o.created_at`).**
Đơn đặt cuối tháng này, giao đầu tháng sau sẽ **rơi khỏi cả hai kỳ** ⇒ từng mất **382.578.400đ** (`SPEC_REVENUE_DELIVERY_PERIOD.md`, CEO chốt 29/07).

**③ CẤM ghi cứng tháng trong vùng tính doanh thu.**
Kỳ lấy theo `REVENUE_REFRESH_KY` → `MATERIALIZE_KY` → `defaultKy()`. `defaultKy()` dùng **`Asia/Bangkok` (GMT+7)** — dùng giờ UTC thì 0h–7h sáng giờ VN ra **tháng trước**.

---

## 3. TỰ NHẢY THEO THÁNG — không phải làm gì thêm

Sang tháng mới, `defaultKy()` tự trả tháng lịch VN hiện tại. **Không sửa code, không đổi cấu hình, không ai phải bấm gì.**
Tên file `scripts/materialize_july_revenue.js` có chữ "july" là **tên cũ từ hồi làm T07** — bên trong **không khoá tháng nào cả**. (Đổi tên được, nhưng phải sửa mọi nơi gọi tới; chưa cần thiết.)

---

## 4. KHOÁ CHỐNG SỬA LÉN — `server/test/revenueRuleLock.test.js`

Vân tay SHA-256 của phần mã quyết định doanh thu (`fetchMisa` + `fetchPartner`) được chốt trong `server/config/revenue_rule_lock.json`.

Test đỏ khi ai đó:
- Đổi điều kiện lọc đơn (kể cả sửa 1 ký tự)
- Thêm lại `manual_zalo` / `PARTNER_TOKEN_INVOICE` / bộ lọc riêng khác
- Lọc theo `o.created_at`
- Ghi cứng kỳ `MM.YYYY` hoặc ngày `YYYY-MM-DD` vào vùng tính
- Bỏ `Asia/Bangkok` khỏi `defaultKy()`

**Đã thử phá để kiểm chứng:** lén thêm `partner.source <> 'manual_zalo'` ⇒ test **đỏ ngay**, kèm câu chỉ rõ sai ở đâu và phải làm gì.

### Muốn đổi luật (hiếm) thì làm đủ 3 bước
1. Cập nhật `ruleHash` trong `config/revenue_rule_lock.json`
2. Nâng `version` trong file lock đó
3. Ghi `CHANGELOG.md`: đổi gì · vì sao · **đã đối chiếu App Sale ra số bao nhiêu**

---

## 5. QUY TRÌNH KHI HAI APP LỆCH

1. **Kiểm bộ lọc NGÀY của màn App Sale TRƯỚC TIÊN.** Lệch do bộ lọc ngày trông y hệt lệch do sai công thức — đã lừa được cả CEO, Claude và bot một lần (tối 02/08 App Sale hiện "đối tác 0 đơn" chỉ vì lọc theo ngày đặt).
2. Chụp **hai màn cùng lúc**, chênh < 2 phút, cùng kỳ, App Sale để mốc **"Ngày phản hồi/giao"**.
3. Còn lệch ⇒ mở màn **"Chưa đồng bộ"** (`SPEC_REVENUE_SYNC_EXCEPTIONS.md`) xem dòng nào bị loại + vì sao.
4. **KHÔNG sửa công thức App Report** để "cho khớp". Khớp bằng cách dùng đúng luật, không bằng cách vá số.

---

## 6. KỶ LUẬT TRIỂN KHAI

**Push lên `origin/main` TRƯỚC — deploy TỪ `origin/main`. Không ngoại lệ.**

Đã 4 lần production chạy code không có trên git (`97b87d6`, `640685c`, `a1e17aa`, `a4e1a7f`). Lần thứ 4 **gây lệch tiền thật 487.924.000đ** vì bộ lọc chỉ tồn tại trên máy bot, không ai soi được.
