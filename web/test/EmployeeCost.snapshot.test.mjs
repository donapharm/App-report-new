import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { employeeCostViewModel } from '../src/employeeCostModel.js';

test('view model propagates sync status/period and allowlisted unavailableReasons', () => {
  const model = employeeCostViewModel({
    allEmployees: true, dongBoKy: '2026-07', periods: [],
    trangThaiDongBo: {
      state: 'partial', syncing: true, complete: false, locked: false,
      fetchedAt: '2026-08-13T02:00:00.000Z', generationId: 'abc',
      rosterCount: 3, availableCount: 2,
      unavailableReasons: { DN003: 'roster_added', DN004: 'https://secret/?key=abc', DN005: 'upstream_rejected' },
    },
  });
  assert.equal(model.dongBoKy, '2026-07');
  assert.deepEqual(model.trangThaiDongBo, {
    state: 'partial', syncing: true, complete: false, locked: false,
    fetchedAt: '2026-08-13T02:00:00.000Z', generationId: 'abc',
    rosterCount: 3, availableCount: 2,
    unavailableReasons: { DN003: 'roster_added', DN004: 'upstream_unavailable', DN005: 'upstream_rejected' },
    errorCode: '',
  });
  assert.doesNotMatch(JSON.stringify(model), /secret|key=abc/);
});

test('normalized match preserves only privacy-safe per-employee unavailable reasons', () => {
  const model = employeeCostViewModel({
    periods: [], allEmployees: true,
    match: {
      unavailableEmployees: ['DN001', 'DN002'], unavailableEmployeeCount: 2,
      unavailableReasons: { DN001: 'not_configured', DN002: 'token=private', DN003: 'upstream_rejected' },
    },
  });
  assert.deepEqual(model.match.unavailableReasons, { DN001: 'not_configured', DN002: 'upstream_unavailable', DN003: 'upstream_rejected' });
});

test('READ_BUSY stays a safe distinct reason and UI tells the user to retry', () => {
  const model = employeeCostViewModel({
    periods: [], allEmployees: true,
    match: { unavailableEmployees: ['DN001'], unavailableReasons: { DN001: 'upstream_busy' } },
  });
  assert.deepEqual(model.match.unavailableReasons, { DN001: 'upstream_busy' });
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(page, /upstream_busy: 'nguồn đang bận, thử lại'/);
  assert.match(page, /DataHub đang bận — thử lại/);
});

test('UI explains upstream rejection as DataHub configuration, never as network or raw upstream detail', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(page, /DataHub từ chối mã này — cần DataHub sửa cấu hình, không phải lỗi mạng/);
  assert.match(page, /reasons\[empCode\] === 'upstream_rejected'/);
  assert.doesNotMatch(page, /credential=must-not-leak|https:\/\/secret\/\?key=/);
});

test('UI and API expose Đồng bộ lại as a background mutation with snapshot status', () => {
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
  assert.match(page, /Bản chi phí trên máy/);
  assert.match(page, /'Đồng bộ lại'/);
  assert.match(page, /api\.employeeCostSnapshotResync\(range\.to\)/);
  assert.match(page, /api\.employeeCostSnapshotStatus\(range\.to\)/);
  assert.match(page, /setSnapshotRevision/);
  assert.match(page, /snapshotStatus\.locked/);
  assert.match(page, /SNAPSHOT_REASON_LABELS/);
  assert.match(api, /employeeCostSnapshotStatus:/);
  assert.match(api, /employeeCostSnapshotResync:/);
  assert.match(api, /'POST', '\/employee-cost\/snapshot\/resync'/);
});

test('pinned rate metadata is explicit while fresh payload has no pinned label', () => {
  const pinned = employeeCostViewModel({
    empCode: 'DN001', period: '2026-07', rateSource: 'local_pinned',
    ratePinnedAt: '2026-08-05T02:03:00.000Z', rows: [], columns: [],
  });
  const fresh = employeeCostViewModel({ empCode: 'DN001', period: '2026-08', rateSource: 'datahub', rows: [], columns: [] });
  assert.equal(pinned.rateSource, 'local_pinned');
  assert.equal(pinned.ratePinnedAt, '2026-08-05T02:03:00.000Z');
  assert.notEqual(fresh.rateSource, 'local_pinned');
  assert.equal(fresh.ratePinnedAt, '');
  const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');
  assert.match(page, /Số chốt từ bản ghim lúc/);
  assert.match(page, /kỳ đã khoá, không gọi nguồn/);
  assert.match(page, /model\.rateSource === 'local_pinned'/);
  assert.match(page, /hour: '2-digit', minute: '2-digit'/);
  assert.match(page, /day: '2-digit', month: '2-digit'/);
  assert.match(page, /timeZone: 'Asia\/Ho_Chi_Minh'/);
});
