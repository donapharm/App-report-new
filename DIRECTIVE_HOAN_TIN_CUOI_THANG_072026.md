# ‼ DIRECTIVE GẤP — HOÃN TIN CUỐI THÁNG 31/07/2026

> **CEO đã duyệt. Bot làm ngay khi đọc được file này, không cần hỏi lại.**
> Ghi ngày 2026-07-29 (khuya). CEO đã đi nghỉ, không relay lệnh trực tiếp được.

---

## Vì sao

Ngày **31/07/2026** hệ thống sẽ **tự gửi** tin chi phí và tin thưởng tháng cho toàn bộ nhân viên.

**Số thưởng hiện đang SAI cho ít nhất 1 người.** Slot T07 vừa được ghi lại (cộng thêm 382.578.400đ phần `HOLD_GOLIVE`), nên **DN008 Đoàn Văn Triệu** từ **117,71% → 130,26%** — **đổi bậc thưởng**, P1 tăng khoảng **1,92 triệu** (chưa kể P2).

Gửi tin bằng số cũ = **nhân viên nhận số thiếu**, rồi vài hôm sau phải sửa. CEO chốt: **hoãn, gửi sau khi tính lại**.

---

## Việc 1 — TẮT 2 CỜ (làm trước 31/07, càng sớm càng tốt)

CEO đã duyệt cả hai:
- Tin **thưởng**: CEO chốt phương án **(B) Hoãn tin thưởng tháng 7**
- Tin **chi phí**: CEO chốt **"hoãn nhé"** — vì chi phí tính bằng % × doanh thu, cùng nguồn số đang sửa

```
EMP_COST_NOTIFY=0
BONUS_NOTIFY=0
```

**Bắt buộc khởi động lại `app-report-tgbot`.** Sửa `.env` không thôi **KHÔNG ĂN** — tiến trình đang chạy giữ giá trị cũ trong bộ nhớ.

- **KHÔNG** restart `app-report` (API/web) — không liên quan, đừng đụng
- **KHÔNG** đụng `web/dist`
- `app-report-tgbot` là tiến trình riêng, restart nó **người dùng không thấy gì**

**Nghiệm thu:** log sau restart phải in **`Chi phí/Thưởng notify: TẮT`**. Chụp lại gửi CEO.

---

## Việc 2 — GỬI TIN BÁO CHẬM CHO NHÂN VIÊN

CEO chốt: **có báo**, qua **Telegram + email**.

### Nội dung — CEO đã duyệt, KHÔNG tự sửa chữ

```
📌 THÔNG BÁO — Tin chi phí & thưởng tháng 7/2026 gửi chậm

Công ty đang rà soát lại số liệu doanh thu tháng 7 để đảm bảo con số
gửi tới anh/chị là chính xác.

Vì vậy tin chi phí tháng và thưởng tháng 7 sẽ chưa gửi vào cuối tháng
như thường lệ.

Số liệu sẽ được gửi đầy đủ chậm nhất ngày 05/08/2026.

Việc này không ảnh hưởng đến quyền lợi của anh/chị — chỉ là gửi chậm
hơn vài ngày để số liệu chuẩn.

Mong anh/chị thông cảm.
```

Tiêu đề email: `[DONAPHARM] Tin chi phí & thưởng tháng 7/2026 gửi chậm — chậm nhất 05/08`

### Cách gửi — ‼ BẮT BUỘC CHẠY THỬ TRƯỚC

Hai cờ thông báo đang TẮT nên phải gửi bằng đoạn riêng — **đây chính là lúc dễ gửi nhầm người nhất**.

1. **In ra danh sách người nhận + nội dung đầy đủ** → **gửi CEO duyệt**
2. **CEO gật rồi mới gửi thật**
3. Người nhận: **đúng danh sách sẽ nhận tin cuối tháng 31/07**, không thêm không bớt
4. Gửi xong báo: bao nhiêu người nhận Telegram, bao nhiêu email, ai lỗi

**Gửi ngày 30/07** — để nhân viên biết trước, khỏi ngồi chờ tối 31.

---

## Việc 3 — TÍNH LẠI THƯỞNG T07 với slot mới

Slot active mới: `rev_2src_072026_20260729153232_2916955_6ffe9252-de1e-4c2f-a922-ff341998e76c`
Tổng: **28.957.771.643đ** · CRM 1.319 dòng / 19.171.667.663đ · Partner 585 dòng / 9.786.103.980đ

Xuất **bảng thưởng T07 đầy đủ** cho toàn bộ NV: mã NV · target · doanh thu · % đạt · bậc · P1 · P2 · tổng.
Đánh dấu rõ **NV nào đổi so với bản cũ**.

**Gửi Claude review trước khi công bố cho nhân viên.**

---

## Việc 4 — trước 05/08, không gấp

Ca test/guard **chống đếm hai lần qua HAI KỲ**: cùng `WEB:<order_item_id>` không được nằm ở slot của hai kỳ khác nhau; phát hiện trùng thì **DỪNG và báo**, không tự chọn kỳ.

Lý do: tháng 8 go-live xong, **45 dòng `HOLD_GOLIVE` vừa thêm** sẽ đổi trạng thái và có thể nhảy sang kỳ T08 trong khi T07 đã đóng.

Đợt này an toàn vì T06 phía đối tác = 0 dòng, không có gì để trùng.

---

## Ranh giới — KHÔNG ĐƯỢC LÀM

1. **KHÔNG deploy, KHÔNG restart `app-report`, KHÔNG build** — chỉ restart `app-report-tgbot` ở Việc 1.
2. **KHÔNG mở khoá auto-deploy.** `.auto-deploy.disabled` giữ nguyên.
3. **KHÔNG build trong cây production** (`DIRECTIVE_DEPLOY_RELEASE_SAFETY.md` mục P4).
4. **KHÔNG gửi tin thật khi chưa có CEO duyệt danh sách người nhận.**
5. **KHÔNG bật lại 2 cờ** cho tới khi thưởng T07 đã tính lại và CEO duyệt. Khi bật lại: nhớ **trước 12:30 Thứ 7 01/08** nếu muốn giữ tin chi phí tuần.

---

## Trạng thái chốt tối 29/07

| Việc | Trạng thái |
|---|---|
| Slot T07 ghi lại (+382,6 triệu `HOLD_GOLIVE`) | **XONG**, Claude nghiệm thu ĐẠT |
| Chênh lệch với App Sale | **2.399.520đ** — 1 dòng thiếu `revenue_date`, đã biết rõ |
| Lịch tin cuối tháng dời 17:30 → 20:00 | **XONG** trên `main`, **chưa deploy** |
| Phạt v3.3 | Trên nhánh `feat/bonus-penalty-v3.3`, Claude đã duyệt, **chưa merge** |
| Hai cờ thông báo | **VẪN BẬT** ⚠ — Việc 1 ở trên |
| Tin báo chậm cho NV | **CHƯA GỬI** — Việc 2 |
