#!/usr/bin/env bash
# backup_data.sh — P2: BẰNG CHỨNG BACKUP PHẢI KIỂM ĐƯỢC NỘI DUNG, không chỉ "đọc được".
#
# Lỗi bản cũ: `tar -tzf` chỉ chứng minh archive liệt kê được — không nói gì về nội dung
# file, quyền, symlink, hay cây phục hồi có đúng không.
#
# Ở đây mỗi backup luôn kèm 2 file cạnh archive:
#   <archive>.manifest  — sha256 từng file + quyền + đích symlink
#   <archive>.sha256    — checksum của chính archive
# và bước verify GIẢI NÉN RA STAGING rồi đối chiếu manifest (không tin tar -tzf).
#
# Dùng:
#   DATA=/path/data ARCHIVE=/path/backups/data-$(date +%F).tgz ./scripts/backup_data.sh create
#   ARCHIVE=/path/backups/data-....tgz ./scripts/backup_data.sh verify

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release_lib.sh"

ACTION="${1:-}"
ARCHIVE="${ARCHIVE:?Thiếu ARCHIVE}"

case "$ACTION" in
  create)
    DATA="${DATA:?Thiếu DATA}"
    echo "=== TẠO BACKUP CÓ BẰNG CHỨNG NỘI DUNG — $(date '+%F %T') ==="
    archive_create "$DATA" "$ARCHIVE"
    ;;
  verify)
    echo "=== XÁC MINH BACKUP (giải nén thật ra staging) — $(date '+%F %T') ==="
    archive_verify_checksum "$ARCHIVE"
    stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
    tar -xzf "$ARCHIVE" -C "$stage" || die "Giải nén thất bại — backup KHÔNG dùng được."
    if ! manifest_verify "$stage" "${ARCHIVE}.manifest"; then
      die "Nội dung backup KHÔNG khớp manifest — backup KHÔNG đáng tin, đừng dựa vào để rollback."
    fi
    ok "Backup xác minh ĐẠT: đủ file, đúng nội dung, đúng quyền/symlink."
    ;;
  *)
    die "Dùng: $0 create|verify"
    ;;
esac
