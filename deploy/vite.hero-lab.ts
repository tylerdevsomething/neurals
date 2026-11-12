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
      // Before the reveal no slot has a part yet, so nothing can be drawn as yours: count what the wallet holds.
      const RET = 'soldSlots: brain.slots.filter((s) => s.issued > 0).length, wallet };';
      if (!code.includes(RET)) throw new Error('hero-lab/data.ts no longer ends load() as expected: update deploy/vite.hero-lab.ts');
      return code.replace(DEVNET_API, `(location.origin + '/api')`).replace(RET, RET.replace('wallet };', 'wallet, held: mine.size } as Net;'));
    }
    // The "buy neurons" link in the wallet panel (inside a template string): the site that serves the page.
    // My neurons shows the wallet connected on the site (passed as ?wallet=), not a sample holder.
    if (file.endsWith('/hero-lab/world.ts')) {
      if (!code.includes('void start(null);')) throw new Error('hero-lab/world.ts no longer starts with start(null): update deploy/vite.hero-lab.ts');
      return code.split('https://neurals-production.up.railway.app/#/buy').join('${location.origin}/buy')
        .replace('void start(null);', "void start(new URLSearchParams(location.search).get('wallet'));")
        // Holding neurons before the reveal: say they get their place in the brain then, not "none".
        .replace('<div class="empty">you hold no neurons yet</div>', '<div class="empty">${(net as any)?.held ? "your neurons get their place in the brain at the reveal" : "you hold no neurons yet"}</div>');
    }
    return null;
  },
};

export default mergeConfig(base, defineConfig({
  base: '/lab/',
  plugins: [sameOriginApi],
  build: { emptyOutDir: true, chunkSizeWarningLimit: 2000, rollupOptions: { input: { index: page('index'), blob: page('blob'), neuron: page('neuron') } } },
}));
