const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-xu-identity-'));
const vatDb = path.join(tmp, 'vat.db');
const db = new DatabaseSync(vatDb);
db.exec(`CREATE TABLE vat_bills (
  emp_code TEXT,
  emp_name TEXT,
  hidden_at TEXT,
  ngay TEXT,
  tong_tien REAL,
  so_tien REAL
)`);
const insert = db.prepare('INSERT INTO vat_bills (emp_code, emp_name, hidden_at, ngay, tong_tien, so_tien) VALUES (?, ?, ?, ?, ?, ?)');
insert.run('CEO', 'CEO account', '', '2026-07-10', 1000000, 0);
insert.run('ceo', 'CEO account renamed', '', '2026-07-10', 2000000, 0);
insert.run('DN001', 'DN001 employee', '', '2026-07-11', 500000, 0);
insert.run('DN002', 'DN002 employee', '', '2026-07-12', 2000000, 0);
insert.run('CEO', 'hidden CEO row', '2026-07-13T00:00:00Z', '2026-07-13', 10000000, 0);
insert.run('CEO', 'outside period', '', '2026-06-30', 10000000, 0);
db.close();

process.env.VAT_DB_PATH = vatDb;
const store = require('../src/store');
const diemXu = require('../src/diemXu');
const range = { from: '2026-07-01', to: '2026-07-31' };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('hard keyword is exact and stable', () => {
  assert.equal(diemXu.CEO_XU_TO_DN001_ONLY, 'CEO_XU_TO_DN001_ONLY');
});

test('generic VAT reader preserves CEO and DN001 as separate identities', () => {
  const all = diemXu.readVatXu(range);
  assert.deepEqual(Object.keys(all).sort(), ['CEO', 'DN001', 'DN002']);
  close(all.CEO.xu, 7.8);
  close(all.DN001.xu, 1.3);

  const dn001Only = diemXu.readVatXu({ ...range, empCode: 'DN001' });
  assert.deepEqual(Object.keys(dn001Only), ['DN001']);
  close(dn001Only.DN001.xu, 1.3);
});

test('only DN001 score Xu may add the CEO VAT code', () => {
  close(diemXu.readScoreXuForEmp({ ...range, empCode: 'DN001' }).xu, 9.1);
  close(diemXu.readScoreXuForEmp({ ...range, empCode: 'DN002' }).xu, 5.2);
  close(diemXu.readScoreXuForEmp({ ...range, empCode: 'CEO' }).xu, 7.8);
});

test('DN001 points remain exact and never absorb rows whose employee code is CEO', () => {
  const original = store.getRowsRange;
  store.getRowsRange = () => [
    { date: '2026-07-10', emp_code: 'DN001', route: 'CL', unit_code: '001.X', revenue: 100000000 },
    { date: '2026-07-10', emp_code: 'CEO', route: 'CL', unit_code: '001.X', revenue: 900000000 },
  ];
  try {
    const points = diemXu.pointsByEmpRange({ ...range, empCode: 'DN001' });
    assert.deepEqual(points, { DN001: 2 });
    const score = diemXu.scoreForEmp({ empCode: 'DN001', weekRange: range, monthRange: range, quarterRange: range });
    assert.equal(score.emp_code, 'DN001');
    assert.equal(score.diem_thang, 2);
    close(score.xu_thang, 9.1);
    const ceoScore = diemXu.scoreForEmp({ empCode: 'CEO', weekRange: range, monthRange: range, quarterRange: range });
    assert.equal(ceoScore.emp_code, 'CEO');
    assert.equal(ceoScore.diem_thang, 18);
    close(ceoScore.xu_thang, 7.8);
  } finally {
    store.getRowsRange = original;
  }
});

test('missing VAT database fails closed without borrowing another identity', () => {
  const moved = `${vatDb}.missing`;
  fs.renameSync(vatDb, moved);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(diemXu.readVatXu(range), {});
    assert.equal(diemXu.readScoreXuForEmp({ ...range, empCode: 'DN001' }).xu, 0);
  } finally {
    console.warn = originalWarn;
    fs.renameSync(moved, vatDb);
  }
});
