#!/usr/bin/env bash
# auto-deploy.sh — App Report New: TỰ cập nhật khi nhánh main có commit mới.
# Chạy định kỳ qua cron (mỗi 1 phút). Thiết kế AN TOÀN:
#   - flock: chống chạy chồng (lần chạy sau bỏ qua nếu lần trước chưa xong).
#   - Chỉ deploy khi HEAD là TỔ TIÊN của origin/main (fast-forward). Nếu server
#     có commit local chưa push -> BỎ QUA, không đè việc bot đang làm.
#   - Bỏ qua nếu working tree có thay đổi TRACKED chưa commit (bảo vệ việc dở).
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

# --- Có bản mới không? ---
git fetch origin "$BRANCH" --quiet || { log "git fetch lỗi"; exit 1; }
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
[ "$LOCAL" = "$REMOTE" ] && exit 0   # không có gì mới -> im lặng thoát

# --- An toàn: chỉ đi tiếp khi fast-forward được (không mất commit local) ---
if ! git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
  log "BỎ QUA: HEAD (${LOCAL:0:7}) không phải tổ tiên của origin/$BRANCH — có commit local chưa push?"
  exit 0
fi

# --- An toàn: không đè thay đổi tracked chưa commit ---
if ! git diff --quiet || ! git diff --cached --quiet; then
  log "BỎ QUA: working tree có thay đổi tracked chưa commit — không đè việc dở."
  exit 0
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
