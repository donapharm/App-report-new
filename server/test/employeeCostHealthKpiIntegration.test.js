'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const routesSource = fs.readFileSync(path.join(__dirname, '../src/routes.js'), 'utf8');
const storeSource = fs.readFileSync(path.join(__dirname, '../src/store.js'), 'utf8');

test('route ALL chụp cùng snapshot trước/sau và chỉ forecast từ payload đã cân', () => {
  assert.match(routesSource, /healthSnapshotBefore\s*=\s*store\.activeDataSignature\(\)/);
  assert.match(routesSource, /healthSnapshotAfter\s*=\s*store\.activeDataSignature\(\)/);
  assert.match(routesSource, /snapshotConsistent:\s*healthSnapshotBefore\s*===\s*healthSnapshotAfter/);
  assert.match(routesSource, /merged\.healthKpis\s*=\s*employeeCostHealthKpis\.buildEmployeeCostHealthKpis/);
});

test('memo ALL ký cả ngày Việt Nam và kho sync exception của KPI', () => {
  assert.match(routesSource, /`vn-day=\$\{employeeCost\.vnToday\(\)\}`/);
  assert.match(storeSource, /sync_exceptions\.json[\s\S]*?'sync-exceptions'/);
});

test('employeeCostDataSignature đổi khi kho sync exception đổi', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'employee-cost-health-signature-'));
  const oldDir = process.env.AUTH_DATA_DIR;
  try {
    process.env.AUTH_DATA_DIR = temp;
    const store = require('../src/store');
    const before = store.employeeCostDataSignature();
    fs.writeFileSync(path.join(temp, 'sync_exceptions.json'), '{}');
    const afterCreate = store.employeeCostDataSignature();
    fs.writeFileSync(path.join(temp, 'sync_exceptions.json'), '{"2026-08":{}}');
    const afterChange = store.employeeCostDataSignature();
    assert.notEqual(afterCreate, before);
    assert.notEqual(afterChange, afterCreate);
  } finally {
    if (oldDir == null) delete process.env.AUTH_DATA_DIR;
    else process.env.AUTH_DATA_DIR = oldDir;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
