# Ai đã rollback lúc 23:09 ngày 13/08/2026

## Kết luận

Rollback không do cron, systemd timer hay watchdog tự chạy. **App Report Dev Bot trong chính phiên Telegram CEO đã chủ động phát lệnh `exec` thủ công** lúc `2026-08-13T16:09:24.879Z` (23:09:24 GMT+7). Script bắt đầu ghi bằng chứng lúc `23:09:25+07:00`, trỏ `current` sang release `7870f10` và restart PM2.

Phiên thực hiện:

```text
agent:reportdev:telegram:direct:1748199545
session checkpoint: dfc2affc-42dc-4791-afe3-17be34bdaecb
```

Đây là lỗi quyết định của bot: sau Gateway restart, bot thấy một OOM JavaScript trước đó và diễn giải tiêu chí rollback cũ là đã phát sinh, rồi chọn nhầm artifact rollback `7870f10`. Tại preflight 23:07, live `current` thực tế đang ở `3a3a47d`; vì thế nhảy tiếp về `7870f10` là sai đích và không phải hành vi của automation nền.

## Chuỗi thời gian có chứng cứ

| Thời điểm GMT+7 | Sự kiện |
|---|---|
| 23:07:28 | Bot kiểm tra `current`; kết quả là release exact `3a3a47d`, health 200. |
| 23:07:57 | Bot tự tuyên bố sẽ preflight rollback exact `7870f10`. |
| 23:08:23 | Bot đọc ba tài liệu/script rollback cũ để chuẩn bị. |
| 23:09:24.879 | Assistant phát `exec` có `ROLL=...7870f10...`. |
| 23:09:25 | `rollback.log` bắt đầu; pointer/runtime bị thay đổi. |

## Loại trừ automation nền

- Không thấy cron hoặc user systemd timer tham chiếu rollback App Report/`7870f10`.
- Không có process rollback/watchdog `7870f10` đang chạy.
- Dấu lệnh nằm trực tiếp trong transcript của phiên `reportdev`; timestamp khớp tuyệt đối với `rollback.log`.
- `/tmp/monitor-9014644-rollback-window.sh` chỉ giám sát RSS/health, không có lệnh đổi symlink hoặc restart.

## Đã vô hiệu hóa runner cũ trỏ về đích cấm

Dù chúng không phải actor của sự cố 23:09, ba script evidence cũ vẫn có executable bit và đều trỏ tới `7870f10`. Ngày 14/08 lúc 08:32 GMT+7, executable bit đã được gỡ nhưng nội dung/hash được giữ nguyên để bảo toàn forensic:

```text
artifacts/deploy-3a3a47d-20260813-0847/rollback-exact-7870f10.sh          750 -> 640
artifacts/deploy-81da127-retry-20260810-124808/rollback-exact-7870f10.sh 700 -> 600
artifacts/deploy-repeat-3a3a47d-20260813-113413/rollback-exact-7870f10.sh 700 -> 600
```

Không còn script executable nào trong evidence tham chiếu release `7870f10`.

## Bằng chứng

Evidence root trên host: `/home/osboxes/.openclaw/workspace-report-dev/`.

- `artifacts/rollback-oom-to-7870f10-20260813-230925/rollback.log`
- `artifacts/rollback-oom-to-7870f10-20260813-230925/session-forensic-sanitized.txt`
- `artifacts/rollback-oom-to-7870f10-20260813-230925/OBSOLETE_7870_RUNNERS_DISABLED.txt`
- SHA-256 transcript checkpoint: `9be6bd53b78bd27e22c39e27fd31fa4d8320d0e8d725b5567f435be663ed7cdc`
- SHA-256 `rollback.log`: `2518a5dd9ffb4cdd92ab898a4cdac147cc53ceedfb95d98f58e98cfad08daecd`

## Luật sau sự cố

Đích rollback duy nhất là `3a3a47d8ac2634ffd0bdecfb46f71db24667a823`. `7870f10` bị cấm. Không suy diễn OOM lịch sử thành quyền rollback ở thời điểm khác; phải đối chiếu đúng cửa sổ giám sát, đúng live base và đúng đích được CEO nêu trong chỉ thị hiện hành.
