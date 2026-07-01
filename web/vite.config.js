import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: proxy /api sang backend Express (cổng 3860).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3860' },
  },
  build: { outDir: 'dist' },
});
