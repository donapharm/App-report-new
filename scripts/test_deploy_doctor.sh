#!/usr/bin/env bash
# test_deploy_doctor.sh — DIỄN TẬP bác sĩ deploy trên repo GIẢ trong thư mục tạm.
# KHÔNG đụng gì tới production, không gọi mạng.
#
#   bash scripts/test_deploy_doctor.sh
#
# Ca quan trọng nhất: `--fix` gỡ được kẹt "server đi trước origin/main" MÀ KHÔNG
# LÀM MẤT COMMIT NÀO — commit local phải còn nguyên trong nhánh cứu hộ.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCTOR="$HERE/deploy_doctor.sh"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (được '$2', cần '$3')"; fi; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# Dựng "GitHub" giả + bản sao trên "server".
git init -q --bare "$TMP/origin.git"
git clone -q "$TMP/origin.git" "$TMP/srv" 2>/dev/null
cd "$TMP/srv"
git checkout -q -b main
echo v1 > f.txt && git add . && git commit -qm "v1"
git push -q -u origin main

run_doctor() { REPO_DIR="$TMP/srv" BRANCH=main HEALTH_URL="http://127.0.0.1:1/none" \
  LAST_FILE="$TMP/srv/.auto-deploy.last" bash "$DOCTOR" ${1:+$1} 2>&1; }

echo "① Server bằng đúng origin/main ⇒ không báo kẹt git"
out="$(run_doctor)"
case "$out" in *"đã ĐÚNG bằng main"*) ok "nhận ra không có gì để deploy";; *) bad "không nhận ra trạng thái sạch";; esac

echo "② Server ĐI TRƯỚC origin/main (đúng ca PROD đang nghi)"
echo v2 > f.txt && git commit -qam "việc local của bot"
LOCAL_SHA="$(git rev-parse HEAD)"
out="$(run_doctor)"; rc=$?
case "$out" in *"CHƯA ĐẨY LÊN GITHUB"*) ok "gọi đúng tên bệnh";; *) bad "không nêu được nguyên nhân";; esac
case "$out" in *"việc local của bot"*) ok "liệt kê đích danh commit đang kẹt";; *) bad "không liệt kê commit";; esac
check "chế độ chỉ đọc KHÔNG tự sửa" "$(git rev-parse HEAD)" "$LOCAL_SHA"

echo "③ --fix gỡ kẹt mà KHÔNG MẤT COMMIT"
# origin có bản mới hơn để fast-forward tới.
git clone -q "$TMP/origin.git" "$TMP/other" && (cd "$TMP/other" && git checkout -q main \
  && echo v3 > g.txt && git add . && git commit -qm "v3 từ GitHub" && git push -q origin main)
out="$(run_doctor --fix)"
REMOTE_SHA="$(git rev-parse origin/main)"
check "server đã về đúng origin/main" "$(git rev-parse HEAD)" "$REMOTE_SHA"
rescue="$(git branch --list 'rescue/*' | tr -d ' *' | head -1)"
if [ -n "$rescue" ]; then ok "đã tạo nhánh cứu hộ: $rescue"; else bad "KHÔNG có nhánh cứu hộ"; fi
check "‼ commit local CÒN NGUYÊN trong nhánh cứu hộ" "$(git rev-parse "${rescue:-HEAD}")" "$LOCAL_SHA"

echo "④ Công tắc tắt phải được nêu ra"
echo "tắt để thử" > "$TMP/srv/.auto-deploy.disabled"
out="$(REPO_DIR="$TMP/srv" BRANCH=main HEALTH_URL="http://127.0.0.1:1/none" \
       DISABLE_FILE="$TMP/srv/.auto-deploy.disabled" bash "$DOCTOR" 2>&1)"
case "$out" in *"ĐANG TẮT"*) ok "báo rõ auto-deploy đang tắt";; *) bad "không báo công tắc tắt";; esac

echo "⑤ Sửa chưa commit phải được nêu ra"
rm -f "$TMP/srv/.auto-deploy.disabled"; echo dirty >> "$TMP/srv/f.txt"
out="$(run_doctor)"
case "$out" in *"DIRTY"*) ok "báo rõ working tree dirty";; *) bad "không báo dirty";; esac

echo "⑥ VỪA DIVERGED VỪA DIRTY — sửa chưa commit KHÔNG được biến mất"
# Bot audit 10/08/2026 tái hiện được: `reset --hard` (nhánh diverged) chạy TRƯỚC khối
# stash (nhánh dirty) ⇒ xoá sạch sửa chưa commit. Nhánh cứu hộ chỉ cứu COMMIT, không
# cứu sửa đang dở. Ca này khoá lại: phải cất được rồi mới được reset.
rm -rf "$TMP/srv2"; git clone -q "$TMP/origin.git" "$TMP/srv2" 2>/dev/null
cd "$TMP/srv2"; git checkout -q main
# (a) tạo commit local chưa đẩy  -> diverged
echo local-only >> f.txt && git commit -qam "commit chỉ có trên server"
LOCAL2="$(git rev-parse HEAD)"
# (b) đồng thời có sửa chưa commit -> dirty
echo "VIỆC ĐANG LÀM DỞ, CHƯA COMMIT" > dangdolam.txt && git add dangdolam.txt
# (c) origin tiến lên để chắc chắn là diverged thật
git -C "$TMP/srv" checkout -q main 2>/dev/null
out="$(REPO_DIR="$TMP/srv2" BRANCH=main HEALTH_URL="http://127.0.0.1:1/none" \
       LAST_FILE="$TMP/srv2/.auto-deploy.last" bash "$DOCTOR" --fix 2>&1)"
cd "$TMP/srv2"
if git stash list 2>/dev/null | grep -q "deploy_doctor"; then
  ok "‼ sửa chưa commit đã được CẤT VÀO STASH trước khi reset"
else
  bad "‼ sửa chưa commit KHÔNG được cất — đúng lỗi bot audit chỉ ra"
fi
recovered=0
if git stash show -p 2>/dev/null | grep -q "VIỆC ĐANG LÀM DỞ"; then recovered=1; fi
check "‼ lấy lại được nguyên nội dung đang làm dở" "$recovered" "1"
rescue2="$(git branch --list 'rescue/*' | tr -d ' *' | head -1)"
check "commit local vẫn còn trong nhánh cứu hộ" "$(git rev-parse "${rescue2:-HEAD}")" "$LOCAL2"

echo ""
echo "Kết quả: $PASS đạt · $FAIL hỏng"
[ "$FAIL" -eq 0 ]
