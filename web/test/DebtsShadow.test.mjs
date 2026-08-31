import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isTabAllowed } from '../src/tabAccess.js';

const page = fs.readFileSync(new URL('../src/pages/DebtsShadow.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const api = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../../server/src/debtsShadowService.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/src/routes.js', import.meta.url), 'utf8');

test('tab Công nợ là CEO-only và backend giữ requireCeo', () => {
  assert.match(app, /key: 'debtsShadow'[\s\S]{0,180}ceoOnly: true/);
  assert.equal(isTabAllowed({ key: 'debtsShadow', ceoOnly: true }, { is_ceo: true }), true);
  assert.equal(isTabAllowed({ key: 'debtsShadow', ceoOnly: true }, { isAdmin: true, is_ceo: false }), false);
  assert.match(routes, /\/admin\/debts-shadow\/preview', auth\.requireAuth, auth\.requireCeo/);
});

test('UI chỉ preview, hiển thị provenance/quarantine và không có publish API', () => {
  assert.match(page, /Chưa publish, không ghi snapshot/);
  assert.match(page, /data\.persisted \? 'CÓ' : 'KHÔNG'/);
  assert.match(page, /quarantineReasonCounts/);
  assert.match(page, /quarantineRows/);
  assert.match(page, /Xuất CSV quarantine/);
  assert.doesNotMatch(api, /debtsShadowPublish/);
});

test('API client dùng đúng route preview/readiness và service chỉ trả whitelist chi tiết', () => {
  assert.match(api, /debtsShadowReadiness:[\s\S]{0,180}\/admin\/debts-shadow\/readiness/);
  assert.match(api, /debtsShadowPreview:[\s\S]{0,220}\/admin\/debts-shadow\/preview/);
  assert.match(service, /quarantineReasonCounts/);
  assert.match(service, /sourceLineId: row\.source_line_id/);
  assert.doesNotMatch(service, /quarantineRows:[\s\S]{0,800}source_before_vat_raw/);
});
