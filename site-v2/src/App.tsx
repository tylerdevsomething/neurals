import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { navigate, NAV_EVENT } from './nav.ts';
import { Connection } from '@solana/web3.js';
import { api, fmt, neurons, short, type SiteConfig, type WalletView, type Brain } from './api.ts';
import { choose, connect, disconnect, useWallet, wallets } from './chain.ts';
import { NeuralsAccounts } from '../../brain/accounts.ts';
import { slotLabel } from './BrainMap.tsx';
import { Modal, Loading, PageHead } from './ui.tsx';
import { Overview } from './pages/Overview.tsx';
import { SlotPage } from './pages/Slot.tsx';
import { WalletPage } from './pages/Wallet.tsx';
import { Market } from './pages/Market.tsx';
import { Buy } from './pages/Buy.tsx';
import { Chat } from './pages/Chat.tsx';
import { Rules } from './pages/Rules.tsx';
import { Rarities } from './pages/Rarities.tsx';
import { Home } from './pages/Home.tsx';
import { Glossary } from './pages/Glossary.tsx';
import { ReceiptPage } from './pages/Receipt.tsx';
import { LAB } from './lab.ts';

export type Ctx = { config: SiteConfig; conn: Connection; accounts: NeuralsAccounts };
const AppContext = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppContext)!;

function useRoute(): string[] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => { setPath(location.pathname); window.scrollTo(0, 0); };
    addEventListener(NAV_EVENT, on);
    return () => removeEventListener(NAV_EVENT, on);
  }, []);
  return path.split('/').filter(Boolean);
}

/** Opens the wallet menu from anywhere (pages call this instead of connecting silently). */
let openMenu: () => void = () => {};
export const askConnect = () => openMenu();

function WalletButton({ onConnected, host = false }: { onConnected: () => void; host?: boolean }) {
  const me = useWallet();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  if (host) openMenu = () => setOpen(true); // only the always-mounted copy answers askConnect, so it works with every folder shut
  useEffect(() => {
    const off = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    addEventListener('mousedown', off);
    return () => removeEventListener('mousedown', off);
  }, []);
  const list = wallets();
  return (
    <div className="walletbtn" ref={ref}>
      {host ? null : me
        ? <button className="ghost" onClick={() => setOpen(!open)}>{short(me)}</button>
        : <button onClick={() => { setErr(''); setOpen(!open); }}>Connect</button>}
      {open && (
        <div className="menu-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
        <div className="menu menu-modal" role="dialog" aria-label={me ? 'Your wallet' : 'Connect a wallet'}>
          <div className="menu-head"><span>{me ? 'Your wallet' : 'Connect a wallet'}</span><button type="button" className="menu-x" aria-label="Close" onClick={() => setOpen(false)}><svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 2 L10 10 M10 2 L2 10" /></svg></button></div>
          {me ? (
            <>
              <a className="wallet-pick" href="/wallet" onClick={() => setOpen(false)}>[My neurons]</a>
              <button className="wallet-pick ghost-pick" onClick={() => { void navigator.clipboard.writeText(me); setOpen(false); }}>[Copy address]</button>
              <button className="wallet-pick ghost-pick" onClick={() => { void disconnect(); setOpen(false); }}>[Disconnect]</button>
            </>
          ) : list.length === 0 ? (
            <p className="muted">No wallet found. Install Phantom, Solflare or Backpack, then come back.</p>
          ) : list.map((w) => (
            <button key={w.name} className="wallet-pick" onClick={() => {
              choose(w.p);
              connect().then(() => { setOpen(false); onConnected(); }).catch((e) => setErr(e.message));
            }}>[{w.name}]</button>
          ))}
          {err && <p className="error">{err}</p>}
        </div>
        </div>
      )}
    </div>
  );
}

/** After an explicit Connect: the wallet's slots, one at a time. */
function Reveal({ wallet, onClose }: { wallet: string; onClose: () => void }) {
  const [view, setView] = useState<WalletView | null>(null);
  const [brain, setBrain] = useState<Brain | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    api.wallet(wallet).then(setView).catch(() => setView(null));
    api.brain().then(setBrain).catch(() => {});
  }, [wallet]);
  const slots = view?.slots ?? [];
  useEffect(() => {
    if (n >= slots.length) return;
    const t = setTimeout(() => setN(n + 1), 700);
    return () => clearTimeout(t);
  }, [n, slots.length]);
  return (
    <Modal title="See what you own" onClose={onClose}>
      {!view ? <Loading text="Reading your wallet" /> : slots.length === 0 ? (
        <p>No neurons in this wallet yet. Neurons come from buying the token on the curve.</p>
      ) : (
        <>
          <p className="muted">The parts of the network your wallet holds.</p>
          <div className="reveal">
            {slots.slice(0, n).map((s) => (
              <div key={s.slot} className="reveal-card">
                <b>{brain ? slotLabel(brain.slots[s.slot]) : `Slot ${s.slot}`}</b>
                <span>{fmt(neurons(s.amount), 2)} neurons</span>
              </div>
            ))}
          </div>
          <p className="muted">{Math.min(n, slots.length)} of {slots.length}</p>
        </>
      )}
      <p className="inline">
        {view && n < slots.length && <button className="ghost" onClick={() => setN(slots.length)}>[Skip]</button>}
        <button onClick={onClose}>[See my neurons]</button>
      </p>
    </Modal>
  );
}

const FONTS: [string, string][] = [['1', 'anton'], ['2', 'bebas neue'], ['3', 'archivo black'], ['4', 'barlow condensed']];
function FontSwitch() {
  // back to the original font: the experiment is switched off
  useEffect(() => { delete document.documentElement.dataset.font; localStorage.removeItem('neurals.font'); }, []);
  return null;
}

const ICON: Record<string, string> = {
  folder: '<path d="M1.5 3.5h4l1.2 1.5h7.8v8H1.5z" fill="none"/>',
  open: '<path d="M1.5 3.5h4l1.2 1.5h7.8v8H1.5z" fill="currentColor"/>',
  overview: '<path d="M8 1.5 9.3 6.7 14.5 8 9.3 9.3 8 14.5 6.7 9.3 1.5 8 6.7 6.7z" fill="currentColor" stroke="none"/>',
  brain: '<g fill="none"><rect x="1.8" y="2.5" width="12.4" height="8.6"/><path d="M8 11.1 V13.6 M4.8 13.6 H11.2"/></g>',
  chat: '<path d="M2 3h12v8H7l-3 2.5V11H2z" fill="none"/>',
  market: '<path d="M2 14h12" fill="none"/><path d="M3 11l3.5-3.5 2.5 2.5L13.5 5" fill="none"/><path d="M10.5 5h3v3" fill="none"/>',
  home: '<path d="M2 7.5 L8 2.5 L14 7.5 M3.8 6.2 V13.5 H12.2 V6.2" fill="none"/><rect x="6.6" y="9.5" width="2.8" height="4" fill="none"/>',
  gear: '<g fill="none"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M3.5 12.5l1.3-1.3M11.2 4.8l1.3-1.3"/><circle cx="8" cy="8" r="4.6"/></g>',
  rarities: '<path d="M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3 4.3 13.3l.8-4.1L2 6.3l4.2-.5z" fill="none"/>',
  rules: '<rect x="3.5" y="7.5" width="9" height="6.5" fill="none"/><path d="M5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5M8 10v1.5" fill="none"/>',
  glossary: '<path d="M8 4.5C6.5 3.5 4.5 3.3 2.5 3.6v8.6c2-.3 4 0 5.5 1 1.5-1 3.5-1.3 5.5-1V3.6c-2-.3-4-.1-5.5.9zM8 4.5v8.7" fill="none"/>',
  paper: '<path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3 M5.5 8h5M5.5 10.5h5M5.5 13h3" fill="none"/>',
  wallet: '<path d="M2.5 4.5h10v8h-10z" fill="none"/><path d="M2.5 4.5 L10 2.5 V4.5" fill="none"/><path d="M9.5 7.5h3v2h-3z" fill="none"/>',
  connect: '<path d="M6 2v4M10 2v4M4 6h8v3a4 4 0 0 1-8 0zM8 13v2" fill="none"/>',
  connected: '<path d="M6 5v3M10 5v3M4 8h8v2a4 4 0 0 1-8 0zM8 14v1.5" fill="none"/><path d="M3 1.5h10v3.5H3z" fill="none"/>',
};
const Ic = ({ n }: { n: string }) => <svg className="ti" viewBox="0 0 16 16" width="14" height="14" stroke="currentColor" strokeWidth="1.2" dangerouslySetInnerHTML={{ __html: ICON[n] }} />;
const TREE: { folder: string; items: [string, string, string][] }[] = [
  { folder: 'Explore', items: [['market', 'Market', 'market'], ['chat', 'Chat', 'chat']] },
  { folder: 'Learn', items: [['rarities', 'Rarities', 'rarities'], ['rules', 'Constraints', 'rules'], ['glossary', 'Glossary', 'glossary'], ['neurals-whitepaper.pdf', 'Whitepaper', 'paper']] },
  { folder: 'You', items: [['wallet', 'My neurons', 'wallet']] },
];
/** The virtual tour runs inside the brain: go to the homepage if needed, then tell the brain to start. */
function startTour() {
  const send = (tries = 0) => {
    const f = document.querySelector<HTMLIFrameElement>('iframe.onion');
    if (f?.contentWindow && document.readyState === 'complete') f.contentWindow.postMessage({ tour: 'start' }, '*');
    else if (tries < 40) setTimeout(() => send(tries + 1), 250);
  };
  if (!location.pathname.startsWith('/network')) { navigate('/network'); setTimeout(() => send(), 1500); } else send();
}
(window as unknown as { neuralsTour?: () => void }).neuralsTour = () => startTour();
function TreeNav({ on, onConnected, splitOn }: { on: string; onConnected: () => void; splitOn: boolean }) {
  const me = useWallet();
  const [shut, setShut] = useState<Record<string, boolean>>({});
  return (
    <aside className="side tree">
      <a className="tree-logo" href="/" aria-label="Neurals">{/* logo: the melted network N */}<svg className="logo-n" viewBox="0 0 100 100" width="20" height="20" aria-hidden="true"><rect x="0" y="0" width="100" height="100" fill="currentColor" /><g transform="translate(15 15) scale(.7)"><filter id="melt-n" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.6" /><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 30 -13" /></filter><g filter="url(#melt-n)"><line x1="24" y1="20" x2="24" y2="50" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" /><line x1="24" y1="50" x2="24" y2="80" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" /><line x1="24" y1="20" x2="50" y2="50" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" /><line x1="50" y1="50" x2="76" y2="80" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" /><line x1="76" y1="20" x2="76" y2="50" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" /><line x1="76" y1="50" x2="76" y2="80" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" /><line x1="24" y1="50" x2="50" y2="50" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" /><line x1="50" y1="50" x2="76" y2="50" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" /><circle cx="24" cy="20" r="9" fill="#ffffff" /><circle cx="24" cy="50" r="9" fill="#ffffff" /><circle cx="24" cy="80" r="9" fill="#ffffff" /><circle cx="50" cy="50" r="12" fill="#ffffff" /><circle cx="76" cy="20" r="9" fill="#ffffff" /><circle cx="76" cy="50" r="9" fill="#ffffff" /><circle cx="76" cy="80" r="9" fill="#ffffff" /></g></g><circle cx="50" cy="50" r="3.5" fill="currentColor" /></svg></a>
      <div className="tree-root">
        {/* the landing page, the main thing: its own row above the folders */}
        <div className="tree-group"><a href="/" className={`tree-folder tree-home-row ${on === '' ? 'on' : ''}`}><Ic n="home" />Home</a></div>
        <div className="tree-group"><a href="/network" className={`tree-folder tree-net ${on === 'network' ? 'on' : ''}`}><Ic n="brain" />The network<iframe className="live-logo" src={`${LAB}/neuron.html?logo&c=pink&fast`} title="live" aria-label="live" tabIndex={-1} /></a><div className="net-tools"><button type="button" className={`net-tool ${splitOn ? 'on' : ''}`} aria-pressed={splitOn} onClick={() => toggleSplit()}>{SPLIT_ICON}split screen</button><button type="button" className="net-tool" onClick={popOut}>{POP_ICON}pop out</button></div><div className="net-soon"><span className="tree-folder net-soon-row" aria-disabled="true">Llama / Mistral / Gemma / DeepSeek</span></div></div>
        {TREE.map((g) => {
          const open = !shut[g.folder];
          return (
            <div key={g.folder} className="tree-group">
              <button className="tree-folder" onClick={() => setShut({ ...shut, [g.folder]: open })}>
                <span className="chev">{open ? '\u2304' : '\u203a'}</span><Ic n={open ? 'open' : 'folder'} />{g.folder}
              </button>
              {open && (
                <div className="tree-items">
                  {g.items.map(([to, name, ic]) => <a key={to} href={`/${to}`} {...(to.endsWith('.pdf') ? { target: '_blank', rel: 'noopener' } : {})} className={`tree-item ${on === to ? 'on' : ''}`}><Ic n={ic} />{name}</a>)}
                  {g.folder === 'You' && <div className={`tree-item tree-wallet ${me ? 'is-on' : ''}`}><Ic n={me ? 'connected' : 'connect'} /><WalletButton onConnected={onConnected} /></div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <span className="side-label">Watch it live</span>
      <button className="side-tour" onClick={startTour}>[Virtual tour]</button>
      <a className="side-buy" href="/buy">[Buy neurons]</a>
      <div className="connect-host"><WalletButton host onConnected={onConnected} /></div>
    </aside>
  );
}
function Crumbs({ on }: { on: string }) {
  const head = document.documentElement.dataset.head, home = !on || on === 'overview' || on === '/';
  const hit = TREE.flatMap((g) => g.items.map((it) => [g.folder, it] as const)).find(([, it]) => it[0] === on);
  return (
    <>
    <div className="crumbbar">
      <a className="crumb-right" href="/buy">[Buy neurons]</a>
    </div>
    {head === '3' && home && <div className="crumb-sub"><span className="crumb-title">A rarity system for neural networks.</span><span>A language model written byte for byte onto Solana and owned through a pump.fun token. Every token on the curve is a piece of it, and every paid message pays the parts that fired.</span></div>}
    </>
  );
}

const BRAIN_SRC = `${LAB}/?embed&theme=paper&white=1&compare`;
let toggleSplit: () => void = () => {};
// pop the network out into its own small window, the way a wallet pops up its own window
let popWin: Window | null = null;
const popOut = () => { const w = 920, h = 720; popWin = window.open(BRAIN_SRC.replace('?embed&', '?'), 'neurals-network', `popup,width=${w},height=${h},left=${Math.max(0, screenX + outerWidth - w - 40)},top=${screenY + 60}`); };
const POP_ICON = <svg className="split-ic" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="4" width="10" height="10" fill="none" /><path d="M8 2 H14 V8 M14 2 L7.5 8.5" fill="none" /></svg>;
const SPLIT_ICON = <svg className="split-ic" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" fill="none" /><rect x="2" y="2.5" width="12" height="5.5" /></svg>;

export function App() {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [error, setError] = useState('');
  const [reveal, setReveal] = useState(false);
  // split view: the live brain in the top part of the window, the page below; remembered between visits
  const [split, setSplit] = useState(() => localStorage.getItem('neurals-split') === '1');
  const [paneH, setPaneH] = useState(() => Number(localStorage.getItem('neurals-split-h')) || 46);
  toggleSplit = () => setSplit((v) => { localStorage.setItem('neurals-split', v ? '0' : '1'); if (!v && location.pathname.startsWith('/network')) navigate('/market'); return !v; }); // turning split on from the homepage opens the first tab
  useEffect(() => { const m = (e: MessageEvent) => { if (e.data && e.data.split === 'toggle') toggleSplit(); if (e.data && e.data.popout) popOut(); if (e.data && e.data.restore) { setSplit(false); localStorage.setItem('neurals-split', '0'); popWin?.close(); popWin = null; } }; addEventListener('message', m); return () => removeEventListener('message', m); }, []);
  useEffect(() => { localStorage.setItem('neurals-split-h', String(paneH)); document.querySelector<HTMLIFrameElement>('iframe.onion')?.contentWindow?.postMessage({ pause: paneH < 14 }, '*'); }, [paneH]);
  const dragSplit = (e: React.PointerEvent) => { e.preventDefault(); const move = (ev: PointerEvent) => setPaneH(Math.max(8, Math.min(80, (ev.clientY / innerHeight) * 100))); const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); document.body.classList.remove('dragging-split'); }; document.body.classList.add('dragging-split'); addEventListener('pointermove', move); addEventListener('pointerup', up); };
  const route = useRoute();
  const wallet = useWallet();
  useEffect(() => { api.config().then(setConfig).catch((e) => setError(String(e.message ?? e))); }, []);
  const ctx = useMemo(() => config && {
    config,
    conn: new Connection(config.rpcUrl, 'confirmed'),
    accounts: new NeuralsAccounts(config.programId),
  }, [config]);

  const page = route[0] ?? '';
  const nav = [['', 'Overview'], ['chat', 'Chat'], ['market', 'Market'], ['rules', 'Rules'], ['glossary', 'Glossary']];
  const navOn = page === 'slot' ? '' : page === 'receipt' ? 'chat' : page === 'wallet' && route[1] && route[1] !== wallet && route[2] !== 'preview' && route[1] !== 'simulate' ? 'market' : page;
  return (
    <>
      {true
        ? <TreeNav splitOn={split} on={navOn} onConnected={() => { navigate('/wallet'); setReveal(true); }} />
        : (
      <aside className="side keys">
          <a className={`key logo ${navOn === '' ? 'on' : ''}`} href="/">neurals</a>
          {nav.filter(([to]) => to !== '').map(([to, name]) => <a key={to} href={`/${to}`} {...(to.endsWith('.pdf') ? { target: '_blank', rel: 'noopener' } : {})} className={`key ${navOn === to ? 'on' : ''}`}>{name}</a>)}
          <a href="/wallet" className={`key ${navOn === 'wallet' ? 'on' : ''}`}>My neurons</a>
          <div className="key keywallet"><WalletButton onConnected={() => { navigate('/wallet'); setReveal(true); }} /></div>
        </aside>
        )}
      <div className="shell">
      {document.documentElement.dataset.variant === 'micro' && <div className="wordrow">{['A', 'rarity', 'system', 'for', 'neural', 'networks', 'on', 'solana'].map((w) => <span key={w}>{w}</span>)}</div>}
      {/* the one live brain: fills the window on the homepage, sits in the top pane in split view */}
      {(page === 'network' || split) && <div className={`brain-dock ${page === 'network' ? 'full' : 'split'}`} style={page === 'network' ? undefined : { height: `${paneH}vh` }}><iframe className="onion" src={BRAIN_SRC} title="The brain, live" onLoad={(e) => { const at = route[0] === 'network' && route[1] === 'part' ? Number(route[2]) : NaN; if (!Number.isNaN(at)) (e.target as HTMLIFrameElement).contentWindow?.postMessage({ goto: at }, '*'); }} /></div>}
      {split && page !== 'network' && <div className="split-bar" style={{ top: `${paneH}vh` }} onPointerDown={dragSplit}><i className="grip" /><button type="button" className="split-x" data-tip="close split screen" aria-label="Close split screen" onPointerDown={(e) => e.stopPropagation()} onClick={() => toggleSplit()}><svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 2 L10 10 M10 2 L2 10" /></svg></button></div>}
      <main className={split && page !== 'network' ? 'split-main' : ''} style={split && page !== 'network' ? { paddingTop: `calc(${paneH}vh + 40px)`, ['--split-top' as string]: `${paneH}vh` } : undefined}>
        {error && <p className="error">Cannot reach the indexer. {error}</p>}
        {!ctx && !error && <Loading />}
        {ctx && (
          <AppContext.Provider value={ctx}>
            {page === '' && <Home />}
            {page === 'network' && <Overview />}
            {page === 'about' && <Overview part="info" />}
            {page === 'slot' && <SlotPage index={Number(route[1])} />}
            {page === 'wallet' && (config?.mint ? <WalletPage address={route[1] ?? wallet ?? null} /> : <NotLive />)}
            {page === 'buy' && (config?.mint ? <Buy /> : <NotLive />)}
            {page === 'market' && <Market />}
            {page === 'chat' && (config?.mint ? <Chat /> : <NotLive />)}
            {page === 'rules' && <Rules />}
            {page === 'rarities' && <Rarities />}
            {page === 'glossary' && <Glossary />}
            {page === 'receipt' && route[1] && <ReceiptPage hash={route[1]} signature={route[2]} />}
          </AppContext.Provider>
        )}
      </main>
      <FontSwitch />
      {reveal && wallet && <Reveal wallet={wallet} onClose={() => setReveal(false)} />}
      </div>
    </>
  );
}

/** Before the token exists (mainnet, ahead of launch): pages that need the token say so instead of failing. */
function NotLive() {
  return (
    <>
      <PageHead title="Not live yet" sub="The Neurals token launches on pump.fun soon. Neurons, wallets, buying and paid chat open the moment it exists." />
      <p className="empty-line">The network, the rules, the glossary and the audit trail are all here to read in the meantime.</p>
    </>
  );
}
