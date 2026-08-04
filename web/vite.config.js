import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Mỗi lần build PHẢI có version riêng, kể cả khi chưa commit Git. Nếu chỉ dùng
// SHA commit, nhiều lần deploy trong cùng commit sẽ có cùng version và app đang
// mở không phát hiện bundle mới. BUILD_VER vẫn được phép override khi CI cấp.
let commitVer = 'dev';
try { commitVer = execSync('git rev-parse --short HEAD').toString().trim() || 'dev'; } catch { /* không có git */ }
const buildNow = new Date();
const buildParts = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(buildNow);
const buildPart = (type) => buildParts.find((p) => p.type === type)?.value || '';
const buildAt = `${buildPart('day')}/${buildPart('month')}/${buildPart('year')} ${buildPart('hour')}:${buildPart('minute')}:${buildPart('second')}`;
const buildStamp = `${buildPart('year')}${buildPart('month')}${buildPart('day')}-${buildPart('hour')}${buildPart('minute')}${buildPart('second')}-${String(buildNow.getTime()).slice(-3)}`;
const buildVer = process.env.BUILD_VER || `${commitVer}-${buildStamp}`;

// Plugin: xuất /version.json vào bản build (để app tự phát hiện "có bản mới").
const emitVersion = {
  name: 'emit-version-json',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: buildVer, commit: commitVer, builtAt: buildAt }) });
  },
};

// Dev: proxy /api sang backend Express App Report (cổng 3873).
export default defineConfig({
  define: {
    __BUILD_VER__: JSON.stringify(buildVer),
    __BUILD_AT__: JSON.stringify(buildAt),
  },
  plugins: [react(), emitVersion],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3873' },
  },
  build: {
    outDir: 'dist',
    // ‼ KHÔNG khai `manualChunks: { recharts }` nữa. Khai như vậy biến recharts thành
    // một mảnh thuộc đồ thị của gói vào ⇒ Vite chèn <link rel="modulepreload"> vào
    // index.html và trình duyệt TẢI NGAY 167KB dù trang đang mở không có biểu đồ nào.
    // Để Vite tự tách theo `import()` động trong chartsLazy.jsx thì nó chỉ tải khi
    // thật sự cần vẽ. Có test khoá lại (charts.lazy.test.mjs).
  },
});
