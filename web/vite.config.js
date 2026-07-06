import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// Dấu mốc bản build: SHA commit + giờ build. Hiện ở màn login để LUÔN biết bản
// nào đang chạy trên server (hết cảnh "hình như vẫn bản cũ"). Ưu tiên biến môi
// trường BUILD_VER (bot có thể truyền), nếu không thì tự đọc git.
let buildVer = process.env.BUILD_VER || '';
if (!buildVer) {
  try { buildVer = execSync('git rev-parse --short HEAD').toString().trim(); } catch { buildVer = 'dev'; }
}
const buildAt = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

// Plugin: xuất /version.json vào bản build (để app tự phát hiện "có bản mới").
const emitVersion = {
  name: 'emit-version-json',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: buildVer, builtAt: buildAt }) });
  },
};

// Dev: proxy /api sang backend Express (cổng 3860).
export default defineConfig({
  define: {
    __BUILD_VER__: JSON.stringify(buildVer),
    __BUILD_AT__: JSON.stringify(buildAt),
  },
  plugins: [react(), emitVersion],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3860' },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ['recharts'],
        },
      },
    },
  },
});
