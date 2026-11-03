import { useEffect, useRef, useState } from 'react';
import { chat, receiptJob, short, sol, type ChatReply, type ReceiptJob } from '../api.ts';
import { useApp } from '../App.tsx';

type Turn = { id?: string; message: string; reply?: ChatReply; job?: ReceiptJob; error?: string };

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

  const ask = async () => {
    const message = text.trim();
    if (!message) return;
    setText('');
    setBusy(true);
    const id = crypto.randomUUID();
    setTurns((t) => [...t, { id, message }]);
    try {
      const reply = await chat(config.brainUrl!, message);
      update(id, { reply, job: { status: 'measuring', fee: reply.fee } });
      void follow(id, reply.job);
    } catch (e) {
      update(id, { error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const receiptLine = (t: Turn) => {
    const j = t.job;
    if (!j) return null;
    if (j.status === 'measuring') return <span className="muted">measuring which parts of the brain fired…</span>;
    if (j.status === 'paying') return <span className="muted">paying {sol(j.fee)} SOL to the neurons that fired…</span>;
    if (j.status === 'failed') return <span className="error">the receipt could not be completed: {j.error}</span>;
    return (
      <>
        {sol(j.fee)} SOL paid to the neurons that fired ·{' '}
        <a href={`#/receipt/${j.receipt}/${j.signature}`}>see which parts fired and check the receipt {short(j.receipt!)}</a>
      </>
    );
  };

  return (
    <section className="chat">
      <h1>Talk to the brain</h1>
      <p className="muted">
        Every answer is a paid thought. The brain replies first; then it measures which of its parts fired, publishes a
        receipt, and pays the fee into the pool for their owners. Anyone can replay a receipt to check it.
      </p>
      {turns.map((t, i) => (
        <div key={t.id ?? i} className="turn">
          <p className="you">{t.message}</p>
          {t.reply && (
            <div className="brain">
              <p>{t.reply.reply}</p>
              <p className="receipt">{t.reply.tokens} tokens · {receiptLine(t)}</p>
            </div>
          )}
          {t.error && <p className="error">{t.error}</p>}
          {!t.reply && !t.error && <p className="muted">thinking…</p>}
        </div>
      ))}
      <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="inline">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask the brain something" disabled={busy} />
        <button disabled={busy || !text.trim()}>Send</button>
        {turns.length > 0 && <button type="button" className="ghost" disabled={busy} onClick={() => setTurns([])}>Clear</button>}
      </form>
      {turns.length > 0 && <p className="muted">This conversation is saved in this browser only. Receipts stay on the network either way.</p>}
    </section>
  );
}
