#!/usr/bin/env bash
# safe_pm2_cutover.sh — MẪU cutover an toàn cho bot Report lắp vào deploy_release.sh.
# Gỡ đúng 3 lỗi bot tự phát hiện khi tích hợp:
#   (#1) Approval token 1-lần — verify TRƯỚC mọi thứ, chặn dùng lại.
#   (#2) Bắt sai exit code — mỗi bước phải `|| fail`, KHÔNG nuốt; `set -Eeuo pipefail` + trap.
#   (#3) Backup lỗi sau khi DỪNG PM2 → service không khởi động lại:
#        ⇒ BACKUP TRƯỚC KHI ĐỘNG VÀO SERVICE; và trap BẢO ĐẢM luôn đưa service về chạy.
#
# Nguyên tắc thứ tự (không đảo):
#   1. verify_approval  (chưa động gì tới hệ thống)
#   2. release_manifest verify  (bản chạy đúng bản đã chuẩn bị)
#   3. backup_data create + verify  — TRONG KHI SERVICE VẪN CHẠY (backup trước khi dừng)
#   4. reload service (ưu tiên `pm2 reload` = không gián đoạn; nếu buộc stop→start thì trap lo restart)
#   5. health + smoke — fail thì rollback ngay bằng safe_rollback.sh
#
# KHÔNG hardcode release: mọi giá trị (release id, base, commit, PM2 app, DataHub release)
# truyền qua biến môi trường. DataHub đang chạy release riêng — script này KHÔNG đụng DataHub.
#
# Dùng:
#   RELEASE_ROOT=/srv/app-report/releases/<rel>  DATA=/srv/app-report/data \
#   PM2_APP=app-report  ARCHIVE=/srv/app-report/backups/data-<ts>.tgz \
#   PREPARE_FILE=/srv/app-report/prepare_result.txt \
#   EXPECT_CALLBACK=OK_ECOST_0726 EXPECT_BASE=/srv/app-report \
#   EXPECT_COMMIT=$(git -C "$RELEASE_ROOT" rev-parse HEAD) EXPECT_RELEASE=<rel> \
#   HEALTH_CMD="curl -fsS localhost:3873/api/health" SMOKE_CMD="node server/scripts/smoke.js" \
#   ./scripts/safe_pm2_cutover.sh

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release_lib.sh"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RELEASE_ROOT="${RELEASE_ROOT:?Thiếu RELEASE_ROOT}"
DATA="${DATA:?Thiếu DATA}"
APP_DATA_DIR="${APP_DATA_DIR:-$DATA}"
AUTH_DATA_DIR="${AUTH_DATA_DIR:?Thiếu AUTH_DATA_DIR}"
COLD_T08_CMD="${COLD_T08_CMD:?Thiếu COLD_T08_CMD}"
PM2_APP="${PM2_APP:?Thiếu PM2_APP}"
ARCHIVE="${ARCHIVE:?Thiếu ARCHIVE}"
HEALTH_CMD="${HEALTH_CMD:-}"
SMOKE_CMD="${SMOKE_CMD:-}"
APP_RELEASE_ROOT="${APP_RELEASE_ROOT:?Thiếu APP_RELEASE_ROOT — phải trỏ release đang cutover}"
# Lệnh đưa service về chạy — mặc định reload (không gián đoạn). Cho override.
START_CMD="${START_CMD:-pm2 reload $PM2_APP --update-env}"

SERVICE_TOUCHED=0
# ‼ Trap bảo đảm: nếu thoát giữa chừng SAU khi đã động vào service, luôn cố đưa
# service về chạy — không để lỗi ở bước sau khiến app chết mà không ai bật lại (#3).
on_exit() {
  local rc=$?
  if [ "$rc" -ne 0 ] && [ "$SERVICE_TOUCHED" -eq 1 ]; then
    echo "⚠ Cutover lỗi sau khi đã động vào service — cố đưa $PM2_APP về chạy..." >&2
    pm2 reload "$PM2_APP" --update-env >/dev/null 2>&1 || pm2 restart "$PM2_APP" >/dev/null 2>&1 || \
      echo "❌ KHÔNG tự bật lại được $PM2_APP — CẦN CAN THIỆP TAY NGAY." >&2
  fi
  exit "$rc"
}
trap on_exit EXIT

echo "=== CUTOVER AN TOÀN $PM2_APP — $(date '+%F %T') ==="

# Identity path is part of the runtime contract. PM2 keeps its old environment
# unless the caller explicitly updates it, so reject a stale release root before
# touching the service.
[ "$(readlink -f "$APP_RELEASE_ROOT")" = "$(readlink -f "$RELEASE_ROOT")" ] \
  || die "APP_RELEASE_ROOT không trỏ release đang cutover — DỪNG trước khi khởi động."
ok "APP_RELEASE_ROOT trỏ đúng release đang cutover"

# ── 1. Duyệt hợp lệ (chưa động gì) ──
PREPARE_FILE="${PREPARE_FILE:?Thiếu PREPARE_FILE}" \
EXPECT_CALLBACK="${EXPECT_CALLBACK:?}" EXPECT_BASE="${EXPECT_BASE:?}" \
EXPECT_COMMIT="${EXPECT_COMMIT:?}" EXPECT_RELEASE="${EXPECT_RELEASE:?}" \
  bash "$HERE/verify_approval.sh" || die "Phiếu duyệt không hợp lệ — DỪNG."

# ── 2. Bản chạy khớp bản đã chuẩn bị (chưa động service) ──
RELEASE_ROOT="$RELEASE_ROOT" bash "$HERE/release_manifest.sh" verify || die "Bản chạy bị đổi sau prepare — DỪNG."

# Runtime bindings and a real cold T08 read must pass before backup, pointer
# change, PM2 reload, or any other production mutation.
RELEASE_ROOT="$RELEASE_ROOT" APP_DATA_DIR="$APP_DATA_DIR" AUTH_DATA_DIR="$AUTH_DATA_DIR" \
  COLD_T08_CMD="$COLD_T08_CMD" bash "$HERE/release_runtime_preflight.sh" \
  || die "Runtime preflight không đạt — DỪNG, chưa đụng service."

# ── 3. BACKUP TRƯỚC KHI ĐỘNG VÀO SERVICE (#3) — service vẫn đang chạy ──
DATA="$DATA" ARCHIVE="$ARCHIVE" bash "$HERE/backup_data.sh" create || die "Tạo backup lỗi — DỪNG, chưa đụng service."
ARCHIVE="$ARCHIVE" bash "$HERE/backup_data.sh" verify || die "Backup không đáng tin — DỪNG, chưa đụng service."
ok "Backup xong & đã kiểm chứng (service vẫn đang chạy bình thường)"

# ── 4. Đưa bản mới vào chạy (từ đây service bị động → trap bảo đảm restart) ──
# ‼ Verify manifest LẦN CUỐI ngay sát trước start — đóng khe TOCTOU giữa lúc backup
# (bước 3) và lúc thực sự chạy: bản chạy không được đổi 1 file nào trong khoảng đó.
RELEASE_ROOT="$RELEASE_ROOT" bash "$HERE/release_manifest.sh" verify \
  || die "Bản chạy bị đổi sau backup (ngay trước start) — DỪNG, chưa động service."
ok "Manifest khớp lần cuối, sát thời điểm start"

SERVICE_TOUCHED=1
info "Nạp bản mới: $START_CMD"
eval "$START_CMD" || die "Lệnh reload/start service lỗi."
ok "Đã nạp bản mới"

# ── 5. Health + smoke — fail thì ROLLBACK ngay, không để bản lỗi chạy ──
cutover_fail() {
  echo "❌ $* — ROLLBACK về dữ liệu backup vừa tạo." >&2
  # ROLLBACK_START_CMD trỏ BẢN CŨ (release trước) — không tái dùng START_CMD của bản
  # mới đang lỗi. Ops set qua env; nếu trống, safe_rollback cảnh báo & fallback START_CMD.
  DATA="$DATA" ARCHIVE="$ARCHIVE" \
    ROLLBACK_START_CMD="${ROLLBACK_START_CMD:-}" START_CMD="$START_CMD" \
    HEALTH_CMD="$HEALTH_CMD" SMOKE_CMD="$SMOKE_CMD" \
    bash "$HERE/safe_rollback.sh" || echo "❌ ROLLBACK cũng lỗi — CẦN CAN THIỆP TAY." >&2
  exit 1
}
if [ -z "$HEALTH_CMD" ]; then cutover_fail "Thiếu HEALTH_CMD để kiểm exact sau cutover"; fi
health_json="$(mktemp)"
if ! eval "$HEALTH_CMD" >"$health_json"; then rm -f "$health_json"; cutover_fail "Health không PASS"; fi
if ! node -e '
  const fs = require("fs");
  const body = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (body?.ok !== true || body?.commit !== process.argv[2]) process.exit(1);
' "$health_json" "$EXPECT_COMMIT"; then
  rm -f "$health_json"
  cutover_fail "Health exact lệch commit đích"
fi
rm -f "$health_json"
ok "PREFLIGHT 4/4 sau cutover: health xanh và exact khớp commit đích"
if [ -n "$SMOKE_CMD" ]; then eval "$SMOKE_CMD" >/dev/null || cutover_fail "Smoke không PASS"; ok "Smoke PASS"; fi

SERVICE_TOUCHED=0  # tới đây coi như ổn định, không cần trap cứu nữa
echo
ok "CUTOVER HOÀN TẤT — bản mới chạy, health/smoke PASS. Backup: $ARCHIVE"
