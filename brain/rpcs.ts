// Several RPC endpoints behind one: a request goes to the endpoint in use, and when that endpoint refuses
// (rate limit, used-up quota, server error, network failure) it moves on to the next and stays there, so
// one provider running out never stops the services. Works as `fetch` for @solana/web3.js Connections.

/** Parses the endpoint list: the main URL, then any comma-separated fallbacks; duplicates and blanks dropped. */
export function rpcList(main: string | undefined, fallbacks: string | undefined, last?: string): string[] {
  const all = [main, ...(fallbacks ?? '').split(','), last].map((u) => u?.trim()).filter((u): u is string => !!u);
  return [...new Set(all)];
}

/** The host only, for logs (never the key in the path or query). */
export const hostOf = (url: string) => { try { return new URL(url).host; } catch { return 'rpc'; } };

export function failoverFetch(urls: string[], log: (msg: string) => void = console.log): typeof fetch {
  if (!urls.length) throw new Error('no RPC endpoints');
  let at = 0;
  return async (_input, init) => {
    let last: unknown;
    for (let tried = 0; tried < urls.length; tried++) {
      const i = at;
      try {
        const res = await fetch(urls[i], init);
        if (res.status !== 429 && res.status < 500) return res;
        last = new Error(`HTTP ${res.status}`);
      } catch (e) {
        last = e;
      }
      if (urls.length > 1 && at === i) {
        at = (i + 1) % urls.length;
        log(`rpc: ${hostOf(urls[i])} refused (${last instanceof Error ? last.message : String(last)}); using ${hostOf(urls[at])}`);
      }
    }
    // Every endpoint refused: hand back the last answer's failure so the caller's own retry applies.
    if (last instanceof Error && /^HTTP \d+$/.test(last.message)) return new Response(null, { status: Number(last.message.slice(5)) });
    throw last;
  };
}
