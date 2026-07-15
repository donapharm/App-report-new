#!/usr/bin/env node
/** Dry-run only: compare App Report local seed assignments with Data Hub catalog baseline. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const reportRoot = path.resolve(__dirname, '..', '..');
const hubRoot = process.env.DATA_HUB_REPO || path.resolve(reportRoot, '..', 'data-hub-smart-app');
const assignmentsPath = path.join(reportRoot, 'server', 'data', 'assignments.json');
const catalogPath = path.join(hubRoot, 'server', 'data', 'vault', 'sales_catalog_full.json');
const outPath = process.argv[2] || path.join(reportRoot, 'artifacts', 'catalog_assignment_reconcile_phase1.json');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const text = (v) => String(v || '').trim();
const local = read(assignmentsPath);
const catalogFile = read(catalogPath); const catalog = catalogFile.rows || [];
const countBy = (rows, key) => Object.fromEntries([...rows.reduce((m, r) => m.set(r[key] ?? '', (m.get(r[key] ?? '') || 0) + 1), new Map())].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'vi')));

const localOwners = new Map();
for (const row of local) {
  const key = `${row.type}\u0000${text(row.value)}\u0000${text(row.from_ky)}`;
  const owners = localOwners.get(key) || new Set(); owners.add(text(row.emp_code)); localOwners.set(key, owners);
}
const localConflicts = [...localOwners].filter(([, owners]) => owners.size > 1).map(([key, owners]) => {
  const [type, value, from_ky] = key.split('\u0000'); return { type, value, from_ky, owners: [...owners].sort() };
});

const pairs = new Map(); const qlnbOwners = new Map(); const unitOwners = new Map(); const routeOwners = new Map();
for (const row of catalog) {
  const unit = text(row.c7); const qlnb = text(row.c5); const emp = text(row.c6).toUpperCase(); const route = text(row.c3);
  if (qlnb && emp) { const set = qlnbOwners.get(qlnb) || new Set(); set.add(emp); qlnbOwners.set(qlnb, set); }
  if (unit && emp) { const set = unitOwners.get(unit) || new Set(); set.add(emp); unitOwners.set(unit, set); }
  if (route && emp) { const set = routeOwners.get(route) || new Set(); set.add(emp); routeOwners.set(route, set); }
  if (!unit || !qlnb) continue;
  const key = `${unit}\u001f${qlnb}`; const rec = pairs.get(key) || { unit_code: unit, qlnb_code: qlnb, route, owners: new Set(), rows: 0 };
  if (emp) rec.owners.add(emp); rec.rows += 1; pairs.set(key, rec);
}
const pairConflicts = [...pairs.values()].filter((x) => x.owners.size > 1).map((x) => ({ unit_code: x.unit_code, qlnb_code: x.qlnb_code, owners: [...x.owners].sort(), rows: x.rows }));
const missingOwnerPairs = [...pairs.values()].filter((x) => x.owners.size === 0).map((x) => ({ unit_code: x.unit_code, qlnb_code: x.qlnb_code, route: x.route }));
const multi = (map) => [...map].filter(([, owners]) => owners.size > 1);
const supportedLocal = local.filter((r) => ['iit', 'unit', 'route'].includes(r.type));
const unsupportedLocal = local.filter((r) => ['all', 'group', 'special'].includes(r.type));
const checksum = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const result = {
  generatedAt: new Date().toISOString(), dryRun: true, writesPerformed: 0,
  sources: { appReportAssignments: assignmentsPath, dataHubCatalog: catalogPath, catalogVersion: catalogFile.version, catalogChecksum: catalogFile.checksum },
  appReportLocal: {
    total: local.length, byType: countBy(local, 'type'), bySource: countBy(local, 'source'), byFromPeriod: countBy(local, 'from_ky'),
    conflictingKeys: localConflicts.length, conflictExamples: localConflicts.slice(0, 30),
    mechanicallyMappableButUnsafe: supportedLocal.length,
    unsupportedOrSemanticallyUnsafe: unsupportedLocal.length,
    note: 'Local rows are auto-seeded from sales history, not authoritative handover history.'
  },
  dataHubCatalog: {
    rows: catalog.length, uniqueQlnb: qlnbOwners.size, uniqueUnits: unitOwners.size, uniqueUnitQlnbPairs: pairs.size,
    qlnbWithMultipleEmployees: multi(qlnbOwners).length, unitsWithMultipleEmployees: multi(unitOwners).length, routesWithMultipleEmployees: multi(routeOwners).length,
    unitQlnbPairsWithMultipleEmployees: pairConflicts.length, unitQlnbPairsMissingEmployee: missingOwnerPairs.length,
    pairConflictExamples: pairConflicts.slice(0, 30), missingOwnerExamples: missingOwnerPairs.slice(0, 30)
  },
  decision: {
    migrateLocal1808: false,
    baselineSource: 'Data Hub sales_catalog_full C6 projected by exact (C7 unit + C5 QLNB) pair',
    eventSource: 'unit_assignments append-only from the approved effective month',
    precedence: ['unit_qlnb', 'qlnb', 'don_vi', 'route', 'all', 'catalog_c6'],
    reason: 'QLNB-only and unit-only assignments are ambiguous; exact unit+QLNB pairs are collision-free in the current catalog.'
  }
};
result.resultChecksum = checksum(result);
fs.mkdirSync(path.dirname(outPath), { recursive: true }); fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ output: outPath, checksum: result.resultChecksum, local: result.appReportLocal, catalog: result.dataHubCatalog, decision: result.decision }, null, 2));
