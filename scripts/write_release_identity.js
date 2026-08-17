#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.env.RELEASE_ROOT || '');
if (!root || root === path.parse(root).root) throw new Error('RELEASE_ROOT_INVALID');
const webFile = path.join(root, 'web', 'dist', 'version.json');
const web = JSON.parse(fs.readFileSync(webFile, 'utf8'));
const commit = String(process.env.RELEASE_COMMIT || '').toLowerCase();
const tree = String(process.env.RELEASE_TREE || '').toLowerCase();
if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{40}$/.test(tree)) throw new Error('RELEASE_GIT_IDENTITY_INVALID');
if (!commit.startsWith(String(web.commit || '').toLowerCase()) || !String(web.version || '').startsWith(commit.slice(0, 7))) {
  throw new Error('RELEASE_WEB_IDENTITY_MISMATCH');
}
if (!path.basename(root).includes(commit.slice(0, 7))) throw new Error('RELEASE_DIRECTORY_IDENTITY_MISMATCH');
const payload = { version: String(web.version), commit, tree, builtAt: String(web.builtAt || '') };
fs.writeFileSync(path.join(root, 'RELEASE_IDENTITY.json'), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o644 });
console.log(JSON.stringify(payload));
