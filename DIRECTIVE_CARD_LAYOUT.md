# DIRECTIVE — Bố cục lại THẺ CHI TIẾT (Doanh thu/DT đầy đủ + đồng bộ CST) — dạng bảng gọn

> Claude Code giao (CEO phản ánh qua ảnh mobile 2026-07-03). Bot triển khai; Claude review. Áp cả mobile + PC. Không đụng app cũ 3860; chỉ layout/hiển thị.

## 7 điểm CEO yêu cầu (BẮT BUỘC)
1. **Thêm "Giá thầu"** (đang thiếu) vào thẻ.
2. **Tên thuốc IN ĐẬM**; **mã QLNB KHÔNG in đậm** (hiện đang ngược). Mã QLNB để dạng mono, xám nhạt, nhỏ hơn.
3. **Nhãn "SP" đặt ở dòng TÊN THUỐC** (không phải dòng mã QLNB).
4. **Bỏ dòng tên đơn vị lặp** ("BVĐK Thống Nhất ĐN") — đã có ở "Đơn vị: 002.BVĐK Thống Nhất ĐN". **Chỉ giữ `002.BVĐK Thống Nhất ĐN`** (mã + tên trong 1 dòng).
5. **Nhà thầu: mã + TÊN ĐẦY ĐỦ** — ngoài `AFP` phải có `Công Ty TNHH AFP Pharma`. VD `AFP · Công Ty TNHH AFP Pharma`.
6. **Thuốc TRÙNG TÊN → hiện thêm HÀM LƯỢNG** (VD `500mg`). **Trừ gói QĐ141 → KHÔNG hiện hàm lượng.** (Tên không trùng thì không cần.)
7. **Bố trí dạng BẢNG cho đẹp**; **mobile vẫn cho 2 CỘT NGANG** với field ngắn (chữ ít) để tận dụng chỗ.

## Bố cục chuẩn (mobile + PC)
```
SP  <Tên thuốc — ĐẬM, to>
    <mã QLNB — mono, xám nhạt, nhỏ>
    <hàm lượng — chỉ khi trùng tên & ≠ QĐ141>
────────────────────────────
NV        <mã · họ tên>
Đơn vị    <mã.tên đơn vị>            (1 dòng, không lặp)
Nhà thầu  <mã · tên nhà thầu đầy đủ>
──────────────┬─────────────
Tuyến  <..>   │ Gói     <..>        (2 cột)
Giá thầu <..đ>│ SL      <..>        (2 cột; Giá thầu MỚI)
────────────────────────────
Doanh thu   <…đ đầy đủ kế toán, nổi bật>
```
- **2 cột ngang** cho nhóm field ngắn (Tuyến/Gói/Giá thầu/SL) kể cả mobile; field dài (Đơn vị/Nhà thầu/Tên thuốc) full-width.
- Số tiền theo chuẩn kế toán VN đầy đủ (`DIRECTIVE_NUMBER_FORMAT_VN.md`): `109.000.000đ`, `28.850đ`.
- Căn hàng key-value gọn (label xám, value đậm vừa); không tràn ngang, không cắt số (theo `DIRECTIVE_MOBILE_UX.md`).

## Phạm vi
- Áp cho **thẻ chi tiết Doanh thu / DT đầy đủ**; đồng bộ **thẻ CST** (cùng có SP/mã QLNB/đơn vị/nhà thầu/gói/giá thầu) theo cùng nguyên tắc (tên thuốc đậm, mã QLNB nhạt, nhà thầu mã+tên, 2 cột field ngắn).
- Dữ liệu: `active_ingredient`/`ham_luong`, tên nhà thầu, `bid_price`/giá thầu — backend đã có (dùng ở CST); nối vào thẻ doanh thu. Thiếu field nào → để trống, không bịa.

## Nghiệm thu
- Thẻ hiện: tên thuốc đậm + "SP" đúng chỗ; mã QLNB nhạt; có Giá thầu; đơn vị 1 dòng (không lặp); nhà thầu mã+tên đầy đủ; hàm lượng chỉ khi trùng tên & ≠ QĐ141.
- Mobile: 2 cột field ngắn, không tràn/cắt; PC gọn đẹp dạng bảng.
- Số tiền đầy đủ kế toán VN. Build OK; số không đổi.
