# DIRECTIVE (bổ sung #159) — Công thức tầng nấc thưởng: % doanh thu, 0.2–0.5% (CEO chốt 2026-07-23)

> Claude Code giao Report Bot. Bổ sung cho `DIRECTIVE_EMP_COST_BONUS_KPI.md` (#159): **mức thưởng là % DOANH THU**
> (không phải tiền cố định), **kịch trần 0.5% cho đạt XUẤT SẮC target**, sàn **0.2% khi đạt target**. Vẫn cấu hình được.

## 1. CÔNG THỨC
`Thưởng dự kiến = doanh thu (trước VAT) × bonusPct(% đạt target) ÷ 100`
- `% đạt target` lấy từ **analytics target sẵn có** của App Report (không tính lại).
- `bonusPct` = bậc theo bảng tầng nấc (config). Trần **0.5%**.

## 2. CONFIG `server/config/employee_bonus_tiers.json` (shape ĐÚNG — dùng bonusPct, KHÔNG phải flat bonus)
```json
{
  "base": "revenue_before_vat",
  "capPct": 0.5,
  "tiers": [
    { "fromPct": 100, "toPct": 110,   "bonusPct": 0.20 },
    { "fromPct": 110, "toPct": 120,   "bonusPct": 0.30 },
    { "fromPct": 120, "toPct": 130,   "bonusPct": 0.40 },
    { "fromPct": 130, "toPct": 99999, "bonusPct": 0.50 }
  ]
}
```
- Bậc chọn theo `% đạt target ∈ [fromPct, toPct)`. Không khớp bậc nào (vd <100%) → **thưởng 0**.
- **tiers rỗng → ô hiện "Chưa cấu hình mức thưởng"** (giữ như #159, không bịa).
- **`capPct` chặn trần** (dù config lỡ nhập >0.5 vẫn không vượt) — an toàn.
- CEO đổi bậc/ngưỡng/% bất cứ lúc nào, **không sửa code**. (Có thể thêm bậc phụ 80–100% nếu CEO muốn thưởng gần-đạt.)

## 3. TÍNH THÁNG & QUÝ
- **Tháng:** % đạt target tháng → bậc → thưởng tháng.
- **Quý:** % đạt target quý (doanh thu quý / target quý) → bậc → thưởng quý. Hiển thị **cả 2** (tháng · lũy kế quý) trong ô KPI
  hoặc tooltip. (Nếu quý dùng bảng bậc riêng → thêm `tiersQuarter`; mặc định dùng chung `tiers`.)

## 4. HIỂN THỊ (giữ như #159)
- Ô **"Thưởng dự kiến"**: số tiền + phụ đề "đạt X% target · bậc 0.Y%". Nhãn **"dự kiến/tham khảo"** (App Report không gửi thưởng/không payroll).
- Self-scope: NV thấy của mình; CEO/ADMIN xem NV bất kỳ / tổng phụ khi "Tất cả NV".

## 5. NGHIỆM THU
1. tiers rỗng → "Chưa cấu hình mức thưởng". Điền bảng trên → NV đạt 100–110% ra **0.2% × doanh thu**; ≥130% ra **0.5%**; <100% ra **0**.
2. Đối chiếu tay 1 NV: doanh thu trước VAT × bonusPct ÷ 100 = đúng số ô hiển thị. Trần 0.5% không vượt.
3. Tháng & quý tính đúng; nhãn "dự kiến" rõ; self-scope. Test + build PASS. Push nhánh review (kèm ô KPI #159); báo Claude; chưa deploy.
