'use strict';

// Out-of-process projector for the full C1-C52 payload.  The serving API only
// streams source bytes to a private inbox; JSON parse/projection RSS lives here.
const fs = require('node:fs');
const { createStore, MAX_SOURCE_BYTES } = require('../src/catalog52SnapshotStore');

function main() {
  let input;
  try { input = JSON.parse(process.argv[2] || ''); } catch { process.exitCode = 2; return; }
  try {
    const stat = fs.statSync(input.sourceFile);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_SOURCE_BYTES) throw new Error('source_size_invalid');
    const canonicalBytes = fs.readFileSync(input.sourceFile);
    const store = createStore({ root: input.root });
    const manifest = store.prepareCandidate({
      period: input.period, source: input.source, sourceVersion: input.sourceVersion,
      sourceVersionNo: input.sourceVersionNo, rowCount: input.rowCount, receivedAt: input.receivedAt,
      sourceIntegrityChecksum: input.sourceIntegrityChecksum, mappingContract: input.mappingContract, canonicalBytes,
    }, { activate: false, actor: input.actor });
    process.stdout.write(JSON.stringify(manifest));
  } catch { process.exitCode = 1; }
}

main();
