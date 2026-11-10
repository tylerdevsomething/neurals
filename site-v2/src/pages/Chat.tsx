import { useEffect, useRef, useState } from 'react';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { brainHealth, chat, receiptJob, short, sol, type BrainHealth, type ChatReply, type ReceiptJob } from '../api.ts';
import { useApp, askConnect } from '../App.tsx';
import { PageHead } from '../ui.tsx';
import { NeuronPfp } from './Market.tsx';
import { send, useWallet } from '../chain.ts';
import { MEMO_PROGRAM, paymentMemo } from '../../../brain/payment.ts';
import { LAB } from '../lab.ts';

/** payment: the signature of this message's payment, kept so a reply that failed can be retried with it. */
type Turn = { id?: string; message: string; payment?: string; status?: string; reply?: ChatReply; job?: ReceiptJob; error?: string };

/** Errors after which the same payment can be sent again. */
const retryable = (e: string) => !/already used|different message|too old|does not pay|failed on chain/.test(e);

/** A wallet or network error in plain words: a title, one line on what to do, and the raw text kept for Details. */
function explain(raw: string, cluster: string): { title: string; line: string } {
  const net = cluster === 'mainnet' ? 'Mainnet' : 'Devnet';
  if (/L2TExMFKDjpN9kozasaURPirfhy9P8sBXoAN1qa3s95|0x1900/i.test(raw))
    return { title: 'Wrong network in your wallet', line: `This site runs on Solana ${net}. Switch your wallet to ${net} and send again.` };
  if (/user rejected|rejected the request|declined|cancel/i.test(raw))
    return { title: 'Payment cancelled', line: 'You closed the wallet request.' };
  if (/insufficient|no record of a prior credit|0x1/i.test(raw))
    return { title: 'Not enough SOL', line: 'Your wallet needs the message fee plus a small network fee.' };
  if (/blockhash|expired|block height exceeded/i.test(raw))
    return { title: 'Payment timed out', line: 'It took too long to approve. Send again.' };
  if (/busy|503|too many/i.test(raw))
    return { title: 'The network is busy', line: 'Too many messages right now. Try again in a minute.' };
  if (/failed to fetch|network ?error|load failed/i.test(raw))
    return { title: 'Connection problem', line: 'Check your connection and send again.' };
  return { title: 'Something went wrong', line: 'The payment did not go through.' };
}

function ChatError({ raw, cluster, onClose }: { raw: string; cluster: string; onClose: () => void }) {
  const { title, line } = explain(raw, cluster);
  return (
    <div className="chat-alert" role="alert">
      <span className="chat-alert-mark" aria-hidden>!</span>
      <div className="chat-alert-body">
        <b>{title}</b>
        <p>{line} Nothing was sent and you were not charged.</p>
        <details><summary>Details</summary><code>{raw}</code></details>
      </div>
      <button type="button" className="chat-alert-x" aria-label="Dismiss" onClick={onClose}>×</button>
    </div>
  );
}

/** The conversation is kept in this browser only (per network), so a refresh does not lose it. */
const KEEP = 100;
const load = (key: string): Turn[] => {
  try {
    const t = (JSON.parse(localStorage.getItem(key) ?? '[]') as Turn[]).map((x) => ({ ...x, id: x.id ?? crypto.randomUUID() }));
    // A question still waiting for its reply when the page closed will not get one now.
    return t.map((x) => (x.reply || x.error ? x : { ...x, error: 'the page was closed before the reply arrived' }));
  } catch {
    return [];
  }
};

export function Chat() {
  const { config } = useApp();
  const key = `neurals.chat.${config.cluster ?? 'net'}.${config.programId}`;
  const [turns, setTurns] = useState<Turn[]>(() => load(key));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [brain, setBrain] = useState<BrainHealth | null>(null);
  const [brainError, setBrainError] = useState('');
  const [notice, alertLine] = useState('');
  const me = useWallet();
  const { conn } = useApp();
  useEffect(() => { if (config.brainUrl) brainHealth(config.brainUrl).then(setBrain).catch((e) => setBrainError(e.message)); }, []);
  useEffect(() => { localStorage.setItem(key, JSON.stringify(turns.slice(-KEEP))); }, [turns, key]);
  // Receipts still being measured or paid when the page was closed: keep following them.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !config.brainUrl) return;
    resumed.current = true;
    turns.forEach((t) => { if (t.id && t.reply && t.job && (t.job.status === 'measuring' || t.job.status === 'paying')) void follow(t.id, t.reply.job); });
  }, []);
  if (!config.brainUrl) return <section><h1>Talk to the brain</h1><p className="muted">The hosted brain is not running for this network.</p></section>;

  const update = (id: string, patch: Partial<Turn>) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  /** Follows a reply's receipt until it is measured and paid (or fails). */
  const follow = async (id: string, job: string) => {
    for (let tries = 0; tries < 120; tries++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const j = await receiptJob(config.brainUrl!, job);
        update(id, { job: j });
        if (j.status === 'done' || j.status === 'failed') return;
      } catch (e) {
        // The brain forgets jobs after an hour or a restart: this one's outcome can no longer be known.
        if ((e as Error).message === 'no such job') {
          update(id, { job: { status: 'failed', fee: 0, error: 'the brain no longer knows this job (it restarted or the job is over an hour old)' } });
          return;
        }
        // otherwise the brain is busy or briefly unreachable: keep trying for a while
      }
    }
  };

  const needsPayment = brain?.requirePayment ?? true;

  /** Sends a paid message to the brain (again, for a retry with the same payment). */
  const deliver = async (id: string, message: string, payment?: string) => {
    update(id, { status: 'thinking…', error: undefined });
    try {
      const reply = await chat(config.brainUrl!, message, payment);
      update(id, { reply, status: undefined, job: { status: 'measuring', fee: reply.fee } });
      void follow(id, reply.job);
    } catch (e) {
      update(id, { status: undefined, error: (e as Error).message });
    }
  };

  const ask = async () => {
    const message = text.trim();
    if (!message || !brain) return;
    setBusy(true);
    const id = crypto.randomUUID();
    try {
      let payment: string | undefined;
      if (needsPayment) {
        // The visitor pays the brain the message fee, with a memo naming this exact message.
        const user = new PublicKey(me!);
        setTurns((t) => [...t, { id, message, status: 'approve the payment in your wallet…' }]);
        payment = await send(conn, [
          SystemProgram.transfer({ fromPubkey: user, toPubkey: new PublicKey(brain.payer), lamports: brain.fee }),
          new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [], data: Buffer.from(paymentMemo(message)) }),
        ]);
        update(id, { payment });
      } else {
        setTurns((t) => [...t, { id, message }]);
      }
      setText('');
      await deliver(id, message, payment);
    } catch (e) {
      // The payment was refused or failed: nothing was paid, so the message is simply dropped.
      setTurns((t) => t.filter((x) => x.id !== id));
      alertLine((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const receiptLine = (t: Turn) => {
    const j = t.job;
    if (!j) return null;
    const steps = ['Replied', 'Measuring what fired', 'Paying the neurons', 'Receipt posted'];
    const at = j.status === 'measuring' ? 1 : j.status === 'paying' ? 2 : 3;
    if (j.status === 'measuring' || j.status === 'paying') return <span className="receipt-now">{steps[at]}…</span>;
    if (j.status === 'failed') return <span className="error">the receipt could not be completed: {j.error}</span>;
    return (
      <>
        <span>{sol(j.fee)} SOL paid to the neurons that fired</span>
        <a className="seller-go receipt-go" data-tip="Solscan" href={`https://solscan.io/tx/${j.signature}${config.cluster === 'devnet' ? '?cluster=devnet' : ''}`} target="_blank" rel="noreferrer" aria-label="See it on Solscan"><svg viewBox="0 0 14 14" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 10 L10 4 M5 4 H10 V9" /></svg></a>
      </>
    );
  };

  return (
    <section className="chat">
      <PageHead
        title="Chat with the live network"
        sub="Every answer is a paid thought. The network replies, measures which of its parts fired, publishes a receipt and pays your fee to their owners."
        stats={brain ? [[`${sol(brain.fee)}`, 'SOL per message'], [brain.served, 'Messages processed']] : undefined}
      />
      <div className="panel chat-panel">
      <div className="chat-log">
      {turns.map((t, i) => (
        <div key={t.id ?? i} className="turn">
          <div className="msg msg-you"><p className="you">{t.message}</p><span className="avatar chat-av" aria-hidden><NeuronPfp seed={me ?? 'you'} alt={false} color="#17306e" /></span></div>
          {t.reply && (
            <div className="msg msg-net"><NetAv live={turns.length - i <= 3} />
            <div className="net-col"><div className="brain">
              <p>{t.reply.reply}</p>
            </div>
            <div className="receipt-box"><span className="receipt-tok">{t.reply.tokens} tokens</span>{receiptLine(t)}</div></div></div>
          )}
          {t.error && (
            <p className="empty-line chat-err">
              {t.error === 'the page was closed before the reply arrived' ? 'No reply, the page was closed before it arrived.' : t.error}{' '}
              {t.payment && retryable(t.error) && <button className="ghost" disabled={busy} onClick={() => void deliver(t.id!, t.message, t.payment)}>[Try again, already paid]</button>}
            </p>
          )}
          {!t.reply && !t.error && <div className="msg msg-net"><NetAv live /><span className="typing"><i /><i /><i /></span></div>}
        </div>
      ))}
      {brainError && <p className="error">{brainError}</p>}
      {notice && <ChatError raw={notice} cluster={config.cluster ?? 'devnet'} onClose={() => alertLine('')} />}
      </div>
      {/* the bar sits at the bottom of the window; starter prompts wait just above it until the first message */}
      <div className="chat-foot">
      {turns.length === 0 && (
        <div className="suggest">
          <span className="suggest-label">Not sure where to start?</span>
          {['What are you, exactly?', 'Which of your parts are working right now?', 'Explain an attention head in one sentence.'].map((q) => (
            <button key={q} type="button" className="suggest-q" onClick={() => setText(q)}>{q}</button>
          ))}
        </div>
      )}
      {turns.some((t) => !t.reply && !t.error) && <p className="chat-status">{turns.find((t) => !t.reply && !t.error)?.status ?? 'thinking…'}</p>}
      <form onSubmit={(e) => { e.preventDefault(); alertLine(''); void ask(); }} className="inline">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your message…" disabled={busy} maxLength={4000} />
        {needsPayment && !me
          ? <button type="button" onClick={askConnect}>[Connect wallet to chat]</button>
          : <button disabled={busy || !brain || !text.trim()}>{needsPayment && brain ? `Send for ${sol(brain.fee)} SOL` : 'Send'}</button>}
        {turns.length > 0 && <button type="button" className="ghost clear-all" data-tip="Saved in this browser only, receipts stay on the network" disabled={busy} onClick={() => setTurns([])}>[Clear all]</button>}
      </form>
      
      </div>
      </div>
    </section>
  );
}

/** The network's picture in the chat: the live jelly blob from the network, moving. Only the newest replies run it live, older ones show the still N so the page never runs out of 3D canvases. */
function NetAv({ live = false }: { live?: boolean }) {
  return <span className="avatar chat-av net-av" aria-hidden>{live ? <iframe src={`${LAB}/blob.html?pfp`} title="" tabIndex={-1} scrolling="no" /> : <img src="/net-pfp.svg" alt="" />}</span>;
}
