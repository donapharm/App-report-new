# RSS peaks — release 9014644

## Đỉnh đã ghi nhận

Trong startup/cutover 14/08, PID `563281` vượt 1,8 GiB liên tục khoảng 90 giây:

```text
07:35:46  2,477,776,896 bytes
07:36:22  2,584,457,216 bytes
07:36:53  2,596,110,336 bytes
07:37:17  2,616,631,296 bytes  (đỉnh)
07:37:28    706,396,160 bytes  (đã hạ)
```

Đỉnh là `2.617 GB` theo hệ thập phân, tương đương `2.437 GiB`; cụm “2,62 GiB” trước đó đã trộn đơn vị. Dù theo cách gọi nào, RSS vẫn vượt ngưỡng cấu hình PM2 `max_memory_restart=2G`.

## Hoạt động đồng thời

- App vừa start và chạy `employee-cost ALL cache warm` lý do `startup`.
- Browser acceptance CEO đang mở T07/T08.
- Đường warm dựng báo cáo có đọc catalog snapshot.
- Catalog LKG thực tế là `377,416,106` byte; `catalogManagement.docLkg()` dùng `readFileSync` + `JSON.parse` toàn file và giữ parsed object ngắn hạn trong RAM.
- Mã nguồn đã ghi nhận riêng rằng parsed LKG từng làm RSS khoảng 1,36–1,37 GiB mỗi tiến trình.

Do đó bằng chứng hiện tại cho thấy tương quan rất mạnh giữa startup warm/browser và việc nạp catalog LKG 377 MB. Chưa có heap profile tại đúng giây peak nên đây là **nghi phạm có bằng chứng**, chưa được nâng thành kết luận độc quyền.

Không có restart trong cửa sổ: PM2 restart giữ `33`, local/public health vẫn 200. Ngưỡng >1,8 GiB chỉ kéo dài 90 giây, không đủ điều kiện rollback “liên tục >10 phút”.

## Đỉnh sau đó

Monitor chuyên dụng ghi thêm một mẫu lúc 08:00:51:

```text
rss=1,983,959,040 bytes (1.848 GiB)
streak=5 seconds
activity=A/C read-only investigation; một TypeScript compile khác cũng đang chạy trên host
```

RSS hạ lại khoảng 0,73–0,80 GB và không tạo cửa sổ >10 phút. Không có rollback.

## Bằng chứng

Evidence root trên host: `/home/osboxes/.openclaw/workspace-report-dev/`.

- `artifacts/rebuild-release-9014644-3a3-modes-20260814-073242/m5-m7-rss-restart-window.tsv`
- `artifacts/rebuild-release-9014644-3a3-modes-20260814-073242/logs/artifact-startup.log`
- `artifacts/rebuild-release-9014644-3a3-modes-20260814-073242/M5_BROWSER_ACCEPTANCE.md`
- `artifacts/rss-context-9014644-20260814-080008/rss.tsv`
- `artifacts/rss-context-9014644-20260814-080008/peaks/2026-08-14T08_00_51,880387659_07_00.txt`
