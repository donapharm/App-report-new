'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { OUT_DIR } = require('../src/report/deckReportV2');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
for (const kind of ['TUAN', 'THANG']) {
  const manifestPath = fs.readdirSync(OUT_DIR).filter((x) => x.includes(`_${kind}_`) && x.endsWith('.manifest.json')).sort().at(-1);
  assert(manifestPath, `Missing ${kind} manifest`); const m = JSON.parse(fs.readFileSync(path.join(OUT_DIR, manifestPath)));
  assert.equal(m.schemaVersion, 2); assert.equal(m.slides, 32); assert.equal(m.draft, true); assert.equal(m.render.width, 1920); assert.equal(m.render.height, 1080); assert.equal(m.rotation.libraryCount, 20); assert.notEqual(m.rotation.coverPhotoIndex, m.rotation.endPhotoIndex);
  const html = path.join(OUT_DIR, m.files.html.name), pptx = path.join(OUT_DIR, m.files.pptx.name); assert(fs.existsSync(html) && fs.existsSync(pptx)); assert.equal(sha(html), m.files.html.sha256); assert.equal(sha(pptx), m.files.pptx.sha256); assert.equal((fs.readFileSync(html, 'utf8').match(/data-slide=\"/g) || []).length, 32);
  const names = execFileSync('unzip', ['-Z1', pptx], { encoding: 'utf8' }).trim().split('\n'); assert.equal(names.filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x)).length, 32); assert.equal(names.filter((x) => /^ppt\/media\/image-\d+-1\.png$/.test(x)).length, 32);
  execFileSync('unzip', ['-t', pptx], { stdio: 'ignore' });
}
console.log('OK CEO deck V2 artifacts: hashes + 32 slides + 1920x1080 render metadata');
