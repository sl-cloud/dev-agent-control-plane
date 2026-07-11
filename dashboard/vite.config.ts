import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api and /health to the local cp-api process so the
// dashboard can use relative paths in both dev and the Caddy-fronted
// staging build, with no CORS and no build-time base URL.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.CP_API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
      '/health': {
        target: process.env.CP_API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
