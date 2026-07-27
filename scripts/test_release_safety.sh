#!/usr/bin/env bash
# test_release_safety.sh — DIỄN TẬP đúng các ca nghiệm thu trong
# DIRECTIVE_DEPLOY_RELEASE_SAFETY.md. Chạy trên dữ liệu GIẢ trong thư mục tạm,
# KHÔNG đụng gì tới production.
#
#   ./scripts/test_release_safety.sh

set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0; FAIL=0
run() { # run "tên ca" "kỳ vọng: pass|fail" command...
  local name="$1" expect="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if { [ "$expect" = "pass" ] && [ $rc -eq 0 ]; } || { [ "$expect" = "fail" ] && [ $rc -ne 0 ]; }; then
    echo "  ✅ $name"; PASS=$((PASS+1))
  else
    echo "  ❌ $name (exit=$rc, kỳ vọng=$expect)"; echo "$out" | sed 's/^/       /' | head -6; FAIL=$((FAIL+1))
  fi
}
assert_intact() { # dữ liệu thật phải còn nguyên
  local name="$1" dir="$2" expect_sha="$3" actual
  actual="$(cd "$dir" && find . -type f -exec sha256sum {} \; 2>/dev/null | LC_ALL=C sort | sha256sum | awk '{print $1}')"
  if [ "$actual" = "$expect_sha" ]; then echo "  ✅ $name"; PASS=$((PASS+1));
  else echo "  ❌ $name — DỮ LIỆU THẬT ĐÃ BỊ THAY ĐỔI!"; FAIL=$((FAIL+1)); fi
}
tree_sha() { (cd "$1" && find . -type f -exec sha256sum {} \; 2>/dev/null | LC_ALL=C sort | sha256sum | awk '{print $1}'); }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
echo "=== DIỄN TẬP AN TOÀN PHÁT HÀNH (sandbox: $WORK) ==="

# ── Dựng dữ liệu giả ──
DATA="$WORK/data"
mkdir -p "$DATA/sub"
echo "so lieu quan trong" > "$DATA/important.json"
echo "cau hinh" > "$DATA/sub/config.json"
ln -s important.json "$DATA/link.json"
chmod 600 "$DATA/important.json"
DATA_SHA="$(tree_sha "$DATA")"

echo
echo "--- P2: backup phải chứng minh được NỘI DUNG ---"
ARCHIVE="$WORK/backups/data.tgz"
run "tạo backup kèm manifest + checksum" pass \
  env DATA="$DATA" ARCHIVE="$ARCHIVE" bash "$HERE/backup_data.sh" create
run "xác minh backup lành lặn → ĐẠT" pass \
  env ARCHIVE="$ARCHIVE" bash "$HERE/backup_data.sh" verify

cp "$ARCHIVE" "$WORK/corrupt.tgz"; cp "$ARCHIVE.sha256" "$WORK/corrupt.tgz.sha256"; cp "$ARCHIVE.manifest" "$WORK/corrupt.tgz.manifest"
printf 'x' | dd of="$WORK/corrupt.tgz" bs=1 seek=50 conv=notrunc status=none
run "archive bị sửa 1 byte → PHÁT HIỆN" fail \
  env ARCHIVE="$WORK/corrupt.tgz" bash "$HERE/backup_data.sh" verify

# archive thiếu file (checksum archive vẫn đúng vì tạo lại) → manifest phải bắt được
MISS="$WORK/miss"; mkdir -p "$MISS"
cp -a "$DATA/." "$MISS/"; rm -f "$MISS/sub/config.json"
tar -czf "$WORK/missing.tgz" -C "$MISS" .
sha256sum "$WORK/missing.tgz" | awk '{print $1}' > "$WORK/missing.tgz.sha256"
cp "$ARCHIVE.manifest" "$WORK/missing.tgz.manifest"
run "archive THIẾU file → PHÁT HIỆN qua manifest" fail \
  env ARCHIVE="$WORK/missing.tgz" bash "$HERE/backup_data.sh" verify

echo
echo "--- P2-BIS: dữ liệu GHI LIÊN TỤC khi backup (shadow verdict) ---"
# BẤT BIẾN cốt lõi: manifest ≡ nội dung archive (cả hai đọc từ staging tĩnh).
run "manifest ĐÚNG BẰNG nội dung archive (đọc từ staging tĩnh)" pass \
  bash -c 'st=$(mktemp -d); tar -xzf "'"$ARCHIVE"'" -C "$st"; source "'"$HERE"'/release_lib.sh"; manifest_verify "$st" "'"$ARCHIVE"'.manifest"; rc=$?; rm -rf "$st"; exit $rc'

# Fail-closed TẤT ĐỊNH: hết ngân sách ổn định (MAX_TRIES=0) → DỪNG, KHÔNG để lại bản dở.
HOTDIR="$WORK/hotdata"; mkdir -p "$HOTDIR"; echo seed > "$HOTDIR/f.json"
out="$(BACKUP_STAGE_MAX_TRIES=0 DATA="$HOTDIR" ARCHIVE="$WORK/nb.tgz" bash "$HERE/backup_data.sh" create 2>&1)"; rc=$?
if [ $rc -ne 0 ] && echo "$out" | grep -q "GHI LIÊN TỤC"; then echo "  ✅ hết ngân sách ổn định → DỪNG fail-closed, thông báo đúng"; PASS=$((PASS+1));
else echo "  ❌ không fail-closed khi hết ngân sách (rc=$rc)"; FAIL=$((FAIL+1)); fi
[ ! -f "$WORK/nb.tgz" ] && { echo "  ✅ không để lại archive nửa vời"; PASS=$((PASS+1)); } || { echo "  ❌ còn archive dở"; FAIL=$((FAIL+1)); }

# Writer nền ghi liên tục: kết quả PHẢI là 1 trong 2 — fail-closed (không archive),
# HOẶC archive NHẤT QUÁN (manifest≡archive). TUYỆT ĐỐI không được ra bản chắp vá.
( for i in $(seq 1 300); do echo "$i" > "$HOTDIR/live.$((i%6)).json"; done ) &
WPID=$!
BACKUP_STAGE_MAX_TRIES=3 DATA="$HOTDIR" ARCHIVE="$WORK/hot.tgz" bash "$HERE/backup_data.sh" create >/dev/null 2>&1
kill "$WPID" 2>/dev/null; wait "$WPID" 2>/dev/null
if [ ! -f "$WORK/hot.tgz" ]; then
  echo "  ✅ writer nóng → hoặc fail-closed (không archive)"; PASS=$((PASS+1))
else
  st=$(mktemp -d); tar -xzf "$WORK/hot.tgz" -C "$st" 2>/dev/null
  ( source "$HERE/release_lib.sh"; manifest_verify "$st" "$WORK/hot.tgz.manifest" >/dev/null 2>&1 ) \
    && { echo "  ✅ writer nóng → archive vẫn NHẤT QUÁN (manifest≡archive)"; PASS=$((PASS+1)); } \
    || { echo "  ❌ archive CHẮP VÁ (manifest≠archive)"; FAIL=$((FAIL+1)); }
  rm -rf "$st"
fi

# Writer đã dừng → dữ liệu nguội → backup THÀNH CÔNG và nhất quán.
run "writer dừng → backup THÀNH CÔNG + nhất quán" pass \
  env DATA="$HOTDIR" ARCHIVE="$WORK/cool.tgz" bash "$HERE/backup_data.sh" create
run "backup lúc nguội xác minh ĐẠT" pass \
  env ARCHIVE="$WORK/cool.tgz" bash "$HERE/backup_data.sh" verify

echo
echo "--- P1-3: rollback KHÔNG được phá dữ liệu thật ---"
run "(a) archive hỏng → rollback DỪNG" fail \
  env DATA="$DATA" ARCHIVE="$WORK/corrupt.tgz" bash "$HERE/safe_rollback.sh"
assert_intact "(a) dữ liệu thật còn NGUYÊN VẸN" "$DATA" "$DATA_SHA"

run "(b) archive thiếu file → rollback DỪNG" fail \
  env DATA="$DATA" ARCHIVE="$WORK/missing.tgz" bash "$HERE/safe_rollback.sh"
assert_intact "(b) dữ liệu thật còn NGUYÊN VẸN" "$DATA" "$DATA_SHA"

run "(c) health FAIL → rollback báo THẤT BẠI (không im lặng)" fail \
  env DATA="$DATA" ARCHIVE="$ARCHIVE" START_CMD="true" HEALTH_CMD="false" bash "$HERE/safe_rollback.sh"
# sau ca (c) dữ liệu đã swap; bản cũ phải còn ở .bad.*
if ls -d "${DATA}.bad."* >/dev/null 2>&1; then echo "  ✅ (c) bản dữ liệu trước rollback được GIỮ LẠI"; PASS=$((PASS+1));
else echo "  ❌ (c) KHÔNG giữ bản dữ liệu cũ"; FAIL=$((FAIL+1)); fi

run "(d) đường hạnh phúc → rollback THÀNH CÔNG" pass \
  env DATA="$DATA" ARCHIVE="$ARCHIVE" START_CMD="true" HEALTH_CMD="true" SMOKE_CMD="true" bash "$HERE/safe_rollback.sh"
assert_intact "(d) dữ liệu phục hồi khớp bản gốc" "$DATA" "$DATA_SHA"

echo
echo "--- P1-1: chỉ deploy đúng bản được duyệt ---"
PREP="$WORK/prepare_result.txt"
write_prep() { cat > "$PREP" <<EOF
status=$1
callback=$2
base=$3
commit=$4
release=$5
EOF
}
GOOD=(PASS OK_ECOST_0726 /srv/app-report abc123 rel-1)
write_prep "${GOOD[@]}"
run "phiếu đúng hết → CHO PHÉP" pass \
  env PREPARE_FILE="$PREP" USED_TOKENS_DIR="$WORK/td1" EXPECT_CALLBACK=OK_ECOST_0726 EXPECT_BASE=/srv/app-report EXPECT_COMMIT=abc123 EXPECT_RELEASE=rel-1 bash "$HERE/verify_approval.sh"

for case in "status:FAIL" "callback:WRONG_TOKEN" "base:/srv/khac" "commit:deadbeef" "release:rel-999"; do
  key="${case%%:*}"; bad="${case#*:}"
  vals=("${GOOD[@]}")
  case "$key" in status) vals[0]="$bad";; callback) vals[1]="$bad";; base) vals[2]="$bad";; commit) vals[3]="$bad";; release) vals[4]="$bad";; esac
  write_prep "${vals[@]}"
  run "lệch trường '$key' → CHẶN" fail \
    env PREPARE_FILE="$PREP" USED_TOKENS_DIR="$WORK/td2_$key" EXPECT_CALLBACK=OK_ECOST_0726 EXPECT_BASE=/srv/app-report EXPECT_COMMIT=abc123 EXPECT_RELEASE=rel-1 bash "$HERE/verify_approval.sh"
done

write_prep "${GOOD[@]}"
grep -v '^commit=' "$PREP" > "$PREP.tmp" && mv "$PREP.tmp" "$PREP"
run "phiếu THIẾU trường commit → CHẶN" fail \
  env PREPARE_FILE="$PREP" USED_TOKENS_DIR="$WORK/td3" EXPECT_CALLBACK=OK_ECOST_0726 EXPECT_BASE=/srv/app-report EXPECT_COMMIT=abc123 EXPECT_RELEASE=rel-1 bash "$HERE/verify_approval.sh"

# Token dùng 1 lần — claim NGUYÊN TỬ: lần đầu claim OK trong td4, lần hai CÙNG td4 bị chặn.
write_prep "${GOOD[@]}"
env PREPARE_FILE="$PREP" USED_TOKENS_DIR="$WORK/td4" EXPECT_CALLBACK=OK_ECOST_0726 EXPECT_BASE=/srv/app-report EXPECT_COMMIT=abc123 EXPECT_RELEASE=rel-1 bash "$HERE/verify_approval.sh" >/dev/null 2>&1
run "dùng lại token đã duyệt (cùng kho) → CHẶN" fail \
  env PREPARE_FILE="$PREP" USED_TOKENS_DIR="$WORK/td4" EXPECT_CALLBACK=OK_ECOST_0726 EXPECT_BASE=/srv/app-report EXPECT_COMMIT=abc123 EXPECT_RELEASE=rel-1 bash "$HERE/verify_approval.sh"

echo
echo "--- P1-2: bản chuẩn bị không được đổi giữa chừng ---"
REL="$WORK/release"
mkdir -p "$REL/server/src" "$REL/server/scripts" "$REL/web/dist"
echo "console.log(1)" > "$REL/server/src/index.js"
echo "{}" > "$REL/server/package.json"
echo "<html></html>" > "$REL/web/dist/index.html"
echo "module.exports={}" > "$REL/ecosystem.config.js"
run "tạo manifest sau build" pass env RELEASE_ROOT="$REL" bash "$HERE/release_manifest.sh" create
run "không đổi gì → verify ĐẠT" pass env RELEASE_ROOT="$REL" bash "$HERE/release_manifest.sh" verify

for f in "server/src/index.js" "web/dist/index.html" "ecosystem.config.js" "server/package.json"; do
  cp "$REL/$f" "$WORK/orig.bak"
  echo "// bi sua len" >> "$REL/$f"
  run "sửa '$f' sau prepare → CHẶN trước khi chạy" fail env RELEASE_ROOT="$REL" bash "$HERE/release_manifest.sh" verify
  cp "$WORK/orig.bak" "$REL/$f"
done

echo
echo "--- Cutover: backup lỗi TRƯỚC khi dừng service (lỗi #3 của bot) ---"
# Giả lập: dùng cutover với ARCHIVE ghi vào chỗ không ghi được → backup create lỗi.
# Kỳ vọng: DỪNG ở bước backup, cờ 'service touched' chưa bật → service KHÔNG bị đụng.
CUT_MARK="$WORK/service_touched.flag"
cat > "$WORK/fake_start.sh" <<EOF
#!/usr/bin/env bash
echo touched > "$CUT_MARK"
EOF
chmod +x "$WORK/fake_start.sh"
PREP2="$WORK/prep_cut.txt"; printf 'status=PASS\ncallback=OK\nbase=/b\ncommit=c1\nrelease=r1\n' > "$PREP2"
mkdir -p "$WORK/rel2/server/src"; echo x > "$WORK/rel2/server/src/index.js"
RELEASE_ROOT="$WORK/rel2" bash "$HERE/release_manifest.sh" create >/dev/null 2>&1
out="$(RELEASE_ROOT="$WORK/rel2" DATA="$DATA" PM2_APP=x ARCHIVE="/proc/nonexistent/x.tgz" \
  PREPARE_FILE="$PREP2" USED_TOKENS_FILE="$WORK/tc" EXPECT_CALLBACK=OK EXPECT_BASE=/b EXPECT_COMMIT=c1 EXPECT_RELEASE=r1 \
  START_CMD="$WORK/fake_start.sh" HEALTH_CMD="true" bash "$HERE/safe_pm2_cutover.sh" 2>&1)"; rc=$?
if [ $rc -ne 0 ]; then echo "  ✅ backup lỗi → cutover DỪNG (exit!=0)"; PASS=$((PASS+1)); else echo "  ❌ cutover không dừng khi backup lỗi"; FAIL=$((FAIL+1)); fi
if [ ! -f "$CUT_MARK" ]; then echo "  ✅ service CHƯA bị đụng (backup lỗi trước khi động vào PM2)"; PASS=$((PASS+1)); else echo "  ❌ service đã bị đụng dù backup lỗi"; FAIL=$((FAIL+1)); fi

echo
echo "--- Read-only review của bot (2026-07-26): 5 điểm cứng hoá ---"

# (1) cp lỗi KHÔNG được nuốt: ép cp luôn fail → stage_stable phải fail-closed,
#     KHÔNG để lại bản staging dở (trước đây `|| true` nuốt, sinh backup thiếu file).
CPFAIL="$WORK/stg_cpfail"
out="$(bash -c '
  source "'"$HERE"'/release_lib.sh"
  cp() { command false; }        # mọi lần cp đều lỗi
  BACKUP_STAGE_MAX_TRIES=2 stage_stable "'"$DATA"'" "'"$CPFAIL"'" 2>&1
' 2>&1)"; rc=$?
if [ $rc -ne 0 ]; then echo "  ✅ (1) cp lỗi → stage_stable FAIL-CLOSED (không nuốt)"; PASS=$((PASS+1)); else echo "  ❌ (1) cp lỗi nhưng vẫn báo OK"; FAIL=$((FAIL+1)); fi
if [ ! -e "$CPFAIL" ]; then echo "  ✅ (1) không để lại staging dở"; PASS=$((PASS+1)); else echo "  ❌ (1) còn staging chắp vá"; FAIL=$((FAIL+1)); fi

# (3a) manifest ghi MODE: đổi quyền 1 file sau backup → verify phải PHÁT HIỆN.
cp -a "$DATA" "$WORK/perm"; ( source "$HERE/release_lib.sh"; manifest_create "$WORK/perm" "$WORK/perm.manifest" )
chmod 644 "$WORK/perm/important.json"   # gốc là 600
run "(3a) đổi QUYỀN file → manifest PHÁT HIỆN" fail \
  bash -c 'source "'"$HERE"'/release_lib.sh"; manifest_verify "'"$WORK"'/perm" "'"$WORK"'/perm.manifest"'

# (3b) manifest ghi UID:GID: đổi chủ sở hữu → PHÁT HIỆN (bỏ qua nếu không có quyền chown).
cp -a "$DATA" "$WORK/own"; ( source "$HERE/release_lib.sh"; manifest_create "$WORK/own" "$WORK/own.manifest" )
if chown 12345:12345 "$WORK/own/important.json" 2>/dev/null; then
  run "(3b) đổi UID/GID → manifest PHÁT HIỆN" fail \
    bash -c 'source "'"$HERE"'/release_lib.sh"; manifest_verify "'"$WORK"'/own" "'"$WORK"'/own.manifest"'
else
  echo "  ⏭ (3b) bỏ qua: môi trường không cho chown (không đủ quyền)"
fi

# (3c) node_modules RUNTIME nằm TRONG phạm vi manifest: sửa 1 file trong đó → CHẶN.
REL2="$WORK/release_nm"; mkdir -p "$REL2/server/src" "$REL2/server/node_modules/pkg" "$REL2/web/dist"
echo "console.log(1)" > "$REL2/server/src/index.js"
echo "module.exports=1" > "$REL2/server/node_modules/pkg/index.js"
echo "<html></html>" > "$REL2/web/dist/index.html"
run "(3c) tạo manifest có node_modules" pass env RELEASE_ROOT="$REL2" bash "$HERE/release_manifest.sh" create
echo "// tiêm mã lạ" >> "$REL2/server/node_modules/pkg/index.js"
run "(3c) sửa file trong node_modules sau prepare → CHẶN" fail env RELEASE_ROOT="$REL2" bash "$HERE/release_manifest.sh" verify

# (5) rollback chạy ĐÚNG lệnh BẢN CŨ (ROLLBACK_START_CMD), KHÔNG dùng START_CMD bản mới.
RBMARK="$WORK/rb_ran.flag"; NEWMARK="$WORK/new_ran.flag"; rm -f "$RBMARK" "$NEWMARK"
cp -a "$DATA" "$WORK/data_rb"; DRB="$WORK/data_rb"
env DATA="$DRB" ARCHIVE="$ARCHIVE" \
  ROLLBACK_START_CMD="touch $RBMARK" START_CMD="touch $NEWMARK" \
  HEALTH_CMD="true" SMOKE_CMD="true" bash "$HERE/safe_rollback.sh" >/dev/null 2>&1
if [ -f "$RBMARK" ] && [ ! -f "$NEWMARK" ]; then echo "  ✅ (5) rollback chạy lệnh BẢN CŨ, không đụng START_CMD bản mới"; PASS=$((PASS+1));
else echo "  ❌ (5) rollback dùng sai lệnh khởi động (rb=$( [ -f "$RBMARK" ] && echo 1 || echo 0 ) new=$( [ -f "$NEWMARK" ] && echo 1 || echo 0 ))"; FAIL=$((FAIL+1)); fi

echo
echo "========================================"
echo "  $PASS PASS · $FAIL FAIL"
[ "$FAIL" -eq 0 ] && echo "  ✅ TẤT CẢ CA DIỄN TẬP ĐẠT" || echo "  ❌ CÒN CA CHƯA ĐẠT"
echo "========================================"
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
