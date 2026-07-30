const fs = require('fs');
const crypto = require('crypto');

const REVENUE_SEMANTIC_VERSION = 1;
const VOLATILE_SEMANTIC_FIELDS = new Set([
  'slotid', 'generatedat', 'uploadedat', 'materializedat', 'dataasof',
]);

// Hash exactly the bytes produced by writeJsonAtomic(rows), but incrementally:
// this avoids allocating another full multi-MiB JSON string beside the rows.
function hashPrettyJsonArray(rows = []) {
  const hash = crypto.createHash('sha256');
  if (!rows.length) {
    hash.update('[]\n');
    return hash.digest('hex');
  }
  hash.update('[\n');
  rows.forEach((row, index) => {
    const pretty = JSON.stringify(row, null, 2).replace(/^/gm, '  ');
    hash.update(pretty);
    hash.update(index === rows.length - 1 ? '\n' : ',\n');
  });
  hash.update(']\n');
  return hash.digest('hex');
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(file);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function canonicalRevenueValue(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalRevenueValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return Object.is(value, -0) ? 0 : value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (VOLATILE_SEMANTIC_FIELDS.has(normalized) || value[key] === undefined) continue;
    out[key] = canonicalRevenueValue(value[key]);
  }
  return out;
}

function semanticRevenueRowsHash(rows = []) {
  if (!Array.isArray(rows)) return null;
  // SQL order and object insertion order are not revenue meaning. Keep only a
  // 64-byte digest per row while sorting, rather than retaining another full
  // canonical copy of a potentially giant revenue payload in RAM.
  const canonicalRows = rows.map((row) => crypto.createHash('sha256')
    .update(JSON.stringify(canonicalRevenueValue(row))).digest('hex')).sort();
  const hash = crypto.createHash('sha256');
  hash.update(`rows:${canonicalRows.length};`);
  for (const row of canonicalRows) hash.update(`${Buffer.byteLength(row)}:${row};`);
  return hash.digest('hex');
}

async function equivalentToActiveSlot({ rows, activeSlot, uploadsDir }) {
  const candidateSha256 = hashPrettyJsonArray(rows);
  if (!activeSlot?.filename) return {
    equivalent: false, candidateSha256, candidateSemanticSha256: semanticRevenueRowsHash(rows),
    activeSha256: null, activeSemanticSha256: null,
  };
  const path = require('path');
  const activeFile = path.join(uploadsDir, path.basename(String(activeSlot.filename)));
  let activeSha256 = String(activeSlot.payloadSha256 || '');
  let activeSemanticSha256 = Number(activeSlot.payloadSemanticVersion) === REVENUE_SEMANTIC_VERSION
    ? String(activeSlot.payloadSemanticSha256 || '') : '';
  let activeBytes = null;
  if (activeSemanticSha256 && activeSha256) {
    try {
      const diskSha256 = await hashFile(activeFile);
      if (diskSha256 !== activeSha256) {
        return { equivalent: false, candidateSha256, candidateSemanticSha256: semanticRevenueRowsHash(rows), activeSha256: diskSha256, activeSemanticSha256: null, activeFile, activeFileChanged: true };
      }
    } catch {
      return { equivalent: false, candidateSha256, candidateSemanticSha256: semanticRevenueRowsHash(rows), activeSha256: null, activeSemanticSha256: null, activeFile };
    }
  } else {
    try {
      activeBytes = await fs.promises.readFile(activeFile);
      if (!activeSha256) activeSha256 = crypto.createHash('sha256').update(activeBytes).digest('hex');
    } catch {
      return { equivalent: false, candidateSha256, candidateSemanticSha256: semanticRevenueRowsHash(rows), activeSha256: activeSha256 || null, activeSemanticSha256: null, activeFile };
    }
  }
  // Normal materializer output is deterministic. Exact equality can reuse the
  // persisted semantic identity (or calculate it once for a legacy manifest)
  // without canonicalizing every candidate row again.
  if (candidateSha256 === activeSha256) {
    const semantic = activeSemanticSha256 || semanticRevenueRowsHash(rows);
    return {
      equivalent: true, candidateSha256, candidateSemanticSha256: semantic,
      activeSha256, activeSemanticSha256: semantic, activeFile,
    };
  }
  const candidateSemanticSha256 = semanticRevenueRowsHash(rows);
  if (!activeSemanticSha256) {
    try {
      activeBytes ||= await fs.promises.readFile(activeFile);
      activeSemanticSha256 = semanticRevenueRowsHash(JSON.parse(activeBytes.toString('utf8')));
    } catch {
      return { equivalent: false, candidateSha256, candidateSemanticSha256, activeSha256: activeSha256 || null, activeSemanticSha256: null, activeFile };
    }
  }
  return {
    equivalent: candidateSemanticSha256 === activeSemanticSha256,
    candidateSha256,
    candidateSemanticSha256,
    activeSha256: activeSha256 || null,
    activeSemanticSha256,
    activeFile,
  };
}

module.exports = {
  REVENUE_SEMANTIC_VERSION,
  VOLATILE_SEMANTIC_FIELDS,
  hashPrettyJsonArray,
  hashFile,
  canonicalRevenueValue,
  semanticRevenueRowsHash,
  equivalentToActiveSlot,
};
