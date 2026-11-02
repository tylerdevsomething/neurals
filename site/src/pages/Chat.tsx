import { useState } from 'react';
import { chat, INDEXER, short, sol, type ChatReply } from '../api.ts';
import { useApp } from '../App.tsx';

type Turn = { message: string; reply?: ChatReply; error?: string };

export function Chat() {
  const { config } = useApp();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!config.brainUrl) return <section><h1>Talk to the brain</h1><p className="muted">The hosted brain is not running for this network.</p></section>;

  const ask = async () => {
    const message = text.trim();
    if (!message) return;
    setText('');
    setBusy(true);
    const i = turns.length;
    setTurns((t) => [...t, { message }]);
    try {
      const reply = await chat(config.brainUrl!, message);
      setTurns((t) => t.map((x, k) => (k === i ? { ...x, reply } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, k) => (k === i ? { ...x, error: (e as Error).message } : x)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat">
      <h1>Talk to the brain</h1>
      <p className="muted">
        Every answer is a paid thought: the brain measures which of its parts fired, publishes a receipt, and pays the
        fee into the pool for their owners. Anyone can replay a receipt to check it.
      </p>
      {turns.map((t, i) => (
        <div key={i} className="turn">
          <p className="you">{t.message}</p>
          {t.reply && (
            <div className="brain">
              <p>{t.reply.reply}</p>
              <p className="receipt">
                {t.reply.tokens} tokens · {sol(t.reply.fee)} SOL to the neurons that fired ·{' '}
                <a href={`#/receipt/${t.reply.receipt}/${t.reply.signature}`}>check receipt {short(t.reply.receipt)}</a>
                <br /><code>node tools/verify-receipt.ts {t.reply.receipt}</code>
              </p>
            </div>
          )}
          {t.error && <p className="error">{t.error}</p>}
          {!t.reply && !t.error && <p className="muted">thinking…</p>}
        </div>
      ))}
      <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="inline">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask the brain something" disabled={busy} />
        <button disabled={busy || !text.trim()}>Send</button>
      </form>
    </section>
  );
}
