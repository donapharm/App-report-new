# Evidence T08 pinned PROD — 15/08/2026

## Kết luận

- Gate 2 chạy đúng một lượt `sync`, concurrency 1, không retry.
- Snapshot T08 được publish đầy đủ 21/21 từ nguồn mạng, cùng `sourceGeneration=V31.5` và exact range `2026-08..2026-08`.
- Đối chứng với model mà đường màn hình PROD dựng khi serve snapshot đang tắt: số NV, tổng dòng nghiệp vụ, tổng doanh thu và tuple reconciliation khớp.
- Cả hai model cùng `revenueRecon.balanced=false`, gap `1.795.600đ`. Đây là cảnh báo dữ liệu tồn tại, không được diễn giải thành cân bằng PASS. Snapshot chưa được phép serve.
- `EMPLOYEE_COST_SERVE_FROM_SNAPSHOT` vẫn OFF; watcher đã trở lại mode chỉ probe 30 phút.

## Định danh

- PROD commit: `1b61089088ece63ede82d27f2f199207873fd496`
- Release: `release-app-report-watcher-1b61089-20260815-1145`
- Kỳ: `2026-08`
- Thời điểm publish: `2026-08-15T07:15:58.923Z` (`14:15:58 15/08/2026 GMT+7`)
- Generation ID: `3f2d963e9954597ef4b70fa3b1289b6bd130ccfb798b9bf1edde8c0e8b02a92d`
- Source generation: `V31.5`
- Manifest digest: `c6435178d7df72edfac13a15e38e5b7085466eed182b79a58f5d35b9ceee90d8`
- Model digest: `f951f9e8f4bf2a35faa6cfdc547c5defc06f594c2bebb19850f35c85831cb502`
- Watcher success key: `3b0a56e3362f370cbd0cc33acd6b72836b481d637fdbd3ce5b70e83fffc68974`

## Gate nguồn và publication

- Roster/available: `21/21`
- Source: `network`
- Complete: `true`
- Locked: `false`
- Watcher kết thúc: `state=ready`, exit code 0
- T07: `waiting`; không tạo bản chốt T07.
- Timer được dừng trong lúc sync và bật lại sau publication; service mode vẫn cố định `probe`.

## Đối chứng model

Model màn hình được dựng qua chính route `/employee-cost?emp=ALL&from=2026-08&to=2026-08`, với serve snapshot OFF. `displayedRows=20` của màn là page size, nên số dòng toàn kỳ được đối chứng bằng `search.totalRows`/`revenueRecon.rowCount`, không dùng số dòng của trang hiện tại.

| Chỉ tiêu | Model màn PROD | Model pinned | Kết quả |
|---|---:|---:|---|
| Nhân viên | 21 | 21 | Khớp |
| Dòng hiển thị toàn kỳ | 1.162 | 1.162 | Khớp |
| Dòng reconciliation | 1.163 | 1.163 | Khớp |
| Tổng doanh thu | 16.360.327.175đ | 16.360.327.175đ | Khớp |
| Revenue recon total | 16.362.122.775đ | 16.362.122.775đ | Khớp |
| Revenue recon shown | 16.360.327.175đ | 16.360.327.175đ | Khớp |
| Gap | 1.795.600đ | 1.795.600đ | Khớp, nhưng khác 0 |
| Balanced | `false` | `false` | Khớp, cảnh báo |
| NV unavailable | 0 | 0 | Khớp |

Trong lượt dựng có cảnh báo DN021 `matchedRows=0/4`; cảnh báo này liên quan trực tiếp tới trạng thái reconciliation chưa cân và phải được giữ trong hồ sơ, không được bỏ qua khi xin Gate serve.

## Trạng thái cuối

- PROD không đổi commit sau lượt ghim.
- `app-report` và `app-report-tgbot` online; không có OOM/restart do lượt ghim.
- Snapshot tồn tại trong `server/data/employee_cost_snapshots/2026-08`.
- Serve snapshot OFF. Bất kỳ quyết định bật serve nào cần Gate riêng và phải xử lý/duyệt rõ cảnh báo reconciliation trên.
- Rollback duy nhất: `release-app-report-rollback-9014644-20260815-0951`.
