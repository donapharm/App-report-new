# SPEC — 3 Ô KPI HÀNG CUỐI màn "Chi phí của tôi" (CEO duyệt 05/08/2026 chiều)

> CEO: *"anh đồng ý với đề xuất của em nhé, chỉ lưu ý một điểm là em phải trừ ngày
> thứ 7, chủ nhật và ngày nghỉ lễ lớn và nghỉ bù theo quy định của pháp luật Việt Nam
> để sau này không phải tính lại."*
>
> Bot server là người TRIỂN KHAI. Claude viết spec + review, không sửa code app song song.

## Bức tranh

Hàng cuối lưới KPI hiện có 1 ô (`Khớp doanh thu 94,5%`) + 3 ô trống. Lấp thành
**hàng hiệu quả & cảnh báo sớm**, đọc trái → phải một mạch:

| Ô 1 (đã có) | Ô 2 (mới) | Ô 3 (mới) | Ô 4 (mới) |
|---|---|---|---|
| Khớp doanh thu | **CP/DT · hiệu quả chi phí** | **Doanh thu chưa phân bổ NV** | **Dự báo đạt target cuối tháng** |
| số có khớp không | hiệu quả bao nhiêu | có tiền nào lạc không | cuối tháng về đích không |

Nguyên tắc chung, không nhắc lại từng ô:
- **Backend tính hết**, frontend chỉ render (`CLAUDE.md` — quyền và số quyết ở backend).
- **Fail-closed**: thiếu vế nào → ô hiện `—` kèm nhãn lý do. **CẤM hiện 0 / 0% giả sạch.**
- Mọi ngày/giờ theo **GMT+7** (`Asia/Bangkok`), dùng helper sẵn có, cấm `toISOString().slice`.
- Đây là màn CEO/admin ("Tất cả NV") — số tổng đội được phép hiện; **không** thêm số
  của từng người vào các ô này.

## Ô 2 — CP/DT · Hiệu quả chi phí (%)

- **Công thức:** `Tổng chi phí tháng (chi phí gốc) ÷ Doanh thu chưa VAT đã phân bổ`
  của cùng kỳ đang xem. Ví dụ số 05/08: 286.350.733 ÷ 3.860.878.168 ≈ **7,4%**.
- **Dòng phụ:** so kỳ liền trước: `T07: x,x% → ±y điểm`. Kỳ trước thiếu vế nào thì
  dòng phụ ghi `kỳ trước: —`, ô chính vẫn hiện.
- ‼ **CÙNG MỘT SNAPSHOT:** hai vế phải được backend lấy trong **một** lần dựng
  (cùng nguồn với KPI doanh thu + KPI chi phí đang có). Banner "hai snapshot" đang
  hiện trên màn chính là lý do — hai vế lệch snapshot thì tỷ lệ là số bịa.
  Khi backend phát hiện lệch snapshot ⇒ ô hiện `—` + nhãn `snapshot lệch — bấm Làm mới`.
- Khi có đủ nguồn phạt (21/21) thì thêm biến thể "sau phạt" ở dòng phụ; chưa đủ thì
  **chỉ hiện bản chi phí gốc và ghi rõ "chi phí gốc"** — không suy số sau phạt
  (đúng luật đang áp cho ô "Tổng chi phí tháng sau phạt").

## Ô 3 — Doanh thu chưa phân bổ NV

- **Nội dung:** `Σ tiền · N dòng` đang không về tay NV Sale nào trong kỳ đang xem:
  - dòng cách ly `UNALLOCATED` / `attribution_status` chứa `QUARANTINED`
    (vụ VP018 → `DH479816174` · 1.795.600đ là đúng loại này);
  - dòng mã đơn vị/mã hàng thiếu danh mục làm rơi phân bổ (nhóm `INCOMPLETE`
    của `syncExceptionCatalog` — dùng danh mục sẵn có, **không nghĩ mã mới**).
- **Đích = 0đ tròn.** Khác 0 ⇒ tô cảnh báo; bấm ô nhảy sang tab "Kiểm soát dữ liệu".
- **Dòng phụ:** tách 2 vế `cách ly: xđ · thiếu danh mục: yđ` nếu cả hai cùng có.
- **Bất biến:** tổng ô này + tổng đã phân bổ = tổng doanh thu kỳ (cùng snapshot).
  Lệch ⇒ ô hiện `—` + nhãn `tổng chưa cân` — đúng tinh thần
  `SPEC_REVENUE_SYNC_EXCEPTIONS`: không dòng nào biến mất lặng lẽ.
- Nguồn lỗi ⇒ `—` + `chưa lấy được nguồn`, không hiện 0đ.

## Ô 4 — Dự báo đạt target cuối tháng ‼ TÍNH THEO NGÀY LÀM VIỆC

- **Nội dung chính:** `Dự báo: ~XX% target` ·
  dòng phụ: `cần Y đ/ngày làm việc · còn N ngày làm việc (tới hết DD/MM)`.
- **Nguồn:** máy dự báo trend sẵn có của Target (`smart.js`) — đem số lên, không
  dựng máy mới, LLM không đụng vào số.
- **‼ NGÀY LÀM VIỆC (lệnh CEO 05/08):** trừ **Thứ 7, Chủ nhật, ngày lễ và nghỉ bù**
  theo pháp luật VN. Cụ thể:

  ### Module mới `server/src/vnWorkingDays.js`
  - `isWorkingDay(dateISO)` = KHÔNG phải T7/CN **và** không nằm trong lịch nghỉ.
  - `workingDaysBetween(fromISO, toISO)` (đầu-cuối bao gồm), `workingDaysInMonth(ym)`,
    `workingDaysElapsed(ym, todayISO)`, `workingDaysRemaining(ym, todayISO)`.
  - **Lịch nghỉ dùng LẠI `server/data/holidays.json` + `holidayFor()` của
    `dailySales.js`** — file này ĐÃ có đủ 2026 kể cả nghỉ bù (Tết 14–22/02 ·
    Giỗ Tổ 26/04 CN → bù 27/04 · 30/04–02/05 · Quốc khánh 01–02/09).
    **CẤM tạo file lịch thứ hai** — hai lịch là có ngày lệch nhau.
  - Thứ trong tuần tính theo **GMT+7** (dùng `vnParts`/`Intl` như `dailySales.js`,
    không `getDay()` trên giờ máy).
  - **Sang năm mới chưa có lịch:** nếu tháng đang xét không có BẤT KỲ mục lễ nào
    của năm đó trong file ⇒ vẫn trừ T7/CN, nhưng ô phải đeo nhãn
    `⚠ chưa nạp lịch nghỉ lễ YYYY` — không im lặng giả vờ đủ. Đây là chốt để
    "sau này không phải tính lại": ai nhìn cũng biết lúc nào cần cập nhật file.
- **Công thức (backend):**
  - `nhịp hiện tại = doanh thu kỳ ÷ số ngày làm việc ĐÃ QUA` (đã qua = tới hết hôm
    qua giờ VN; đầu tháng chưa có ngày làm việc nào ⇒ ô hiện `—` + `chưa đủ ngày để dự báo`).
  - `dự báo = nhịp × tổng ngày làm việc trong tháng`.
  - `cần/ngày = (target − doanh thu hiện tại) ÷ ngày làm việc CÒN LẠI` (còn lại = từ
    hôm nay tới hết tháng; hôm nay là ngày nghỉ thì không tính hôm nay).
    Đã vượt target ⇒ dòng phụ đổi thành `đã vượt target — +zđ`.
  - Kỳ không có target ⇒ `—` + `kỳ chưa có target`.
- **Ghi chú tương thích:** màn "nhịp ngày" (`dailySales`) đang coi **Thứ 7 là ngày
  làm việc** (ca 07:30–13:00). GIỮ NGUYÊN màn đó — lệnh trừ T7 chỉ áp cho Ô KPI dự
  báo này. Ghi chú này nằm trong code để sau không ai "đồng bộ" nhầm hai quy ước.

## Test bắt buộc (thiếu cái nào không duyệt)

1. `vnWorkingDays` — khoá bằng số Claude đã đếm tay trên lịch:
   - **T08.2026 = 21** ngày làm việc (31 ngày − 5 T7 − 5 CN, không có lễ; 01/08 là T7);
   - **T09.2026 = 20** (30 − 4 T7 − 4 CN − lễ 01/09 thứ Ba − 02/09 thứ Tư);
   - **T02.2026 = 15** (20 ngày T2–T6 − 5 ngày Tết rơi vào T2–T6 là 16→20/02;
     các ngày Tết trùng T7/CN **không được trừ hai lần**);
   - **27/04/2026** (nghỉ bù Giỗ Tổ, thứ Hai) KHÔNG phải ngày làm việc.
   Bot đếm ra số khác ⇒ dừng lại đối chiếu lịch với Claude trước, đừng sửa test cho xanh.
2. Ranh giới GMT+7: 00:30 giờ VN ngày 01/09 vẫn phải là 01/09 (ngày lễ), không lùi
   về 31/08 theo UTC.
3. Năm không có lịch (2027): vẫn trừ T7/CN + trả cờ `calendarMissing: true`;
   UI phải hiện nhãn ⚠.
4. Ô CP/DT: thiếu 1 vế → `—`; hai vế khác snapshot → `—`; cấm khớp `0%` khi thiếu nguồn.
5. Ô chưa phân bổ: bất biến tổng cân; nguồn lỗi → `—`; có dòng cách ly thật
   (dựng lại ca `DH479816174`) phải ra đúng `1.795.600đ · 1 dòng`.
6. Ô dự báo: đầu tháng (0 ngày làm việc đã qua) → `—`; đã vượt target → nhãn vượt;
   không target → `—`.
7. Test quét: 3 ô mới không render số nào frontend tự tính (không có phép chia/nhân
   trong JSX — số lấy nguyên từ payload backend).

## Nghiệm thu sau deploy (lệnh đọc, không đụng tiền)

- Màn CEO kỳ T08: ô CP/DT ra ~7,4% (khớp 286.350.733/3.860.878.168) hoặc `—` kèm
  nhãn nếu snapshot đang lệch; ô chưa phân bổ ra số thật kèm số dòng; ô dự báo ghi
  rõ "ngày làm việc" và số ngày còn lại **đã trừ T7/CN** (kiểm tay: đếm lịch tháng 8).
- Báo cáo dán: số ngày làm việc T08.2026 mà hệ thống đếm + 3 ảnh ô KPI.
