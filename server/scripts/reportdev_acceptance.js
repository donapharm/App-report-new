#!/usr/bin/env node
'use strict';

// Gate-1 only. No password/OTP/browser session exists here. Gate 2 must provide
// a reviewed read-only counter adapter before this executable may run on PROD.
const { runAcceptance } = require('../src/reportdevAcceptance');

const periodArg = process.argv.find((arg) => arg.startsWith('--period='));
runAcceptance({ period: periodArg?.slice('--period='.length) }, {})
  .then((value) => process.stdout.write(`${JSON.stringify(value)}\n`))
  .catch((error) => { process.stderr.write(`${error.code || 'ACCEPTANCE_FAILED'}\n`); process.exitCode = 1; });
