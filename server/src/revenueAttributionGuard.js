const VALID_EMP = /^(DN|VP)\d{3}$/;

function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

function pairKey(row = {}) {
  return `${upper(row.unit_code)}\u001f${upper(row.qlnb_code ?? row.iit_code)}`;
}

function activeIn(row, period) {
  return row.active !== false
    && String(row.effective_from || '') <= period
    && (!row.effective_to || String(row.effective_to) >= period);
}

/**
 * Fail-safe attribution guard.
 *
 * App Report never guesses or remaps a source employee to another employee.
 * When a valid source emp_code conflicts with the current authoritative
 * unit+QLNB roster, quarantine the row as UNALLOCATED until App Sale fixes the
 * source export. Company totals remain unchanged and no employee sees another
 * employee's conflicting revenue.
 */
function quarantineRosterConflicts(rows = [], snapshot = {}, period, now = new Date().toISOString()) {
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period))) {
    throw new Error(`INVALID_ROSTER_PERIOD:${period || ''}`);
  }
  if (!Array.isArray(snapshot.rows) || !snapshot.rows.length) {
    throw new Error('ROSTER_SNAPSHOT_EMPTY');
  }

  const roster = new Map();
  for (const row of snapshot.rows.filter((item) => activeIn(item, period))) {
    const key = pairKey(row);
    if (key === '\u001f') continue;
    if (roster.has(key)) throw new Error(`ROSTER_PAIR_DUPLICATE:${key}`);
    roster.set(key, row);
  }
  if (!roster.size) throw new Error(`ROSTER_PERIOD_EMPTY:${period}`);

  const conflicts = [];
  const guardedRows = rows.map((row, index) => {
    const expected = roster.get(pairKey(row));
    const actualEmp = upper(row.emp_code);
    const expectedEmp = upper(expected?.emp_code);
    if (!expected || !VALID_EMP.test(actualEmp) || actualEmp === expectedEmp) return row;

    conflicts.push({
      index,
      source_line_id: row.source_line_id || null,
      source_order: row.source_order || null,
      unit_code: row.unit_code || null,
      iit_code: row.iit_code || row.qlnb_code || null,
      from_emp: actualEmp,
      expected_emp: expectedEmp,
      revenue: Number(row.revenue || 0),
    });
    return {
      ...row,
      raw_emp_code: row.raw_emp_code || row.emp_code,
      emp_code: 'UNALLOCATED',
      emp_name: 'Chưa phân bổ',
      attribution_status: 'ROSTER_CONFLICT_QUARANTINED',
      attribution_quarantined_at: now,
    };
  });

  return {
    rows: guardedRows,
    conflicts,
    summary: {
      rows: conflicts.length,
      units: new Set(conflicts.map((row) => row.unit_code)).size,
      revenue: conflicts.reduce((sum, row) => sum + row.revenue, 0),
    },
  };
}

module.exports = { quarantineRosterConflicts, pairKey, activeIn };
