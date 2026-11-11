{
  const t = new URLSearchParams(location.search).get('theme') ?? import.meta.env.VITE_THEME ?? 'light';
  document.documentElement.dataset.theme = t === 'micro' || t === 'white' ? 'paper' : t;
  if (t === 'white') document.documentElement.dataset.white = '1';
  if (t === 'micro') document.documentElement.dataset.variant = 'micro';
  { const h = new URLSearchParams(location.search).get('head'); if (h) document.documentElement.dataset.head = h; } // title placement options: brain alone on the homepage
}
import { makeBitmaps } from './bitmap.ts';
if (document.documentElement.dataset.variant === 'micro') makeBitmaps();
import './polyfill.ts';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';
import { LAB } from './lab.ts';
import { startNav } from './nav.ts';

// Clean addresses: old #/ links are rewritten and same-site links navigate without a reload.
startNav();

createRoot(document.getElementById('root')!).render(<App />);
// the brain sits in a frame; plain scroll over it is passed up here so the page still moves
addEventListener('message', (e) => { if (e.origin.startsWith(new URL(LAB).origin) && typeof e.data?.wheel === 'number') scrollBy({ top: e.data.wheel, behavior: 'instant' as ScrollBehavior }); });
