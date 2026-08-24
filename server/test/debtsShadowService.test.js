'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../src/debtsShadowService');

test('Debts shadow is OFF by default and never changes selector', async () => {
  await assert.rejects(service.preview({ period: '2026-08', env: {} }), { code: 'DEBTS_SHADOW_DISABLED' });
  assert.equal(service.enabled({}), false);
});

test('T06 is hard blocked before any source request', async () => {
  let calls = 0;
  await assert.rejects(service.preview({
    period: '2026-06',
    env: { APP_REPORT_DEBTS_SHADOW_ENABLED: '1' },
    fetchImpl: async () => { calls += 1; throw new Error('must not call'); },
  }), { code: 'DEBTS_PERIOD_HARD_BLOCKED' });
  assert.equal(calls, 0);
});

test('mapping file is confined to App Report data and selector flags stay separate', () => {
  assert.throws(() => service.safeMappingFile('/tmp/mapping.json'), { code: 'DEBTS_MAPPING_FILE_INVALID' });
  const cfg = service.config({ APP_REPORT_DEBTS_SHADOW_ENABLED: '1' });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.allowWrite, false);
  assert.match(cfg.dataDir, /revenue-shadow\/debts$/);
});

test('route is CEO-only shadow preview and does not wire live selector', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  assert.match(routes, /\/admin\/debts-shadow\/preview', auth\.requireAuth, auth\.requireCeo/);
  assert.doesNotMatch(routes, /getRows\s*=.*debts|activeSlots\s*=.*debts/);
});

/* Claude review 24/08: dựng thử đường đục và ĐỌC ĐƯỢC file ngoài kho qua symlink
 * nằm trong `server/data`. `path.resolve` chỉ ghép chuỗi, không đi theo liên kết
 * mềm. Test này khoá lại: đường thật phải nằm trong kho, không chỉ đường chuỗi. */
test('symlink nằm trong data trỏ ra ngoài KHÔNG đọc được', () => {
  const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
  const dataDir = path.resolve(service.DATA_DIR);
  fs.mkdirSync(dataDir, { recursive: true });
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'debts-probe-')), 'outside.json');
  fs.writeFileSync(outside, JSON.stringify({ leaked: true }));
  const link = path.join(dataDir, `probe-${process.pid}.json`);
  try { fs.unlinkSync(link); } catch { /* chưa có */ }
  fs.symlinkSync(outside, link);
  try {
    assert.throws(() => service.safeMappingFile(link), { code: 'DEBTS_MAPPING_FILE_INVALID' });
    assert.throws(() => service.loadMapping(link), { code: 'DEBTS_MAPPING_FILE_INVALID' });
  } finally {
    fs.unlinkSync(link); fs.rmSync(path.dirname(outside), { recursive: true, force: true });
  }
});

test('file thật nằm trong kho vẫn đọc được — hàng rào không chặn oan', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const dataDir = path.resolve(service.DATA_DIR);
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, `probe-ok-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify({ ok: 1 }));
  try { assert.deepEqual(service.loadMapping(file), { ok: 1 }); }
  finally { fs.unlinkSync(file); }
});

test('mapping chưa tồn tại fail-closed trước khi có thể bị đổi thành symlink', () => {
  const path = require('node:path');
  const file = path.join(service.DATA_DIR, `missing-${process.pid}.json`);
  assert.throws(() => service.safeMappingFile(file), { code: 'DEBTS_MAPPING_UNAVAILABLE' });
  assert.throws(() => service.loadMapping(file), { code: 'DEBTS_MAPPING_UNAVAILABLE' });
});

test('mapping được đọc qua descriptor no-follow và kiểm lại chính object đã mở', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'debtsShadowService.js'), 'utf8');
  const body = src.slice(src.indexOf('function loadMapping'), src.indexOf('function config'));
  assert.match(body, /O_NOFOLLOW/);
  assert.match(body, /\/proc\/self\/fd\/\$\{fd\}/);
  assert.match(body, /fstatSync\(fd\)\.isFile\(\)/);
  assert.doesNotMatch(body, /readFileSync\(safeMappingFile/);
});

test('preview bắt buộc partition DONA hoặc AFP trước mọi source request', async () => {
  let calls = 0;
  const env = { APP_REPORT_DEBTS_SHADOW_ENABLED: '1' };
  const fetchImpl = async () => { calls += 1; throw new Error('must not call'); };
  await assert.rejects(service.preview({ period: '2026-08', env, fetchImpl }), { code: 'DEBTS_LEGAL_ENTITY_INVALID' });
  await assert.rejects(service.preview({ period: '2026-08', legalEntity: 'OTHER', env, fetchImpl }), { code: 'DEBTS_LEGAL_ENTITY_INVALID' });
  assert.equal(calls, 0);
});

/* Điểm 6 bot tự nhận là CHƯA CÓ TEST. Hợp đồng: KHÔNG BAO GIỜ ghi tên khách hàng
 * vào báo cáo, chỉ mã. Lõi hiện dựng dòng bằng DANH SÁCH TRẮNG trường (normalizeRow
 * không spread `...row`), nên tên khách rơi ra theo thiết kế. Test khoá đúng tính
 * chất đó lại, để một lượt sửa sau này thay bằng spread là đỏ ngay. */
test('hợp đồng dòng chỉ có MÃ, không có trường tên khách hàng', () => {
  const core = require('../src/debtsInvoiceShadow');
  const NAMEISH = /(ten|name|customer|khach|kh_)/i;
  const offenders = core.REQUIRED_ROW_FIELDS.filter((f) => NAMEISH.test(f));
  assert.deepEqual(offenders, [], `trường giống tên khách lọt vào hợp đồng dòng: ${offenders}`);
  assert.ok(core.REQUIRED_ROW_FIELDS.includes('unit_code'));
  assert.ok(core.REQUIRED_ROW_FIELDS.includes('qlnb_code'));
});

test('lõi dựng dòng bằng danh sách trắng, không bê nguyên dòng nguồn', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'debtsInvoiceShadow.js'), 'utf8');
  const body = src.slice(src.indexOf('function normalizeRow'), src.indexOf('function materializeShadow'));
  assert.doesNotMatch(body, /\.\.\.row/, 'normalizeRow bê nguyên dòng nguồn ⇒ tên khách có thể lọt vào');
  assert.doesNotMatch(body, /Object\.assign\(\s*\{\s*\}\s*,\s*row/, 'gán nguyên dòng nguồn ⇒ tên khách có thể lọt');
});

test('phản hồi preview chỉ trả số đếm và checksum, không trả dòng dữ liệu', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const svc = fs.readFileSync(path.join(__dirname, '..', 'src', 'debtsShadowService.js'), 'utf8');
  const ret = svc.slice(svc.indexOf('return Object.freeze({'), svc.indexOf('module.exports'));
  assert.doesNotMatch(ret, /\brows\b\s*:/, 'preview không được trả mảng dòng ra ngoài');
  for (const k of ['rowCount', 'invoiceCount', 'mappedCount', 'quarantinedCount', 'sourceChecksum']) {
    assert.match(ret, new RegExp(k));
  }
});
