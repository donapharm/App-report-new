import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// ‼ 04/08/2026 — Bot chặn ở post-deploy: `ReferenceError: readEmployeeCostPrefs is
// not defined`. Hàm được DÙNG nhưng không được IMPORT. Build vẫn xanh vì lỗi chỉ nổ
// lúc chạy ⇒ lọt tới tận PROD rồi mới phát hiện, phải rollback.
// Đây là lần thứ HAI cùng một kiểu (trước đó là `aiRows` thiếu khai báo state).
// Test này quét TOÀN BỘ: mọi tên xuất từ model mà trang có dùng thì phải có import.
const MODEL_URL = new URL('../src/employeeCostModel.js', import.meta.url);
const model = fs.readFileSync(MODEL_URL, 'utf8');

const PAGES = ['EmployeeCost.jsx', 'Target.jsx', 'Overview.jsx', 'Revenue.jsx']
  .map((name) => new URL(`../src/pages/${name}`, import.meta.url))
  .filter((url) => fs.existsSync(url));

function exportedNames(source) {
  return [...source.matchAll(/^export (?:async )?function (\w+)|^export const (\w+)/gm)]
    .map((match) => match[1] || match[2]).filter(Boolean);
}

function importedFrom(source, moduleName) {
  const block = new RegExp(`import \\{([^}]*)\\} from '[^']*${moduleName}'`, 'g');
  const names = new Set();
  for (const match of source.matchAll(block)) {
    for (const raw of match[1].split(',')) {
      const name = raw.split(' as ')[0].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

// Bỏ chuỗi/comment để không tưởng nhầm tên xuất hiện trong chữ là "đang dùng".
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

for (const url of PAGES) {
  const name = url.pathname.split('/').pop();
  test(`${name}: mọi hàm dùng từ employeeCostModel đều phải được import`, () => {
    const source = fs.readFileSync(url, 'utf8');
    if (!source.includes("employeeCostModel.js")) return;
    const imported = importedFrom(source, 'employeeCostModel.js');
    const body = codeOnly(source);
    const missing = exportedNames(model).filter((exportName) => {
      if (imported.has(exportName)) return false;
      return new RegExp(`(?<![\\w.])${exportName}\\s*\\(`).test(body);
    });
    assert.deepEqual(missing, [], `dùng mà chưa import: ${missing.join(', ')} — sẽ nổ ReferenceError lúc mở màn`);
  });
}
