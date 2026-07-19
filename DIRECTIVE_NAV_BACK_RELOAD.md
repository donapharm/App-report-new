# DIRECTIVE — Nút Quay lại + Breadcrumb + Tải lại (điều hướng, áp TOÀN APP)

> Claude Code giao (CEO 2026-07-03). Bot triển khai; Claude review. Không đụng nguồn đã cách ly 3860.

## Vấn đề
Drill sâu (Doanh thu → NV DN006 → đơn vị/SP của NV đó) **không có đường lùi lại** trang/cấp đang mở; cũng **không có nút tải lại**. Cần cơ chế điều hướng nhất quán MỌI trang.

## Giải: 1 thanh điều hướng dùng chung (component chung)
Đặt dưới header mỗi trang: **[← Quay lại]  [breadcrumb]  … [↻ Tải lại]**

### 1) Nút "← Quay lại"
- Lùi **đúng 1 bước** trong luồng drill (VD: SP → Đơn vị → NV → danh sách). Ẩn khi đang ở cấp gốc.
- Không phải "về trang chủ" — chỉ lùi 1 cấp của ngăn xếp drill/điều hướng.

### 2) Breadcrumb (đường dẫn phân cấp)
- Hiện lối đi: VD `Doanh thu › Nguyễn Trọng Hiếu (DN006) › 001.BVĐK Đồng Nai`.
- **Bấm bất kỳ cấp nào → nhảy thẳng về cấp đó** (nhanh hơn back nhiều lần).
- Dùng mã+tên theo chuẩn (đơn vị `001.BVĐK…`, NV `mã · tên`).

### 3) Nút "↻ Tải lại"
- **Tải lại DỮ LIỆU trang hiện tại** (re-fetch API), **GIỮ NGUYÊN bộ lọc + vị trí drill** (không phải F5 mất trạng thái).
- Hữu ích trên mobile (không có thanh trình duyệt).

### 4) Hỗ trợ nút Back trình duyệt/điện thoại
- Mỗi bước drill/điều hướng (bao gồm cả khi bấm từ cảnh báo Tổng quan sang tab khác) **đẩy state vào history** (URL query/hash hoặc history.pushState) → **nút Back của máy lùi đúng 1 bước**, không thoát app.

## Phạm vi — TOÀN APP
- Áp cho mọi trang có drill/điều hướng: **Doanh thu, DT đầy đủ, Sản phẩm, Cơ số thầu, Phân tích, Target, Tổng quan (khi bấm cảnh báo sang tab khác)**.
- **Component/hook dùng chung** (VD `useDrillStack` + `<NavBar>`), sửa 1 nơi áp mọi trang; không làm lẻ.
- Giữ nguyên: bộ lọc chạy backend theo quyền; scope không đổi.

## Nghiệm thu
- Doanh thu → chọn NV DN006 → drill đơn vị → drill SP: có breadcrump 3 cấp; bấm "← Quay lại" lùi đúng 1 cấp; bấm cấp giữa trong breadcrumb nhảy về đúng cấp.
- Nút Back điện thoại cũng lùi đúng (không thoát app).
- "↻ Tải lại" nạp lại số mới, **giữ bộ lọc + cấp drill**.
- Áp nhất quán mọi tab; mobile + PC. Build OK.
