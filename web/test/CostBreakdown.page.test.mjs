/**
 * Trang "Tổng hợp chi phí C33–C46" (CEO 09/08/2026) — con mắt che số + bộ lọc 6
 * chiều + C44 nêu rõ + xuất Excel theo đúng bộ lọc.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/CostBreakdown.jsx', import.meta.url), 'utf8');
// Ô lọc đã tách ra dùng CHUNG với menu Thành tiền C32·C47 — soi ở file chung.
const pick = fs.readFileSync(new URL('../src/costFilterPanel.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const access = fs.readFileSync(new URL('../src/tabAccess.js', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');

test('‼ CON MẮT che số phủ MỌI ô tiền: mọi ô .catalog-money đều mang data-sensitive', () => {
  // CEO: "tất cả đều có tính năng con mắt mở/đóng các con số, các %, nó rất nhạy cảm."
  // Soi Ô DỮ LIỆU <td> — tiêu đề <th> là chữ, không phải số, không cần che.
  const tdMoney = page.match(/<td [^>]*catalog-money[^>]*>/g) || [];
  assert.ok(tdMoney.length >= 5, 'phải có ô tiền trong bảng');
  for (const cell of tdMoney) assert.match(cell, /data-sensitive/, `td tiền thiếu con mắt: ${cell}`);
});

test('bộ lọc DÙNG CHUNG với menu Thành tiền — đủ 8 chiều CEO chốt, một luật cho hai màn', () => {
  // Trang dùng CostFilterPanel chung; 8 chiều nằm ở COST_FILTER_DIMENSIONS.
  assert.match(page, /<CostFilterPanel options=\{data\?\.filterOptions\} partnerGroups=\{data\?\.partnerGroups\}/);
  assert.match(page, /note=\{data\?\.groupQueryNote\}/, 'thiếu dấu chấm phải nói ra trên màn');
  for (const label of ['Mã nhà thầu', 'Tên nhà thầu', 'Group DONA/đối tác', 'Nhân viên', 'Tuyến', 'Mã đơn vị', 'Nhóm mã đơn vị', 'Ưu tiên (H.A*…)']) {
    assert.ok(pick.includes(`label: '${label}'`), `thiếu chiều lọc ${label}`);
  }
  // "Cột hiển thị" nay nằm CÙNG thẻ bộ lọc (bớt một thẻ rời — CEO chê "lùng nhùng").
  assert.match(page, /extra=\{<MultiPick label="Cột hiển thị"/, 'phải chọn được cột cần hiện/xuất');
});

test('C44 vẫn tính nhưng NÊU RÕ: cột đánh dấu *, chú thích NGOÀI C47, hai dòng tổng tách bạch', () => {
  assert.match(page, /column\.outsideC47 \? '\*' : ''/);
  assert.match(page, /cost-breakdown-outside/);
  assert.match(page, /Tổng chi CÓ C44/);
  // ‼ Bỏ chữ "C47" khỏi TÊN CỘT (CEO hỏi 09/08: "cột C47 sao có tiền ở đây?").
  // Hai cột này là tổng của C33–C46, KHÔNG phải tiền C47 — tiền C47 ở menu riêng.
  assert.match(page, /Tổng chi KHÔNG C44/);
  assert.doesNotMatch(page, /<th className="catalog-money"[^>]*>Trừ vào C47/);
  assert.match(page, /KHÔNG phải tiền C47/);
  assert.match(page, /nằm ở menu riêng <b>“Thành tiền C32 · C47”<\/b>/);
  assert.match(page, /\{data\.c44Note\}/);
});

test('xuất Excel mang ĐÚNG bộ lọc đang chọn — không xuất một đằng nhìn một nẻo', () => {
  assert.match(page, /downloadCostBreakdown\(params\)/);
  assert.match(page, /Xuất Excel \(đúng bộ lọc đang chọn\)/);
  assert.match(api, /costBreakdown: \(params = \{\}\) => req\('GET', '\/catalog-management\/cost-breakdown\?'/);
  assert.match(api, /cost-breakdown\.xlsx/);
});

test('kỳ chưa đồng bộ được NÓI RA trên màn — không lặng lẽ thiếu tháng', () => {
  assert.match(page, /CHƯA đồng bộ %/);
  assert.match(page, /KHÔNG<\/b> gồm các kỳ đó/);
});

test('cột thiếu % hiện cảnh báo ⚠ kèm số cặp — tổng thiếu không giả làm tổng thật', () => {
  assert.match(page, /cặp thiếu % cột này — số dưới là tổng THIẾU/);
  assert.match(page, /⚠ \{cell\.missingPairs\} cặp thiếu %/);
});

test('tab CHỈ CEO: cờ ceoOnly ở App + tabAccess, backend chặn độc lập bằng requireCeo', () => {
  assert.match(app, /key: 'costBreakdown'.*ceoOnly: true/);
  assert.match(access, /!tab\.ceoOnly \|\| canonicalCeo/);
  for (const route of ["'/catalog-management/cost-breakdown'", "'/catalog-management/cost-breakdown.xlsx'"]) {
    const at = routes.indexOf(`router.get(${route}`);
    assert.ok(at > 0, `thiếu route ${route}`);
    assert.match(routes.slice(at, routes.indexOf('\n', at)), /auth\.requireCeo/, `${route} phải requireCeo`);
  }
});

test('menu Thành tiền C32·C47 VẪN RIÊNG — trang mới không thay thế nó (CEO chốt)', () => {
  assert.match(app, /key: 'costAmounts'/);
  assert.match(app, /key: 'costBreakdown'/);
  assert.doesNotMatch(page, /c32NoVat|c47NoVat/, 'trang tổng hợp không nhúng số C32/C47 của menu kia');
});

/* ── Ba công cụ quản trị (Claude tư vấn 09/08, CEO chốt "làm tiếp") ──────────── */

test('cột "Chi/Doanh thu" — chỉ số so được NV bán nhiều với NV bán ít', () => {
  assert.match(page, /Chi\/Doanh thu/);
  assert.match(page, /pctText\(row\.costRatio\)/);
  assert.match(page, /pctText\(data\.totals\.costRatio\)/);
});

test('‼ tỷ lệ null hiện "—", KHÔNG hiện 0% (0% đọc thành "không tốn đồng nào")', () => {
  assert.match(page, /const pctText = \(value\) => \(value == null \? '—'/);
  assert.match(page, /"0%" đọc thành "không tốn đồng nào", sai nguy hiểm/);
});

test('dòng tỷ trọng: cột nào ăn phần lớn nhất trong tiền đã chi', () => {
  assert.match(page, /cost-breakdown-share/);
  assert.match(page, /Tỷ trọng trên tổng chi/);
  assert.match(page, /pctText\(data\.totals\.share\?\.\[column\.key\]\)/);
});

test('khối "So với kỳ trước" xếp theo TIỀN TUYỆT ĐỐI, nói rõ vì sao không xếp theo %', () => {
  assert.match(page, /So với kỳ trước/);
  assert.match(page, /Xếp theo <b>tiền tuyệt đối<\/b>, không theo %/);
  assert.match(page, /cột lớn tăng ít vẫn đứng trên cột nhỏ tăng nhiều/i);
  assert.match(page, /signedMoney\(item\.delta\)/);
});

test('kỳ trước chưa đồng bộ ⇒ NÓI RA, không so nửa vời', () => {
  assert.match(page, /KY_TRUOC_CHUA_DONG_BO/);
  assert.match(page, /chưa đồng bộ %/);
  assert.match(page, /<b>không<\/b> so nửa vời/);
});

test('con mắt phủ luôn số so sánh — chênh lệch cũng là tiền', () => {
  const compareBlock = page.slice(page.indexOf('So với kỳ trước'));
  const cells = compareBlock.match(/<td className="catalog-money"[^>]*>/g) || [];
  assert.ok(cells.length >= 4);
  for (const cell of cells) assert.match(cell, /data-sensitive/);
});

/* ── Ô lọc KHÔNG được kẹt (CEO báo 09/08: "tích vào ô chọn xuất, nó dính luôn") ── */

test('‼ ba đường thoát khỏi ô lọc: bấm ra ngoài · phím Esc · nút "Xong"', () => {
  assert.match(pick, /if \(!boxRef\.current\?\.contains\(event\.target\)\) onToggle\(false\)/, 'bấm ra ngoài phải đóng');
  assert.match(pick, /if \(event\.key === 'Escape'\) onToggle\(false\)/, 'Esc phải đóng');
  assert.match(pick, /onClick=\{\(\) => onToggle\(false\)\}>Xong</, 'phải có nút Xong');
  assert.match(pick, /Bấm ra ngoài hoặc phím Esc để đóng/);
});

test('CHỈ MỘT ô lọc mở tại một thời điểm — trạng thái do CHA giữ, không chồng nhau', () => {
  // Bản đầu mỗi ô tự giữ `open` nên 4 menu mở chồng lên nhau, che mất cả bảng lẫn
  // chính cái nút phải bấm để đóng. Nay 8 chiều nằm trong CostFilterPanel (cha giữ
  // `openPick` bên trong panel); trang chỉ còn ô "Cột xuất" cũng theo cùng kiểu.
  assert.match(pick, /const \[openPick, setOpenPick\] = useState\(''\)/);
  assert.match(pick, /open=\{openPick === dim\.key\} onToggle=\{\(v\) => setOpenPick\(v \? dim\.key : ''\)\}/);
  assert.match(page, /const \[openPick, setOpenPick\] = useState\(''\)/);
  assert.match(page, /<MultiPick label="Cột hiển thị" open=\{openPick === "Cột xuất"\}/);
  // Không được quay lại kiểu mỗi ô tự giữ state.
  assert.doesNotMatch(pick, /export function MultiPick\([^)]*\) \{\s*const \[open, setOpen\] = useState\(false\)/);
});

test('dọn sự kiện khi đóng — không để lại trình nghe treo', () => {
  assert.match(pick, /removeEventListener\('mousedown', onDocDown\); document\.removeEventListener\('keydown', onKey\)/);
});

/* ── Bảng rỗng vì chưa đồng bộ: phải NÓI TO + chỉ việc cần làm ─────────────── */

test('‼ chưa đồng bộ mà bảng rỗng hoàn toàn ⇒ nói rõ "không phải kỳ đó không tốn tiền"', () => {
  // CEO chọn T07 thấy 0 dòng rồi hỏi "đáng lẽ phải ra số". Bảng 0 dòng mà không
  // giải thích là bỏ mặc người dùng tự đoán.
  assert.match(page, /bảng trống hoàn toàn<\/b>, không phải kỳ đó không tốn tiền/);
  assert.match(page, /cost-breakdown-empty-warn/);
});

test('cảnh báo kèm ĐÚNG CÁC BƯỚC phải làm, không chỉ báo lỗi rồi bỏ đó', () => {
  assert.match(page, /<b>Cần làm:<\/b> vào <b>Danh mục QL<\/b>/);
  assert.match(page, /bấm <b>"Đồng bộ từ DataHub"<\/b> → quay lại đây/);
  assert.match(page, /Mỗi kỳ phải đồng bộ một lần/);
});

/* ── Tiêu đề đủ tên + mỗi cột hiện CẢ % LẪN TIỀN (CEO xin 09/08) ─────────────── */

test('tiêu đề cột: mã C-bao-nhiêu + TÊN ĐẦY ĐỦ + nền tính %', () => {
  // CEO: "các mục thanh tiêu đề của các cột hiển thị đủ tên thanh tiêu đề kèm với
  // cột C bao nhiêu". Trước chỉ có mã trần "C43" — nhìn không biết chi phí gì.
  assert.match(page, /<b>\{column\.key\.toUpperCase\(\)\}\{column\.outsideC47 \? '\*' : ''\}<\/b>/);
  assert.match(page, /<small>\{column\.label\.replace\(\/\^C\\d\+\\s\*\/, ''\)\}<\/small>/);
  assert.match(page, /<em>% của \{column\.pctBaseLabel\}<\/em>/);
});

test('mỗi ô hiện CẢ tiền LẪN %, không phải chỉ tiền', () => {
  assert.match(page, /<b>\{money\(v\(row, column\.key\)\)\}<\/b>\s*<small>\{pctText\(row\.pct\?\.\[column\.key\]\)\}<\/small>/);
  assert.match(page, /<b>\{money\(totalsCell\(column\.key\)\)\}<\/b>\s*<small>\{pctText\(data\.totals\.pct\?\.\[column\.key\]\)\}<\/small>/);
});

test('ô vẫn giữ con mắt che số khi thêm dòng %', () => {
  assert.match(page, /className="catalog-money cost-breakdown-cell" data-sensitive=""/);
});

test('Excel xuất HAI cột cho mỗi khoản: "% của …" rồi "thành tiền"', () => {
  assert.match(routes, /head\.push\(`\$\{name\} — % của \$\{column\.pctBaseLabel\}`, `\$\{name\} — thành tiền`\)/);
  assert.match(routes, /const cellsOf = \(columnsData, pct\)/);
  // Thiếu % thì cả hai ô đều '—', không để tiền trống mà % vẫn có số.
  assert.match(routes, /return \[empty \? '—' : \(pct\?\.\[column\.key\] \?\? '—'\), empty \? '—' : cell\.noVat\]/);
});

/* ── CEO chê 09/08 22:52: bộ lọc "như dân nghiệp dư" · màn "lùng nhùng" ──────── */

test('‼ MỌI lớp giao diện của bảng lọc PHẢI có CSS — không có là trình duyệt xếp dọc, menu đè nhau', () => {
  // Claude đẻ ra 8 lớp mà quên viết CSS ⇒ nút xếp thành cột, menu thả xuống đè lên
  // ô nhập. Lỗi thuần trình bày, nhưng nhìn vào thì không ai tin phần tính toán nữa.
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const classes = [...new Set([...pick.matchAll(/className="([^"{}]+)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((name) => name.startsWith('cost-filter') || name.startsWith('cost-breakdown-pick')))];
  assert.ok(classes.length >= 8, 'phải soi được các lớp của bảng lọc');
  for (const name of classes) {
    assert.ok(new RegExp(`\\.${name}[\\s,{:.]`).test(css), `lớp .${name} chưa có CSS`);
  }
});

test('ô chọn nằm NGANG và tự xuống dòng — không xếp thành cột dọc', () => {
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const rule = css.slice(css.indexOf('.cost-filter-picks'), css.indexOf('.cost-filter-inputs'));
  assert.match(rule, /display:flex/);
  assert.match(rule, /flex-wrap:wrap/);
});

test('% dưới ô tiền là BÌNH QUÂN CÓ TRỌNG SỐ — nói ra để không ai đọc thành tỷ lệ cố định', () => {
  // CEO: "cột C44 sao số tiền đó là sao, chưa hiểu" khi thấy 3,99% thay vì 5%.
  assert.match(page, /bình quân có trọng số<\/b> của các cặp đang gộp/);
  assert.match(page, /số bình quân sẽ <b>thấp hơn 5%<\/b> — đó là số thật, không phải tính sai/);
});
