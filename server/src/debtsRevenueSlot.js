'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { writeJsonAtomic, acquireFileLock } = require('./materializeFileSafety');
const policy = require('./groupDonaRevenuePolicy');
const cutover = require('./debtsRevenueCutover');

function fail(code, details = {}) { const error = new Error(code); error.code = code; error.details = details; throw error; }
function checksum(rows) { return createHash('sha256').update(cutover.canonical(rows)).digest('hex'); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function uiPeriod(period) { const p = policy.normalizePeriod(period); return p ? `${p.slice(5)}.${p.slice(0, 4)}` : ''; }
function paths(dataDir) { const root = path.resolve(String(dataDir || '')); return { root, uploads: path.join(root, 'uploads'),
  slots: path.join(root, 'upload_slots.json'), audit: path.join(root, 'audit.json'), lock: path.join(root, 'revenue_materialize.lock') }; }

function compose({ period, currentRows = [], debts } = {}) {
  const normalized = policy.normalizePeriod(period);
  if (!policy.isCutoverPeriod(normalized) || !debts || debts.period !== normalized) fail('DEBTS_SLOT_PERIOD_INVALID');
  if (!Array.isArray(currentRows) || currentRows.some((row) => String(row?.source || '').toUpperCase() !== 'APP_WEB_PARTNER'
    || policy.isGroupDona(row) || !String(row?.source_line_id || '').trim())) fail('DEBTS_SLOT_PARTNER_PARTITION_INVALID');
  if (!Array.isArray(debts.rows) || debts.rows.some((row) => String(row?.source || '').toUpperCase() !== 'DEBTS_INVOICE_SHADOW'
    || !policy.isGroupDona(row) || !String(row?.source_line_id || '').trim())) fail('DEBTS_SLOT_GROUP_DONA_PARTITION_INVALID');
  const retained = currentRows.slice();
  const rows = [...retained, ...debts.rows];
  const forbidden = rows.filter((row) => policy.isGroupDona(row) && String(row.source || '').toUpperCase() !== 'DEBTS_INVOICE_SHADOW');
  if (forbidden.length) fail('DEBTS_SLOT_CRM_LEAK');
  const partnerIds = new Set(retained.map((row) => String(row.source_line_id)));
  const debtIds = new Set(debts.rows.map((row) => String(row.source_line_id)));
  const partitionOverlapCount = [...partnerIds].filter((id) => debtIds.has(id)).length;
  if (partitionOverlapCount) fail('DEBTS_SLOT_DUPLICATE_LINE_ID', { partitionOverlapCount });
  const ids = rows.map((row) => String(row.source_line_id));
  if (new Set(ids).size !== ids.length) fail('DEBTS_SLOT_DUPLICATE_LINE_ID', { partitionOverlapCount });
  const partnerRowsChecksum = checksum(retained); const compositeRowsChecksum = checksum(rows);
  return Object.freeze({ period: normalized, ky: uiPeriod(normalized), rows: Object.freeze(rows),
    debtsRowsChecksum: debts.rowsChecksum, debtsSourceReceipts: debts.sourceReceipts, retainedPartnerRows: retained.length,
    partnerRowsChecksum, compositeRowsChecksum, partitionOverlapCount });
}

function publish(composed, { dataDir, now = () => new Date(), idFactory = () => randomUUID() } = {}) {
  if (!composed || !policy.isCutoverPeriod(composed.period) || composed.ky !== uiPeriod(composed.period) || !Array.isArray(composed.rows)) fail('DEBTS_SLOT_PAYLOAD_INVALID');
  const loc = paths(dataDir); fs.mkdirSync(loc.uploads, { recursive: true });
  const release = acquireFileLock(loc.lock);
  try {
    const registry = readJson(loc.slots, []);
    if (!Array.isArray(registry)) fail('DEBTS_SLOT_REGISTRY_INVALID');
    const active = registry.find((slot) => slot.ky === composed.ky && slot.active) || null;
    if (active?.source === 'DEBTS_ONLY_GROUP_DONA' && active.debtsRowsChecksum === composed.debtsRowsChecksum
      && active.partnerRowsChecksum === composed.partnerRowsChecksum
      && active.compositeRowsChecksum === composed.compositeRowsChecksum
      && active.retainedPartnerRows === composed.retainedPartnerRows) return Object.freeze({ skipped: 'unchanged', slot: active });
    const at = now(); const id = `slot_${composed.ky.replace('.', '')}_debts_${String(idFactory()).replace(/[^A-Za-z0-9-]/g, '')}`;
    if (!/^slot_\d{6}_debts_[A-Za-z0-9-]+$/.test(id) || registry.some((slot) => slot.id === id)) fail('DEBTS_SLOT_ID_INVALID');
    const file = path.join(loc.uploads, `${id}.json`); if (fs.existsSync(file)) fail('DEBTS_SLOT_ID_INVALID');
    writeJsonAtomic(file, composed.rows);
    const totalRevenue = composed.rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
    const slot = { id, ky: composed.ky, dateFrom: `${composed.period}-01`, dateTo: `${composed.period}-${String(new Date(Date.UTC(Number(composed.period.slice(0,4)), Number(composed.period.slice(5,7)), 0)).getUTCDate()).padStart(2,'0')}`,
      totalRows: composed.rows.length, totalRevenue, empCount: new Set(composed.rows.map((row) => row.emp_code).filter(Boolean)).size,
      filename: `${id}.json`, uploadedBy: 'SYSTEM_DEBTS', uploadedByName: 'App Công nợ → App Report', uploadedAt: at.toISOString(), jobRunAt: at.toISOString(), activatedAt: at.toISOString(),
      active: true, mode: active ? 'update' : 'new', replacedSlotId: active?.id || null, source: 'DEBTS_ONLY_GROUP_DONA',
      debtsRowsChecksum: composed.debtsRowsChecksum, debtsSourceReceipts: composed.debtsSourceReceipts,
      retainedPartnerRows: composed.retainedPartnerRows, partnerRowsChecksum: composed.partnerRowsChecksum,
      compositeRowsChecksum: composed.compositeRowsChecksum, partitionOverlapCount: composed.partitionOverlapCount,
      selectorPolicy: 'GROUP_DONA_DEBTS_FROM_2026_09' };
    writeJsonAtomic(loc.slots, [...registry.map((item) => item.ky === composed.ky ? { ...item, active: false } : item), slot]);
    const audit = readJson(loc.audit, []); if (!Array.isArray(audit)) fail('DEBTS_SLOT_AUDIT_INVALID');
    writeJsonAtomic(loc.audit, [...audit, { at: slot.uploadedAt, by: slot.uploadedBy, action: 'debts_group_dona_cutover', ky: slot.ky,
      slotId: slot.id, replacedSlotId: slot.replacedSlotId, rows: slot.totalRows, revenue: slot.totalRevenue,
      debtsRowsChecksum: slot.debtsRowsChecksum, partnerRowsChecksum: slot.partnerRowsChecksum,
      compositeRowsChecksum: slot.compositeRowsChecksum, partitionOverlapCount: slot.partitionOverlapCount }]);
    return Object.freeze({ skipped: null, slot });
  } finally { release(); }
}

module.exports = { paths, compose, publish };
