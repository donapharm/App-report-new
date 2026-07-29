# SPEC — MÀN "CHƯA ĐỒNG BỘ": mọi dòng bị loại đều phải nêu tên và nêu lý do

> **CEO chốt 2026-07-29:** *"anh đề nghị có một màn riêng để lọc ra những mã đơn hàng / mặt hàng / nhà thầu chưa đồng bộ qua App Report được, phải có kèm nội dung lý do sao không cho đồng bộ với đơn hàng đó / mã hàng đó / mã nhà thầu đó. Để xử lý tại chỗ, tránh chạy lòng vòng như thế này mệt lắm rồi."*

Người triển khai: **bot server**. Claude: kiến trúc + review.

---

## 0. Vì sao cần — hai vụ thật trong cùng một ngày

| Khoản | Mất bao lâu không ai biết | Vì sao không ai biết |
|---|---|---|
| **382.578.400đ** | từ 11/07 → 29/07 (**18 ngày**) | Bị loại lặng lẽ bởi `o.status <> 'HOLD_GOLIVE'` |
| **2.399.520đ** | cả tháng 7 | Bị loại lặng lẽ vì `revenue_date` NULL |

Cả hai **chỉ lộ ra vì CEO tình cờ mở hai màn hình cạnh nhau rồi trừ tay**. Không có cái đó thì đến giờ vẫn không ai biết.

Rồi truy ra mất **gần trọn một ngày** của cả CEO lẫn hai bot — đúng cái CEO gọi là *"chạy lòng vòng, mệt lắm rồi"*.

**Vấn đề gốc không phải hai khoản tiền đó. Vấn đề là hệ thống ném dòng đi mà không nói với ai.**

---

## 1. ‼ NGUYÊN TẮC SỐ MỘT — KHÔNG DÒNG NÀO ĐƯỢC BIẾN MẤT LẶNG LẼ

Hiện `fetchMisa()` / `fetchPartner()` loại dòng bằng mệnh đề `WHERE`. Dòng bị loại **không để lại dấu vết nào** — không log, không đếm, không hiện ở đâu.

**Phải đảo ngược cách làm:**

```
Bước 1  Lấy TOÀN BỘ dòng của kỳ (universe), KHÔNG lọc
Bước 2  Phân loại từng dòng: ĐƯA VÀO  hoặc  LOẠI + MÃ LÝ DO
Bước 3  Ghi 2 kết quả:
          - dòng ĐƯA VÀO  -> slot doanh thu (như hiện nay)
          - dòng LOẠI     -> bảng ngoại lệ, KÈM LÝ DO
```

Số tiền không đổi một đồng so với hôm nay. Khác duy nhất: **phần bị loại nay có tên, có mặt, có lý do.**

### 1.1 Bất biến số học — bắt buộc kiểm mỗi lần chạy

```
Σ(đưa vào) + Σ(loại)  ==  Σ(toàn bộ nguồn)
số dòng đưa vào + số dòng loại  ==  số dòng nguồn
```

**Không khớp ⇒ DỪNG, không ghi slot, báo lỗi.** Nghĩa là có dòng rơi ở chỗ không ai khai báo.

Chỉ riêng phép kiểm này đã **bắt được cả hai vụ hôm nay ngay lần chạy đầu tiên**.

---

## 2. Danh mục lý do — mỗi lý do phải nói rõ AI XỬ LÝ và XỬ THẾ NÀO

Không được dùng lý do chung chung kiểu *"không hợp lệ"*. Người đọc phải **làm được ngay**.

### 2.1 Nguồn CRM MISA

| Mã lý do | Nghĩa | Ai xử lý | Làm gì |
|---|---|---|---|
| `MISA_CHUA_GHI_DOANH_SO` | bucket ngoài `official`/`pending` | Kế toán | Ghi doanh số, hoặc xác nhận huỷ |
| **`MISA_THIEU_NGAY_DOANH_THU`** | **đã ghi doanh số, có tiền, nhưng `revenue_date` NULL** | **Kế toán MISA** | **Nhập ngày ghi doanh thu** |
| `MISA_NGAY_NGOAI_KY` | `revenue_date` thuộc kỳ khác | — | Chỉ để biết, sẽ vào kỳ của nó |
| `MISA_NGHI_DON_TEST` | `is_test_suspected = true` | App Sale | Xác nhận thật/test rồi gỡ cờ |
| `MISA_TIEN_BANG_0` | thành tiền = 0 | Kế toán | Kiểm lại đơn giá / số lượng |

> `MISA_THIEU_NGAY_DOANH_THU` chính là vụ **2.399.520đ** — đơn `DH479815711`.

### 2.2 Nguồn APP WEB đối tác

| Mã lý do | Nghĩa | Ai xử lý | Làm gì |
|---|---|---|---|
| `WEB_CHUA_CO_PHAN_HOI` | đối tác chưa phản hồi đơn | NV phụ trách | Nhắc đối tác phản hồi |
| `WEB_GIAO_BANG_0` | có phản hồi nhưng SL giao = 0 | NV phụ trách | Xác nhận đã giao hay huỷ |
| `WEB_DON_TEST` | `is_test` và chưa phản hồi | App Sale | Gỡ cờ test |
| `WEB_NGAY_NGOAI_KY` | ngày quy kỳ thuộc kỳ khác | — | Chỉ để biết |
| `WEB_SAI_NHOM` | `entity_group` ≠ `PARTNER` | App Sale | Kiểm lại phân loại đơn |

### 2.3 Vào được nhưng THIẾU THÔNG TIN — cảnh báo riêng, không loại

Nhóm này **vẫn tính tiền đủ**, nhưng thiếu dữ liệu nên **rơi khỏi bộ lọc** — nguy hiểm vì nhìn tổng thì đúng, lọc ra thì mất.

| Mã lý do | Nghĩa | Ai xử lý | Làm gì |
|---|---|---|---|
| **`DON_VI_THIEU_DANH_MUC`** | mã đơn vị không có trong danh mục App Report ⇒ **mất tỉnh** ⇒ **biến mất khi lọc theo tỉnh** | DataHub / App Report | Thêm mã đơn vị vào danh mục |
| `MA_HANG_THIEU_DANH_MUC` | mã QLNB không có trong danh mục | DataHub | Thêm mã hàng |
| `NV_XUNG_DOT_ROSTER` | `emp_code` nguồn không khớp roster ⇒ dồn về `UNALLOCATED` | Nhân sự | Sửa phân công |

> `DON_VI_THIEU_DANH_MUC` chính là vụ **mã 175.BVĐK Vũng Tàu** — tiền tính đủ 275,9 triệu nhưng lọc theo tỉnh thì không thấy.

### 2.4 Ghi chú, KHÔNG phải ngoại lệ

| Mã | Nghĩa |
|---|---|
| `WEB_HOLD_GOLIVE_DA_GIAO` | đơn `HOLD_GOLIVE` nhưng đã giao thực ⇒ **VẪN TÍNH** (CEO chốt 29/07). Hiện ra để theo dõi, **không** nằm trong nhóm bị loại |

---

## 3. Màn hình — ba cách nhóm CEO yêu cầu

Trang mới **"Chưa đồng bộ"**, dựng theo đúng khuôn `DataQualityPanel` đang có (cùng bộ lọc, cùng nút xuất Excel) — **không dựng UI mới từ đầu**.

### 3.1 Hàng KPI trên cùng

| Ô | Nội dung |
|---|---|
| **Tổng chưa đồng bộ** | số dòng + **tổng tiền** |
| **Cần xử lý gấp** | chỉ nhóm CÓ TIỀN mà đáng lẽ phải vào (vd thiếu ngày doanh thu) |
| **Chỉ để biết** | ngày thuộc kỳ khác, chưa ghi doanh số — không cần làm gì |
| **Thiếu danh mục** | vào được nhưng mất tỉnh / mất mã hàng |

**Fail-closed:** chưa chạy đối soát ⇒ hiện **"Chưa có dữ liệu đối soát"**, **tuyệt đối không hiện `0`**. Số 0 nghĩa là *"đã kiểm, không có gì"* — nói sai chỗ này còn tệ hơn không nói.

### 3.2 Ba tab nhóm — đúng yêu cầu CEO

| Tab | Nhóm theo | Mỗi dòng hiện |
|---|---|---|
| **Đơn hàng** | mã đơn | mã đơn · ngày · NV · đơn vị · tiền · **lý do** · **ai xử lý** · **làm gì** |
| **Mặt hàng** | mã QLNB | mã hàng · tên · số đơn dính · tổng tiền · **lý do hay gặp nhất** |
| **Nhà thầu** | mã nhà thầu | tên nhà thầu · số đơn · tổng tiền · **lý do** |

Bấm vào dòng nhóm ⇒ bung ra **danh sách đơn chi tiết** bên dưới. Không phải mở trang khác.

### 3.3 Bộ lọc
Kỳ · nguồn (CRM / WEB) · mã lý do · nhân viên · đơn vị · tỉnh · **chỉ dòng có tiền**.

### 3.4 Xuất Excel
Đúng phần đang lọc, đủ cột lý do — để gửi thẳng cho kế toán / DataHub / App Sale mà không phải chép tay.

---

## 4. Quyền

1. **CEO/admin**: xem toàn bộ.
2. **NV**: chỉ thấy đơn **của chính mình** — `auth.scopeOf(session)`, khoá ở backend. Đây là dữ liệu doanh thu, đúng nguyên tắc self-scoped đang có.
3. Xuất Excel theo đúng phạm vi người xuất.

---

## 5. ‼ KHÔNG tự sửa dữ liệu

Màn này để **nhìn ra và giao việc**, **không phải để sửa**.

- **Không** cho bấm nút sửa ngày, gỡ cờ, thêm mã ngay trên màn.
- **Không** cho App Report tự đoán ngày thay `revenue_date` NULL. Hôm nay 1 dòng; mai kia 50 dòng thì **doanh thu nhảy tháng hàng loạt mà không ai hay**.
- Sửa phải làm **ở nguồn** — MISA, App Sale, DataHub — rồi chạy lại đối soát thì dòng tự biến mất khỏi danh sách.

Đó là cách "xử lý tại chỗ" đúng nghĩa: **nhìn thấy ngay, biết giao cho ai ngay** — chứ không phải sửa liều ở nơi chỉ đọc.

---

## 6. Test bắt buộc

**Bất biến — quan trọng nhất**
1. `Σ(đưa vào) + Σ(loại) == Σ(nguồn)` về **cả tiền lẫn số dòng**. Lệch ⇒ **DỪNG, không ghi slot**.
2. Cố tình thêm một bộ lọc mới mà **quên khai mã lý do** ⇒ bất biến vỡ ⇒ **test đỏ**. Đây là lưới chặn đúng lỗi đã xảy ra hai lần hôm nay.

**Dựng lại đúng hai vụ thật**
3. Dòng `official` + tiền ≠ 0 + `revenue_date` NULL ⇒ ra `MISA_THIEU_NGAY_DOANH_THU`, **đúng 2.399.520đ**, kèm đúng mã đơn `DH479815711`.
4. Dòng `HOLD_GOLIVE` đã giao ⇒ **KHÔNG** nằm trong nhóm bị loại (đã tính vào doanh thu).
5. Mã đơn vị ngoài danh mục ⇒ ra `DON_VI_THIEU_DANH_MUC`, **tiền vẫn tính đủ** (không được trừ đi).

**Fail-closed**
6. Chưa chạy đối soát ⇒ hiện **"Chưa có dữ liệu đối soát"**, `assert.doesNotMatch(value, /^0/)`.
7. Mọi mã lý do đều **phải có** đủ 3 phần: nghĩa · ai xử lý · làm gì. Thiếu một phần ⇒ test đỏ.

**Quyền**
8. NV chỉ thấy đơn của mình; ép `emp_code` người khác ⇒ **403**.

---

## 7. Thứ tự làm

| Đợt | Việc | Ghi chú |
|---|---|---|
| **1** | Đảo cách lọc: lấy toàn bộ → phân loại → 2 kết quả. **Kèm bất biến ở 1.1** | Backend. Số tiền **không đổi một đồng** |
| **2** | Màn hình + 3 tab + xuất Excel | Theo khuôn `DataQualityPanel` |
| **3** | Nối vào lịch chạy đối soát hằng ngày | Có ngoại lệ mới thì báo CEO |

**Đợt 1 đã có giá trị ngay** kể cả khi chưa có màn hình — chỉ cần con số ngoại lệ in ra log mỗi lần chạy là đã hơn hẳn hôm nay.

**KHÔNG deploy trước 31/07.**

---

## 8. CẢNH BÁO TELEGRAM KHI ĐỒNG BỘ LỖI (CEO chốt 2026-07-29)

> CEO: *"khi đồng bộ mà lỗi thì hệ thống báo về Telegram cho VP018 / DN007 / CEO để biết xử lý. Và báo về bot Sale luôn."*

Không có cảnh báo thì màn hình ở mục 3 vẫn phải **có người chủ động mở ra mới thấy** — mà chính vì không ai mở nên 382,6 triệu nằm im 18 ngày.

### 8.1 ‼ NGƯỜI NHẬN — PHẢI LÀ DANH SÁCH RIÊNG, TUYỆT ĐỐI KHÔNG DÙNG LẠI DANH SÁCH CŨ

**VP018 hiện đang nằm trong `config/notify_optout.json`** — danh sách *"TUYỆT ĐỐI không nhận thông báo tự động"* (cùng `DN021`, `DN023`, `VP004`), và cũng có trong `dormantFeedback.TELEGRAM_HARD_EXCLUDED`.

Có **hai cách làm sai**, cả hai đều hỏng:

| Làm sai | Hậu quả |
|---|---|
| Lọc cảnh báo đồng bộ qua `targetNotify.isMuted` | **VP018 không nhận được gì** — đúng người CEO chỉ định lại bị chặn |
| Gỡ VP018 khỏi `notify_optout.json` | VP018 **nhận lại toàn bộ** tin target / mốc thưởng / chi phí / doanh thu — thứ đã cố ý loại |

**Đây đúng loại lỗi đã dính ngày 28/07** — lấy danh sách của việc này dùng cho việc khác. Lần đó là `diemXu.EXCLUDE`, suýt chặn nhầm DN022.

**Cách đúng:** danh sách **HOÀN TOÀN MỚI**, mục đích khác, không dính gì tới 4 danh sách đang có.

```
server/config/sync_alert_recipients.json
```

Ghi chú bắt buộc trong file đó, nguyên văn:

> *Đây là kênh CẢNH BÁO VẬN HÀNH khi đồng bộ doanh thu lỗi — KHÁC hoàn toàn với thông báo hiệu suất (target/thưởng/chi phí/doanh thu). `notify_optout.json` chỉ chặn thông báo hiệu suất; **KHÔNG áp vào đây**. VP018 nằm trong optout nhưng **VẪN PHẢI** nhận cảnh báo đồng bộ, vì VP018 là người sửa ngày thực giao.*

Đồng thời **bổ sung một câu vào `notify_optout.json`** nói rõ phạm vi của nó chỉ là thông báo hiệu suất, để lần sau không ai hiểu nhầm.

**Người nhận và phần việc:**

| Người | Nhận phần nào |
|---|---|
| **VP018**, **DN007** | Đơn hàng · ngày giao · đơn vị — **những thứ họ sửa được** |
| **CEO** | Bản tổng: tổng số mục, tổng tiền, ai đang phải xử lý bao nhiêu |
| **Bot App Sale** | Phần thuộc App Sale: cờ test, `entity_group` sai, `HOLD_GOLIVE` bất thường |

Mỗi người nhận **đúng phần của mình**, không phải bản giống nhau. Nhận thứ mình không sửa được thì lần sau sẽ không đọc nữa.

### 8.2 Hai mức cảnh báo — KHÁC NHAU RÕ

**Mức 1 — KHẨN, gửi NGAY, không đợi khung giờ**

Bất biến ở mục 1.1 vỡ: `Σ(đưa vào) + Σ(loại) ≠ Σ(nguồn)`.

Đây **không phải ngoại lệ dữ liệu — đây là hệ thống hỏng**: có dòng rơi ở chỗ không ai khai báo. Kèm luôn: **đã DỪNG, chưa ghi slot**.

**Mức 2 — CẦN XỬ LÝ, gửi theo khung 07:30 hằng ngày**

Chỉ 2 nhóm:
- Nhóm **cần xử lý** (có tiền, đáng lẽ phải vào): thiếu ngày doanh thu · tiền = 0 · giao = 0 · sai nhóm · nghi đơn test
- Nhóm **thiếu danh mục**: đơn vị / mã hàng ngoài danh mục · NV xung đột roster

**TUYỆT ĐỐI KHÔNG báo nhóm "chỉ để biết"** — chưa ghi doanh số · ngày thuộc kỳ khác · đối tác chưa phản hồi. Mấy cái này **lúc nào cũng có**; báo hằng ngày thì 3 hôm là không ai đọc nữa, và **cảnh báo thật sẽ chìm nghỉm giữa đống rác**.

### 8.3 Chống spam — chỉ báo cái MỚI

Một ngoại lệ tồn tại 10 ngày **không được nhắn 10 lần**.

- Chỉ nhắn ngoại lệ **mới xuất hiện lần đầu**.
- Cái đã nhắn rồi ⇒ chỉ gộp vào **một dòng tóm tắt**: *"còn tồn N mục cũ chưa xử lý — xem trên app"*.
- Ngoại lệ đã được xử lý xong ⇒ **báo một lần** *"đã hết"*, rồi thôi.
- **Không có gì mới ⇒ KHÔNG GỬI.** Đúng chốt của CEO ngày 28/07: *"không có tin gì thì không gửi"*.

Trạng thái đã-nhắn lưu ở `data/sync_alert_state.json`, cùng cách `notif_cost_state.json` đang làm.

### 8.4 Mẫu tin

```
⚠ ĐỒNG BỘ DOANH THU — 3 mục mới cần xử lý (kỳ 07.2026)

1. Đơn DH479815711 · 2.399.520đ · DN010
   Lý do: đã ghi doanh số nhưng THIẾU NGÀY DOANH THU
   → Kế toán MISA nhập ngày ghi doanh thu

2. Đơn vị 175.BVĐK Vũng Tàu · 275.925.600đ
   Lý do: mã đơn vị chưa có trong danh mục → mất tỉnh, không lọc được
   → DataHub thêm mã đơn vị

3. ...

Còn tồn 12 mục cũ chưa xử lý — xem trên app.
```

Mỗi mục **bắt buộc** có: **cái gì · bao nhiêu tiền · vì sao · ai làm gì**. Thiếu phần "ai làm gì" thì người nhận lại phải đi hỏi — đúng cái *"chạy lòng vòng"* CEO muốn bỏ.

### 8.5 ⛔ Kênh sang bot App Sale — CHƯA CÓ, phải mở trước

Ngày 29/07 Report Bot đã thử gửi sang App Sale và **thất bại**: không có agent Sale trong allowlist, `sessions_list` timeout. Bot **không giả vờ đã gửi** — ghi nhận đúng.

**Phải mở kênh trước khi làm mục 8.** Hai cách, chọn một:
- **(a)** Một nhóm Telegram chung cho cả hai bot — đơn giản nhất, người cũng đọc được
- **(b)** Một endpoint HTTP có token để Report Bot đẩy sang App Sale

**Khuyến nghị (a)** — vừa cho bot, vừa cho người, không phải dựng thêm hạ tầng.

Chưa có kênh thì **vẫn làm phần VP018/DN007/CEO trước**, phần App Sale bổ sung sau. Không để một chỗ chặn cả việc.

### 8.6 Test bắt buộc

1. **VP018 nhận được cảnh báo đồng bộ** dù đang nằm trong `notify_optout.json`.
2. **VP018 KHÔNG nhận** tin target / mốc thưởng / chi phí / doanh thu — optout vẫn nguyên hiệu lực.
3. Mã nguồn cảnh báo đồng bộ **không được gọi** `targetNotify.isMuted` — khoá bằng test đọc mã, như `notifySchedule.test.js` đang làm.
4. Bất biến vỡ ⇒ gửi **NGAY**, nội dung có chữ **"đã DỪNG, chưa ghi slot"**.
5. Chỉ có ngoại lệ nhóm "chỉ để biết" ⇒ **KHÔNG GỬI**.
6. Cùng một ngoại lệ ở lần chạy thứ hai ⇒ **không nhắn lại**, chỉ vào dòng tồn đọng.
7. Không có gì mới ⇒ **không gửi tin nào**.
8. Mỗi mục trong tin phải có đủ 4 phần (cái gì · tiền · vì sao · ai làm gì).
