/**
 * RÀ PHÂN QUYỀN KHI DANH MỤC ĐỔI — CEO nêu 09/08/2026.
 * "hôm sau nhóm 033 mở thêm đơn vị mới… hôm sau chuyển NV phụ trách sang đơn vị
 *  khác… vậy vào đâu để bấm cập nhật phân quyền?"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewGrants, applySuggestion, isGroupChecked } from '../src/catalogCostGrantsModel.js';

const group = (key, label, units) => ({ key, label, units, unitCount: units.length });
const row = (empCode, columns, groups, name = '') => ({
  empCode, name, columns, availableGroups: groups, availableUnits: groups.flatMap((g) => g.units), ungroupedUnits: [],
});
const panelOf = (...rows) => ({ columns: [{ key: 'c41' }, { key: 'c43' }], rows });

const G001 = group('001', '001 · BVĐK Đồng Nai', ['001.BVĐK ĐỒNG NAI']);
const G033 = group('033', '033 · PKĐK An Long Khánh', ['033.PKĐK LONG KHÁNH', '033.PKĐK XUÂN LỘC']);
const G120 = group('120', '120 · BV Mới', ['120.BV MỚI']);

/* ── Tình huống 1: thêm đơn vị vào nhóm ĐÃ CẤP ⇒ tự động, không báo gì ────────── */

test('nhóm 033 mở thêm đơn vị mới KHÔNG sinh việc — quyền theo nhóm tự phủ tới', () => {
  // '033.PKĐK XUÂN LỘC' vừa mở, nhưng nhóm 033 đã được cấp c41 ⇒ không có gì phải rà.
  const review = reviewGrants(panelOf(row('DN001', { c41: ['033'] }, [G033])));
  assert.equal(review.counts.needsGrant, 0);
  assert.equal(review.counts.staleGrant, 0);
});

/* ── Tình huống 2: nhóm mã HOÀN TOÀN MỚI ─────────────────────────────────────── */

test('nhóm mã mới mà chưa ai được cấp ⇒ báo là NHÓM MỚI, không có ai để gợi ý', () => {
  const review = reviewGrants(panelOf(row('DN001', { c41: ['001'] }, [G001, G120])));
  assert.equal(review.counts.needsGrant, 1);
  const item = review.needsGrant[0];
  assert.deepEqual(
    { empCode: item.empCode, groupKey: item.groupKey, isNewGroup: item.isNewGroup, suggestions: item.suggestions },
    { empCode: 'DN001', groupKey: '120', isNewGroup: true, suggestions: [] },
  );
});

test('‼ CEO chốt 09/08: nhóm mới thì NV KHÔNG tự thấy — app chỉ báo, không tự cấp', () => {
  const panel = panelOf(row('DN001', { c41: ['001'] }, [G001, G120]));
  const review = reviewGrants(panel);
  // reviewGrants là hàm ĐỌC: chạy xong ma trận phải y nguyên, không tự nới cho nhóm mới.
  assert.equal(isGroupChecked(panel.rows[0], 'c41', '120'), false);
  assert.equal(review.needsGrant.length, 1);
  assert.deepEqual(panel.rows[0].columns, { c41: ['001'] });
});

test('cột để "Mọi nhóm" thì nhóm mới tự phủ tới — không sinh việc rà', () => {
  const review = reviewGrants(panelOf(row('DN001', { c41: ['*'] }, [G001, G120])));
  assert.equal(review.counts.needsGrant, 0);
});

/* ── Tình huống 3: chuyển NV phụ trách ───────────────────────────────────────── */

test('chuyển nhóm 033 từ DN001 sang DN002 ⇒ báo DN002 thiếu, gợi ý cấp giống DN001', () => {
  const panel = panelOf(
    row('DN001', { c41: ['033'], c43: ['033'] }, [G033], 'Đặng Xuân Trung'),
    row('DN002', { c41: ['001'] }, [G001, G033], 'NV Hai'),
  );
  const review = reviewGrants(panel);
  const item = review.needsGrant.find((x) => x.empCode === 'DN002' && x.groupKey === '033');
  assert.ok(item, 'phải báo DN002 chưa có quyền ở nhóm 033');
  assert.equal(item.isNewGroup, false);
  assert.deepEqual(item.suggestions, [{ empCode: 'DN001', name: 'Đặng Xuân Trung', columns: ['c41', 'c43'] }]);
});

test('gợi ý KHÔNG bao giờ trỏ về chính người đang thiếu', () => {
  const panel = panelOf(row('DN001', { c41: ['001'] }, [G001, G033]));
  const item = reviewGrants(panel).needsGrant.find((x) => x.groupKey === '033');
  assert.equal(item.suggestions.some((s) => s.empCode === 'DN001'), false);
});

test('bấm "Cấp giống DN001" mới thực sự cấp — và chỉ cấp ĐÚNG nhóm đó', () => {
  let panel = panelOf(
    row('DN001', { c41: ['033'], c43: ['033'] }, [G033]),
    row('DN002', { c41: ['001'] }, [G001, G033]),
  );
  panel = applySuggestion(panel, 'DN002', '033', ['c41', 'c43']);
  const dn002 = panel.rows.find((r) => r.empCode === 'DN002');
  assert.equal(isGroupChecked(dn002, 'c41', '033'), true);
  assert.equal(isGroupChecked(dn002, 'c43', '033'), true);
  // Không được lan sang nhóm khác: c43 chỉ mở ở 033, KHÔNG mở ở 001.
  assert.equal(isGroupChecked(dn002, 'c43', '001'), false);
  assert.equal(dn002.dirty, true, 'phải đánh dấu chưa lưu để CEO bấm Lưu');
  assert.equal(reviewGrants(panel).needsGrant.some((x) => x.empCode === 'DN002' && x.groupKey === '033'), false);
});

/* ── Quyền thừa sau khi chuyển đi ────────────────────────────────────────────── */

test('NV không còn phụ trách nhóm nhưng còn quyền ⇒ báo để dọn', () => {
  const review = reviewGrants(panelOf(row('DN001', { c41: ['001', '033'], c43: ['033'] }, [G001])));
  assert.equal(review.counts.staleGrant, 1);
  assert.deepEqual(review.staleGrant[0], { empCode: 'DN001', name: '', groupKey: '033', columns: ['c41', 'c43'] });
});

test('"Mọi nhóm" không bao giờ bị coi là quyền thừa', () => {
  const review = reviewGrants(panelOf(row('DN001', { c41: ['*'] }, [G001])));
  assert.equal(review.counts.staleGrant, 0);
});

/* ── Chống nhiễu: NV chưa cấu hình gì không phải là lỗi ──────────────────────── */

test('NV chưa cấp gì KHÔNG bị kêu — đó là mặc định đúng, không phải lệch', () => {
  // Không có luật này thì ngày đầu bật máy đã hơn hai nghìn dòng cảnh báo, đọc thành
  // nhiễu rồi bỏ qua hết — cảnh báo mất tác dụng đúng lúc cần nhất.
  const review = reviewGrants(panelOf(row('DN001', {}, [G001, G033, G120])));
  assert.equal(review.counts.needsGrant, 0);
  assert.deepEqual(review.neverConfigured, [{ empCode: 'DN001', name: '', groupCount: 3 }]);
  assert.equal(review.counts.neverConfigured, 1);
});

test('NV chưa cấp gì mà cũng chưa phụ trách gì thì không đếm vào đâu cả', () => {
  const review = reviewGrants(panelOf(row('VP018', {}, [])));
  assert.equal(review.counts.neverConfigured, 0);
});

/* ── Đếm nhóm mới ───────────────────────────────────────────────────────────── */

test('đếm NHÓM mới theo nhóm, không nhân lên theo số NV cùng phụ trách', () => {
  const review = reviewGrants(panelOf(
    row('DN001', { c41: ['001'] }, [G001, G120]),
    row('DN002', { c41: ['001'] }, [G001, G120]),
  ));
  assert.equal(review.counts.needsGrant, 2, 'hai NV cùng thiếu ⇒ hai việc');
  assert.equal(review.counts.newGroups, 1, 'nhưng chỉ MỘT nhóm mới');
});

test('bảng rỗng/hỏng không làm nổ màn hình', () => {
  for (const input of [undefined, null, {}, { rows: null }]) {
    assert.deepEqual(reviewGrants(input).counts, { needsGrant: 0, staleGrant: 0, newGroups: 0, neverConfigured: 0 });
  }
});

/* ── Màn hình: khối "Cần rà phân quyền" ─────────────────────────────────────── */

import fs from 'node:fs';
const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');
const board = page.slice(page.indexOf('function GrantReviewBoard'), page.indexOf('function CostColumnGrantsPanel'));

test('có CHỖ ĐỂ BẤM: khối rà nằm ngay đầu menu phân quyền, kèm số việc trên tiêu đề', () => {
  // Trước bản này CEO hỏi "vào đâu để bấm cập nhật phân quyền" và câu trả lời thật
  // là: không có chỗ nào.
  assert.match(page, /<GrantReviewBoard review=\{review\}/);
  assert.match(page, /const review = useMemo\(\(\) => reviewGrants\(panel\), \[panel\]\)/);
  assert.match(page, /catalog-grants-badge/);
  assert.match(page, /const todo = review\.counts\.needsGrant \+ review\.counts\.staleGrant/);
});

test('‼ app CHỈ BÁO, KHÔNG TỰ CẤP — nút gợi ý vẫn phải bấm Lưu (CEO chốt 09/08)', () => {
  assert.match(board, /app <b>không tự cấp<\/b> gì, mọi thay đổi vẫn phải bấm/);
  assert.match(page, /onApply=\{\(item, suggestion\) => setPanel\(\(cur\) => applySuggestion\(cur, item\.empCode, item\.groupKey, suggestion\.columns\)\)\}/);
  // Không có đường tự chạy: applySuggestion chỉ được gọi từ onClick của người dùng.
  assert.doesNotMatch(page, /useEffect\([^)]*applySuggestion/);
});

test('nhóm mới thì nói thẳng là chưa có mẫu, không bịa ra một gợi ý', () => {
  assert.match(board, /item\.isNewGroup/);
  assert.match(board, /nhóm mới, chưa có mẫu/);
});

test('nút gợi ý ghi rõ cấp cột nào của ai — CEO không bấm mù', () => {
  assert.match(board, /Cấp giống \{suggestion\.empCode\} \(\{suggestion\.columns\.map\(\(c\) => c\.toUpperCase\(\)\)\.join\(', '\)\}\)/);
});

test('quyền thừa nói rõ là KHÔNG lộ số, tránh làm CEO hoảng', () => {
  assert.match(board, /không lộ số \(bảng vẫn lọc theo phụ trách\)/);
});

test('không lệch gì thì nói thẳng "đang khớp", không để khối trống khó hiểu', () => {
  assert.match(board, /Phân quyền đang khớp với danh mục hiện hành/);
});

test('NV chưa cấp gì được nói là MẶC ĐỊNH ĐÚNG, không gộp vào số việc', () => {
  assert.match(board, /đây là <b>mặc định đúng<\/b>, không phải lệch, nên không tính vào số việc/);
});

test('danh sách dài bị cắt thì NÓI RA đã cắt, không im lặng hiện 25 dòng', () => {
  assert.match(board, /Hiện \{REVIEW_LIMIT\}\/\{needsGrant\.length\} chỗ/);
  assert.match(board, /Hiện \{REVIEW_LIMIT\}\/\{staleGrant\.length\} chỗ/);
});

/* ── Nói ĐÚNG nguyên nhân khi không hỏi được bảng nhóm (CEO chụp màn 09/08) ──── */

test('‼ "không hỏi được backend" KHÁC "đơn vị thiếu nhóm" — không đổ tội cho dữ liệu', () => {
  // Bản cũ nuốt lỗi thành {} nên 403/timeout cũng hiện "164 đơn vị chưa nhận diện
  // được nhóm". CEO đọc xong đi tìm lỗi dữ liệu, trong khi thật ra chưa hỏi được ai.
  assert.match(page, /const \[groupsError, setGroupsError\] = useState\(''\)/);
  // Fulfilled nhưng bị cắt trần cũng phải nói (truncated) — còn lỗi hệ thống thì
  // lấy đúng message của reason như cũ.
  assert.match(page, /setGroupsError\(unitGroups\.status === 'fulfilled'/);
  assert.match(page, /unitGroups\.value\.truncated/);
  assert.match(page, /unitGroups\.reason\?\.message/);
  assert.match(page, /Không hỏi được bảng "mã đơn vị → nhóm"/);
  assert.match(page, /<b>KHÔNG<\/b> phải đơn vị thiếu nhóm, mà là chưa hỏi được máy chủ/);
  // Phải chỉ đúng endpoint để bot khỏi đi dò mò.
  assert.match(page, /POST \/catalog-management\/cost-columns\/unit-groups/);
});

test('màn chi tiết NV trỏ ngược lên cảnh báo đỏ khi MỌI người đều 0 nhóm', () => {
  assert.match(page, /Nếu MỌI nhân viên đều báo 0 nhóm thì đây không phải lỗi dữ liệu/);
});

/* ── Nút "Thử lại" phải GỌI LẠI API THẬT (bot chặn Gate 2 đúng, 09/08) ───────── */

test('‼ HÀNH VI: đóng/mở panel KHÔNG gọi lại API — nên hướng dẫn cũ là vô dụng', () => {
  // Bản đầu bảo "Bấm Thu gọn rồi Mở phân quyền lại để thử lần nữa". Sai: `load()`
  // có chốt `!panel`, mà sau lỗi panel VẪN tồn tại (bảng nhóm rỗng) ⇒ không chạy lại.
  // Lấy ĐÚNG luật gating từ code rồi chạy mô phỏng, không chép tay quy tắc.
  const effect = page.match(/useEffect\(\(\) => \{ if \(open && !panel && !loading\) load\(\); \}, \[open\]\);/);
  assert.ok(effect, 'luật tự-tải phải là (open && !panel && !loading)');
  const autoLoads = (open, panel, loading) => !!(open && !panel && !loading);

  const panelAfterError = { rows: [], columns: [] };       // lỗi bảng nhóm: panel VẪN có
  assert.equal(autoLoads(false, panelAfterError, false), false, 'thu gọn: không tải');
  assert.equal(autoLoads(true, panelAfterError, false), false, 'mở lại: VẪN không tải ⇒ hướng dẫn cũ vô dụng');
  // Lần mở đầu (chưa có panel) thì vẫn phải tự tải như cũ.
  assert.equal(autoLoads(true, null, false), true);
});

test('nút "Thử lại" gọi THẲNG load(), không đi vòng qua setOpen', () => {
  assert.match(page, /onClick=\{\(\) => load\(\)\}>\s*\{loading \? 'Đang thử lại…' : '↻ Thử lại'\}/);
  assert.match(page, /<button type="button" className="btn" disabled=\{loading\} onClick=\{\(\) => load\(\)\}/);
  // Không được quay lại kiểu bảo người dùng đóng/mở panel.
  assert.doesNotMatch(page, /Thu gọn<\/b> rồi <b>Mở phân quyền<\/b> lại/);
});

/* ── HAI KHUNG ĐỎ CÙNG MỘT GỐC — và cái thứ hai đổ tội nhầm (CEO 09/08 23:59) ──
 * Ảnh CEO: banner đỏ "Không hỏi được bảng mã đơn vị → nhóm (Failed to fetch)" VÀ
 * dòng "16 đơn vị chưa nhận diện được nhóm (007.BVĐK…, 008.BVĐK…, 015.TTYT…)".
 * Nhưng 007/008/015 RÕ RÀNG có nhóm — chúng chỉ "không nhận diện được" vì bảng tra
 * chưa tải về. Đổ tội cho dữ liệu khiến CEO đi sửa nhầm chỗ và nghi ngờ chính số
 * liệu của mình.                                                                */

test('‼ chưa hỏi được máy chủ ⇒ màn chi tiết NÓI ĐÚNG lý do, KHÔNG bảo NV thiếu nhóm', () => {
  assert.match(page, /Chưa hỏi được máy chủ bảng "mã đơn vị → nhóm"<\/b> \(\{groupsError\}\)/);
  assert.match(page, /<b>KHÔNG phải \{row\.empCode\} thiếu nhóm<\/b>/);
  // Và phải chặn tay CEO lại: lưới nhóm trống thì cấp quyền là cấp mù.
  assert.match(page, /đừng cấp quyền<\/b> vì lưới nhóm đang trống/);
});

test('dòng "N đơn vị chưa nhận diện được nhóm" bị TẮT khi lỗi là do chưa hỏi được', () => {
  assert.match(page, /\{!!row\.ungroupedUnits\.length && !groupsError &&/);
});

test('màn chi tiết có nút Thử lại tại chỗ — không bắt quay ra đầu menu', () => {
  assert.match(page, /onRetryGroups=\{\(\) => load\(\)\}/);
  assert.match(page, /onRetryGroups && <div className="catalog-grant-retry">/);
});

test('‼ hụt mạng nhất thời TỰ THỬ LẠI — không đẩy việc của máy sang cho người', () => {
  assert.match(page, /const withRetry = async \(call, tries = 3\)/);
  assert.match(page, /withRetry\(\(\) => api\.catalogCostUnitGroups\(distinctUnits\)\)/);
  // Nghỉ tăng dần giữa các lượt, không nện liên tiếp.
  assert.match(page, /setTimeout\(done, 400 \* \(attempt \+ 1\)\)/);
  // Hai lời gọi kia KHÔNG bọc retry — chúng hỏng thì đã có đường báo lỗi riêng.
  assert.match(page, /api\.catalogCostGrants\(\), api\.catalogCostRates\(\), withRetry/);
});
