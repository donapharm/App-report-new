'use strict';
const fs = require('node:fs');
const path = require('node:path');
const bridge = require('../src/catalog52CustodyBridge');
const viewer = require('../src/catalog52EncryptedViewer');

function loadEnv(file) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/); if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}
async function main() {
  loadEnv(path.join(__dirname, '..', '..', '.env'));
  const period = process.argv[2]; const actor = process.argv[3] || 'CEO';
  const keyPath = process.env.CATALOG52_DATAHUB_KEY_FILE || '/home/osboxes/.openclaw/secrets/datahub-full52-app-report.key';
  const secret = fs.readFileSync(keyPath, 'utf8').trim();
  const source = await bridge.pullSource({ period, baseUrl: process.env.DATA_HUB_BASE_URL, client: process.env.CATALOG52_DATAHUB_CLIENT || 'app-report-ceo', secret });
  const result = bridge.buildCostProjection({ root: process.env.CATALOG52_STORE_ROOT || viewer.DEFAULT_ROOT, source, actor });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
main().catch((error) => { process.stderr.write(`${error.code || 'CATALOG52_COST_PROJECTION_FAILED'}\n`); process.exitCode = 1; });
