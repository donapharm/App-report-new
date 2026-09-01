'use strict';

const crypto = require('node:crypto');
const shadow = require('./debtsInvoiceShadow');

const PROFILE = 'production';
const CONTRACTOR_TO_ENTITY = Object.freeze({ '01.DONA': 'DONA', '02.AFP': 'AFP' });

function clean(value, max = 240) { return String(value ?? '').normalize('NFC').trim().slice(0, max); }
function upper(value, max) { return clean(value, max).toUpperCase(); }
function digest(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function fail(code) { const error = new Error(code); error.code = code; throw error; }

function build(snapshot, period) {
  const expectedPeriod = clean(period, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(expectedPeriod) || !snapshot || snapshot.period !== expectedPeriod
    || !Array.isArray(snapshot.rows) || !snapshot.rows.length) fail('DEBTS_CATALOG_SNAPSHOT_INVALID');
  const sourceVersion = clean(snapshot.meta?.sourceVersion, 80);
  const sourceChecksum = clean(snapshot.meta?.checksum, 80).toLowerCase().replace(/^sha256:/, '');
  const snapshotVersion = clean(snapshot.meta?.version, 80);
  if (!sourceVersion || !snapshotVersion || !/^[a-f0-9]{64}$/.test(sourceChecksum)) fail('DEBTS_CATALOG_IDENTITY_INVALID');

  const grouped = new Map();
  for (const row of snapshot.rows) {
    if (row?.active === false || (row?.effective_from && row.effective_from > expectedPeriod)
      || (row?.effective_to && row.effective_to < expectedPeriod)) continue;
    const legalEntity = CONTRACTOR_TO_ENTITY[upper(row?.contractor_code, 80)];
    const unitCode = upper(row?.unit_code, 180); const qlnbCode = upper(row?.qlnb_code, 180);
    const employeeCode = upper(row?.emp_code, 80); const uom = upper(row?.uom, 100);
    if (!legalEntity || !unitCode || !qlnbCode || !employeeCode || !uom) continue;
    const key = `${legalEntity}|${unitCode}|${qlnbCode}`; const group = grouped.get(key) || new Map();
    const candidateKey = `${employeeCode}|${uom}`;
    if (!group.has(candidateKey)) group.set(candidateKey, { employeeCode, uom,
      sourceLineId: clean(row.id, 240) || digest(`${key}|${candidateKey}`) });
    grouped.set(key, group);
  }
  if (!grouped.size) fail('DEBTS_CATALOG_MAPPING_EMPTY');
  const rows = [...grouped].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, group]) => {
    const [legalEntity, unitCode, qlnbCode] = key.split('|');
    const candidates = [...group.values()].sort((a, b) => `${a.employeeCode}|${a.uom}`.localeCompare(`${b.employeeCode}|${b.uom}`, 'en'));
    return { legalEntity, unitCode, qlnbCode, candidates,
      employeeConflict: new Set(candidates.map((item) => item.employeeCode)).size > 1,
      uomConflict: new Set(candidates.map((item) => item.uom)).size > 1 };
  });
  const partitionRows = rows.map((row) => ({ legal_entity: row.legalEntity,
    source_legal_entity_code: row.legalEntity === 'DONA' ? '01.DONA' : '02.AFP', unit_code: row.unitCode, qlnb_code: row.qlnbCode }));
  const legalEntityRows = partitionRows.reduce((counts, row) => { counts[row.legal_entity] = (counts[row.legal_entity] || 0) + 1; return counts; }, {});
  const declaredCounts = { mappingRows: rows.length, legalEntityRows };
  return { version: `catalog-direct-${sourceVersion}/${snapshotVersion}`,
    sourceManifestId: `app-report-catalog:${expectedPeriod}:${sourceVersion}`, sourceManifestChecksum: sourceChecksum,
    profile: PROFILE, declaredCounts, checksum: shadow.mappingArtifactChecksum(rows, declaredCounts, PROFILE),
    contract: { unitCodeColumn: 'c7', qlnbColumn: 'c5', employeeColumn: 'c6', uomColumn: 'c25', uomMode: 'validation' }, rows,
    legalEntityAttestation: { contract: shadow.LEGAL_ENTITY_CONTRACT_KIND, checksum: digest(shadow.canonicalJson(partitionRows)), rows: partitionRows } };
}

module.exports = { build };
