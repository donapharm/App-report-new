#!/usr/bin/env bash
# verify_approval.sh — P1-1: CHỈ DEPLOY ĐÚNG THỨ ĐÃ ĐƯỢC DUYỆT.
#
# Lỗi bản cũ: chỉ xem `status=PASS` ⇒ duyệt bản này nhưng chạy bản khác vẫn lọt.
# Ở đây so KHỚP TỪNG TRƯỜNG, thiếu/lệch/vắng mặt đều DỪNG (không có giá trị mặc định).
#
# Dùng:
#   PREPARE_FILE=/path/prepare_result.txt \
#   EXPECT_CALLBACK=OK_ECOST_0726 EXPECT_BASE=/srv/app-report \
#   EXPECT_COMMIT=$(git rev-parse HEAD) EXPECT_RELEASE=rel-20260726 \
#   ./scripts/verify_approval.sh
#
# prepare_result.txt dạng key=value mỗi dòng:
#   status=PASS
#   callback=OK_ECOST_0726
#   base=/srv/app-report
#   commit=<git rev-parse HEAD của cây sắp chạy>   # KHÔNG hardcode — truyền động
#   release=rel-20260726

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/release_lib.sh"

PREPARE_FILE="${PREPARE_FILE:?Thiếu PREPARE_FILE}"
EXPECT_CALLBACK="${EXPECT_CALLBACK:?Thiếu EXPECT_CALLBACK}"
EXPECT_BASE="${EXPECT_BASE:?Thiếu EXPECT_BASE}"
EXPECT_COMMIT="${EXPECT_COMMIT:?Thiếu EXPECT_COMMIT}"
EXPECT_RELEASE="${EXPECT_RELEASE:?Thiếu EXPECT_RELEASE}"
# Token duyệt DÙNG 1 LẦN: đã dùng thì không nhận lại (chống phát lại phiếu cũ).
# Claim NGUYÊN TỬ bằng thư mục marker/token: `mkdir` là thao tác atomic của FS —
# hai cutover chạy song song chỉ 1 cái tạo được, cái kia thua ngay (không còn khe
# check-rồi-mới-write của bản grep+append cũ).
USED_TOKENS_DIR="${USED_TOKENS_DIR:-$(dirname "$PREPARE_FILE")/.used_approval_tokens.d}"

[ -f "$PREPARE_FILE" ] || die "Không thấy phiếu duyệt: $PREPARE_FILE — DỪNG."

# Đọc 1 trường; VẮNG MẶT là lỗi, không được suy ra mặc định.
field() {
  local key="$1" line
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$PREPARE_FILE" | tail -1 || true)"
  [ -n "$line" ] || die "Phiếu duyệt THIẾU trường '${key}' — DỪNG (không dùng giá trị mặc định)."
  printf '%s' "${line#*=}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'
}

compare() {
  local name="$1" actual="$2" expect="$3"
  if [ "$actual" != "$expect" ]; then
    die "Trường '${name}' LỆCH — phiếu duyệt: '${actual}' | thực tế cần: '${expect}' — DỪNG, không cutover."
  fi
  ok "${name} khớp (${actual})"
}

echo "=== KIỂM PHIẾU DUYỆT — $(date '+%F %T') ==="

STATUS="$(field status)"
[ "$STATUS" = "PASS" ] || die "status='${STATUS}' (phải là PASS) — DỪNG."
ok "status = PASS"

compare "callback" "$(field callback)" "$EXPECT_CALLBACK"
compare "base"     "$(field base)"     "$EXPECT_BASE"
compare "commit"   "$(field commit)"   "$EXPECT_COMMIT"
compare "release"  "$(field release)"  "$EXPECT_RELEASE"

# Token dùng 1 lần — CLAIM NGUYÊN TỬ: mkdir marker riêng cho token này. Nếu đã tồn
# tại (đã dùng) → mkdir fail → DỪNG. Không có khe check-rồi-write.
mkdir -p "$USED_TOKENS_DIR" || die "Không tạo được thư mục token: $USED_TOKENS_DIR"
# Làm sạch token cho tên thư mục an toàn (chỉ chữ/số/._-), tránh path traversal.
TOKEN_SAFE="$(printf '%s' "$EXPECT_CALLBACK" | tr -c 'A-Za-z0-9._-' '_')"
TOKEN_MARKER="${USED_TOKENS_DIR}/${TOKEN_SAFE}"
if ! mkdir "$TOKEN_MARKER" 2>/dev/null; then
  die "Token duyệt '${EXPECT_CALLBACK}' ĐÃ DÙNG RỒI — DỪNG (chống phát lại phiếu cũ)."
fi
# Ghi vết thời điểm claim (không bắt buộc cho tính đúng — chỉ để truy vết).
date '+%F %T' > "${TOKEN_MARKER}/claimed_at" 2>/dev/null || true
echo
ok "PHIẾU DUYỆT HỢP LỆ — đúng bản được duyệt, token vừa claim, được phép cutover."
