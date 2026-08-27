const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const router = require('../src/routes');

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.js') ? [absolute] : [];
  });
}

test('warmEmployeeCostAllCache từ chối khoá testOptions ngoài allowlist', async () => {
  await assert.rejects(
    router.employeeCostAllTestServices.warmEmployeeCostAllCache('07.2026', 'unknown-option-test', {
      unexpectedRuntimeOption: true,
    }),
    { code: 'EMPLOYEE_COST_WARM_TEST_OPTION_UNKNOWN', unknown: ['unexpectedRuntimeOption'] },
  );
});

test('server/src không caller runtime nào truyền tham số thứ ba cho warmEmployeeCostAllCache', () => {
  const srcRoot = path.join(__dirname, '..', 'src');
  const callWithThirdArgument = /warmEmployeeCostAllCache\s*\(\s*[^,\n]+\s*,\s*[^,\n]+\s*,/g;
  const offenders = sourceFiles(srcRoot).filter((file) => {
    const source = fs.readFileSync(file, 'utf8')
      .replace(/async function warmEmployeeCostAllCache\s*\([^)]*\)/, '');
    callWithThirdArgument.lastIndex = 0;
    return callWithThirdArgument.test(source);
  });
  assert.deepEqual(offenders.map((file) => path.relative(srcRoot, file)), []);
});
