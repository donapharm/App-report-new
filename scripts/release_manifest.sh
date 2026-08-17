#!/usr/bin/env bash
# release_manifest.sh — P1-2: BẢN ĐÃ CHUẨN BỊ KHÔNG ĐƯỢC ĐỔI GIỮA CHỪNG (chống TOCTOU).
#
# Lỗi bản cũ: chỉ kiểm RELEASE_COMMIT + .env + symlink data ⇒ mã nguồn, asset build,
# node_modules, ecosystem.config bị sửa SAU khi chuẩn bị vẫn chạy được mà không ai biết.
#
# Cách dùng:
#   # ngay SAU khi build xong:
#   RELEASE_ROOT=/srv/app-report/releases/rel-x ./scripts/release_manifest.sh create
#   # ngay TRƯỚC pm2 start/reload:
#   RELEASE_ROOT=/srv/app-report/releases/rel-x ./scripts/release_manifest.sh verify
#
# Phạm vi tính manifest (mọi thứ SẼ CHẠY):
#   server/src, server/scripts, server/package.json, server/package-lock.json,
#   web/dist, ecosystem.config.*, và các file khởi động khác nếu khai báo thêm
#   qua MANIFEST_EXTRA (danh sách đường dẫn tương đối, cách nhau bởi dấu cách).

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release_lib.sh"

RELEASE_ROOT="${RELEASE_ROOT:?Thiếu RELEASE_ROOT (thư mục release sẽ chạy)}"
MANIFEST="${MANIFEST:-${RELEASE_ROOT}/release_manifest.sha256}"
ACTION="${1:-}"

# Phải gồm node_modules RUNTIME (server) — P1-2 nghiệm thu (d): sửa 1 file trong
# node_modules SAU prepare phải bị chặn trước khi PM2 chạy. web build ra dist nên
# node_modules của web không chạy ở runtime; chỉ manifest server/node_modules.
DEFAULT_TARGETS=(
  "RELEASE_IDENTITY.json"
  "server/src" "server/scripts" "server/package.json" "server/package-lock.json"
  "server/node_modules" "web/dist" "ecosystem.config.js" "ecosystem.config.cjs"
)
read -r -a EXTRA <<< "${MANIFEST_EXTRA:-}"
TARGETS=("${DEFAULT_TARGETS[@]}" "${EXTRA[@]}")

# Gom các đích tồn tại vào 1 cây tạm rồi tính manifest — giữ nguyên quyền + symlink.
stage_targets() {
  local stage="$1" found=0 t
  for t in "${TARGETS[@]}"; do
    [ -n "$t" ] || continue
    local src="${RELEASE_ROOT}/${t}"
    [ -e "$src" ] || continue
    mkdir -p "$stage/$(dirname "$t")"
    cp -a "$src" "$stage/$t"
    found=$((found + 1))
  done
  [ "$found" -gt 0 ] || die "Không thấy đích nào để tính manifest trong $RELEASE_ROOT"
  info "Đã gom ${found} đích vào manifest"
}

case "$ACTION" in
  create)
    echo "=== TẠO RELEASE MANIFEST — $(date '+%F %T') ==="
    stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
    stage_targets "$stage"
    manifest_create "$stage" "$MANIFEST"
    RELEASE_ROOT="$RELEASE_ROOT" node "$RELEASE_ROOT/scripts/verify_release_identity.js"
    ok "Đã tạo manifest: $MANIFEST ($(wc -l < "$MANIFEST") mục)"
    info "sha256 manifest: $(file_sha256 "$MANIFEST")"
    ;;
  verify)
    echo "=== KIỂM RELEASE MANIFEST (ngay trước khi chạy) — $(date '+%F %T') ==="
    [ -f "$MANIFEST" ] || die "Thiếu manifest $MANIFEST — DỪNG, không cutover."
    stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
    stage_targets "$stage"
    if ! manifest_verify "$stage" "$MANIFEST"; then
      die "BẢN CHẠY ĐÃ BỊ THAY ĐỔI so với lúc chuẩn bị — DỪNG, KHÔNG khởi động."
    fi
    RELEASE_ROOT="$RELEASE_ROOT" node "$RELEASE_ROOT/scripts/verify_release_identity.js"
    ok "Bản chạy khớp đúng bản đã chuẩn bị — được phép cutover."
    ;;
  *)
    die "Dùng: $0 create|verify (đặt RELEASE_ROOT=...)"
    ;;
esac
