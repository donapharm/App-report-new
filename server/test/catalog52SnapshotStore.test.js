'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const catalog52 = require('../src/catalog52SnapshotStore');

function row(id, overrides = {}) {
  return Object.assign({ sourceLineId: id }, Object.fromEntries(Array.from({ length: 52 }, (_, index) => [`c${index + 1}`, `${id}-C${index + 1}`])), {
    c5: overrides.c5 || 'QL-A', c6: overrides.c6 || 'DN001', c7: overrides.c7 || '033.BV-A', c25: overrides.c25 || 'HOP',
  }, overrides);
}
function sourceEnvelope(rows, overrides = {}) {
  const canonicalBytes = Buffer.from(JSON.stringify({ rows }), 'utf8');
  return {
    period: '2026-08', source: 'ceo-vault', sourceVersion: 'V31.7', sourceVersionNo: 9,
    rowCount: rows.length, canonicalBytes,
    mappingContract: { unitCodeColumn: 'c7', qlnbColumn: 'c5', employeeColumn: 'c6', uomColumn: 'c25', uomMode: 'validation' },
    sourceIntegrityChecksum: `sha256:${crypto.createHash('sha256').update(canonicalBytes).digest('hex')}`,
    receivedAt: '2026-08-18T00:00:00.000Z', ...overrides,
  };
}
function temporaryStore(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog52-'));
  return { root, store: catalog52.createStore({ root, ...options }) };
}

test('projection physically excludes every C32-C47 from catalogSafe but retains purpose-bound cost fields', () => {
  const result = catalog52.projectRows([row('L1')], { period: '2026-08', sourceVersion: 'V31.7', sourceVersionNo: 9, mappingContract: sourceEnvelope([row('X')]).mappingContract });
  for (const field of catalog52.SENSITIVE_COLUMNS) {
    assert.equal(Object.prototype.hasOwnProperty.call(result.catalogSafe[0], field), false, field);
    assert.equal(result.costRestricted[0][field], `L1-C${field.slice(1)}`, field);
  }
  assert.doesNotThrow(() => catalog52.assertNoSensitive(result.catalogSafe));
  assert.throws(() => catalog52.assertNoSensitive({ nested: { c32: 'CANARY' } }), { code: 'CATALOG52_SENSITIVE_FIELD_LEAK' });
});

test('mapping keeps every C6 candidate and reports conflict instead of first-win', () => {
  const result = catalog52.projectRows([
    row('L1', { c6: 'DN001' }), row('L2', { c6: 'DN002' }), row('L3', { c6: 'DN001', c25: 'CHAI' }),
  ], { period: '2026-08', sourceVersion: 'V31.7', sourceVersionNo: 9, mappingContract: sourceEnvelope([row('X')]).mappingContract });
  assert.equal(result.employeeMapping.length, 1);
  assert.equal(result.employeeMapping[0].candidates.length, 3);
  assert.equal(result.employeeMapping[0].employeeConflict, true);
  assert.equal(result.employeeMapping[0].uomConflict, true);
});

test('canonical C7+C5 to C6 mapping requires a source-declared non-sensitive UOM validation column', () => {
  const rows = [row('L1')];
  const valid = sourceEnvelope(rows);
  assert.equal(catalog52.normalizedMappingContract(valid.mappingContract).uomColumn, 'c25');
  assert.throws(() => catalog52.projectRows(rows, { period: '2026-08' }), { code: 'CATALOG52_MAPPING_CONTRACT_REQUIRED' });
  assert.throws(() => catalog52.projectRows(rows, { period: '2026-08', mappingContract: { ...valid.mappingContract, unitCodeColumn: 'c8' } }), { code: 'CATALOG52_CANONICAL_MAPPING_CONTRACT_INVALID' });
  assert.throws(() => catalog52.projectRows(rows, { period: '2026-08', mappingContract: { ...valid.mappingContract, uomColumn: 'c32' } }), { code: 'CATALOG52_UOM_CONTRACT_INVALID' });
});

test('source integrity checksum verifies exact bytes and remains distinct from canonical internal identity', () => {
  const first = sourceEnvelope([row('L1')]);
  const reordered = Buffer.from(JSON.stringify({ rows: [{ ...Object.fromEntries(Object.entries(row('L1')).reverse()) }] }), 'utf8');
  assert.notEqual(first.sourceIntegrityChecksum, `sha256:${crypto.createHash('sha256').update(reordered).digest('hex')}`);
  assert.equal(catalog52.checksum(catalog52.canonicalJson([catalog52.normalizedRow(row('L1'), 0)])), catalog52.checksum(catalog52.canonicalJson([catalog52.normalizedRow(JSON.parse(reordered).rows[0], 0)])));
});

test('source bounds reject oversized row counts and non-scalar or oversized cells before publication', () => {
  const { root, store } = temporaryStore();
  try {
    assert.throws(() => store.prepareCandidate(sourceEnvelope([row('L1')], { rowCount: catalog52.MAX_ROWS + 1 })), { code: 'CATALOG52_ROW_COUNT_INVALID' });
    assert.throws(() => store.prepareCandidate(sourceEnvelope([row('L1', { c1: { nested: 'forbidden' } })])), { code: 'CATALOG52_CELL_INVALID' });
    assert.throws(() => store.prepareCandidate(sourceEnvelope([row('L1', { c1: 'x'.repeat(catalog52.MAX_CELL_BYTES + 1) })])), { code: 'CATALOG52_CELL_INVALID' });
    assert.equal(store.readPointer('2026-08'), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('candidate is immutable and inactive until a single atomic activation, then readers pin one manifest', () => {
  const { root, store } = temporaryStore();
  try {
    const manifest = store.prepareCandidate(sourceEnvelope([row('L1'), row('L2', { c5: 'QL-B' })]), { actor: 'CEO' });
    assert.equal(store.readPointer('2026-08'), null);
    assert.equal(manifest.state, 'validated');
    assert.throws(() => store.prepareCandidate(sourceEnvelope([row('L1'), row('L2', { c5: 'QL-B' })])), { code: 'CATALOG52_IMMUTABLE_OBJECT_EXISTS' });
    const active = store.activateManifest('2026-08', manifest.manifestId, { actor: 'CEO' });
    assert.equal(active.pointer.activeManifestId, manifest.manifestId);
    const page = store.readProjectionPage('2026-08', 'catalogSafe', { page: 1, pageSize: 1 });
    assert.equal(page.manifestId, manifest.manifestId);
    assert.equal(page.rows.length, 1);
    for (const field of catalog52.SENSITIVE_COLUMNS) assert.equal(field in page.rows[0], false);
    const full = store.readProjectionPage('2026-08', 'full', { page: 2, pageSize: 1, manifestId: manifest.manifestId });
    assert.equal(full.rows[0].sourceLineId, 'L2');
    const audits = fs.readdirSync(path.join(root, 'audit', '2026-08')).map((file) => JSON.parse(fs.readFileSync(path.join(root, 'audit', '2026-08', file), 'utf8')));
    assert.deepEqual(audits.map((item) => item.action).sort(), ['activate', 'preview_validated']);
    assert.equal(audits.every((item) => !JSON.stringify(item).includes('L1-C32')), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('every sync records immutable checksum, row count, GMT+7 time and actor in version history', () => {
  const instant = Date.parse('2026-08-21T05:30:45.000Z');
  const { root, store } = temporaryStore({ now: () => instant });
  try {
    const first = store.prepareCandidate(sourceEnvelope([row('L1')]), { actor: 'CEO' });
    const second = store.prepareCandidate(sourceEnvelope([row('L2')], {
      sourceVersion: 'V31.8', sourceVersionNo: 10,
    }), { actor: 'CEO' });
    const history = store.history('2026-08');
    assert.equal(history.versions.length, 2);
    assert.deepEqual(new Set(history.versions.map((item) => item.manifestId)), new Set([first.manifestId, second.manifestId]));
    for (const item of history.versions) {
      assert.equal(item.rowCount, 1);
      assert.match(item.sourceIntegrityChecksum, /^sha256:[a-f0-9]{64}$/);
      assert.match(item.internalIdentityHash, /^sha256:[a-f0-9]{64}$/);
      assert.equal(item.syncedAtGmt7, '2026-08-21T12:30:45+07:00');
      assert.equal(item.syncedBy, 'CEO');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('control plane defaults only to custody, permits explicit override and never falls back into release data', () => {
  const control = require('../src/catalog52ControlPlane');
  assert.equal(control.DEFAULT_STORE_ROOT, '/home/osboxes/app-report-custody/catalog52-v1');
  assert.equal(control.resolveStoreRoot({}), control.DEFAULT_STORE_ROOT);
  assert.equal(control.resolveStoreRoot({ CATALOG52_STORE_ROOT: '/srv/app-report/catalog52' }), '/srv/app-report/catalog52');
  assert.equal(control.resolveStoreRoot({ CATALOG52_STORE_ROOT: '   ' }), control.DEFAULT_STORE_ROOT);
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'catalog52ControlPlane.js'), 'utf8');
  assert.doesNotMatch(source, /data['"], ['"]catalog52-snapshots/);
  assert.doesNotMatch(source, /catch[^\n]*createStore/);
});

test('catalog52 control plane flag remains fail-closed and off unless explicitly set to one', () => {
  const control = require('../src/catalog52ControlPlane');
  const original = process.env.CATALOG52_CONTROL_PLANE_ENABLED;
  try {
    delete process.env.CATALOG52_CONTROL_PLANE_ENABLED;
    assert.equal(control.enabled(), false);
    process.env.CATALOG52_CONTROL_PLANE_ENABLED = '0';
    assert.equal(control.enabled(), false);
    process.env.CATALOG52_CONTROL_PLANE_ENABLED = 'true';
    assert.equal(control.enabled(), false);
    process.env.CATALOG52_CONTROL_PLANE_ENABLED = '1';
    assert.equal(control.enabled(), true);
  } finally {
    if (original === undefined) delete process.env.CATALOG52_CONTROL_PLANE_ENABLED;
    else process.env.CATALOG52_CONTROL_PLANE_ENABLED = original;
  }
});

test('unwritable snapshot root fails closed and does not choose another directory', () => {
  const store = catalog52.createStore({ root: '/sys/app-report-catalog52-test' });
  assert.equal(store.root, '/sys/app-report-catalog52-test');
  assert.throws(() => store.prepareCandidate(sourceEnvelope([row('L1')])), { code: 'CATALOG52_STORE_UNWRITABLE' });
});

test('failed checksum/projection leaves existing active pointer and LKG untouched', () => {
  const { root, store } = temporaryStore();
  try {
    const first = store.prepareCandidate(sourceEnvelope([row('L1')]), { activate: true, actor: 'CEO' });
    const before = fs.readFileSync(path.join(root, 'pointers', '2026-08.json'));
    const corrupted = sourceEnvelope([row('L2')], { sourceVersionNo: 10, sourceIntegrityChecksum: `sha256:${'0'.repeat(64)}` });
    assert.throws(() => store.prepareCandidate(corrupted), { code: 'CATALOG52_SOURCE_CHECKSUM_MISMATCH' });
    assert.deepEqual(fs.readFileSync(path.join(root, 'pointers', '2026-08.json')), before);
    assert.equal(store.status('2026-08').active.manifestId, first.manifestId);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('crash residue before final pointer rename cannot replace or mix the active manifest', () => {
  const { root, store } = temporaryStore();
  try {
    const active = store.prepareCandidate(sourceEnvelope([row('ACTIVE')]), { activate: true });
    const residue = path.join(root, 'objects', '2026-08', '.stage-crashed-writer');
    fs.mkdirSync(residue, { recursive: true });
    fs.writeFileSync(path.join(residue, 'manifest.json'), '{"manifestId":"partial"');
    const status = store.status('2026-08');
    const page = store.readProjectionPage('2026-08', 'full', { pageSize: 10 });
    assert.equal(status.active.manifestId, active.manifestId);
    assert.deepEqual(page.rows.map((item) => item.sourceLineId), ['ACTIVE']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('activation and rollback deterministically rotate active/LKG under the same period lock', () => {
  const { root, store } = temporaryStore();
  try {
    const a = store.prepareCandidate(sourceEnvelope([row('A')], { sourceVersionNo: 9 }), { activate: true });
    const b = store.prepareCandidate(sourceEnvelope([row('B')], { sourceVersion: 'V31.8', sourceVersionNo: 10 }), { activate: true });
    assert.equal(store.readPointer('2026-08').activeManifestId, b.manifestId);
    assert.equal(store.readPointer('2026-08').lastKnownGoodManifestId, a.manifestId);
    const beforeNoop = store.readPointer('2026-08');
    store.activateManifest('2026-08', b.manifestId, { actor: 'CEO' });
    assert.deepEqual(store.readPointer('2026-08'), beforeNoop, 're-activating active manifest must not erase LKG');
    const rolled = store.rollback('2026-08', { actor: 'CEO' });
    assert.equal(rolled.pointer.activeManifestId, a.manifestId);
    assert.equal(rolled.pointer.lastKnownGoodManifestId, b.manifestId);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('pointer binds immutable manifest checksum and fails closed after manifest tampering', () => {
  const { root, store } = temporaryStore();
  try {
    const active = store.prepareCandidate(sourceEnvelope([row('L1')]), { activate: true });
    const pointer = store.readPointer('2026-08');
    assert.match(pointer.activeManifestChecksum, /^sha256:[a-f0-9]{64}$/);
    const manifestFile = path.join(root, 'objects', '2026-08', active.manifestId, 'manifest.json');
    fs.appendFileSync(manifestFile, ' ');
    assert.throws(() => store.status('2026-08'), { code: 'CATALOG52_MANIFEST_CHECKSUM_MISMATCH' });
    assert.throws(() => store.readProjectionPage('2026-08', 'full', { pageSize: 1 }), { code: 'CATALOG52_MANIFEST_CHECKSUM_MISMATCH' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('retention cannot delete a manifest while a reader pin is registered under the period lock', () => {
  let clock = Date.now();
  const { root, store } = temporaryStore({ readerGraceMs: 1, now: () => clock });
  try {
    const manifests = [];
    for (let index = 1; index <= 4; index += 1) {
      manifests.push(store.prepareCandidate(sourceEnvelope([row(`L${index}`)], {
        sourceVersion: `V${index}`, sourceVersionNo: index,
      })));
      clock += 10;
    }
    const oldest = manifests[0];
    const pinned = store.pinForRead('2026-08', oldest.manifestId);
    clock += 100;
    const retained = store.retain('2026-08', { keep: 2 });
    assert.equal(retained.deleted.includes(oldest.manifestId), false);
    assert.equal(fs.existsSync(path.join(root, 'objects', '2026-08', oldest.manifestId)), true);
    pinned.release();
    const afterRelease = store.retain('2026-08', { keep: 2 });
    assert.equal(afterRelease.deleted.includes(oldest.manifestId), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('live writer lock excludes a competing sync and stale dead lock is recoverable', () => {
  let clock = Date.now();
  const { root, store } = temporaryStore({ lockTtlMs: 1000, now: () => clock });
  try {
    const release = store.acquireLock('2026-08', 'sync');
    assert.throws(() => store.acquireLock('2026-08', 'rollback'), { code: 'CATALOG52_WRITE_LOCKED' });
    release();
    fs.mkdirSync(path.join(root, 'locks'), { recursive: true });
    fs.writeFileSync(path.join(root, 'locks', '2026-08.json'), JSON.stringify({ token: 'dead', host: 'other-host', pid: 999999, heartbeatAt: clock - 2000 }));
    clock += 3000;
    const recovered = store.acquireLock('2026-08', 'retention');
    assert.doesNotThrow(recovered);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('full-52 routes use human trusted gate and never service-token middleware', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes.js'), 'utf8');
  const block = routes.slice(routes.indexOf("router.get('/admin/catalog-management/cp-total-52/status'"), routes.indexOf("router.post('/admin/catalog-management/report/preview'"));
  assert.match(block, /auth\.requireAuth, catalog52ControlPlane\.requireCeoTrustedHuman/);
  assert.doesNotMatch(block, /requireTargetAuth|requireDataHubService/);
  const authSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'auth.js'), 'utf8');
  assert.match(authSource, /trustedHumanDeviceForSession/);
  assert.match(authSource, /session\.service|service-token/);
  assert.match(authSource, /devices\.find/);
});

test('control-plane errors and disabled mode do not disclose rows, secrets or sensitive canaries', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'catalog52ControlPlane.js'), 'utf8');
  const block = source.slice(source.indexOf('function safeError'), source.indexOf('module.exports'));
  assert.match(block, /body: \{ error: code, code \}/);
  assert.doesNotMatch(block, /error\.message|error\.details|JSON\.stringify\(error\)/);
});

test('full API page reader is bounded and projection runs outside the serving process', () => {
  const storeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'catalog52SnapshotStore.js'), 'utf8');
  const reader = storeSource.slice(storeSource.indexOf('function readJsonLinesPage'), storeSource.indexOf('function lockOwner'));
  assert.match(reader, /fs\.readSync/);
  assert.doesNotMatch(reader, /readFileSync/);
  const controlSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'catalog52ControlPlane.js'), 'utf8');
  assert.match(controlSource, /catalog52_projection_worker\.js/);
  assert.match(controlSource, /Readable\.fromWeb\(response\.body\)/);
  assert.doesNotMatch(controlSource, /arrayBuffer\(\)/);
  const worker = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'catalog52_projection_worker.js'), 'utf8');
  assert.match(worker, /prepareCandidate/);
  assert.doesNotMatch(worker, /VAULT_READ_TOKEN|authorization/);
  const activate = storeSource.slice(storeSource.indexOf('function activateUnlocked'), storeSource.indexOf('function activateManifest'));
  assert.match(activate, /checksumFile\(file\)/);
  assert.doesNotMatch(activate, /readFileSync/);
});

test('activation checksum verification streams bounded chunks and detects corruption', () => {
  const { root, store } = temporaryStore();
  try {
    const manifest = store.prepareCandidate(sourceEnvelope([row('L1')]));
    const object = path.join(root, 'objects', '2026-08', manifest.manifestId);
    assert.equal(catalog52.checksumFile(path.join(object, 'full.jsonl')), manifest.artifacts.full.checksum);
    fs.appendFileSync(path.join(object, 'full.jsonl'), '{}\n');
    assert.throws(() => store.activateManifest('2026-08', manifest.manifestId), { code: 'CATALOG52_ARTIFACT_CHECKSUM_MISMATCH' });
    assert.equal(store.readPointer('2026-08'), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('trusted-human middleware denies NV, service, QA and untrusted CEO, then observes live trust success', () => {
  const auth = require('../src/auth');
  const control = require('../src/catalog52ControlPlane');
  const originalCeo = auth.isCeoActor;
  const originalTrust = auth.trustedHumanDeviceForSession;
  const invoke = (session) => {
    const result = { status: null, body: null, next: false, headers: {} };
    const res = {
      set: (key, value) => { result.headers[key] = value; },
      status: (status) => { result.status = status; return res; },
      json: (body) => { result.body = body; return res; },
    };
    control.requireCeoTrustedHuman({ session }, res, () => { result.next = true; });
    return result;
  };
  try {
    auth.isCeoActor = (session) => session?.emp_code === 'CEO';
    auth.trustedHumanDeviceForSession = () => null;
    assert.equal(invoke({ emp_code: 'DN001', role: 'sale', method: 'otp' }).status, 403);
    assert.equal(invoke({ emp_code: 'CEO', role: 'ceo', method: 'service-token', service: 'datahub' }).body.code, 'CATALOG52_HUMAN_SESSION_REQUIRED');
    assert.equal(invoke({ emp_code: 'CEO', role: 'ceo', method: 'qa-browser' }).body.code, 'CATALOG52_HUMAN_SESSION_REQUIRED');
    assert.equal(invoke({ emp_code: 'CEO', role: 'admin', method: 'otp' }).body.code, 'CATALOG52_TRUST_REVERIFY_REQUIRED');
    auth.trustedHumanDeviceForSession = () => ({ id: 'live-device', last_otp_at: Date.now() });
    assert.equal(invoke({ emp_code: 'CEO', role: 'admin', method: 'otp' }).next, true);
  } finally {
    auth.isCeoActor = originalCeo;
    auth.trustedHumanDeviceForSession = originalTrust;
  }
});
