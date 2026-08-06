#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# DỰNG LẠI SLOT DOANH THU T08.2026 — MỘT LỆNH, TỰ SAO LƯU, SAI LÀ TỰ LÙI LẠI
# (PENDING_T08_SLOT_REBUILD · đóng nghiệm thu V1: ô "Chưa phân bổ" về 0đ)
#
# Dành cho người KHÔNG chuyên chạy được. Trên server App Report, gõ đúng 2 dòng:
#
#     cd /duong-dan/App-report-new/server
#     bash scripts/rebuild_t08_slot_safely.sh
#
# Script sẽ TỰ DỪNG (không sửa gì / tự khôi phục) nếu bất kỳ bước kiểm nào lệch:
#   1. Kiểm T06/T07 khoá sổ TRƯỚC khi làm — đang lệch sẵn thì không làm gì cả.
#   2. Sao lưu toàn bộ slot + uploads vào backups/ (kèm thời điểm).
#   3. Chỉ dựng lại kỳ 08.2026 (REVENUE_REFRESH_KY=08.2026). Materializer có sẵn
#      3 lớp bất biến + ghim T06/T07 — lệch là chính nó ném lỗi.
#   4. Kiểm T06/T07 SAU khi làm — lệch ⇒ TỰ KHÔI PHỤC bản sao lưu rồi thoát lỗi.
#   5. In tổng T08 trước/sau và số "chưa phân bổ" để dán vào báo cáo nghiệm thu.
#
# TUYỆT ĐỐI không đụng T06/T07 — mọi nhánh lệch đều dừng/lùi, không có nhánh "cứ tiếp".
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

KY="08.2026"
cd "$(dirname "$0")/.."          # về server/
STAMP="$(TZ=Asia/Bangkok date +%Y%m%d_%H%M%S)"
BK_DIR="data/backups/t08_rebuild_${STAMP}"

say()  { printf '\n══ %s\n' "$*"; }
die()  { printf '\n⛔ %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || die "Không tìm thấy node trên máy này."
[ -f scripts/materialize_july_revenue.js ] || die "Chạy sai thư mục — phải đứng ở App-report-new/server."
[ -f data/upload_slots.json ] || die "Không thấy data/upload_slots.json — đây không phải máy PROD?"

t08_summary() {
  node -e '
    const fs=require("fs");
    const slots=JSON.parse(fs.readFileSync("data/upload_slots.json","utf8")).filter(s=>s.active&&s.ky==="'"$KY"'");
    let rows=0,total=0,unalloc=0;
    for(const s of slots){
      const rs=JSON.parse(fs.readFileSync("data/uploads/"+s.id+".json","utf8"));
      for(const r of rs){rows++;total+=Math.round(Number(r.revenue)||0);
        if(String(r.emp_code||"").toUpperCase()==="UNALLOCATED"||!String(r.emp_code||"").trim())unalloc+=Math.round(Number(r.revenue)||0);}
    }
    const vn=n=>n.toLocaleString("vi-VN");
    console.log(`slot=${slots.map(s=>s.id).join(",")||"KHONG_CO"} · ${vn(rows)} dòng · tổng ${vn(total)}đ · chưa phân bổ ${vn(unalloc)}đ`);
  '
}

say "BƯỚC 1/5 — Kiểm T06/T07 khoá sổ TRƯỚC khi làm"
node scripts/verify_frozen_periods.js || die "T06/T07 đang lệch SẴN — không dựng gì cả, đi tìm nguyên nhân trước."

say "BƯỚC 2/5 — Sao lưu vào ${BK_DIR}"
mkdir -p "$BK_DIR"
cp data/upload_slots.json "$BK_DIR/"
cp -r data/uploads "$BK_DIR/uploads"
echo "Đã sao lưu. Muốn tự khôi phục tay: cp ${BK_DIR}/upload_slots.json data/ && rm -rf data/uploads && cp -r ${BK_DIR}/uploads data/uploads"

say "T08 TRƯỚC khi dựng:"
BEFORE="$(t08_summary)"; echo "  $BEFORE"

say "BƯỚC 3/5 — Dựng lại RIÊNG kỳ ${KY} (materializer tự có 3 lớp bất biến)"
if ! REVENUE_REFRESH_KY="$KY" node scripts/materialize_july_revenue.js; then
  echo "⛔ Materializer báo lỗi — nó fail-closed nên KHÔNG ghi gì hỏng; giữ nguyên hiện trạng." >&2
  exit 1
fi

say "BƯỚC 4/5 — Kiểm T06/T07 SAU khi dựng"
if ! node scripts/verify_frozen_periods.js; then
  echo "⛔ T06/T07 LỆCH SAU KHI DỰNG — TỰ KHÔI PHỤC bản sao lưu ngay." >&2
  cp "$BK_DIR/upload_slots.json" data/upload_slots.json
  rm -rf data/uploads && cp -r "$BK_DIR/uploads" data/uploads
  node scripts/verify_frozen_periods.js && echo "Đã khôi phục xong — hiện trạng như trước khi chạy." >&2
  die "Dừng tại đây. Dán toàn bộ log này cho Claude/bot xem."
fi

say "BƯỚC 5/5 — T08 SAU khi dựng (dán 2 dòng này vào báo cáo nghiệm thu):"
echo "  TRƯỚC: $BEFORE"
echo "  SAU:   $(t08_summary)"
echo ""
echo "✅ XONG. Mở App Report → Tổng quan, bấm Làm mới: ô 'Doanh thu chưa phân bổ NV' phải về 0đ."
echo "   (Bản sao lưu vẫn giữ ở ${BK_DIR} — chưa cần xoá.)"
