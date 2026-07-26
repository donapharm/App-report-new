'use strict';

function isExplicitlyEnabled(value) {
  return String(value ?? '').trim() === '1';
}

function salesReportSchedulePolicy(env = {}) {
  const masterEnabled = isExplicitlyEnabled(env.SALES_REPORT_NOTIFY);
  return {
    masterEnabled,
    dailyEnabled: masterEnabled && isExplicitlyEnabled(env.SALES_REPORT_DAILY_NOTIFY),
  };
}

module.exports = { isExplicitlyEnabled, salesReportSchedulePolicy };
