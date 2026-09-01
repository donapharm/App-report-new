import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLatestRequestGate } from '../src/requestCoordinator.js';

const page = fs.readFileSync(new URL('../src/pages/CatalogManagement.jsx', import.meta.url), 'utf8');

test('đổi kỳ KHÔNG đập bảng cũ về vòng quay (CEO 08/08: "quay như vậy thì rất kẹt")', () => {
  const load = page.slice(page.indexOf('async function load(selected = period'), page.indexOf('useEffect(() => { api.periods()'));
  // Bản cũ gọi setData(null) ngay đầu ⇒ cả trang trắng. Không được quay lại.
  assert.doesNotMatch(load, /setData\(null\)/, 'không được xoá dữ liệu cũ trước khi tải');
  assert.match(load, /setLoadingPeriod\(selected\)/);
  assert.match(load, /finally \{[\s\S]*if \(request\.isLatest\(\)\) setLoadingPeriod\(''\);[\s\S]*\}/);
});

test('tải hỏng thì GIỮ bảng cũ + báo lỗi, không về màn trắng', () => {
  const load = page.slice(page.indexOf('async function load(selected = period'), page.indexOf('useEffect(() => { api.periods()'));
  const katch = load.slice(load.indexOf('catch (e)'));
  // Câu lỗi mang nguyên `e.message` NHƯNG nói thêm hỏng ở CỬA NÀO và cái gì vẫn
  // dùng được — 502 ở cửa danh mục không liên quan cửa chi phí, mà CEO đọc "Lỗi
  // máy chủ" trơ thì tưởng chết cả hệ (09/08 23:24).
  assert.match(katch, /setError\(`\$\{e\.message\}/);
  assert.match(katch, /VẪN DÙNG ĐƯỢC bình thường/);
  assert.doesNotMatch(katch, /setData\(/, 'lỗi không được đụng tới dữ liệu đang hiển thị');
});

test('admin response rỗng sau refresh bị từ chối và không thay bảng tốt đang có', () => {
  assert.match(page, /function usableCatalogResponse\(result, admin\)/);
  assert.match(page, /result\.rows\.length > 0 && Number\(result\.catalog_total \|\| 0\) > 0/);
  assert.match(page, /if \(!usableCatalogResponse\(result, isAdmin\)\)/);
  assert.match(page, /App Report giữ nguyên bảng tốt gần nhất/);
});

test('đang tải mà đã có bảng ⇒ chỉ dải mảnh, và NÓI RÕ bảng dưới là kỳ nào', () => {
  assert.match(page, /catalog-loading-strip/);
  // ‼ Câu chờ phải nói ĐÚNG đang làm gì: lượt xem thường đọc bản trên máy, chỉ
  // "Đồng bộ lại" mới hỏi Data Hub (CEO bực 09/08 22:07 vì câu chờ nói sai).
  assert.match(page, /Đang mở danh mục kỳ <b>\{loadingPeriod\}<\/b> — <b>đọc bản đã có trên máy<\/b>, không gọi Data Hub/);
  assert.match(page, /askingHub\s*\?\s*<>Đang <b>hỏi lại Data Hub<\/b>/);
  // Không được để người đọc tưởng số trên màn đã là kỳ vừa chọn.
  assert.match(page, /shownPeriod && shownPeriod !== loadingPeriod/);
  assert.match(page, /Bảng dưới vẫn là <b>kỳ \{shownPeriod\}<\/b>/);
});

test('lần đầu chưa có gì để giữ ⇒ khung chờ NÓI đang chờ cái gì, không phải vòng quay trơ', () => {
  assert.match(page, /catalog-first-load/);
  assert.match(page, /Đang mở danh mục kỳ \$\{loadingPeriod \|\| period\}…/);
  assert.match(page, /Đang hỏi lại Data Hub cho kỳ \$\{loadingPeriod \|\| period\}…/);
  assert.match(page, /27\.700 cặp/, 'nói rõ vì sao lâu');
});

test('đổi kỳ liên tục chỉ cho request mới nhất ghi dữ liệu/lỗi/loading state', () => {
  const load = page.slice(page.indexOf('async function load(selected = period'), page.indexOf('useEffect(() => { api.periods()'));
  assert.match(page, /createLatestRequestGate/);
  assert.match(load, /const request = loadGateRef\.current\.next\(\)/);
  assert.ok((load.match(/if \(!request\.isLatest\(\)\) return(?: undefined)?;/g) || []).length >= 2, 'chặn cả dữ liệu chính và metadata cũ');
  assert.match(load, /if \(request\.isLatest\(\)\) \{\s*\n\s*setError\(`\$\{e\.message\}/);
  assert.match(load, /if \(request\.isLatest\(\)\) setLoadingPeriod\(''\)/);
  assert.match(page, /loadGateRef\.current\?\.cancel\(\)/, 'unmount phải vô hiệu request còn treo');
});

test('request kỳ cũ resolve sau không thể ghi đè kỳ mới', async () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  };
  const gate = createLatestRequestGate();
  const commits = [];
  const run = async (pending) => {
    const request = gate.next();
    const value = await pending.promise;
    if (request.isLatest()) commits.push(value);
  };
  const oldPeriod = deferred();
  const newPeriod = deferred();
  const oldRun = run(oldPeriod);
  const newRun = run(newPeriod);
  newPeriod.resolve('08.2026');
  await newRun;
  oldPeriod.resolve('07.2026');
  await oldRun;
  assert.deepEqual(commits, ['08.2026']);
});

test('bảng % kho cục bộ theo cùng luật: đổi kỳ giữ bảng cũ', () => {
  const panel = page.slice(page.indexOf('function CostRatesTablePanel'), page.indexOf('function CostRatesSyncCard'));
  assert.doesNotMatch(panel, /setData\(null\); setError\(''\)/, 'không đập bảng % về trắng khi đổi kỳ');
  assert.match(panel, /bảng dưới vẫn là bản vừa xem/);
  // Huỷ đúng cách khi đổi kỳ liên tục — tránh kết quả kỳ cũ ghi đè kỳ mới.
  assert.match(panel, /let alive = true/);
  assert.match(panel, /if \(alive\) setData\(result\)/);
});

test('bảng giữ lại của kỳ cũ chỉ được đọc — không thể report/điều chuyển/cấp quyền dưới kỳ mới', () => {
  assert.match(page, /const periodMismatch = !!data && !!shownPeriod && shownPeriod !== period/);
  assert.match(page, /const actionsLocked = !!loadingPeriod \|\| periodMismatch/);
  assert.match(page, /period=\{uiToHub\(shownPeriod \|\| period\)\}/,
    'lọc dòng của bảng giữ lại phải dùng kỳ thuộc chính bảng đó');
  assert.match(page, /interactionsDisabled=\{actionsLocked\}/);
  assert.match(page, /const effectiveMode = interactionsDisabled \? 'view' : mode/,
    'khóa ngay trong render, không chờ effect mới thoát tab ghi');
  assert.match(page, /disabled=\{interactionsDisabled\}[\s\S]*setMode\('report'\)/);
  assert.match(page, /disabled=\{interactionsDisabled\}[\s\S]*setMode\('transfer'\)/);
  // Thẻ đồng bộ % không đụng dữ liệu danh mục nên KHÔNG ẩn theo actionsLocked —
  // nó tự khoá NÚT kèm lý do (xem CostRatesSync.card.test.mjs). Ẩn nguyên thẻ từng
  // làm CEO tìm không ra nút được hướng dẫn bấm (09/08 20:04).
  // ‼ Nút đồng bộ % chỉ khoá khi ĐANG TẢI, KHÔNG khoá khi danh mục hỏng — 502 ở
  // cửa danh mục từng khoá vĩnh viễn nút đồng bộ %, chặn đúng đường thoát duy nhất.
  assert.match(page, /isCeo && <CostRatesSyncCard period=\{period\} catalogLoading=\{!!loadingPeriod\}/);
  assert.match(page, /isCeo && data && !actionsLocked && <CostColumnGrantsPanel/);
  assert.match(page, /Bảng kỳ <b>\{shownPeriod\}<\/b> bên dưới chỉ để đọc/);
  assert.doesNotMatch(page, /<AdminView data=\{data\} period=\{uiToHub\(period\)\}/,
    'cấm truyền kỳ vừa chọn vào subtree đang chứa dữ liệu kỳ cũ');
});

test('‼ CẤM bịa số trong chữ giao diện — mọi con số trên màn phải là số THẬT', () => {
  // CEO 09/08: câu chờ ghi "khoảng 27.700 cặp" (Claude viết cứng), CEO đọc thành số
  // liệu thật rồi hỏi vì sao lệch 19 dòng so với 27.719 thực tế. Trong app mà nguyên
  // tắc là "không dòng nào biến mất lặng lẽ", một con số bịa làm hỏng lòng tin vào
  // MỌI con số khác.
  const renderedSource = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const literals = renderedSource.match(/>\s*[^<>{}]*\b2[0-9][.,][0-9]{3}\b[^<>{}]*</g) || [];
  assert.deepEqual(literals, [], 'không được viết cứng số dòng/cặp vào chữ giao diện');
  assert.doesNotMatch(renderedSource, /khoảng <b>[\d.,]+/);
});

/* ── CÂU CHỜ KHÔNG ĐƯỢC NÓI DỐI (CEO bực 09/08 22:07) ────────────────────────
 * CEO: *"tại sao vẫn cứ báo là đang đồng bộ từ DataHub, trong khi hiện tại đã kéo
 * đủ danh mục 27.719 dòng về rồi. Nhìn vào bực mình."* Đúng: từ khi đổi sang
 * đọc-bản-trên-máy, lượt xem thường KHÔNG gọi DataHub nữa. Chờ vài giây thì chịu
 * được; chờ mà bị nói sai đang chờ cái gì thì mất tin vào cả màn hình.          */

test('‼ chỉ "Đồng bộ lại" mới được nói là hỏi Data Hub — cờ do chính nút đó bật', () => {
  assert.match(page, /const \[askingHub, setAskingHub\] = useState\(false\)/);
  assert.match(page, /setAskingHub\(true\);/);
  assert.match(page, /finally \{ setAskingHub\(false\); \}/);
});

test('lượt xem thường KHÔNG còn câu "từ Data Hub" nào trong khung chờ', () => {
  const waiting = page.slice(page.indexOf('catalog-loading-strip'), page.indexOf('catalog-first-load') + 1400);
  const claims = waiting.match(/từ Data Hub/g) || [];
  assert.equal(claims.length, 0, 'khung chờ không được khẳng định đang lấy từ Data Hub');
});

test('nói rõ vì sao vẫn phải chờ vài giây dù đọc từ máy — không để người dùng tự đoán', () => {
  assert.match(page, /Ưu tiên bản đã lưu TRÊN MÁY; chỉ gọi Data Hub khi máy chưa có kỳ này/);
  assert.match(page, /vẫn mất vài giây để bày ra bảng/);
});

/* ── ĐỔI MÀN KHÔNG ĐƯỢC QUAY LẠI TỪ ĐẦU (CEO 09/08 23:22) ───────────────────
 * CEO: *"mỗi lần tao đổi màn xem nó quay như thế này thì có bực không cơ chứ."*
 * Local-first đã bỏ được cú gọi DataHub, nhưng mỗi lần vào lại trang trình duyệt
 * vẫn tải lại 27.719 dòng từ máy chủ — vài giây quay vòng, lần nào cũng vậy.    */

test('‼ kỳ đã xem trong phiên ⇒ hiện NGAY, không tải lại, không quay vòng', () => {
  assert.match(page, /const catalogSessionCache = new Map\(\)/);
  assert.match(page, /if \(!fresh && catalogSessionCache\.has\(hub\)\) \{/);
  assert.match(page, /setData\(catalogSessionCache\.get\(hub\)\); setLoadingPeriod\(''\)/);
  assert.match(page, /rememberCatalog\(p, result\)/);
});

test('bản nhớ CHỈ nằm trong trình duyệt — không đụng máy chủ, không đụng DataHub', () => {
  // Soi ĐÚNG khối bộ nhớ phiên (khai báo + hàm ghi nhớ), không quét lẫn phần khác.
  const block = page.slice(page.indexOf('const catalogSessionCache'), page.indexOf('function CatalogSearch({'));
  const code = block.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('/*') && !line.trim().startsWith('//')).join('\n');
  assert.equal(/api\.[a-z]/i.test(code), false, 'bộ nhớ phiên tuyệt đối không gọi API');
  assert.match(page, /không đụng máy chủ\s*\n?\s*và không đụng DataHub/);
});

test('giữ số kỳ nhớ có trần — không phình theo mọi kỳ người dùng bấm', () => {
  assert.match(page, /const CATALOG_SESSION_MAX = 3/);
  assert.match(page, /while \(catalogSessionCache\.size > CATALOG_SESSION_MAX\)/);
});

test('‼ lỗi cửa danh mục phải nói RÕ cửa nào + cái gì vẫn dùng được', () => {
  // 502 ở cửa danh mục không liên quan cửa chi phí; đọc "Lỗi máy chủ" trơ thì
  // tưởng chết cả hệ và không ai dám bấm gì nữa.
  assert.match(page, /đây là CỬA DANH MỤC của Data Hub, không phải cửa chi phí/);
  assert.match(page, /Đồng bộ % chi phí kỳ \$\{selected\}" phía dưới VẪN DÙNG ĐƯỢC bình thường/);
});
