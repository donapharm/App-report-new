#!/usr/bin/env bash
# safe_rollback.sh — P1-3: ROLLBACK KHÔNG ĐƯỢC PHÁ DỮ LIỆU TRƯỚC KHI CHỨNG MINH PHỤC HỒI ĐƯỢC.
#
# Lỗi của bản cũ: xoá $DATA → giải nén đè → không kiểm checksum/manifest → nuốt lỗi
# restore/start/smoke → VẪN in "rollback finished". Lưới an toàn tự phá dữ liệu.
#
# Thứ tự CỨNG ở đây (sai bước nào dừng ngay, dữ liệu thật còn nguyên):
#   1. Kiểm checksum archive  → TRƯỚC KHI động vào dữ liệu
#   2. Giải nén ra STAGING    → tuyệt đối không đè lên $DATA
#   3. Đối chiếu manifest     → đủ file/đúng nội dung/đúng quyền/đúng symlink
#   4. Đổi chỗ NGUYÊN TỬ      → $DATA thành $DATA.bad.<ts> (GIỮ LẠI), staging thành $DATA
#   5. Start + health + smoke → fail là exit != 0, nói rõ dữ liệu cũ nằm đâu
#   6. Chỉ khi tất cả xanh mới in thành công
#
# KHÔNG có `rm -rf "$DATA"` ở bất kỳ nhánh nào.
#
# Dùng:
#   DATA=/path/data ARCHIVE=/path/backup.tgz \
#   START_CMD="pm2 restart app-report" HEALTH_CMD="curl -fsS localhost:3873/api/health" \
#   SMOKE_CMD="node scripts/smoke.js" ./scripts/safe_rollback.sh

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release_lib.sh"

DATA="${DATA:?Thiếu biến DATA (thư mục dữ liệu thật)}"
ARCHIVE="${ARCHIVE:?Thiếu biến ARCHIVE (đường dẫn backup .tgz)}"
# ‼ Lệnh khởi động phải là của BẢN CŨ (release trước), KHÔNG tái dùng lệnh start bản
# mới đang lỗi. Rollback đưa DATA về, nhưng nếu bản mới lỗi ở tầng CODE thì bật lại
# code mới là vô nghĩa. Ops truyền ROLLBACK_START_CMD trỏ đúng release trước
# (vd đổi symlink current→release-cũ rồi pm2 reload). Không có thì cảnh báo & dùng
# START_CMD như phương án cuối (chỉ đủ khi rollback thuần dữ liệu, code không đổi).
ROLLBACK_START_CMD="${ROLLBACK_START_CMD:-}"
START_CMD="${START_CMD:-}"
if [ -z "$ROLLBACK_START_CMD" ] && [ -n "$START_CMD" ]; then
  echo "⚠ ROLLBACK_START_CMD trống — dùng START_CMD (chỉ đúng khi CODE không đổi, chỉ lùi DATA)." >&2
  ROLLBACK_START_CMD="$START_CMD"
fi
HEALTH_CMD="${HEALTH_CMD:-}"
SMOKE_CMD="${SMOKE_CMD:-}"
TS="$(date +%Y%m%d-%H%M%S)"
STAGING="${DATA}.restore.${TS}"
KEPT="${DATA}.bad.${TS}"

echo "=== ROLLBACK AN TOÀN — $(date '+%F %T') ==="
info "DATA=$DATA"
info "ARCHIVE=$ARCHIVE"

# ── Bước 1: checksum archive TRƯỚC khi động vào dữ liệu thật ──
archive_verify_checksum "$ARCHIVE"

# ── Bước 2: giải nén ra STAGING (không đè $DATA) ──
[ -e "$STAGING" ] && die "Staging đã tồn tại: $STAGING"
mkdir -p "$STAGING"
tar -xzf "$ARCHIVE" -C "$STAGING" || die "Giải nén thất bại — DỪNG, dữ liệu thật CHƯA bị đụng."
ok "Đã giải nén ra staging (dữ liệu thật chưa bị đụng)"

# ── Bước 3: đối chiếu manifest (đủ file, đúng nội dung, quyền, symlink) ──
if ! manifest_verify "$STAGING" "${ARCHIVE}.manifest"; then
  rm -rf "$STAGING"
  die "Bản phục hồi KHÔNG khớp manifest — DỪNG, dữ liệu thật ($DATA) còn nguyên vẹn."
fi
ok "Bản phục hồi khớp manifest"

# ── Bước 4: đổi chỗ NGUYÊN TỬ, giữ lại bản cũ (không xoá) ──
if [ -e "$DATA" ]; then
  mv "$DATA" "$KEPT" || die "Không đổi tên được $DATA — DỪNG, chưa mất gì."
  info "Dữ liệu cũ được GIỮ tại: $KEPT"
fi
if ! mv "$STAGING" "$DATA"; then
  # Cố khôi phục lại nguyên trạng trước khi báo lỗi.
  [ -e "$KEPT" ] && mv "$KEPT" "$DATA" 2>/dev/null || true
  die "Không chuyển được staging vào $DATA — đã cố đưa dữ liệu cũ về chỗ cũ."
fi
ok "Đã đổi chỗ nguyên tử sang bản phục hồi"

fail_hard() {
  echo "❌ ROLLBACK THẤT BẠI: $*" >&2
  echo "   ‼ Dữ liệu cũ VẪN CÒN tại: $KEPT (không bị xoá) — có thể đưa về thủ công." >&2
  exit 1
}

# ── Bước 5: start + health + smoke — fail là fail, không nuốt ──
if [ -n "$ROLLBACK_START_CMD" ]; then
  info "Khởi động BẢN CŨ: $ROLLBACK_START_CMD"
  eval "$ROLLBACK_START_CMD" || fail_hard "khởi động bản cũ lỗi"
  ok "Đã khởi động bản cũ"
fi
if [ -n "$HEALTH_CMD" ]; then
  info "Health: $HEALTH_CMD"
  eval "$HEALTH_CMD" >/dev/null || fail_hard "health check không PASS"
  ok "Health PASS"
fi
if [ -n "$SMOKE_CMD" ]; then
  info "Smoke: $SMOKE_CMD"
  eval "$SMOKE_CMD" >/dev/null || fail_hard "smoke test không PASS"
  ok "Smoke PASS"
fi

# ── Bước 6: chỉ tới đây mới được nói thành công ──
echo
ok "ROLLBACK HOÀN TẤT — đã phục hồi, kiểm chứng và app chạy lại."
info "Bản dữ liệu trước rollback giữ tại: $KEPT (dọn tay khi đã yên tâm)."
