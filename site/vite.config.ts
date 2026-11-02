import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The site imports the same brain/ modules as the indexer; node:crypto maps to a small browser shim.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: { 'node:crypto': fileURLToPath(new URL('./src/shims/crypto.ts', import.meta.url)) },
  },
  define: { 'process.env': {} },
  server: { port: 5173 },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
});
