const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const cacheFile = path.join('/tmp', `app-report-unit-groups-${process.pid}.json`);
process.env.DATA_HUB_UNIT_GROUPS_CACHE_FILE = cacheFile;
process.env.DATA_HUB_BASE_URL = 'http://data-hub.test';
process.env.DATA_HUB_ASSIGNMENT_KEY = 'unit-group-test-key';
process.env.DATA_HUB_UNIT_GROUPS_CACHE_TTL_MS = '60000';
const unitGroups = require('../src/dataHubUnitGroups');

function withChecksum(value) {
  const copy = structuredClone(value);
  const signed = {
    groups: copy.groups,
    totalUnits: copy.totalUnits,
    totalGroups: copy.totalGroups,
    sharedGroups: copy.sharedGroups,
  };
  copy.checksum = crypto.createHash('sha256').update(JSON.stringify(signed)).digest('hex');
  return copy;
}

const payload = withChecksum({
  contract: 'app-report.unit-groups.v1',
  source: 'data-hub.catalogs+units',
  version: '2.7',
  updatedAt: '2026-07-20T10:00:00.000Z',
  totalUnits: 16,
  totalGroups: 2,
  sharedGroups: 2,
  groups: [
    {
      base: '001', label: 'BVĐK Đồng Nai', count: 3, types: { CL: 2, 'CL/NT': 1 }, classes: ['CL'],
      members: [
        { code: '001.BVĐK Đồng Nai', name: 'BVĐK Đồng Nai', route: 'CL', type: 'CL', unitClass: 'CL' },
        { code: '001.BVĐK Đồng Nai-KHU C', name: 'BVĐK Đồng Nai-KHU C', route: 'CL', type: 'CL', unitClass: 'CL' },
        { code: '001.NT-BVĐK Đồng Nai', name: 'NT-BVĐK Đồng Nai', route: 'CL/NT', type: 'CL/NT', unitClass: 'CL' },
      ],
    },
    {
      base: '033', label: 'Nhóm 033', count: 13, types: { NCL: 9, NT: 4 }, classes: ['NCL'],
      members: [
        ...Array.from({ length: 9 }, (_, index) => ({ code: `033.NCL${index + 1}`, name: `NCL ${index + 1}`, route: 'NCL', type: 'NCL', unitClass: 'NCL' })),
        ...Array.from({ length: 4 }, (_, index) => ({ code: `033.NT${index + 1}`, name: `NT ${index + 1}`, route: 'NT', type: 'NT', unitClass: null })),
      ],
    },
  ],
});

let originalFetch;
test.beforeEach(() => {
  originalFetch = global.fetch;
  unitGroups.resetForTests();
  fs.rmSync(cacheFile, { force: true });
});
test.afterEach(() => { global.fetch = originalFetch; });
test.after(() => fs.rmSync(cacheFile, { force: true }));

test('accepts 033 and 033. as the same canonical group with all 13 exact members', async () => {
  global.fetch = async (url, options) => {
    assert.equal(url, 'http://data-hub.test/api/integrations/app-report/unit-groups');
    assert.equal(options.headers['x-assignment-key'], 'unit-group-test-key');
    return { ok: true, json: async () => payload };
  };
  const plain = await unitGroups.membersFor('033');
  const dotted = await unitGroups.membersFor('033.');
  assert.equal(plain.key, '033');
  assert.equal(dotted.key, '033');
  assert.equal(plain.codes.length, 13);
  assert.deepEqual(dotted.codes, plain.codes);
  assert.equal(plain.codes.includes('0331.KHÔNG THUỘC 033'), false);
});

test('keeps 001 exact membership and route intersection, including units with no revenue', async () => {
  global.fetch = async () => ({ ok: true, json: async () => payload });
  const snapshot = await unitGroups.getSnapshot();
  const g001 = snapshot.groups.find((group) => group.base === '001');
  assert.deepEqual(g001.members.map((member) => member.code), [
    '001.BVĐK Đồng Nai', '001.BVĐK Đồng Nai-KHU C', '001.NT-BVĐK Đồng Nai',
  ]);
  const g033 = snapshot.groups.find((group) => group.base === '033');
  assert.equal(g033.members.filter((member) => unitGroups.memberMatchesRoutes(member, 'NCL')).length, 9);
  assert.equal(g033.members.filter((member) => unitGroups.memberMatchesRoutes(member, 'NT')).length, 4);
});

test('uses validated last-known-good when DataHub is temporarily unavailable', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) return { ok: true, json: async () => payload };
    throw new Error('offline');
  };
  await unitGroups.getSnapshot({ force: true });
  unitGroups.resetForTests();
  const fallback = await unitGroups.getSnapshot({ force: true });
  assert.equal(fallback.meta.source, 'data-hub-lkg');
  assert.equal(fallback.meta.stale, true);
  assert.equal(fallback.groups.find((group) => group.base === '033').count, 13);
});

test('rejects malformed membership rather than deriving from prefixes', () => {
  assert.throws(() => unitGroups.validateSnapshot({ ...payload, checksum: 'a'.repeat(64) }), /checksum/i);
  assert.throws(() => unitGroups.validateSnapshot(withChecksum({ ...payload, totalUnits: 15 })), /sai tổng số đơn vị/i);
  const duplicate = structuredClone(payload);
  duplicate.groups[1].members[0].code = duplicate.groups[0].members[0].code;
  assert.throws(() => unitGroups.validateSnapshot(withChecksum(duplicate)), /xuất hiện ở cả nhóm/i);
});

test('employee facet enrichment cannot switch identity through the emp query', () => {
  assert.deepEqual(unitGroups.facetEmployeeCodes({ ownEmployee: 'DN001', selectedEmployees: [] }), ['DN001']);
  assert.deepEqual(unitGroups.facetEmployeeCodes({ ownEmployee: 'DN001', selectedEmployees: ['DN001', 'DN002'] }), ['DN001']);
  assert.deepEqual(unitGroups.facetEmployeeCodes({ ownEmployee: 'DN001', selectedEmployees: ['DN002'] }), []);
  assert.deepEqual(unitGroups.facetEmployeeCodes({ isAdmin: true, ownEmployee: 'CEO', selectedEmployees: ['DN001', 'DN002'] }), ['DN001', 'DN002']);
});
