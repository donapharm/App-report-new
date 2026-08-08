# DIRECTIVE — PHẠM VI VP018 (CEO chốt 08/08/2026, nguyên văn 4 điểm)

> 1. *"VP018 chính là telesale thay cho anh KIỂM đó."* — vai trò: người kiểm tra
>    doanh thu thay mặt CEO.
> 2. *"VP018 chỉ được xem đúng 2 tab nói trên (Doanh thu · DT đầy đủ), không bất cứ
>    tab nào khác."*
> 3. *"Con mắt ẩn số — VP018 không được tiếp cận dưới mọi hình thức."*
> 4. *"Cho phép VP018 xem ĐẦY ĐỦ + tải file Excel/PDF về tra cứu cho cả hai tab này,
>    đầy đủ các NV."*

## Diễn giải kỹ thuật (để review candidate `vp018-full-revenue-two-tabs`)

- **Phạm vi dữ liệu:** trong đúng 2 tab, VP018 thấy doanh thu **toàn công ty, đủ mọi
  NV** (scope như admin chỉ-đọc), vì vai trò là kiểm thay CEO. NGOÀI 2 tab: giữ
  nguyên chặn 403 như `accessPolicy` hiện hành.
- **Export:** thêm ĐÚNG các đường export của 2 tab đó vào allowlist
  `REVENUE_ONLY_GET_PATHS` (liệt kê tường minh từng path, cấm wildcard). Export vẫn
  đi qua backend + audit như mọi export.
- **Con mắt ẩn số:** VP018 KHÔNG thấy nút con mắt (ẩn `PrivacyEyeButton` theo
  access profile `revenue_only`); không có bất kỳ đường nào cho VP018 chạm vào
  cơ chế che/mở số. VP018 cũng không có nút ghi tiền nào nên khoá-nút-khi-che
  không liên quan.
- **Tuyệt đối không đổi:** VP018 không thấy % chi phí (grants mặc định tắt + thêm
  test khoá đích danh VP018) · không vào Chi phí/Thanh toán/Danh mục QL/menu C32-C47
  sau này · doanh thu KHÔNG được gán cho VP018 (luật NON_SALES_ROLE giữ nguyên —
  xem được ≠ được gán số).

## Checklist Gate 2 (Claude soát từng mục)

1. Diff `accessPolicy`: allowlist chỉ thêm path GET/export của đúng 2 tab; đếm path
   trước/sau, từng path đọc được bằng mắt.
2. Test đích danh: VP018 gọi export 2 tab → 200; gọi export/tab bất kỳ khác → 403;
   `/api/employee-cost*` → 403; PUT/POST bất kỳ → 403.
3. UI: VP018 đăng nhập chỉ thấy 2 tab; không thấy nút con mắt; deep-link tab khác
   quay về Doanh thu.
4. Không đụng: T07 pin · 16 tài khoản bị khoá · payment_notice tắt · tgbot.
