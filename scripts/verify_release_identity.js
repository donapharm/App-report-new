#!/usr/bin/env node
'use strict';

const path = require('node:path');
const root = path.resolve(process.env.RELEASE_ROOT || '');
if (!root || root === path.parse(root).root) throw new Error('RELEASE_ROOT_INVALID');
process.env.APP_RELEASE_ROOT = root;
const identity = require(path.join(root, 'server', 'src', 'releaseIdentity')).validateIdentity(root);
console.log(JSON.stringify({ ok: true, release: path.basename(root), ...identity }));
