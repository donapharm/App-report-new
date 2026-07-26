'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { salesReportSchedulePolicy } = require('../src/salesReportSchedulePolicy');

test('SalesReport scheduler fail-closed khi thiếu hoặc dùng giá trị không chính xác 1', () => {
  for (const value of [undefined, '', '0', 'true', 'yes', ' 0 ']) {
    assert.deepEqual(salesReportSchedulePolicy({ SALES_REPORT_NOTIFY: value }), {
      masterEnabled: false,
      dailyEnabled: false,
    });
  }
});

test('daily phải được bật riêng, không đi theo master', () => {
  assert.deepEqual(salesReportSchedulePolicy({ SALES_REPORT_NOTIFY: '1' }), {
    masterEnabled: true,
    dailyEnabled: false,
  });
  assert.deepEqual(salesReportSchedulePolicy({ SALES_REPORT_NOTIFY: '1', SALES_REPORT_DAILY_NOTIFY: '1' }), {
    masterEnabled: true,
    dailyEnabled: true,
  });
});
