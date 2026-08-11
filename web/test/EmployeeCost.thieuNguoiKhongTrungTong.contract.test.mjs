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


/* ── BOT AUDIT ĐỢT 17 VÒNG 3 ──────────────────────────────────────────────────
 *
 * Bot bắt: bản trước tôi chặn bốn ô KPI đầu màn rồi tuyên bố "không ô tổng nào hiện
 * số" — trong khi ba dòng tổng NGAY DƯỚI BẢNG (`PeriodBlock`) vẫn in số của phần đội.
 * Màn hình tự mâu thuẫn: trên ghi "Chưa đủ dữ liệu", dưới in một con số.
 *
 * ‼ ĐAU NHẤT LÀ CA KIỂM VẪN XANH. Tôi kiểm đúng bốn chỗ tôi vừa sửa, không kiểm cái
 * luật. Ca kiểm kiểu đó chỉ chứng minh "tôi đã sửa chỗ tôi nhớ" — mà chỗ nhớ được thì
 * đâu cần ca kiểm; cần là chỗ QUÊN. Đúng cái bẫy đã sập ba lần bên `formulaIdentity`
 * (danh sách module viết tay → danh sách file → danh sách thư mục).
 *
 * Nay đảo cách kiểm: KHÔNG liệt kê chỗ phải chặn nữa. Quét CẢ FILE tìm mọi chỗ đọc một
 * trường tổng toàn đội, và đòi từng chỗ phải đi qua `tongToanDoi()` hoặc nằm trong tầm
 * bảo vệ của cờ. Viết thêm ô mới ở bất kỳ đâu mà quên chặn ⇒ ca này đỏ, không cần ai
 * nhớ quay lại sửa test.
 */

// Trường mang số TỔNG TOÀN ĐỘI. Thêm trường tổng mới thì thêm vào đây.
const TRUONG_TONG = [
  'monthlyTotal', 'periodTotal', 'provisionalPeriodTotal',
  'annualTotal', 'afterPenaltyTotal', 'baseTotal',
];

test('MÁY QUÉT: mọi chỗ đọc số tổng toàn đội đều phải qua cửa chặn', () => {
  const dong = SOURCE.split('\n');
  const roRi = [];
  dong.forEach((noiDung, i) => {
    const ma = noiDung.split('//')[0];
    if (ma.trimStart().startsWith('*')) return;      // chú thích
    if (!TRUONG_TONG.some((truong) => ma.includes(`.${truong}`))) return;
    // Định nghĩa cửa và khai báo tham số thì không phải nơi hiển thị.
    if (/^\s*(function|const)\s/.test(ma) && !ma.includes('<')) return;
    // Có chặn ngay trên dòng, hoặc trong 3 dòng quanh nó (biểu thức xuống dòng).
    const quanh = dong.slice(Math.max(0, i - 3), i + 4).join('\n');
    if (/tongToanDoi\(|thieuNguoi/.test(quanh)) return;
    /* ‼ MIỄN TRỪ PHẢI CÓ NHÃN VÀ CÓ LÝ DO VIẾT RA. Không phải chỗ nào đọc mấy trường này
     * cũng là tổng toàn đội: tổng phụ của TỪNG NV là số thật của người đó, giấu đi mới là
     * giấu dữ liệu đang có. Nhưng miễn trừ phải NÓI RA vì sao, ngay tại chỗ:
     *   · `tong-1-nguoi`  — số của đúng một NV, thiếu người khác không làm nó sai.
     *   · `tong-da-chan`  — đã nằm trong nhánh có cờ, chỉ là ngoài tầm ±3 dòng.
     * Nhãn suông không kèm chữ giải thích thì vẫn tính là rò — nhãn dán bừa để test xanh
     * đúng là cách hàng rào này chết. */
    const nhan = dong.slice(Math.max(0, i - 6), i + 1).join('\n');
    const coNhan = /tong-1-nguoi|tong-da-chan/.test(nhan);
    const duLyDo = coNhan && nhan.replace(/.*tong-(1-nguoi|da-chan):?/s, '').trim().length >= 40;
    if (coNhan && duLyDo) return;
    roRi.push(coNhan
      ? `dòng ${i + 1}: có nhãn miễn trừ nhưng KHÔNG nêu lý do — ${noiDung.trim().slice(0, 80)}`
      : `dòng ${i + 1}: ${noiDung.trim().slice(0, 110)}`);
  });
  assert.deepEqual(roRi, [],
    'Còn chỗ in số tổng toàn đội mà không qua cửa chặn — đúng lỗ `PeriodBlock` bot bắt ở 076a4b9:\n'
    + roRi.join('\n'));
});

test('cửa chặn `tongToanDoi` trả CHỮ, không trả số, khi thiếu người', () => {
  const than = SOURCE.slice(SOURCE.indexOf('function tongToanDoi('));
  assert.match(than.slice(0, 200), /if \(thieuNguoi\) return 'Chưa đủ dữ liệu';/,
    'phải trả thẳng câu nói, không được trả 0 hay null rồi để chỗ khác tự diễn giải');
});

/* Ba dòng tổng dưới bảng — đúng chỗ bot bắt. Kiểm riêng vì đây là bằng chứng cụ thể,
 * còn máy quét bên trên là lưới chung. */
test('ba dòng tổng dưới bảng trong PeriodBlock đều đã qua cửa', () => {
  /* `CostTable` được khai TRƯỚC `PeriodBlock` trong file, nên cắt tới đó là cắt ngược và
   * ra chuỗi rỗng — ca kiểm khi ấy xanh vì không tìm thấy gì để chê. Đúng kiểu hỏng âm
   * thầm đã dính ở A6c. Cắt tới component kế TIẾP theo thứ tự file. */
  const dau = SOURCE.indexOf('function PeriodBlock(');
  const cuoi = SOURCE.indexOf('function ', SOURCE.indexOf('function tongToanDoi(') > dau ? dau + 1 : dau + 1);
  const than = SOURCE.slice(dau, SOURCE.indexOf('\nfunction ', dau + 1));
  assert.ok(than.length > 500 && cuoi > 0, 'cắt trúng thân PeriodBlock, không được ra chuỗi rỗng');
  for (const truong of ['period.summary.monthlyTotal', 'penalty?.afterPenaltyTotal', 'period.summary.annualTotal']) {
    assert.ok(than.includes(`tongToanDoi(${truong}`),
      `${truong} phải qua cửa — đây đúng ba dòng in số trong khi KPI trên đầu ghi "Chưa đủ dữ liệu"`);
  }
  assert.match(than, /thieuNguoi = false, thieuNguoiNote = ''/,
    'PeriodBlock phải NHẬN cờ; không nhận thì mọi thứ bên trong nó mù');
  assert.match(SOURCE, /<PeriodBlock thieuNguoi=\{thieuNguoi\}/,
    'và chỗ gọi phải TRUYỀN cờ xuống — nhận mà không ai truyền thì cũng như không');
});

test('ô "sau phạt" trên đầu màn cũng không được nhận số khi thiếu người', () => {
  assert.match(SOURCE, /baseTotal=\{thieuNguoi \? null :/,
    'truyền null để AfterPenaltyKpi tự nói "Chưa đủ dữ liệu chi phí" — đường nó vốn đã làm đúng');
});


test('Σ ngày trong bảng chi tiết cũng phải qua cửa — ở chế độ toàn đội đó là tổng cả đội', () => {
  const than = SOURCE.slice(SOURCE.indexOf('function CostTable('), SOURCE.indexOf('function CostColumnKpi('));
  assert.match(than, /tongToanDoi\(totalsByDate\.get\(row\.date\)\?\.monthlyTotal, thieuNguoi\)/,
    'dòng "Σ ngày" gộp cả đội theo từng ngày — thiếu người thì nó cũng sai như tổng tháng');
  assert.match(than, /thieuNguoi = false/, 'CostTable phải NHẬN cờ');
  assert.equal((SOURCE.match(/<CostTable[^>]*thieuNguoi=\{thieuNguoi\}/g) || []).length, 2,
    'cả hai chỗ gọi CostTable (bảng thường và bảng theo ngày) đều phải truyền cờ');
});
