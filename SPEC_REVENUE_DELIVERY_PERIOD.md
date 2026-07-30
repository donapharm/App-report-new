# SPEC — QUY KỲ DOANH THU THEO NGÀY THỰC GIAO

> **Bối cảnh:** ngày 29/07 CEO phát hiện App Sale báo **28,96 tỷ** còn App Report báo **28,58 tỷ** — lệch **384.977.920đ**. Truy ra **99,4% chênh lệch nằm ở nguồn đối tác**, và nguyên nhân là **bộ lọc kép ngày** khiến đơn rơi khỏi CẢ HAI kỳ.
>
> Đây **không phải** tính năng mới. Mục 3 là **VÁ LỖI MẤT DOANH THU**, ưu tiên cao nhất.

Người triển khai: **App Sale** (mục 2) + **App Report** (mục 3). Claude: kiến trúc + review.

---

## 0. Bằng chứng — số đã đối chiếu

App Sale tự khớp (snapshot 18:00 29/07):
```
CRM xuất HĐ 19.174.067.183 + Đối tác đã giao 9.786.103.980 = 28.960.171.163  ✓
```

Tách chênh lệch theo nguồn:

| Nguồn | App Sale | App Report | Chênh |
|---|---|---|---|
| **Đối tác (WEB nội bộ)** | 9.786.103.980đ | 9.403.525.580đ | **382.578.400đ** |
| CRM MISA | 19.174.067.183đ | 19.171.667.663đ | 2.399.520đ |
| | | **Tổng** | **384.977.920đ** ✓ |

Cộng lại **đúng bằng** chênh lệch tổng, không dư một đồng.

---

## 1. ‼ LỖI GỐC — bộ lọc kép làm đơn rơi khỏi CẢ HAI kỳ

`server/scripts/materialize_july_revenue.js`, hàm `fetchPartner()`:

```sql
AND o.created_at        >= kỳ_từ  AND o.created_at        < kỳ_đến+1   -- (1) NGÀY ĐẶT trong kỳ
AND COALESCE(partner.effective_date, o.created_at::date) >= kỳ_từ      -- (2) NGÀY GHI NHẬN trong kỳ
AND COALESCE(partner.effective_date, o.created_at::date) <= kỳ_đến
```

**Phải thoả CẢ HAI.** Đơn nào có ngày đặt và ngày ghi nhận ở **hai tháng khác nhau** thì:

| Kỳ | Điều kiện (1) đặt trong kỳ | Điều kiện (2) ghi nhận trong kỳ | Kết quả |
|---|---|---|---|
| **T06** | ✓ đặt 25/06 | ✗ ghi nhận 01/07 | **LOẠI** |
| **T07** | ✗ đặt 25/06 | ✓ ghi nhận 01/07 | **LOẠI** |

⇒ **Biến mất khỏi báo cáo.** Không nằm ở tháng 6, cũng không ở tháng 7.

Hai ví dụ CEO nêu, cả hai đều đang mất:

| Ca | Đặt | Giao thật | Phản hồi | CEO muốn | Máy đang |
|---|---|---|---|---|---|
| A | 25/06 | **25/06** | 01/07 | T06 | **MẤT** |
| B | 25/06 | 02/07 | — | T07 | **MẤT** |

---

## 2. Nguyên nhân sâu — KHÔNG CÓ Ô "NGÀY THỰC GIAO"

Form phản hồi đơn hàng WEB **không có chỗ điền ngày giao thật**, nên máy phải tự đoán:

```sql
CASE
  WHEN có invoice_no  THEN COALESCE(invoice_date, responded_at::date, updated_at::date)
  WHEN có phản hồi    THEN COALESCE(responded_at::date, updated_at::date)   -- ← ĐOÁN
  WHEN có SL giao     THEN invoice_date
END effective_date
```

Không có hoá đơn ⇒ máy lấy **ngày đối tác bấm phản hồi**. Ca A giao thật 25/06 nhưng phản hồi 01/07 ⇒ máy ghi 01/07. **Máy không có cách nào biết** hàng đã giao 25/06 — không ai điền vào đâu cả.

### 2.1 Việc của App Sale — thêm ô "Ngày thực giao"

| Yêu cầu | Chi tiết |
|---|---|
| Vị trí | Form phản hồi đơn hàng WEB, cột riêng trong bảng phản hồi |
| Bắt buộc | **Có** — không điền không lưu được phản hồi |
| Mặc định | Hôm nay |
| **Cho chọn lùi** | **Có** — đối tác phản hồi trễ vẫn khai đúng ngày giao thật (ca A) |
| Chặn | Ngày **tương lai**; ngày **trước ngày đặt hàng** |
| Khoá theo kỳ | Xem mục 4 |
| Nhật ký | Ai điền/sửa · từ ngày nào sang ngày nào · lúc mấy giờ · đơn nào. **Không xoá được** |

### 2.2 Việc của App Report — đổi thứ tự ưu tiên

```
ngày quy kỳ = NGÀY THỰC GIAO  →  ngày hoá đơn  →  ngày phản hồi
```

Ngày phản hồi tụt xuống **cuối cùng**, chỉ dùng khi hai cái trên đều trống.

---

## 3. ‼ VÁ NGAY — bỏ bộ lọc kép (App Report)

**Làm được ngay, không chờ App Sale.** Đây là chỗ đang mất tiền.

**Bỏ hẳn** hai dòng lọc theo `o.created_at` (điều kiện (1)). Quy kỳ **chỉ theo MỘT mốc ngày duy nhất** — ngày quy kỳ ở mục 2.2.

Sau khi sửa, hai ca trên rơi đúng chỗ:

| Ca | Ngày quy kỳ | Vào kỳ |
|---|---|---|
| A (giao 25/06, phản hồi 01/07) | 25/06 *(sau khi App Sale có ô ngày giao)* | **T06** ✓ |
| A (trước khi có ô ngày giao) | 01/07 *(tạm dùng ngày phản hồi)* | T07 — **có số, không mất** |
| B (giao 02/07) | 02/07 | **T07** ✓ |

**Quan trọng:** ngay cả khi App Sale chưa kịp thêm ô ngày giao, bỏ bộ lọc kép vẫn khiến **tiền không còn biến mất** — cùng lắm là rơi nhầm tháng, còn hơn mất hẳn.

### 3.1 Nghiệm thu bắt buộc

1. Chạy lại materialize cho **T06 và T07**, in `sourceSummary` từng nguồn.
2. `APP_WEB_PARTNER` của T07 phải **tăng lên** so với 9.403.525.580đ.
3. Xuất **bảng từng đơn** đã được cứu: mã đơn · ngày đặt · ngày quy kỳ · số tiền · kỳ trước / kỳ sau khi sửa.
4. **Không đơn nào được đếm hai lần** — kiểm tổng T06 + T07 trước và sau khi sửa.
5. Đối chiếu lại với App Sale, báo chênh lệch còn lại là bao nhiêu.

---

## 4. Kỳ khoá sổ — **CEO chốt lại 30/07: hết ngày 8 tháng sau** (thay cho ngày 5)

> CEO 30/07: *"dữ liệu từ ngày 05 tháng sau đổ về trước thì mình sẽ dùng từ **dự kiến** vì còn cập nhật lại doanh thu bán hàng trong khoảng thời gian đó. Còn không thì đẹp nhất là **trước ngày 08** hàng tháng cho rộng rãi để chốt."*
> Vì sao ngày 8: ngày 5 dễ rơi vào thứ 7/CN nên thực tế chỉ còn 2–3 ngày làm việc; các ca như 275.925.600đ chờ App Sale sửa mã đơn vị không xong trong 2 ngày.
> CEO đã xác nhận **ứng lần 01 rơi vào cuối tháng đó và app lương tự tính**, nên không cần số chốt trước ngày 8.

| | |
|---|---|
| Kỳ T06 khoá lúc | **hết ngày 08/07** |
| Kỳ T07 khoá lúc | **hết ngày 08/08** |
| Kỳ T12 khoá lúc | **hết ngày 08/01 năm sau** |

**Biên chính xác:** 23:59 ngày 08 **vẫn chưa** chốt; 00:00 ngày 09 **mới** chốt. Tính theo **giờ Việt Nam**, không theo giờ máy chủ (server chạy UTC).

**‼ Lỗi đã sửa ở v3.5:** trước đó code chốt bằng cách so tháng (`kỳ < tháng hiện tại`) nên **00:00 ngày 01 tháng sau đã dán nhãn "ĐÃ CHỐT KỲ"** trong khi doanh thu còn về tới ngày 8. Mọi chỗ hỏi "kỳ này chốt chưa" nay bắt buộc dùng `employeeCost.isPeriodClosed()`.

**Hai nhãn KHÁC NHAU, không gộp:**
| Nhãn | Nghĩa | Ai xử lý |
|---|---|---|
| **DỰ KIẾN** | Kỳ chưa khoá sổ, doanh thu còn về | Chờ đến ngày 8 |
| **tạm tính** | Danh mục còn mã chưa gán % | DataHub / App Sale phải điền |

Một kỳ có thể **vừa dự kiến vừa tạm tính**; gộp một từ là mất thông tin.

**Phạt:** trong kỳ và tới hết ngày 8 chỉ là **DỰ KIẾN**; sau ngày 8 mới là **SỐ CHÍNH THỨC**. Cờ `penalty.finalized` chỉ đúng khi **vừa trừ thật vừa đã khoá sổ** — đây là điều kiện để chuyển số cho kế toán.

**Trước ngày khoá:** VP018 / DN007 sửa ngày thực giao thoải mái, số tự chạy về đúng kỳ.

**Sau ngày khoá:** **không sửa được nữa**. Muốn sửa phải **CEO duyệt từng đơn**, có ghi nhật ký.

Lý do có mốc này: thưởng/phạt gắn vào con số kỳ. Để mở vô hạn thì tháng nào cũng có thể bị đổi ngược — **không bao giờ chốt được**.

---

## 5. KHÔNG HỒI TỐ — CEO chốt 29/07

> CEO: *"KHÔNG NÊN HỒI TỐ NHÉ, CỨ ĐỂ VP018 VÀ DN007 CHỦ ĐỘNG SỬA LẠI NGÀY THỰC GIAO ĐƠN HÀNG SẼ PHÙ HỢP NHANH CHÓNG CHÍNH XÁC NHẤT."*

Hệ quả bắt buộc:

1. **Sổ kỳ đã chốt KHÔNG BAO GIỜ bị sửa đè.**
2. **Thưởng đã thông báo cho NV: không đòi lại.**
3. **Không phạt hồi tố.** Hàng trả lại kéo NV rơi bậc thì **không** quay lại phạt — tháng đó đã qua, họ không thể bán bù.
4. Sửa ngày thực giao **trong kỳ chưa khoá** không phải hồi tố — đó là **sửa dữ liệu đang nhập**, hoàn toàn hợp lệ.

---

## 6. ⏳ BA VIỆC CHỜ CEO — chưa làm

| # | Việc | Lựa chọn | Claude khuyến nghị |
|---|---|---|---|
| **6.1** | Đơn đặt 25/06 bù hàng 05/07 | Tách đơn bù **/** đổi thẳng ngày đặt | **Tách đơn bù** — giữ được sổ T06 và bảng công nợ |
| **6.2** | Đơn cuối tháng phải chờ 15 ngày mới tính target | ≥50tr hoặc ≥2% target **/** ≥100tr **/** không làm | **≥50tr hoặc ≥2% target** |
| **6.3** | Hàng trả lại: tách "doanh thu tài chính" và "doanh thu đánh giá NV" | Có **/** không | **Có tách** |

**Chưa có quyết định thì KHÔNG code 3 mục này.**

### Vì sao 6.2 quan trọng
Không hồi tố + không chặn = **bán đơn lớn cuối tháng, nhận thưởng, tháng sau trả lại, không mất gì cả**. Không nói ai sẽ làm vậy, nhưng cửa đang mở rất rộng và **phía sau không còn lưới nào**.

---

## 7. Thứ tự làm

| Đợt | Việc | Ai | Chờ ai không |
|---|---|---|---|
| **1** | Mục 3 — bỏ bộ lọc kép | App Report | **Không** — làm ngay |
| **2** | Mục 2.1 — ô Ngày thực giao | App Sale | Không |
| **3** | Mục 2.2 — đổi thứ tự ưu tiên | App Report | Chờ đợt 2 |
| **4** | Mục 4 — khoá sổ ngày 5 | Cả hai | Chờ đợt 2 |
| **5** | Mục 6 | — | **Chờ CEO** |

**KHÔNG deploy trước 31/07** — ngày chốt tháng đang chạy tin chi phí 17:30 và tin thưởng 17:40 cho cả công ty.

---

## 8. Nguyên tắc chung

1. **Chỉ đọc khi điều tra.** Không sửa dữ liệu live, không tự đổi quy tắc quy kỳ khi chưa có lệnh CEO.
2. **Không đếm hai lần.** Mọi thay đổi quy kỳ phải kiểm tổng trước/sau.
3. **Fail-closed.** Không xác định được ngày quy kỳ ⇒ giữ dòng lại và báo, **không đoán bừa, không âm thầm bỏ**.
4. **Ghi `CHANGELOG.md`** mỗi đợt.
