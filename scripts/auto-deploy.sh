#!/usr/bin/env bash
# auto-deploy.sh — App Report: TỰ cập nhật khi nhánh main có commit mới.
# Chạy định kỳ qua cron (mỗi 5 phút). Thiết kế AN TOÀN:
#   - flock: chống chạy chồng (lần chạy sau bỏ qua nếu lần trước chưa xong).
#   - Chỉ deploy khi HEAD là TỔ TIÊN của origin/main (fast-forward). Nếu server
#     có commit local chưa push -> BỎ QUA, không đè việc bot đang làm.
#   - Working tree có thay đổi TRACKED chưa commit -> CHỜ (bảo vệ việc dở) NHƯNG
#     luôn ghi rõ file nào dirty vào log; dirty quá lâu (STALE_SECS, mặc định 15')
#     coi là KẸT -> git stash (khôi phục được) rồi deploy, KHÔNG kẹt mãi.
#     (File dữ liệu runtime đã untracked nên không tính, không chặn deploy.)
#   - Build ra thư mục TẠM rồi mới tráo (swap) NGUYÊN TỬ. Build LỖI -> giữ
#     nguyên bản đang chạy, KHÔNG reload, thoát với mã lỗi.
#   - Chỉ reload backend khi có file server thay đổi; commit chỉ đổi frontend
#     tuyệt đối không đụng process HTTP nên không tạo 502 do PM2.
# Cấu hình qua biến môi trường nếu cần (mặc định theo server hiện tại).
set -uo pipefail

REPO_DIR="${REPO_DIR:-$HOME/.openclaw/workspace-report/App-report}"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-app-report}"
# Worker Telegram (bot) — cũng phải restart để bot chạy code mới (câu hỏi/LLM/thông báo).
PM2_WORKER="${PM2_WORKER:-app-report-tgbot}"
LOG="${LOG:-$REPO_DIR/auto-deploy.log}"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT:-3873}/api/health}"
HEALTH_TRIES="${HEALTH_TRIES:-6}"      # 6 lần x 5s = 30s cho backend đứng dậy
DISABLE_FILE="${DISABLE_FILE:-$REPO_DIR/.auto-deploy.disabled}"

cd "$REPO_DIR" 2>/dev/null || { echo "REPO_DIR không tồn tại: $REPO_DIR" >&2; exit 1; }

# --- CÔNG TẮC TẮT NHÌN THẤY ĐƯỢC ---
# Trước đây "khoá auto-deploy" chỉ là dòng cron bị chú thích: không ai nhìn thấy,
# không ghi log, và bật lại là quên mất vì sao từng tắt. Nay tắt bằng FILE có nội
# dung là LÝ DO, script tôn trọng và ghi rõ mỗi lượt.
#   Tắt : echo "DISABLED_BY_CEO_20260727 — deploy tay an toàn hơn" > .auto-deploy.disabled
#   Bật : rm .auto-deploy.disabled
if [ -f "$DISABLE_FILE" ]; then
  log "TẮT: $(head -c 200 "$DISABLE_FILE" 2>/dev/null | tr '\n' ' ') (xoá $DISABLE_FILE để bật lại)"
  exit 0
fi

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

# --- Sao lưu dữ liệu TRƯỚC khi động vào code (rẻ, và là thứ duy nhất không dựng lại được) ---
if [ -x "$REPO_DIR/scripts/backup_data.sh" ] && [ -d "$REPO_DIR/server/data" ]; then
  BK_DIR="${BACKUP_DIR:-$REPO_DIR/../backups}"
  mkdir -p "$BK_DIR" 2>/dev/null || true
  BK_FILE="$BK_DIR/data-$(date '+%Y%m%d-%H%M%S')-before-${REMOTE:0:7}.tgz"
  if DATA="$REPO_DIR/server/data" ARCHIVE="$BK_FILE" "$REPO_DIR/scripts/backup_data.sh" create >> "$LOG" 2>&1; then
    log "Đã sao lưu dữ liệu: $BK_FILE"
  else
    log "SAO LƯU LỖI -> DỪNG, không deploy (không đánh đổi dữ liệu lấy tốc độ)."
    exit 1
  fi
fi
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

# Đổi chỗ hai đường dẫn bằng renameat2(RENAME_EXCHANGE): tại mọi thời điểm
# web/dist luôn trỏ tới một bản hoàn chỉnh, không có khe "đã dời dist cũ nhưng
# chưa đưa dist mới vào". Host production là Linux; nếu kernel/filesystem không
# hỗ trợ thì fail-closed, tuyệt đối không fallback sang swap hai bước.
atomic_exchange() {
  python3 - "$1" "$2" <<'PY'
import ctypes
import os
import sys

left, right = (os.fsencode(os.path.abspath(p)) for p in sys.argv[1:3])
libc = ctypes.CDLL(None, use_errno=True)
renameat2 = getattr(libc, 'renameat2', None)
if renameat2 is None:
    raise OSError('libc không có renameat2')
renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameat2.restype = ctypes.c_int
AT_FDCWD = -100
RENAME_EXCHANGE = 2
if renameat2(AT_FDCWD, left, AT_FDCWD, right, RENAME_EXCHANGE) != 0:
    err = ctypes.get_errno()
    raise OSError(err, os.strerror(err))
PY
}

# --- Build ra thư mục tạm; kiểm đủ artifact rồi mới swap nguyên tử ---
rm -rf web/dist.new
if ! npm --prefix web run build -- --outDir dist.new --emptyOutDir >> "$LOG" 2>&1; then
  log "BUILD LỖI -> GIỮ NGUYÊN bản đang chạy, không reload."
  rm -rf web/dist.new
  exit 1
fi
if [ ! -s web/dist.new/index.html ] || [ ! -s web/dist.new/version.json ]; then
  log "BUILD THIẾU ARTIFACT -> GIỮ NGUYÊN web/dist, không reload."
  rm -rf web/dist.new
  exit 1
fi

if [ -e web/dist ] || [ -L web/dist ]; then
  if ! atomic_exchange web/dist.new web/dist >> "$LOG" 2>&1; then
    log "ATOMIC SWAP LỖI -> GIỮ NGUYÊN web/dist, không reload."
    rm -rf web/dist.new
    exit 1
  fi
  # Sau exchange, dist.new CHÍNH LÀ bản cũ. GIỮ lại thành dist.prev để lùi được
  # tức thì nếu bản mới hỏng — xoá ngay là tự tay vứt lưới an toàn.
  rm -rf web/dist.prev
  mv web/dist.new web/dist.prev
else
  # Lần cài đầu chưa có dist: một rename duy nhất cũng là atomic.
  mv web/dist.new web/dist
fi

# Frontend được Express đọc trực tiếp từ web/dist nên không cần đụng process.
# Chỉ reload khi backend thật sự đổi; tránh 502 ở các release chỉ sửa UI.
BACKEND_CHANGED=0
if echo "$CHANGED" | grep -qE '^(server/|ecosystem[^/]*\.(js|cjs|json)$|package(-lock)?\.json$)'; then
  BACKEND_CHANGED=1
fi
# Kiểm app còn sống thật hay không. `pm2 reload` trả 0 vẫn có thể để lại app 502
# (lỗi lúc khởi động, thiếu env, cổng chưa mở) — đó chính là kiểu sập đã gặp.
health_ok() {
  for _ in $(seq 1 "$HEALTH_TRIES"); do
    curl -fsS --max-time 5 "$HEALTH_URL" > /dev/null 2>&1 && return 0
    sleep 5
  done
  return 1
}

# Lùi về bản trước: trả code VÀ frontend về nguyên trạng rồi reload lại.
rollback_to_previous() {
  log "LÙI BẢN: quay lại ${LOCAL:0:7}."
  git reset --hard "$LOCAL" --quiet 2>>"$LOG" || log "  ! git reset khi lùi bản LỖI"
  if [ -d web/dist.prev ]; then
    rm -rf web/dist.new
    if atomic_exchange web/dist.prev web/dist >> "$LOG" 2>&1; then
      log "  đã trả web/dist về bản cũ."
    else
      log "  ! trả web/dist về bản cũ LỖI — frontend đang là bản mới."
    fi
  fi
  pm2 reload "$PM2_APP" --update-env >> "$LOG" 2>&1 || log "  ! pm2 reload khi lùi bản LỖI"
  if health_ok; then log "  ĐÃ LÙI XONG, app khoẻ lại."; else log "  ‼ LÙI RỒI VẪN KHÔNG KHOẺ — CẦN NGƯỜI VÀO XEM NGAY."; fi
}

if [ "$BACKEND_CHANGED" = 1 ]; then
  pm2 reload "$PM2_APP" --update-env >> "$LOG" 2>&1 || { log "pm2 reload LỖI"; rollback_to_previous; exit 1; }
  log "Đã reload backend $PM2_APP vì có file server thay đổi."

  if ! health_ok; then
    log "‼ SAU RELOAD APP KHÔNG KHOẺ ($HEALTH_URL) -> tự lùi về bản trước."
    rollback_to_previous
    exit 1
  fi
  log "Health OK sau reload."

  # Worker không phục vụ HTTP nhưng phải nạp code server mới khi đang chạy.
  if pm2 describe "$PM2_WORKER" > /dev/null 2>&1; then
    pm2 reload "$PM2_WORKER" --update-env >> "$LOG" 2>&1 && log "Đã reload worker $PM2_WORKER." || log "reload worker $PM2_WORKER LỖI (bỏ qua)."
  fi
else
  log "Frontend-only: đã atomic swap web/dist, không reload backend/worker."
fi
pm2 save >> "$LOG" 2>&1 || true
log "XONG: đã lên bản ${REMOTE:0:7}."
