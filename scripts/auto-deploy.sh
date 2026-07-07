#!/usr/bin/env bash
# auto-deploy.sh — App Report New: TỰ cập nhật khi nhánh main có commit mới.
# Chạy định kỳ qua cron (mỗi 1 phút). Thiết kế AN TOÀN:
#   - flock: chống chạy chồng (lần chạy sau bỏ qua nếu lần trước chưa xong).
#   - Chỉ deploy khi HEAD là TỔ TIÊN của origin/main (fast-forward). Nếu server
#     có commit local chưa push -> BỎ QUA, không đè việc bot đang làm.
#   - Working tree có thay đổi TRACKED chưa commit -> CHỜ (bảo vệ việc dở) NHƯNG
#     luôn ghi rõ file nào dirty vào log; dirty quá lâu (STALE_SECS, mặc định 15')
#     coi là KẸT -> git stash (khôi phục được) rồi deploy, KHÔNG kẹt mãi.
#     (File dữ liệu runtime đã untracked nên không tính, không chặn deploy.)
#   - Build ra thư mục TẠM rồi mới tráo (swap). Build LỖI -> giữ nguyên bản đang
#     chạy, KHÔNG restart, thoát với mã lỗi.
# Cấu hình qua biến môi trường nếu cần (mặc định theo server hiện tại).
set -uo pipefail

REPO_DIR="${REPO_DIR:-$HOME/.openclaw/workspace-report/App-report-new}"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-reportnew}"
LOG="${LOG:-$REPO_DIR/auto-deploy.log}"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

cd "$REPO_DIR" 2>/dev/null || { echo "REPO_DIR không tồn tại: $REPO_DIR" >&2; exit 1; }

# --- Khoá chống chạy chồng ---
exec 9>"$REPO_DIR/.auto-deploy.lock"
flock -n 9 || exit 0

# Mốc "đã chạy" (ghi đè mỗi lượt, không phình) -> biết cron còn sống.
date '+%F %T' > "$REPO_DIR/.auto-deploy.last" 2>/dev/null || true

# --- Có bản mới không? (thử lại 3 lần khi mạng chập chờn; GHI LẠI lỗi thật) ---
fetch_ok=0
for i in 1 2 3; do
  if err=$(git fetch origin "$BRANCH" 2>&1); then fetch_ok=1; break; fi
  log "git fetch lần $i lỗi: ${err//$'\n'/ | }"
  sleep 5
done
if [ "$fetch_ok" != 1 ]; then log "git fetch thất bại sau 3 lần — bỏ qua lượt này (sẽ thử lại phút sau)."; exit 0; fi
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
[ "$LOCAL" = "$REMOTE" ] && exit 0   # không có gì mới -> im lặng thoát

# --- An toàn: chỉ đi tiếp khi fast-forward được (không mất commit local) ---
if ! git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
  log "BỎ QUA: HEAD (${LOCAL:0:7}) không phải tổ tiên của origin/$BRANCH — có commit local chưa push?"
  exit 0
fi

# --- An toàn: không đè thay đổi tracked chưa commit ---
# KHÁC bản cũ (chỉ "BỎ QUA" im lặng, kẹt mãi mãi nếu tree dirty):
#   1) LUÔN ghi RÕ file nào đang dirty -> soi được thủ phạm.
#   2) Có CỬA THOÁT: dirty quá lâu (mặc định 15') = kẹt, KHÔNG phải việc đang làm
#      -> git stash (KHÔI PHỤC được bằng `git stash list`) rồi deploy tiếp.
DIRTY_MARK="$REPO_DIR/.auto-deploy.dirty-since"
STALE_SECS="${STALE_SECS:-900}"
if ! git diff --quiet || ! git diff --cached --quiet; then
  DIRTY_LIST=$(git status --short 2>/dev/null | tr '\n' ';')
  now=$(date +%s)
  since=$now
  if [ -f "$DIRTY_MARK" ]; then since=$(cat "$DIRTY_MARK" 2>/dev/null || echo "$now"); fi
  case "$since" in ''|*[!0-9]*) since=$now ;; esac
  [ -f "$DIRTY_MARK" ] || echo "$now" > "$DIRTY_MARK"
  age=$(( now - since ))
  if [ "$age" -lt "$STALE_SECS" ]; then
    log "BỎ QUA (${age}s/${STALE_SECS}s): working tree dirty — chờ, không đè việc dở. Files: ${DIRTY_LIST}"
    exit 0
  fi
  log "KẸT ${age}s vẫn dirty -> git stash (khôi phục: 'git stash list') rồi deploy. Files: ${DIRTY_LIST}"
  if git stash push -u -m "auto-deploy-stash $(date '+%F %T')" >> "$LOG" 2>&1; then
    rm -f "$DIRTY_MARK"
  else
    log "git stash LỖI -> bỏ qua lượt này để an toàn."
    exit 0
  fi
else
  rm -f "$DIRTY_MARK"   # sạch rồi -> xoá mốc dirty
fi

log "Bản mới ${LOCAL:0:7} -> ${REMOTE:0:7}: bắt đầu cập nhật."
CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE")
git reset --hard "origin/$BRANCH" --quiet

# --- Cài lại dependency nếu lockfile/manifest đổi ---
if echo "$CHANGED" | grep -qE 'web/package(-lock)?\.json'; then
  log "web/package đổi -> npm ci"
  npm --prefix web ci --no-audit --no-fund >> "$LOG" 2>&1 || { log "npm ci LỖI"; exit 1; }
fi
if echo "$CHANGED" | grep -qE 'server/package(-lock)?\.json|^package(-lock)?\.json'; then
  log "server/package đổi -> npm install (server)"
  npm install --no-audit --no-fund >> "$LOG" 2>&1 || { log "npm install (server) LỖI"; exit 1; }
fi

# --- Build ra thư mục tạm; chỉ tráo khi build OK ---
rm -rf web/dist.new
if npm --prefix web run build -- --outDir dist.new --emptyOutDir >> "$LOG" 2>&1; then
  [ -d web/dist ] && mv web/dist web/dist.old
  mv web/dist.new web/dist
  rm -rf web/dist.old
  pm2 restart "$PM2_APP" >> "$LOG" 2>&1 || { log "pm2 restart LỖI"; exit 1; }
  pm2 save >> "$LOG" 2>&1 || true
  log "XONG: đã lên bản ${REMOTE:0:7}."
else
  log "BUILD LỖI -> GIỮ NGUYÊN bản đang chạy, không restart."
  rm -rf web/dist.new
  exit 1
fi
