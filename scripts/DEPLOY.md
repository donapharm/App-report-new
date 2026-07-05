# Deploy — App Report New (reportnew)

## Tự động (mặc định)
Server chạy `scripts/auto-deploy.sh` qua **cron mỗi 1 phút**. Cứ có commit mới trên
`main` là server tự: `fetch → reset --hard → (build vào thư mục tạm) → tráo dist →
pm2 restart`. **Không cần deploy tay.**

- Merge PR lên `main` → chờ ~1 phút → site tự cập nhật.
- Kiểm "đã lên bản nào": nhìn dòng **"Bản <sha>"** ở chân màn login, hoặc:
  ```
  tail -n 30 ~/.openclaw/workspace-report/App-report-new/auto-deploy.log
  ```

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
bash ~/.openclaw/workspace-report/App-report-new/scripts/auto-deploy.sh
```

## Deploy tay (khi cần, vd đổi dependency lớn)
```
cd ~/.openclaw/workspace-report/App-report-new
git fetch origin main && git reset --hard origin/main
npm --prefix web run build
pm2 restart reportnew && pm2 save
```

## Biến môi trường (nếu đổi máy/đường dẫn)
`REPO_DIR` (mặc định `~/.openclaw/workspace-report/App-report-new`), `BRANCH`
(`main`), `PM2_APP` (`reportnew`), `LOG` (`<repo>/auto-deploy.log`).
