'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const parameters = {
  penaltyEnabled: true,
  warningFrom: '2026-07-01',
  enforcedFrom: '2026-08-01',
  dropThresholdPct: 50,
  upperPenaltyThresholdPct: 70,
  noPenaltyThresholdPct: 90,
  lowerRatePct: 0.3,
  upperRatePct: 0.2,
  bottomDropC45: true,
  bottomRatePct: 0.3,
  xuEnabled: false,
  perMissingXu: 300000,
};

const editablePeriod = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit',
}).format(new Date());

function headers(emp, role, session = 'session-a') {
  return { 'content-type': 'application/json', 'x-test-emp': emp, 'x-test-role': role, 'x-test-session': session };
}

test('HTTP penalty policy routes enforce CEO/session/single-use save with JSON errors', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'penalty-policy-http-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.EMPLOYEE_PENALTY_POLICY_FILE = path.join(dir, 'policies.json');
  process.env.EMPLOYEE_PENALTY_POLICY_AUDIT_FILE = path.join(dir, 'audit.json');
  process.env.VAT_DB_PATH = path.join(dir, 'vat.db');
  fs.writeFileSync(process.env.VAT_DB_PATH, 'fixture');

  const auth = require('../src/auth');
  auth.requireAuth = (req, res, next) => {
    req.session = {
      emp_code: String(req.headers['x-test-emp'] || ''),
      role: String(req.headers['x-test-role'] || ''),
      th: String(req.headers['x-test-session'] || ''),
    };
    next();
  };
  auth.requireAdmin = (req, res, next) => (
    auth.isAdmin(req.session.role) ? next() : res.status(403).json({ error: 'Không đủ quyền' })
  );

  const express = require('express');
  const routes = require('../src/routes');
  const policy = require('../src/employeePenaltyPolicy');
  const store = require('../src/store');
  const app = express();
  app.use(express.json());
  app.use('/api', routes);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  let response = await fetch(`${base}/admin/penalty-policies?period=${editablePeriod}`, { headers: headers('ADMIN', 'admin') });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).canEdit, false);

  response = await fetch(`${base}/admin/penalty-policies/preview`, {
    method: 'POST', headers: headers('ADMIN', 'admin'), body: JSON.stringify({}),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'PENALTY_POLICY_CEO_REQUIRED');

  const canonical = policy.preview({
    effectiveFrom: editablePeriod, previewPeriod: editablePeriod, note: 'HTTP integration', parameters,
  }, 'CEO');
  const stash = (id, sessionKey) => routes.penaltyPolicyPreviews.set(id, {
    at: Date.now(), actor: 'CEO', sessionKey,
    candidate: canonical.candidate, revision: canonical.revision, previewHash: canonical.previewHash,
    dataSignature: store.employeeCostDataSignature(),
  });

  stash('wrong-session', 'session-a');
  response = await fetch(`${base}/admin/penalty-policies`, {
    method: 'POST', headers: headers('CEO', 'ceo', 'session-b'), body: JSON.stringify({ previewId: 'wrong-session' }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PENALTY_POLICY_PREVIEW_REQUIRED');

  stash('vat-changed', 'session-a');
  fs.appendFileSync(process.env.VAT_DB_PATH, '-changed-after-preview');
  response = await fetch(`${base}/admin/penalty-policies`, {
    method: 'POST', headers: headers('CEO', 'ceo', 'session-a'), body: JSON.stringify({ previewId: 'vat-changed' }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PENALTY_POLICY_PREVIEW_DATA_CHANGED');

  stash('save-once', 'session-a');
  response = await fetch(`${base}/admin/penalty-policies`, {
    method: 'POST', headers: headers('CEO', 'ceo', 'session-a'), body: JSON.stringify({ previewId: 'save-once' }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).saved, true);
  assert.equal(policy.list().length, 1);
  assert.equal(policy.audit().length, 1);

  response = await fetch(`${base}/admin/penalty-policies`, {
    method: 'POST', headers: headers('CEO', 'ceo', 'session-a'), body: JSON.stringify({ previewId: 'save-once' }),
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PENALTY_POLICY_PREVIEW_REQUIRED');
});
