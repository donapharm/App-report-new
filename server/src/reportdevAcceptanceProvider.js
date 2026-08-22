'use strict';

const store = require('./store');
const employeeCostRoster = require('./employeeCostRoster');
const accessPolicy = require('./accessPolicy');
const employeeIncentivePolicy = require('./employeeIncentivePolicy');
const revenueRecon = require('./employeeCostRevenueRecon');

const PERIOD_TO_KY = Object.freeze({ '2026-07': '07.2026', '2026-08': '08.2026' });
const upper = (value) => String(value || '').trim().toUpperCase();
const amount = (row) => Number(row?.revenue ?? row?.tong_tien ?? row?.REVENUE ?? row?.TONG_TIEN ?? 0) || 0;
const quarantined = (row) => upper(row?.raw_emp_code ?? row?.rawEmpCode) === 'VP018'
  || upper(row?.attribution_status ?? row?.attributionStatus) === 'NON_SALES_ROLE_QUARANTINED';

function createAcceptanceProvider(deps = {}) {
  const source = deps.store || store;
  const rosterBuilder = deps.rosterBuilder || employeeCostRoster.buildRoster;
  const blocked = deps.isLoginBlocked || accessPolicy.isLoginBlocked;
  const targetOnly = deps.isTargetOnlyEmployee || employeeIncentivePolicy.isTargetOnlyEmployee;
  const buildRecon = deps.buildRevenueRecon || revenueRecon.buildRevenueRecon;

  return async function loadCounters(period) {
    const ky = PERIOD_TO_KY[period];
    if (!ky) throw Object.assign(new Error('ACCEPTANCE_PERIOD_FORBIDDEN'), { code: 'ACCEPTANCE_PERIOD_FORBIDDEN' });
    const roster = rosterBuilder(source.targetRoster({ scope: {} })).filter((item) => !blocked(item.emp_code));
    const rosterCodes = new Set(roster.map((item) => upper(item.emp_code)));
    const rows = source.getRows({ ky, scope: {} });
    const shownRows = rows.filter((row) => rosterCodes.has(upper(row.emp_code))
      && !targetOnly(row.emp_code) && !quarantined(row));
    const shownRevenue = shownRows.reduce((sum, row) => sum + amount(row), 0);
    const recon = buildRecon({
      periods: [period], revenueRowsOf: () => rows, unavailable: [], roster,
      shownRevenue, shownRows,
    });
    return {
      activeRows: rows.length,
      employeeCount: roster.length,
      targetOnlyAmount: recon.targetOnlyAmount,
      nonSalesRoleQuarantinedAmount: recon.nonSalesRoleQuarantinedAmount,
      balanced: recon.balanced,
    };
  };
}

module.exports = { PERIOD_TO_KY, createAcceptanceProvider };
