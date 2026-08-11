import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * THIẾU NGƯỜI THÌ KHÔNG ĐƯỢC TRƯNG TỔNG (CEO chốt 11/08/2026).
 *
 * Ảnh chụp màn 22:00 ngày 11/08/2026: DataHub thiếu nguồn của 15/21 NV (DN007…VP004),
 * app vẫn in "Tổng chi phí tháng 1.444.932.127đ", "Thưởng dự kiến 31.812.041đ",
 * "Phạt dự kiến −458.482đ", "C36 CP ctv/khác 123.136.637đ" — toàn bộ là số của SÁU
 * người, đặt vào đúng những ô mà người xem đọc là số của CẢ ĐỘI. Kỳ đủ dữ liệu là
 * 30,98 tỷ. Có nhãn "tạm tính" bên cạnh, nhưng thứ đập vào mắt là con số.
 *
 * Ô "Tổng chi phí tháng sau phạt" từ trước ĐÃ làm đúng ("Chưa đủ dữ liệu chi phí").
 * Lỗi là làm đúng ở một ô rồi để nguyên các ô bên cạnh — nên ca kiểm này soi CẢ BỐN.
 *
 * Vì sao kiểm bằng cách đọc mã nguồn: mấy ô này nằm sâu trong một component 2.300 dòng
 * cần cả model backend để render. Ca kiểm ở đây giữ đúng một điều — không ai gỡ cái
 * chặn ra mà không có gì kêu lên.
 */
const SOURCE = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');

test('cờ thiếu người bật khi và chỉ khi xem TOÀN ĐỘI mà mất trắng ít nhất một NV', () => {
  assert.match(SOURCE, /const thieuNguoi = allEmployees && unavailableEmps > 0;/,
    'cờ phải là (đang xem toàn đội) VÀ (có NV không lấy được dữ liệu)');
});

/* ‼ NGƯỠNG KHÔNG ĐƯỢC LÀ HẰNG SỐ — CEO hỏi thẳng 11/08: "sang T09 tôi nhận thêm
 * người, lên 25 hay 30 NV, thì nó có đếm thêm không hay chỉ đếm 21 người?"
 * Ngưỡng phải đi từ danh sách NV của kỳ (`target_roster.json` → `store.targetRoster`),
 * để thêm người vào danh sách là ngưỡng tự lên, không ai phải sửa code. */
test('số NV của kỳ lấy từ danh sách backend, KHÔNG ghi cứng 21', () => {
  assert.match(SOURCE, /const soNvKy = Number\(model\.penalty\?\.employeeCount \|\| 0\)/,
    'số NV của kỳ phải lấy từ payload backend');
  const dongCoSo21 = SOURCE.split('\n')
    .filter((dong) => !dong.trimStart().startsWith('*') && !dong.trimStart().startsWith('//'))
    .filter((dong) => /\b21\b/.test(dong) && /NV|employee|nhân viên|roster/i.test(dong));
  assert.deepEqual(dongCoSo21, [],
    'ghi cứng 21 là sai: T09 lên 25/30 NV thì app vẫn tưởng đủ. Lấy từ danh sách backend.');
});

test('ô "Tổng chi phí tháng (chi phí gốc)" không hiện số khi thiếu người', () => {
  assert.match(SOURCE, /value=\{thieuNguoi\s*\n?\s*\?\s*'Chưa đủ dữ liệu chi phí'/,
    'phải trả chữ "Chưa đủ dữ liệu chi phí" thay vì tổng của phần đội');
});

test('ô "Thưởng dự kiến" và "Phạt dự kiến" chặn NGAY ĐẦU component, trước mọi phép cộng', () => {
  for (const [ten, nhan] of [['BonusKpi', 'Thưởng dự kiến'], ['PenaltyKpi', 'Phạt dự kiến']]) {
    const than = SOURCE.slice(SOURCE.indexOf(`function ${ten}(`));
    const chan = than.indexOf('if (thieuNguoi)');
    assert.ok(chan > 0, `${ten} phải có chặn thiếu người`);
    assert.ok(chan < than.indexOf('formatEmployeeCostCell'),
      `${ten}: chặn phải nằm TRƯỚC mọi phép dựng số, không phải cuối hàm`);
    assert.match(than.slice(chan, chan + 220), new RegExp(nhan),
      `${ten} phải giữ nguyên nhãn "${nhan}" — ẩn ô đi thì người xem tưởng mất tính năng`);
  }
});

test('các ô cột tiền (C36, C44…) cũng không hiện số khi thiếu người', () => {
  const than = SOURCE.slice(SOURCE.indexOf('function CostColumnKpi('));
  assert.match(than.slice(0, 900), /thieuNguoi \? 'Chưa đủ dữ liệu' : formatEmployeeCostCell/,
    'ô cột tiền cũng là tổng toàn đội — ảnh 22:00 in C36 = 123.136.637đ trong khi thiếu 15/21 NV');
  assert.match(than.slice(0, 900), /!thieuNguoi && item\.provisional/,
    'thiếu người thì đừng gắn nhãn "tạm tính" — không phải tạm tính, mà là không có số');
});

/* Ranh giới: thiếu CẶP mã hàng (vài dòng bên trong người ĐÃ có số) khác hẳn thiếu
 * NGƯỜI. Kiểu đầu vẫn tạm tính được và phải giữ nguyên, nếu không thì mọi kỳ có một
 * mã lẻ chưa gán % đều trắng bảng. */
test('thiếu CẶP mã hàng vẫn cho tạm tính — không được gộp hai kiểu thiếu làm một', () => {
  assert.match(SOURCE, /provisionalTotals\s*=\s*model\.summary\.periodTotal == null/,
    'lối tạm tính theo cặp mã hàng phải còn nguyên');
  assert.ok(!/const thieuNguoi = .*missingPairs/.test(SOURCE),
    'thiếu cặp mã hàng KHÔNG được kéo theo chặn tổng');
});
