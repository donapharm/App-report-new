#!/usr/bin/env bash
# release_lib.sh — thư viện dùng chung cho quy trình phát hành AN TOÀN.
# Nguyên tắc bất di (DIRECTIVE_DEPLOY_RELEASE_SAFETY.md):
#   1. Fail-closed mọi nhánh — không rõ ràng là DỪNG.
#   2. KHÔNG xoá dữ liệu thật trước khi bản thay thế được chứng minh hợp lệ.
#   3. CẤM in "thành công" khi chưa pass đủ điều kiện.
# Dùng: source "$(dirname "$0")/release_lib.sh"

set -Eeuo pipefail

# Bắt mọi lỗi chưa xử lý → in rõ dòng nào, rồi thoát khác 0.
trap 'rc=$?; echo "❌ LỖI tại ${BASH_SOURCE[0]}:${LINENO} (exit ${rc}) — DỪNG, không tiếp tục." >&2; exit "$rc"' ERR

die()  { echo "❌ $*" >&2; exit 1; }
ok()   { echo "✅ $*"; }
info() { echo "•  $*"; }

# sha256 của 1 file (portable Linux/macOS).
file_sha256() {
  local f="$1"
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$f" | awk '{print $1}'
  else shasum -a 256 "$f" | awk '{print $1}'; fi
}

# ─────────────────────────── MANIFEST NỘI DUNG + METADATA ───────────────────────────
# P2: `tar -tzf` chỉ chứng minh archive ĐỌC ĐƯỢC. Manifest dưới đây ghi cả nội dung
# (sha256 từng file), quyền, và đích symlink → mới đủ để đối chiếu sau khi phục hồi.
# Định dạng mỗi dòng:  <type>|<đường-dẫn-tương-đối>|<mode>|<uid:gid>|<sha256|đích-symlink|->
# (uid:gid số học — P2 yêu cầu ghi & kiểm quyền sở hữu, không chỉ mode; create+verify
#  chạy cùng host trong 1 đợt nên số uid/gid nhất quán, đổi chủ sở hữu là phát hiện được.)
manifest_create() {
  local root="$1" out="$2"
  [ -d "$root" ] || die "manifest_create: không thấy thư mục $root"
  ( cd "$root" && find . -mindepth 1 \( -type f -o -type l -o -type d \) -print0 \
    | LC_ALL=C sort -z \
    | while IFS= read -r -d '' p; do
        local own; own="$(stat -c '%u:%g' "$p" 2>/dev/null || echo '-')"
        if [ -L "$p" ]; then
          printf 'l|%s|%s|%s|%s\n' "$p" "$(stat -c '%a' "$p" 2>/dev/null || echo '-')" "$own" "$(readlink "$p")"
        elif [ -d "$p" ]; then
          printf 'd|%s|%s|%s|-\n' "$p" "$(stat -c '%a' "$p" 2>/dev/null || echo '-')" "$own"
        else
          printf 'f|%s|%s|%s|%s\n' "$p" "$(stat -c '%a' "$p" 2>/dev/null || echo '-')" "$own" "$(file_sha256 "$p")"
        fi
      done ) > "$out"
  [ -s "$out" ] || die "manifest_create: manifest rỗng cho $root"
}

# So manifest của cây thật với manifest kỳ vọng. Lệch 1 dòng là fail.
manifest_verify() {
  local root="$1" expected="$2" tmp
  [ -f "$expected" ] || die "manifest_verify: thiếu manifest kỳ vọng $expected"
  tmp="$(mktemp)"
  manifest_create "$root" "$tmp"
  if ! diff -u "$expected" "$tmp" > /tmp/manifest_diff.$$ 2>&1; then
    echo "--- LỆCH MANIFEST (kỳ vọng ← | thực tế →) ---" >&2
    head -40 /tmp/manifest_diff.$$ >&2
    rm -f "$tmp" /tmp/manifest_diff.$$
    return 1
  fi
  rm -f "$tmp" /tmp/manifest_diff.$$
  return 0
}

# ─────────────────────────── STAGING TĨNH + CỔNG ỔN ĐỊNH ───────────────────────────
# Vấn đề (Claude shadow verdict eae1d1d): App Report GHI dữ liệu liên tục. Nếu đọc
# cây SỐNG hai lần (manifest rồi tar), file đổi ở giữa → manifest ≠ archive, backup
# không nhất quán. Fix gốc: sao ra 1 bản TĨNH (staging) đúng 1 thời điểm, rồi manifest
# và tar đều đọc staging → LUÔN khớp. Cổng ổn định: chỉ nhận bản sao khi cây sống
# KHÔNG đổi trong suốt lúc sao; còn "nóng" sau N lần → fail-closed, KHÔNG tạo backup dở.
# ops có thể trỏ BACKUP_SOURCE vào snapshot CoW/LVM (đã tĩnh) để bỏ qua cổng này.

# Dấu vân tay nhẹ để phát hiện thay đổi (loại|đường dẫn|kích thước|mtime) — nhanh hơn sha256.
tree_state() {
  ( cd "$1" && find . -mindepth 1 \( -type f -o -type l -o -type d \) -printf '%y|%p|%s|%T@\n' 2>/dev/null | LC_ALL=C sort )
}

# Sao src → staging thành bản TĨNH nhất quán. Trả 0 nếu ổn định, 1 nếu vẫn nóng.
stage_stable() {
  local src="$1" staging="$2" tries="${BACKUP_STAGE_MAX_TRIES:-5}" i before after
  [ -d "$src" ] || die "stage_stable: không thấy $src"
  for ((i=1; i<=tries; i++)); do
    before="$(tree_state "$src")"
    rm -rf "$staging"; mkdir -p "$staging"
    # KHÔNG nuốt lỗi cp: cp lỗi (disk/permission, hoặc file biến mất vì cây sống)
    # ⇒ coi như CHƯA ổn định, bỏ bản sao dở và thử lại; hết lượt thì fail-closed.
    if ! cp -a "$src/." "$staging/" 2>/dev/null; then
      info "cp lỗi khi sao (lượt $i/$tries) — bỏ bản dở, thử lại"
      sleep "$i"; continue
    fi
    after="$(tree_state "$src")"
    # Cây sống KHÔNG đổi trong suốt lúc sao → staging là ảnh nhất quán 1 thời điểm.
    if [ "$before" = "$after" ]; then ok "Staging tĩnh ổn định (lượt $i/$tries)"; return 0; fi
    info "Dữ liệu đang đổi khi backup (lượt $i/$tries) — thử lại"
    sleep "$i"
  done
  rm -rf "$staging"
  return 1
}

# ─────────────────────────── ARCHIVE + CHECKSUM ───────────────────────────
# Tạo archive KÈM manifest nội dung + checksum. manifest và tar CÙNG đọc staging tĩnh
# → manifest ≡ archive theo thiết kế (không còn lệch do ghi live).
archive_create() {
  local root="$1" archive="$2"
  [ -d "$root" ] || die "archive_create: không thấy $root"
  mkdir -p "$(dirname "$archive")"
  local src="${BACKUP_SOURCE:-$root}"   # ops trỏ snapshot CoW/LVM (đã tĩnh) nếu có
  local staging="${archive}.staging.$$"
  if ! stage_stable "$src" "$staging"; then
    die "Dữ liệu đang GHI LIÊN TỤC — không tạo được backup nhất quán (fail-closed). Dùng snapshot CoW/LVM (đặt BACKUP_SOURCE=<mount>) hoặc tạm quiesce ghi rồi thử lại."
  fi
  manifest_create "$staging" "${archive}.manifest"
  tar -czf "$archive" -C "$staging" .
  file_sha256 "$archive" > "${archive}.sha256"
  rm -rf "$staging"
  ok "Đã tạo backup: $archive"
  info "manifest: ${archive}.manifest · checksum: $(cat "${archive}.sha256")"
}

# Kiểm checksum archive TRƯỚC KHI động vào dữ liệu thật (P1-3 bước 1).
archive_verify_checksum() {
  local archive="$1"
  [ -f "$archive" ]            || die "Không thấy archive: $archive"
  [ -f "${archive}.sha256" ]   || die "Thiếu file checksum: ${archive}.sha256"
  [ -f "${archive}.manifest" ] || die "Thiếu manifest: ${archive}.manifest"
  local expect actual
  expect="$(cat "${archive}.sha256")"
  actual="$(file_sha256 "$archive")"
  [ "$expect" = "$actual" ] || die "CHECKSUM ARCHIVE SAI (kỳ vọng $expect, thực tế $actual) — DỪNG, không đụng dữ liệu thật."
  ok "Checksum archive khớp"
}
