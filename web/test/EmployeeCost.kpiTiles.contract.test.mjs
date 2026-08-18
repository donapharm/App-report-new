import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  employeeCostColumnKpis,
  employeeCostViewModel,
  formatEmployeeCostCell,
} from '../src/employeeCostModel.js';
import { EmployeeCostKpiTiles } from '../src/employeeCostKpiTiles.js';

const config = JSON.parse(fs.readFileSync(new URL('../../server/config/employee_cost_templates.json', import.meta.url), 'utf8'));
const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');

function templateOf(key) {
  const template = config.displayTemplates.find((item) => item.key === key);
  assert.ok(template, `thiếu template ${key} trong employee_cost_templates.json`);
  return template;
}

function emptySourceModel(key) {
  const template = templateOf(key);
  return employeeCostViewModel({
    empCode: key === 'parttime' ? 'DN021' : 'DN001',
    from: '2026-08',
    to: '2026-08',
    template,
    columns: [],
    rows: [],
    summary: {
      reliable: false,
      monthlyTotal: null,
      annualTotal: null,
      columnTotals: null,
      provisionalColumnTotals: null,
      annualColumnKeys: [],
    },
  });
}

test('KPI tiles contract lock: nguồn chết vẫn giữ đúng bộ ô theo config và không bịa 0', () => {
  for (const key of ['fulltime', 'parttime']) {
    const expected = Object.keys(templateOf(key).costLabels);
    const model = emptySourceModel(key);
    const kpis = employeeCostColumnKpis(model);
    assert.deepEqual(kpis.map((item) => item.key), expected);
    assert.deepEqual(kpis.map((item) => item.label), expected.map((costKey) => templateOf(key).costLabels[costKey]));
    assert.ok(kpis.every((item) => item.value === null), `${key}: thiếu số phải là null`);
    assert.ok(kpis.every((item) => formatEmployeeCostCell(item.value, { kind: 'money' }) === '—'), `${key}: thiếu số phải hiện —`);
  }
});

test('KPI tiles render contract lock: cụm ô và lý do không được biến mất khi columns rỗng', () => {
  const items = employeeCostColumnKpis(emptySourceModel('fulltime'));
  const html = renderToStaticMarkup(React.createElement(EmployeeCostKpiTiles, {
    items,
    fallback: true,
    renderTile: (item) => React.createElement('article', { key: item.key, 'data-kpi-key': item.key }, item.value ?? '—'),
  }));
  assert.equal((html.match(/data-kpi-key=/g) || []).length, Object.keys(templateOf('fulltime').costLabels).length);
  assert.match(html, /role="status"/);
  assert.match(html, /Chưa lấy được tỷ lệ chi phí ở lượt này/);
  assert.match(html, /Doanh thu và bảng vẫn đúng/);
  assert.match(page, /<EmployeeCostKpiTiles items=\{columnKpis\} fallback=\{model\.costColumnsFallback\}/);
});
