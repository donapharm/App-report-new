import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../src/pages/EmployeeCost.jsx', import.meta.url), 'utf8');

test('gap-sync preview exposes exactly the three CEO approval labels in required order', () => {
  const approve = page.indexOf("'✅ Duyệt'");
  const reject = page.indexOf('>❌ Không duyệt</button>');
  const note = page.indexOf("'📝 Ý kiến khác'");
  assert(approve >= 0, 'missing exact ✅ Duyệt label');
  assert(reject > approve, 'missing or misordered exact ❌ Không duyệt label');
  assert(note > reject, 'missing or misordered exact 📝 Ý kiến khác label');
  assert.doesNotMatch(page, /✅ Duyệt & gửi|📝 Ghi ý kiến \(không gửi\)/);
});

test('only approve calls the sending helper; note is record-only and reject is local-only', () => {
  assert.match(page, /const runSync = async \(\) =>[\s\S]*?employeeCostGapSyncDataHub\([^;]+\{ confirm: true, note:/);
  assert.match(page, /const saveNote = async \(\) =>[\s\S]*?employeeCostGapSyncDataHub\([^;]+\{ action: 'note', note:/);
  assert.match(page, /'✅ Duyệt'\}<\/button>[\s\S]*?onClick=\{\(\) => \{ setSyncConfirm\(false\); setSyncError\(''\); \}\}>❌ Không duyệt<\/button>[\s\S]*?'📝 Ý kiến khác'/);
});
