/**
 * PHÂN QUYỀN CỘT % CHI PHÍ — SPEC_CATALOG_COST_COLUMNS.md (CEO chốt 06/08/2026)
 * Điểm phải khoá: mặc định TẮT · chỉ trong whitelist · phạm vi đơn vị chỉ thu hẹp ·
 * audit không bao giờ trống.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const grants = require('../src/catalogCostColumnGrants');

// Kho giả trong bộ nhớ — không đụng file thật của server.
const memStore = () => {
  const data = {};
  return { data, load: (name, def) => data[name] ?? def, save: (name, value) => { data[name] = value; } };
};
const ceo = { emp_code: 'CEO', isCeo: true };
const sale = (code) => ({ emp_code: code, isCeo: false });

test('MẶC ĐỊNH TẮT: chưa cấp thì không thấy cột nào, và không trả null', () => {
  const store = memStore();
  const grant = grants.readFor('DN001', { store });
  assert.deepEqual(grant.columns, {});
  assert.deepEqual(grant.columnKeys, []);
  assert.equal(grant.granted, false, 'phải phân biệt được "chưa cấp" với "cấp rỗng"');
  assert.deepEqual(grants.visibleColumns(sale('DN001'), ['c41', 'c43'], { store }), []);
  assert.equal(grants.canSee(sale('DN001'), { unitCode: '120.X', column: 'c41' }, { store }), false);
});

test('VP018 mặc định không có grant % chi phí và không thấy C32–C47', () => {
  const store = memStore();
  const grant = grants.readFor('VP018', { store });
  assert.equal(grant.granted, false);
  assert.deepEqual(grant.columns, []);
  assert.deepEqual(grants.visibleColumns(sale('VP018'), ['c32', 'c33', 'c41', 'c46', 'c47'], { store }), []);
  for (const column of ['c32', 'c33', 'c41', 'c46', 'c47']) {
    assert.equal(grants.canSee(sale('VP018'), { unitCode: '120.X', column }, { store }), false, column);
  }
});

test('CEO thấy mọi cột nguồn có, không cần tự cấp cho mình', () => {
  const store = memStore();
  assert.deepEqual(grants.visibleColumns(ceo, ['c45', 'c41', 'c36'], { store }), ['c36', 'c41', 'c45']);
  assert.equal(grants.canSee(ceo, { unitCode: 'bất kỳ', column: 'c44' }, { store }), true);
});

test('chỉ cấp được cột trong whitelist C33–C46; cột cấm là LỖI, không im lặng bỏ qua', () => {
  const store = memStore();
  assert.equal(grants.isAllowedColumn('c41'), true);
  assert.equal(grants.isAllowedColumn('c46'), true);
  for (const bad of ['c32', 'c47', 'c31', 'c48', 'revenue', '']) {
    assert.equal(grants.isAllowedColumn(bad), false, `${bad} phải bị chặn`);
  }
  for (const bad of ['c32', 'c47', 'c48']) {
    assert.throws(() => grants.setGrant('DN001', { columns: [bad] }, { actor: 'CEO', store }),
      /CATALOG_GRANT_COLUMN_NOT_ALLOWED|không nằm trong hợp đồng/,
      `tick nhầm ${bad} phải báo lỗi, không được lưu im rồi báo thành công`);
  }
});

test('cấp cột không kèm phạm vi ⇒ mặc định mọi nhóm NV đang phụ trách', () => {
  const store = memStore();
  const saved = grants.setGrant('DN001', { columns: ['c43', 'c41'] }, { actor: 'CEO', store });
  assert.deepEqual(saved.columnKeys, ['c41', 'c43'], 'cột được chuẩn hoá và sắp xếp');
  assert.deepEqual(saved.columns, { c41: ['*'], c43: ['*'] }, 'v1 không nói phạm vi ⇒ mỗi cột nhận mọi nhóm');
  assert.equal(grants.canSee(sale('DN001'), { unitCode: '120.HTNT', column: 'c41' }, { store }), true);
  assert.equal(grants.canSee(sale('DN001'), { unitCode: '120.HTNT', column: 'c45' }, { store }), false,
    'cột không cấp thì vẫn không thấy dù đơn vị trong phạm vi');
});

test('CEO thu hẹp phạm vi đơn vị: ngoài danh sách là không thấy', () => {
  const store = memStore();
  grants.setGrant('DN001', { columns: ['c41'], units: ['120.HTNT', '021.TTYT'] }, { actor: 'CEO', store });
  assert.equal(grants.canSee(sale('DN001'), { unitCode: '120.HTNT', column: 'c41' }, { store }), true);
  assert.equal(grants.canSee(sale('DN001'), { unitCode: '021.ttyt', column: 'c41' }, { store }), true, 'không phân biệt hoa thường');
  assert.equal(grants.canSee(sale('DN001'), { unitCode: '999.KHAC', column: 'c41' }, { store }), false);
  // Quyền của người này không rò sang người khác.
  assert.equal(grants.canSee(sale('DN002'), { unitCode: '120.HTNT', column: 'c41' }, { store }), false);
});

test('bỏ hết cột ⇒ quay lại trạng thái không thấy gì, không để quyền treo lơ lửng', () => {
  const store = memStore();
  grants.setGrant('DN001', { columns: ['c41'], units: ['120.HTNT'] }, { actor: 'CEO', store });
  const cleared = grants.setGrant('DN001', { columns: [] }, { actor: 'CEO', store });
  assert.deepEqual(cleared.columns, {});
  assert.deepEqual(cleared.columnKeys, []);
  assert.equal(grants.canSee(sale('DN001'), { unitCode: '120.HTNT', column: 'c41' }, { store }), false);
});

test('audit ghi đủ ai · cho ai · trước · sau; thiếu người thao tác là LỖI', () => {
  const store = memStore();
  assert.throws(() => grants.setGrant('DN001', { columns: ['c41'] }, { store }),
    /CATALOG_GRANT_ACTOR_REQUIRED|Thiếu người thao tác/);
  grants.setGrant('DN001', { columns: ['c41'] }, { actor: 'CEO', store });
  grants.setGrant('DN001', { columns: ['c41', 'c43'] }, { actor: 'CEO', store });
  const audit = grants.listAudit({ store });
  assert.equal(audit.length, 2);
  assert.equal(audit[0].actor, 'CEO');
  assert.equal(audit[0].empCode, 'DN001');
  assert.deepEqual(audit[0].before.columns, { c41: ['*'] }, 'phải giữ được trạng thái TRƯỚC để truy ngược');
  assert.deepEqual(audit[0].after.columns, { c41: ['*'], c43: ['*'] });
  assert.equal(audit[1].before, null, 'lần cấp đầu tiên thì trước đó là chưa có');
});

test('mã NV sai định dạng bị chặn — không tạo quyền cho mã rác', () => {
  const store = memStore();
  for (const bad of ['CEO', 'ADMIN', 'DN1', '', 'DN0011']) {
    assert.throws(() => grants.setGrant(bad, { columns: ['c41'] }, { actor: 'CEO', store }),
      /CATALOG_GRANT_EMP_INVALID|Mã nhân viên không hợp lệ/, `${bad} phải bị chặn`);
  }
});

test('whitelist server khớp đúng luật isAllowedCostColumn bên web', () => {
  // Hai nơi lệch nhau thì CEO cấp được cột mà bảng không hiện (hoặc ngược lại).
  const webSource = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'employeeCostModel.js'), 'utf8');
  const webRule = /pos >= 33 && pos <= 46/.test(webSource);
  assert.ok(webRule, 'web đổi luật cột thì phải đổi cả server — sửa cả hai rồi cập nhật test này');
  for (let i = 30; i <= 50; i += 1) {
    const key = `c${i}`;
    assert.equal(grants.isAllowedColumn(key), i >= 33 && i <= 46, `${key} phải khớp luật của web`);
  }
});

/* ── V2: MA TRẬN CỘT × NHÓM ĐƠN VỊ (CEO chốt 08/08/2026) ─────────────────────── */

test('V2: mỗi cột một phạm vi NHÓM riêng — C41 mọi nhóm, C43 chỉ nhóm BV', () => {
  const store = memStore();
  grants.setGrant('DN002', { columns: { c41: ['*'], c43: ['BV'] } }, { actor: 'CEO', store });
  // C41 phủ mọi nhóm ⇒ thấy ở cả BVĐK lẫn TTYT.
  assert.equal(grants.canSee(sale('DN002'), { unitCode: '001.BVĐK ĐỒNG NAI', column: 'c41' }, { store }), true);
  assert.equal(grants.canSee(sale('DN002'), { unitCode: '021.TTYT LONG THÀNH', column: 'c41' }, { store }), true);
  // C43 chỉ nhóm BV ⇒ BVĐK thấy, TTYT không.
  assert.equal(grants.canSee(sale('DN002'), { unitCode: '001.BVĐK ĐỒNG NAI', column: 'c43' }, { store }), true);
  assert.equal(grants.canSee(sale('DN002'), { unitCode: '021.TTYT LONG THÀNH', column: 'c43' }, { store }), false);
});

test('V2 · luật CEO nguyên văn: hai đơn vị CÙNG NHÓM không bao giờ lệch nhau', () => {
  // CEO 08/08: "không có chuyện DN008 chỉ xem được C41 ở 033.PKĐK An Long Khánh
  // mà ở 003.PKĐK An Long Thành lại không xem được".
  const store = memStore();
  grants.setGrant('DN008', { columns: { c41: ['PKĐK'] } }, { actor: 'CEO', store });
  const khanh = grants.canSee(sale('DN008'), { unitCode: '033.PKĐK AN LONG KHÁNH', column: 'c41' }, { store });
  const thanh = grants.canSee(sale('DN008'), { unitCode: '003.PKĐK AN LONG THÀNH', column: 'c41' }, { store });
  assert.equal(khanh, true);
  assert.equal(thanh, true, 'cùng nhóm PKĐK thì phải cùng thấy — cấp theo nhóm là cấp CẢ nhóm');
});

test('V2: đơn vị không phân giải được nhóm ⇒ fail-closed, chỉ "*" mới phủ tới', () => {
  const store = memStore();
  grants.setGrant('DN001', { columns: { c41: ['BV'] } }, { actor: 'CEO', store });
  assert.equal(grants.canSee(sale('DN001'), { unitCode: '999', column: 'c41' }, { store }), false,
    'mã không tách được nhóm không được suy vào nhóm nào');
  grants.setGrant('DN001', { columns: { c41: ['*'] } }, { actor: 'CEO', store });
  assert.equal(grants.canSee(sale('DN001'), { unitCode: '999', column: 'c41' }, { store }), true);
});

test('V2: bản ghi v1 cũ (units mã lẻ) tự NỚI LÊN BIÊN NHÓM khi đọc — đúng luật "đi theo nhóm"', () => {
  const store = memStore();
  // Ghi thẳng bản v1 vào kho như dữ liệu để lại từ trước.
  store.save(grants.FILE, { grants: { DN003: { columns: ['c41'], units: ['033.PKĐK AN LONG KHÁNH'], updatedAt: 'x', updatedBy: 'CEO' } }, audit: [] });
  const grant = grants.readFor('DN003', { store });
  assert.deepEqual(grant.columns, { c41: ['PKĐK'] }, 'mã lẻ phải nở thành nhóm chứa nó');
  // Nhờ đó đơn vị PKĐK khác cũng thấy — không còn lệch trong cùng nhóm.
  assert.equal(grants.canSee(sale('DN003'), { unitCode: '003.PKĐK AN LONG THÀNH', column: 'c41' }, { store }), true);
});

test('V2: unitInScope = có ÍT NHẤT một cột phủ tới — dùng để bỏ nguyên dòng', () => {
  const store = memStore();
  grants.setGrant('DN002', { columns: { c41: ['BV'], c43: ['TTYT'] } }, { actor: 'CEO', store });
  const grant = grants.readFor('DN002', { store });
  assert.equal(grants.unitInScope(grant, '001.BVĐK ĐỒNG NAI'), true);
  assert.equal(grants.unitInScope(grant, '021.TTYT LONG THÀNH'), true);
  assert.equal(grants.unitInScope(grant, '120.HTNT XYZ'), false, 'không cột nào phủ HTNT');
  // Nhưng từng Ô vẫn bị che đúng cột: BVĐK chỉ thấy C41, không thấy C43.
  assert.equal(grants.columnScopeAllows(grant, 'c43', '001.BVĐK ĐỒNG NAI'), false);
});

test('V2: cột cấm trong ma trận vẫn là LỖI; phạm vi rỗng ⇒ cột tự rơi', () => {
  const store = memStore();
  assert.throws(() => grants.setGrant('DN001', { columns: { c47: ['*'] } }, { actor: 'CEO', store }),
    /CATALOG_GRANT_COLUMN_NOT_ALLOWED|không nằm trong hợp đồng/);
  const saved = grants.setGrant('DN001', { columns: { c41: ['*'], c43: [] } }, { actor: 'CEO', store });
  assert.deepEqual(saved.columnKeys, ['c41'], 'cột không nhóm nào = không cấp');
});
