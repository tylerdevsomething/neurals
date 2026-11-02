import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Connection } from '@solana/web3.js';
import { api, short, type SiteConfig } from './api.ts';
import { connect, disconnect, useWallet } from './chain.ts';
import { NeuralsAccounts } from '../../brain/accounts.ts';
import { Home } from './pages/Home.tsx';
import { SlotPage } from './pages/Slot.tsx';
import { WalletPage } from './pages/Wallet.tsx';
import { Market } from './pages/Market.tsx';
import { Buy } from './pages/Buy.tsx';
import { Chat } from './pages/Chat.tsx';
import { Rules } from './pages/Rules.tsx';
import { ReceiptPage } from './pages/Receipt.tsx';

export type Ctx = { config: SiteConfig; conn: Connection; accounts: NeuralsAccounts };
const AppContext = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppContext)!;

function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => { setHash(location.hash); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

export function App() {
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [error, setError] = useState('');
  const route = useRoute();
  const wallet = useWallet();
  useEffect(() => { api.config().then(setConfig).catch((e) => setError(String(e.message ?? e))); }, []);
  const ctx = useMemo(() => config && {
    config,
    conn: new Connection(config.rpcUrl, 'confirmed'),
    accounts: new NeuralsAccounts(config.programId),
  }, [config]);

  const page = route[0] ?? '';
  const nav = [['', 'Brain'], ['buy', 'Buy'], ['market', 'Market'], ['chat', 'Chat'], ['wallet', 'My neurons'], ['rules', 'Rules']];
  return (
    <>
      <header>
        <a className="logo" href="#/">neurals</a>
        <nav>
          {nav.map(([to, name]) => <a key={to} href={`#/${to}`} className={page === to ? 'on' : ''}>{name}</a>)}
        </nav>
        {config?.cluster && config.cluster !== 'mainnet' && <span className="cluster">{config.cluster}</span>}
        {wallet
          ? <button className="ghost" onClick={() => void disconnect()} title="Disconnect">{short(wallet)}</button>
          : <button onClick={() => connect().catch((e) => alert(e.message))}>Connect</button>}
      </header>
      <main>
        {error && <p className="error">Cannot reach the indexer: {error}</p>}
        {!ctx && !error && <p className="muted">Loading…</p>}
        {ctx && (
          <AppContext.Provider value={ctx}>
            {page === '' && <Home />}
            {page === 'slot' && <SlotPage index={Number(route[1])} />}
            {page === 'wallet' && <WalletPage address={route[1] ?? wallet ?? null} />}
            {page === 'buy' && <Buy />}
            {page === 'market' && <Market />}
            {page === 'chat' && <Chat />}
            {page === 'rules' && <Rules />}
            {page === 'receipt' && route[1] && <ReceiptPage hash={route[1]} signature={route[2]} />}
          </AppContext.Provider>
        )}
      </main>
      <footer>
        Every neuron of this brain is written byte for byte onto Solana. Fees go to the neurons that fire.
      </footer>
    </>
  );
}
