import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// CEO duyệt 04/08: tách thư viện biểu đồ ra khỏi gói chính. Trước đó recharts nằm
// thẳng trong gói vào ⇒ MỌI trang phải tải 167KB nén, kể cả trang không có biểu đồ.
const viteConfig = fs.readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
const lazy = fs.readFileSync(new URL('../src/chartsLazy.jsx', import.meta.url), 'utf8');
const PAGES = ['Overview.jsx', 'Analysis.jsx', 'Target.jsx'];

test('‼ CẤM khai manualChunks cho recharts — khai là bị modulepreload tải ngay', () => {
  // Bỏ chú thích rồi mới soi, để lời cảnh báo trong file không bị tính là vi phạm.
  const code = viteConfig.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  assert.doesNotMatch(code, /manualChunks/,
    'khai manualChunks biến recharts thành mảnh của gói vào ⇒ Vite chèn modulepreload vào index.html');
});

test('‼ không trang nào được import TĨNH charts.jsx — phải đi qua chartsLazy', () => {
  for (const name of PAGES) {
    const source = fs.readFileSync(new URL(`../src/pages/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from '\.\.\/charts\.jsx'/, `${name} còn import tĩnh charts.jsx`);
  }
});

test('chartsLazy phải dùng import() động và có khung xương giữ chỗ', () => {
  assert.match(lazy, /import\('\.\/charts\.jsx'\)/, 'phải là import động thì Vite mới tách được');
  assert.match(lazy, /React\.Suspense/);
  assert.match(lazy, /ChartSkeleton/, 'thiếu khung xương thì trang bị giật layout lúc chờ');
});

test('mọi biểu đồ charts.jsx xuất ra đều phải có bản lazy tương ứng', () => {
  const charts = fs.readFileSync(new URL('../src/charts.jsx', import.meta.url), 'utf8');
  const exported = [...charts.matchAll(/^export function (\w+)/gm)].map((match) => match[1]);
  assert.ok(exported.length >= 4);
  for (const name of exported) {
    assert.match(lazy, new RegExp(`export const ${name} = lazyChart\\('${name}'`),
      `thiếu bản lazy cho ${name} — trang nào dùng nó sẽ kéo recharts vào gói chính trở lại`);
  }
});

test('‼ index.html đã build KHÔNG được preload gói biểu đồ', () => {
  const url = new URL('../dist/index.html', import.meta.url);
  if (!fs.existsSync(url)) return;   // chưa build thì bỏ qua
  const html = fs.readFileSync(url, 'utf8');
  assert.doesNotMatch(html, /modulepreload[^>]*recharts/);
  assert.doesNotMatch(html, /modulepreload[^>]*charts-/);
});
