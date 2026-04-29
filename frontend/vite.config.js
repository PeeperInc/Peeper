import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const sharedHtmlDir = path.resolve(__dirname, '../html');
const legacyPublicDir = path.resolve(__dirname, 'public');

export default defineConfig({
  plugins: [react()],
  // In local dev we reuse the same html/ asset layout as production exports.
  // If the shared folder is absent, fall back to the regular frontend/public folder.
  publicDir: fs.existsSync(sharedHtmlDir) ? sharedHtmlDir : legacyPublicDir,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
    // Proxy API calls to backend in dev mode
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
