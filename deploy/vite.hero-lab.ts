// Hosted build of the 3D pages (hero-lab/, kept exactly as handed over): its own config, plus all three
// pages the site embeds, served under /lab/ by the indexer next to the site.
//   npx vite build --config deploy/vite.hero-lab.ts --outDir <site dist>/lab
// hero-lab/data.ts names the devnet API; hosted, the pages read the API of the site that serves them
// (same origin), so the mainnet site shows mainnet data. The swap happens at build time only.
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import base from '../hero-lab/vite.config.ts';

const page = (name: string) => fileURLToPath(new URL(`../hero-lab/${name}.html`, import.meta.url));
const DEVNET_API = /(['"])https:\/\/neurals-production\.up\.railway\.app\/api\1/;

const sameOriginApi: Plugin = {
  name: 'neurals-same-origin-api',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('\\').join('/');
    if (file.endsWith('/hero-lab/data.ts')) {
      if (!DEVNET_API.test(code)) throw new Error('hero-lab/data.ts no longer names the devnet API: update deploy/vite.hero-lab.ts');
      return code.replace(DEVNET_API, `(location.origin + '/api')`);
    }
    // The "buy neurons" link in the wallet panel (inside a template string): the site that serves the page.
    if (file.endsWith('/hero-lab/world.ts')) return code.split('https://neurals-production.up.railway.app/#/buy').join('${location.origin}/buy');
    return null;
  },
};

export default mergeConfig(base, defineConfig({
  base: '/lab/',
  plugins: [sameOriginApi],
  build: { emptyOutDir: true, chunkSizeWarningLimit: 2000, rollupOptions: { input: { index: page('index'), blob: page('blob'), neuron: page('neuron') } } },
}));
