'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const identity = require('../src/releaseIdentity');

function fixture() {
  const commit = 'a'.repeat(40); const root = fs.mkdtempSync(path.join(os.tmpdir(), `release-app-report-${commit.slice(0, 7)}-`));
  fs.mkdirSync(path.join(root, 'web', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'RELEASE_IDENTITY.json'), JSON.stringify({ version: `${commit.slice(0, 7)}-build`, commit, tree: 'b'.repeat(40), builtAt: '18/08/2026 06:30:00' }));
  fs.writeFileSync(path.join(root, 'web', 'dist', 'version.json'), JSON.stringify({ version: `${commit.slice(0, 7)}-build`, commit: commit.slice(0, 7) }));
  fs.writeFileSync(path.join(root, 'release_manifest.sha256'), 'F 0644 0:0 1 deadbeef RELEASE_IDENTITY.json\n');
  return root;
}

test('bốn nguồn căn cước đồng nhất thì PASS', () => {
  const root = fixture();
  try { assert.equal(identity.validateIdentity(root).commit, 'a'.repeat(40)); } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('sai directory, web version hoặc manifest thiếu identity đều fail-closed', () => {
  let root = fixture();
  try {
    const web = path.join(root, 'web', 'dist', 'version.json');
    fs.writeFileSync(web, JSON.stringify({ version: 'wrong', commit: 'aaaaaaa' }));
    assert.throws(() => identity.validateIdentity(root), { code: 'RELEASE_IDENTITY_MISMATCH' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  root = fixture();
  try {
    fs.writeFileSync(path.join(root, 'release_manifest.sha256'), 'other-file\n');
    assert.throws(() => identity.validateIdentity(root), { code: 'RELEASE_IDENTITY_NOT_MANIFESTED' });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
