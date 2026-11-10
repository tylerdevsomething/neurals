// Hosted build of the 3D pages (hero-lab/, kept exactly as handed over): its own config, plus all three
// pages the site embeds, served under /lab/ by the indexer next to the site (VITE_LAB_URL=/lab).
//   npx vite build --config deploy/vite.hero-lab.ts --outDir <site dist>/lab
import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from '../hero-lab/vite.config.ts';

const page = (name: string) => fileURLToPath(new URL(`../hero-lab/${name}.html`, import.meta.url));

export default mergeConfig(base, defineConfig({
  base: '/lab/',
  build: { emptyOutDir: true, chunkSizeWarningLimit: 2000, rollupOptions: { input: { index: page('index'), blob: page('blob'), neuron: page('neuron') } } },
}));
