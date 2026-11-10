import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: { 'node:crypto': fileURLToPath(new URL('../site-v2/src/shims/crypto.ts', import.meta.url)) } },
  define: { 'process.env': {} },
  server: { port: 5212 },
});
