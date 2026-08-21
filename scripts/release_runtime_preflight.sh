#!/usr/bin/env bash
# Mandatory fail-closed checks before production traffic moves to a release.

set -Eeuo pipefail

RELEASE_ROOT="${RELEASE_ROOT:?Thiếu RELEASE_ROOT}"
APP_DATA_DIR="${APP_DATA_DIR:?Thiếu APP_DATA_DIR}"
AUTH_DATA_DIR="${AUTH_DATA_DIR:?Thiếu AUTH_DATA_DIR}"
COLD_T08_CMD="${COLD_T08_CMD:?Thiếu COLD_T08_CMD}"

fail() { echo "❌ PREFLIGHT $1" >&2; exit 1; }
pass() { echo "✅ PREFLIGHT $1"; }

[ -L "$RELEASE_ROOT/server/data" ] || fail "server/data không phải symlink"
[ "$(readlink -f "$RELEASE_ROOT/server/data")" = "$(readlink -f "$APP_DATA_DIR")" ] || fail "server/data trỏ sai"
[ -r "$RELEASE_ROOT/server/data/users.json" ] || fail "users.json không đọc được từ release"
node -e 'const fs=require("fs"); const p=process.argv[1]; const v=JSON.parse(fs.readFileSync(p,"utf8")); if (!Array.isArray(v) && !Array.isArray(v.users)) process.exit(1)' \
  "$RELEASE_ROOT/server/data/users.json" >/dev/null 2>&1 || fail "users.json không hợp lệ"
pass "users.json đọc được từ release"
pass "server/data trỏ đúng và đọc được"

[ -d "$AUTH_DATA_DIR" ] && [ -r "$AUTH_DATA_DIR" ] || fail "AUTH_DATA_DIR không đọc được"
pass "AUTH_DATA_DIR đọc được"

cold_json="$(mktemp)"; trap 'rm -f "$cold_json"' EXIT
if ! eval "$COLD_T08_CMD" >"$cold_json"; then fail "đọc nguội T08 lỗi"; fi
node -e '
  const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  const candidates=[p.rowCount,p.rowsCount,p.sourceRows,p.totalRows,p?.data?.rowCount,p?.data?.rowsCount,p?.data?.sourceRows,p?.data?.totalRows];
  let n=candidates.find(Number.isFinite);
  if (!Number.isFinite(n) && Array.isArray(p.rows)) n=p.rows.length;
  if (!Number.isFinite(n) && Array.isArray(p?.data?.rows)) n=p.data.rows.length;
  if (!Number.isFinite(n) && Array.isArray(p.results)) n=p.results.find((r)=>r?.period==="T08")?.totalRows;
  if (!(n>0)) process.exit(1);
' "$cold_json" >/dev/null 2>&1 || fail "đọc nguội T08 không có dòng"
pass "đọc nguội T08 >0 dòng"

echo "✅ PREFLIGHT 3/3 PASS — được phép chuyển traffic"
