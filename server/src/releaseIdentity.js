'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

function releaseRoot() {
  return path.resolve(process.env.APP_RELEASE_ROOT || path.join(__dirname, '..', '..'));
}

function readJson(file, code) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    throw Object.assign(new Error(code), { code, cause: error });
  }
}

function validateIdentity(root = releaseRoot()) {
  const identity = readJson(path.join(root, 'RELEASE_IDENTITY.json'), 'RELEASE_IDENTITY_MISSING');
  const web = readJson(path.join(root, 'web', 'dist', 'version.json'), 'RELEASE_WEB_VERSION_MISSING');
  const manifest = path.join(root, 'release_manifest.sha256');
  if (!fs.existsSync(manifest)) throw Object.assign(new Error('RELEASE_MANIFEST_MISSING'), { code: 'RELEASE_MANIFEST_MISSING' });
  const version = String(identity.version || '');
  const commit = String(identity.commit || '').toLowerCase();
  if (!version || !/^[a-f0-9]{40}$/.test(commit) || String(web.version) !== version
    || !commit.startsWith(String(web.commit || '').toLowerCase())
    || !path.basename(root).includes(commit.slice(0, 7))) {
    throw Object.assign(new Error('RELEASE_IDENTITY_MISMATCH'), { code: 'RELEASE_IDENTITY_MISMATCH' });
  }
  const manifestText = fs.readFileSync(manifest, 'utf8');
  if (!manifestText.includes('RELEASE_IDENTITY.json')) {
    throw Object.assign(new Error('RELEASE_IDENTITY_NOT_MANIFESTED'), { code: 'RELEASE_IDENTITY_NOT_MANIFESTED' });
  }
  return Object.freeze({ version, commit, tree: String(identity.tree || ''), builtAt: String(identity.builtAt || '') });
}

function runtimeIdentity(root = releaseRoot()) {
  if (process.env.APP_RELEASE_ROOT || path.basename(root).startsWith('release-app-report-')) return validateIdentity(root);
  let commit = 'dev';
  try { commit = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* development fallback */ }
  return Object.freeze({ version: process.env.APP_BUILD_VERSION || commit.slice(0, 7), commit, tree: '', builtAt: '' });
}

module.exports = { releaseRoot, validateIdentity, runtimeIdentity };
