#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# deploy_doctor.sh — VÌ SAO SITE KHÔNG LÊN BẢN MỚI, VÀ CÁCH GỠ (CEO 10/08/2026)
#
# CEO: *"Con bot của tao nó đang bị lỗi, nên mày tìm cách vá cho tao đi nào."*
#
# ‼ Site KHÔNG cần bot mới lên bản mới. Server có cron chạy `auto-deploy.sh` mỗi
# phút, cứ `main` có commit mới là tự build + tráo + restart. Bot hỏng ≠ deploy chết.
# Nhưng auto-deploy có ba trạng thái **BỎ QUA IM LẶNG**, mỗi phút ghi một dòng vào
# file log không ai đọc, và site đứng yên mãi mãi mà không ai biết vì sao:
#
#   ① HEAD trên server KHÔNG phải tổ tiên của origin/main (server có commit local
#      chưa đẩy) ⇒ bỏ qua để không đè việc của bot. Đây là ca đang nghi: PROD hiện
#      bản `7870f10` mà commit đó KHÔNG có trên GitHub.
#   ② Working tree dirty ⇒ chờ (có cửa thoát sau 15 phút, nhưng vẫn im).
#   ③ File `.auto-deploy.disabled` tồn tại ⇒ tắt hẳn.
#   ④ Cron chết / build lỗi liên tiếp.
#
# Script này ĐỌC ĐÚNG những thứ auto-deploy đọc rồi nói thẳng bằng tiếng Việt đang
# vướng cái nào và gỡ ra sao. Mặc định **CHỈ ĐỌC**, không sửa gì.
#
#   bash scripts/deploy_doctor.sh            # chẩn đoán, không đụng gì
#   bash scripts/deploy_doctor.sh --fix      # gỡ kẹt (KHÔNG BAO GIỜ mất commit)
#
# ‼ `--fix` không xoá gì: commit local trên server được cất vào nhánh cứu hộ
# `rescue/local-<sha7>-<ngày>` TRƯỚC khi fast-forward, thay đổi chưa commit được
# `git stash`. Muốn lấy lại luôn còn đường.
#
# ‼ KHÔNG in token/khoá/nội dung .env — chỉ trạng thái git, mốc giờ (GMT+7), tên file.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO_DIR="${REPO_DIR:-$HOME/.openclaw/workspace-report/App-report}"
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-app-report}"
LOG="${LOG:-$REPO_DIR/auto-deploy.log}"
DISABLE_FILE="${DISABLE_FILE:-$REPO_DIR/.auto-deploy.disabled}"
STUCK_FILE="${STUCK_FILE:-$REPO_DIR/.auto-deploy.stuck}"
LAST_FILE="${LAST_FILE:-$REPO_DIR/.auto-deploy.last}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${PORT:-3873}/api/health}"

FIX=0
[ "${1:-}" = "--fix" ] && FIX=1

# ‼ Giờ VN (GMT+7). In giờ UTC là lệch ngày — CEO đã nhắc nhiều lần.
vn_now() { TZ='Asia/Bangkok' date '+%F %H:%M:%S'; }

BLOCKERS=0
say()  { echo "$*"; }
warn() { echo "⛔ $*"; BLOCKERS=$((BLOCKERS+1)); }
ok()   { echo "✅ $*"; }

say "=== BÁC SĨ DEPLOY — APP REPORT ==="
say "Thời điểm soi : $(vn_now) (GMT+7)"
say "Thư mục repo  : $REPO_DIR"
say "Nhánh theo dõi: $BRANCH"
say "Chế độ        : $([ $FIX = 1 ] && echo 'GỠ KẸT (--fix)' || echo 'CHỈ ĐỌC')"
say ""

if [ ! -d "$REPO_DIR/.git" ]; then
  warn "KHÔNG thấy repo ở $REPO_DIR — chạy trên máy PROD, hoặc đặt REPO_DIR trỏ đúng chỗ."
  exit 1
fi
cd "$REPO_DIR" || exit 1

# ── ① Công tắc tắt ────────────────────────────────────────────────────────────
say "① CÔNG TẮC AUTO-DEPLOY"
if [ -f "$DISABLE_FILE" ]; then
  warn "Auto-deploy ĐANG TẮT. Lý do ghi trong file: $(head -c 200 "$DISABLE_FILE" | tr '\n' ' ')"
  say "   Gỡ: rm $DISABLE_FILE"
  [ $FIX = 1 ] && { rm -f "$DISABLE_FILE" && ok "   ĐÃ BẬT LẠI (xoá $DISABLE_FILE)."; BLOCKERS=$((BLOCKERS-1)); }
else
  ok "Không có file tắt — auto-deploy được phép chạy."
fi
say ""

# ── ② Cron còn sống không ─────────────────────────────────────────────────────
say "② CRON CÒN CHẠY KHÔNG"
if [ -f "$LAST_FILE" ]; then
  last_run=$(cat "$LAST_FILE" 2>/dev/null || echo '')
  age_min=$(( ( $(date +%s) - $(date -r "$LAST_FILE" +%s 2>/dev/null || date +%s) ) / 60 ))
  if [ "$age_min" -le 10 ]; then ok "Lượt chạy gần nhất: $last_run (${age_min} phút trước) — cron sống."
  else warn "Lượt chạy gần nhất cách đây ${age_min} PHÚT ($last_run) — cron có thể đã chết. Kiểm: crontab -l | grep auto-deploy"; fi
else
  warn "Chưa có $LAST_FILE — cron có thể chưa từng chạy bản script này. Kiểm: crontab -l | grep auto-deploy"
fi
say ""

# ── ③ Trạng thái git: ĐÂY LÀ CHỖ HAY KẸT NHẤT ─────────────────────────────────
say "③ TRẠNG THÁI GIT (chỗ auto-deploy hay bỏ qua im lặng)"
if ! git fetch origin "$BRANCH" --quiet 2>/dev/null; then
  warn "git fetch KHÔNG được — mạng/khoá truy cập GitHub. Deploy không thể biết có bản mới."
  say ""
fi
LOCAL=$(git rev-parse HEAD 2>/dev/null || echo '')
REMOTE=$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo '')
say "   HEAD trên server : ${LOCAL:0:7}"
say "   origin/$BRANCH   : ${REMOTE:0:7}"

if [ -n "$LOCAL" ] && [ "$LOCAL" = "$REMOTE" ]; then
  ok "Server đã ĐÚNG bằng $BRANCH — không có gì mới để deploy."
elif [ -n "$LOCAL" ] && [ -n "$REMOTE" ]; then
  if git merge-base --is-ancestor "$LOCAL" "$REMOTE" 2>/dev/null; then
    behind=$(git rev-list --count "$LOCAL..$REMOTE" 2>/dev/null || echo '?')
    ok "Đi SAU $behind commit và fast-forward được — lượt cron kế tiếp sẽ tự lên."
  else
    ahead=$(git rev-list --count "$REMOTE..$LOCAL" 2>/dev/null || echo '?')
    warn "SERVER CÓ $ahead COMMIT LOCAL CHƯA ĐẨY LÊN GITHUB ⇒ auto-deploy BỎ QUA MỖI PHÚT, site đứng yên."
    say "   Các commit chỉ có trên server (không ai ngoài máy này có):"
    git log --oneline "$REMOTE..$LOCAL" 2>/dev/null | sed 's/^/     · /' | head -20
    say "   Gỡ an toàn: cất chúng vào nhánh cứu hộ rồi mới fast-forward."
    if [ $FIX = 1 ]; then
      RESCUE="rescue/local-${LOCAL:0:7}-$(TZ='Asia/Bangkok' date '+%Y%m%d-%H%M')"
      if git branch "$RESCUE" "$LOCAL" 2>/dev/null; then
        ok "   Đã cất $ahead commit vào nhánh **$RESCUE** (còn nguyên, lấy lại được bất cứ lúc nào)."
        say "   Đẩy lên GitHub để không mất khi máy hỏng:  git push -u origin $RESCUE"
        if git reset --hard "origin/$BRANCH" --quiet; then
          ok "   Đã đưa server về đúng origin/$BRANCH (${REMOTE:0:7}). Lượt cron kế tiếp sẽ build + restart."
          BLOCKERS=$((BLOCKERS-1))
        else
          warn "   reset --hard LỖI — dừng lại, không làm gì thêm."
        fi
      else
        warn "   Không tạo được nhánh cứu hộ ⇒ DỪNG. Tuyệt đối không reset khi chưa cất được commit."
      fi
    fi
  fi
fi

if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  warn "Working tree DIRTY (có sửa chưa commit) ⇒ auto-deploy chờ, tối đa 15 phút rồi mới tự stash."
  git status --short 2>/dev/null | sed 's/^/     · /' | head -20
  if [ $FIX = 1 ]; then
    if git stash push -u -m "deploy_doctor $(vn_now)" >/dev/null 2>&1; then
      ok "   Đã cất vào stash (xem lại: git stash list · lấy về: git stash pop)."
      BLOCKERS=$((BLOCKERS-1))
    else warn "   git stash LỖI — không đụng gì thêm."; fi
  fi
else
  ok "Working tree sạch."
fi
say ""

# ── ④ Backend còn sống không ──────────────────────────────────────────────────
say "④ BACKEND"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || echo '000')
if [ "$code" = "200" ]; then ok "API trả 200 — backend đang sống."
else warn "API trả '$code' — backend có thể chết. Kiểm: pm2 status $PM2_APP && pm2 logs $PM2_APP --lines 50"; fi
say ""

# ── ⑤ Mấy dòng log cuối ───────────────────────────────────────────────────────
say "⑤ 12 DÒNG NHẬT KÝ AUTO-DEPLOY GẦN NHẤT"
if [ -f "$LOG" ]; then tail -n 12 "$LOG" | sed 's/^/   /'; else say "   (chưa có $LOG)"; fi
say ""

# ── Kết luận ──────────────────────────────────────────────────────────────────
say "=== KẾT LUẬN ==="
if [ "$BLOCKERS" -le 0 ]; then
  ok "Không thấy vướng gì. Có commit mới trên $BRANCH là site tự lên trong ~1 phút."
  say "   Bản đang chạy xem ở chân màn đăng nhập, hoặc: tail -n 5 $LOG"
  rm -f "$STUCK_FILE" 2>/dev/null || true
  exit 0
fi
say "Còn $BLOCKERS chỗ vướng ở trên."
[ $FIX = 0 ] && say "Gỡ tự động (KHÔNG mất commit nào):  bash scripts/deploy_doctor.sh --fix"
# Để lại dấu vết NHÌN THẤY ĐƯỢC — cái thiếu đúng của bản cũ: kẹt mà chỉ ghi vào
# log rồi im, nên đứng hàng tiếng không ai hay.
{ echo "stuck_at=$(vn_now) blockers=$BLOCKERS head=${LOCAL:0:7} remote=${REMOTE:0:7}"; } > "$STUCK_FILE" 2>/dev/null || true
exit 2
