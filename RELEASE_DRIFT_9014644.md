# Release drift audit — 9014644 — 2026-08-15

## Kết luận

Release không rụng 660 file. Kiểm độc lập toàn bộ manifest niêm phong cho kết quả `5857/5857` mục tồn tại và đúng checksum/symlink/type; mismatch bằng 0.

Chênh `5857 -> 5197` là lỗi tái tạo tập target khi verify: lúc create có `MANIFEST_EXTRA` mở rộng, còn lượt verify đầu không mang cùng cấu hình nên chỉ gom tập runtime mặc định. Đây là drift của **cấu hình verifier**, không phải drift của artifact.

## Chốt phòng ngừa

- Tập target phải được ghi bền cạnh manifest tại lúc create và verify bắt buộc đọc lại đúng tập đó.
- Không dùng biến môi trường chỉ tồn tại trong shell làm nguồn duy nhất cho phạm vi manifest.
- Verify phải phân biệt `artifact_content_mismatch` với `manifest_target_config_mismatch`.
- Bản dự phòng mới vẫn dựng từ exact commit sạch, thay toàn bộ `server/data` bằng symlink live trước khi niêm phong và probe roster độc lập trước mọi cutover.

