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
  assert.deepEqual(grant.columns, []);
  assert.deepEqual(grant.units, []);
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

test('cấp cột không kèm phạm vi ⇒ mặc định mọi đơn vị NV đang phụ trách', () => {
  const store = memStore();
  const saved = grants.setGrant('DN001', { columns: ['c43', 'c41'] }, { actor: 'CEO', store });
  assert.deepEqual(saved.columns, ['c41', 'c43'], 'cột được chuẩn hoá và sắp xếp');
  assert.deepEqual(saved.units, ['*']);
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

test('bỏ hết cột ⇒ phạm vi dọn về rỗng, quay lại trạng thái không thấy gì', () => {
  const store = memStore();
  grants.setGrant('DN001', { columns: ['c41'], units: ['120.HTNT'] }, { actor: 'CEO', store });
  const cleared = grants.setGrant('DN001', { columns: [] }, { actor: 'CEO', store });
  assert.deepEqual(cleared.columns, []);
  assert.deepEqual(cleared.units, [], 'giữ lại phạm vi cũ là để lại quyền treo lơ lửng');
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
  assert.deepEqual(audit[0].before.columns, ['c41'], 'phải giữ được trạng thái TRƯỚC để truy ngược');
  assert.deepEqual(audit[0].after.columns, ['c41', 'c43']);
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
