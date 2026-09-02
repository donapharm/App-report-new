# Deploy — App Report (`app-report`)

## Ràng buộc dựng release bất biến

- Mọi release phải chạy `scripts/prepare_release_runtime.sh`; cấm tự tạo `server/data` bằng `ln -s` trần.
- `server/data/` được `export-ignore` vì 5 file theo dõi trong Git đã được xác nhận có đủ trong kho runtime chuẩn. Do đó `git archive` không được tạo thư mục `server/data` thật.
- Prepare script chỉ tạo liên kết khi đích chưa tồn tại và chặn thư mục thật, liên kết lồng `server/data/data`, liên kết gãy hoặc liên kết trỏ sai bằng `RELEASE_DATA_BINDING_INVALID`/`RELEASE_DATA_BINDING_BROKEN`.
- Sau prepare, bắt buộc chạy `release_manifest.sh create` rồi `verify`; không được cutover nếu runtime binding hoặc manifest không đạt.

## Tự động (mặc định)
Server chạy `scripts/auto-deploy.sh` qua **cron mỗi 1 phút**. Cứ có commit mới trên
`main` là server tự: `fetch → reset --hard → (build vào thư mục tạm) → tráo dist →
pm2 restart`. **Không cần deploy tay.**

- Merge PR lên `main` → chờ ~1 phút → site tự cập nhật.
- Kiểm "đã lên bản nào": nhìn dòng **"Bản <sha>"** ở chân màn login, hoặc:
  ```
  tail -n 30 ~/.openclaw/workspace-report/App-report/auto-deploy.log
  ```

## ‼ Site không lên bản mới? Chạy BÁC SĨ DEPLOY trước khi đổ tại bot

```
bash scripts/deploy_doctor.sh          # chẩn đoán, KHÔNG sửa gì
bash scripts/deploy_doctor.sh --fix    # gỡ kẹt, KHÔNG mất commit nào
```

Nó soi đúng những thứ `auto-deploy.sh` soi rồi nói thẳng đang vướng cái nào:
công tắc tắt · cron chết · **server có commit local chưa đẩy** · tree dirty ·
backend chết. Ca hay gặp nhất là commit local: bản cũ gặp ca này thì `exit 0`
mỗi phút và **im lặng vĩnh viễn**, site đứng yên hàng tiếng mà không ai biết
(PROD từng kẹt ở `7870f10` — commit không có trên GitHub).

Nay `auto-deploy.sh` cũng không im nữa: ghi file dấu vết `.auto-deploy.stuck`,
và sau `STUCK_SECS` (mặc định **6 giờ**) thì tự gỡ — nhưng **cất commit local
vào nhánh `rescue/local-<sha7>-<ngày>` trước**, không bao giờ đánh mất việc của
bot. Lấy lại: `git checkout rescue/local-…`.

Diễn tập: `bash scripts/test_deploy_doctor.sh` (repo giả, không đụng production).

## An toàn (đã tính sẵn trong script)
- **flock**: không chạy chồng.
- Chỉ deploy khi **fast-forward** được → không đè commit local chưa push của bot.
- Bỏ qua nếu tree có **thay đổi tracked chưa commit**.
- **Build lỗi → giữ nguyên bản đang chạy**, không restart (site không sập).
- File dữ liệu runtime đã **untracked** → `reset --hard` không đụng tới.

## Tạm tắt / bật lại auto-deploy
```
crontab -e            # xoá/thêm lại dòng chứa auto-deploy.sh
# hoặc chạy tay 1 lần:
bash ~/.openclaw/workspace-report/App-report/scripts/auto-deploy.sh
```

## Deploy tay (khi cần, vd đổi dependency lớn)
```
cd ~/.openclaw/workspace-report/App-report
git fetch origin main && git reset --hard origin/main
npm --prefix web run build
pm2 restart app-report && pm2 save
```

## Biến môi trường (nếu đổi máy/đường dẫn)
`REPO_DIR` (mặc định `~/.openclaw/workspace-report/App-report`), `BRANCH`
(`main`), `PM2_APP` (`app-report`), `PM2_WORKER` (`app-report-tgbot`), `LOG` (`<repo>/auto-deploy.log`).
