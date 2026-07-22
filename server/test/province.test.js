'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { provinceOf, provinceResolution } = require('../src/province');

test('province resolution uses only authoritative row/config sources and never name inference', () => {
  assert.deepEqual(provinceResolution('UNKNOWN', 'Tên bất kỳ', 'CÀ MAU'), { value: 'CÀ MAU', source: 'source' });
  assert.deepEqual(provinceResolution('BV001', 'Tên không có tỉnh', ''), { value: 'Đồng Nai', source: 'config' });
  assert.deepEqual(provinceResolution('UNKNOWN', 'BVĐK Long Khánh ĐN', ''), { value: '', source: '' });
  assert.equal(provinceOf('UNKNOWN', 'BVĐK Long Khánh ĐN', ''), '');
  assert.equal(provinceOf('UNKNOWN', 'BV Tân Phú', ''), '');
});

test('province config hot-reloads and revenue/CST caches include its version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-province-'));
  const mapFile = path.join(dir, 'unit_province.json');
  fs.writeFileSync(mapFile, JSON.stringify({ map: { TEST: 'Đồng Nai' } }));
  const script = `
    const fs = require('fs');
    const p = require(${JSON.stringify(require.resolve('../src/province'))});
    const first = p.provinceResolution('TEST', '', '');
    const v1 = p.provinceMapVersion();
    fs.writeFileSync(process.env.UNIT_PROVINCE_MAP_FILE, JSON.stringify({ map: { TEST: 'Bà Rịa - Vũng Tàu' } }));
    const next = new Date(Date.now() + 2000); fs.utimesSync(process.env.UNIT_PROVINCE_MAP_FILE, next, next);
    const second = p.provinceResolution('TEST', '', '');
    const v2 = p.provinceMapVersion();
    process.stdout.write(JSON.stringify({ first, second, changed: v1 !== v2 }));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8', env: { ...process.env, UNIT_PROVINCE_MAP_FILE: mapFile },
  }));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(result.first, { value: 'Đồng Nai', source: 'config' });
  assert.deepEqual(result.second, { value: 'Bà Rịa - Vũng Tàu', source: 'config' });
  assert.equal(result.changed, true);

  const storeSource = fs.readFileSync(require.resolve('../src/store'), 'utf8');
  assert.match(storeSource, /const sig = `\$\{provinceMapVersion\(\)\}\|\$\{slotsSig\(slots\)\}`/);
  assert.match(storeSource, /\$\{provinceMapVersion\(\)\}\|` \+ slotsSig\(activeSlots\(\)\)/);
  assert.match(storeSource, /_baseProvinceVersion === currentProvinceVersion/);
  assert.match(storeSource, /\['inferred', 'guessed_from_name', 'catalog'\]/);
  assert.match(storeSource, /sourceProvince \|\| configuredProvince\.value \|\| catalogProvince/);
});
