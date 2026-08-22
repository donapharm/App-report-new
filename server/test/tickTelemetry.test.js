'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const telemetry = require('../src/tickTelemetry');

test('tick telemetry emits one compact line with GMT+7 timestamp and work outcome', () => {
  const lines = [];
  const finish = telemetry.startTick('sample', {
    now: new Date('2026-08-21T09:04:07Z'),
    startNs: process.hrtime.bigint(),
    log: (line) => lines.push(line),
  });
  const record = finish({ didWork: false, outcome: 'not-due' });
  assert.equal(record.at, '2026-08-21 16:04:07 GMT+7');
  assert.equal(record.didWork, false);
  assert.equal(record.outcome, 'not-due');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[sample-tick\] \{"at":"2026-08-21 16:04:07 GMT\+7","durationMs":\d+(?:\.\d+)?,"didWork":false,"outcome":"not-due"\}$/);
  assert.equal(finish({ didWork: true, outcome: 'duplicate' }), null);
  assert.equal(lines.length, 1);
});

test('event-loop warning carries its own GMT+7 timestamp contract', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'eventLoopMonitor.js'), 'utf8');
  assert.match(source, /at: vnSecond\(\)/);
  assert.match(source, /runtimeActivity\.snapshot\(\)/);
});

test('runtime activity exposes compact request, parent decode and background labels only', () => {
  const activity = require('../src/runtimeActivity');
  activity.resetForTests();
  const request = activity.beginRequest();
  const finishTask = activity.beginBackground('revenue-materialize');
  activity.beginParentDecode(1000);
  activity.parentDecoded(640);
  assert.deepEqual(activity.snapshot(), {
    requestIds: [request.id], backgroundTasks: ['revenue-materialize'],
    parentDecodeActive: true, parentDecodedBytes: 640, parentDecodeTotalBytes: 1000,
  });
  request.finish(); finishTask(); activity.endParentDecode();
  assert.deepEqual(activity.snapshot().requestIds, []);
  assert.deepEqual(activity.snapshot().backgroundTasks, []);
});
