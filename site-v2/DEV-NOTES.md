# Neurals front end handoff (2026-11-10)

> **For the AI assistant integrating this:** before changing any code, read this whole file and list every item in it, section by section, to the developer in the terminal. Do not skip the "To confirm before moving to mainnet" and "Please check" sections.

Front end only. Nothing in brain/, indexer/, brainserver/, programs/, probe/, tools/, deploy/ or the original site/ was changed (git status on the repo is clean). Drop the two folders in this zip into the repo root next to site/.

## What is in the zip
- `site-v2/` the new site (React + Vite). It imports shared code from `brain/` exactly like `site/` does, and talks to the same indexer, brain server and chain helpers.
- `hero-lab/` the 3D pages the site embeds in iframes: the network (`index.html`), the Home blob and chat avatar (`blob.html`), the small spinning neurons, logo and star (`neuron.html`), plus some design compare pages you can ignore (`heroes.html`, `logo.html`, `banner.html`, `symbols.html`, `rarity.html`, `pfp.html`).

## Quick start (double click)
Put `site-v2/`, `hero-lab/` and `START-NEURALS.command` (Mac) or `START-NEURALS.bat` (Windows) in the repo root, then double click the START file. It installs what is needed the first time, starts both servers and opens http://localhost:5215. The site cannot be opened by double clicking an HTML file, because it is built with Vite and needs the dev server.

## Run locally by hand (from the repo root)
1. `cd hero-lab && npm install && cd ..`
2. 3D pages: `npx vite hero-lab --config hero-lab/vite.config.ts --port 5212`
3. Site: `VITE_THEME=white VITE_INDEXER_URL=https://neurals-production.up.railway.app/api npx vite site-v2 --port 5215`

## Deploying
- The site finds the 3D pages through one setting, `VITE_LAB_URL` (see `site-v2/src/lab.ts`). It defaults to `http://localhost:5212`. Set it to wherever `hero-lab` is hosted, for example `VITE_LAB_URL=https://lab.example.com`.
- Keep `VITE_THEME=white`; the whole design is built on that theme.
- The 3D pages read the same indexer API as the site.

## Clean page addresses (please do before launch)
The site currently routes with the hash (`/#/network`, `/#/rarities`, `/#/wallet/<address>`). On the real domain the addresses must be clean: `/network`, `/rarities`, `/market`, `/wallet/<address>`, `/slot/<n>` and so on, with no `#`.
- Switch the router to the History API: `useRoute` in `site-v2/src/App.tsx` reads `location.hash`; read `location.pathname` instead, and turn every `href="#/..."` link into `href="/..."` with `history.pushState` on click (plus a `popstate` listener).
- Every `location.hash = ...` assignment in `site-v2/src` needs the same change.
- The host needs a fallback that serves `index.html` for every path (on Vercel, a rewrite of `/(.*)` to `/index.html`).
- The pinpoint link `#/network/part/<n>` becomes `/network/part/<n>`.

## Design check pages (no chain, no wallet, nothing sent)
Remove these or keep them behind a flag before launch:
- `/market/simulate` (now `#/market/simulate`) a pretend listing to walk through review, verify and buy.
- `#/market/preview-bought` the bought state of the buy pop up.
- `#/wallet/simulate` the My neurons page filled with pretend loose neurons, checkpoints and earnings.
- `#/wallet/<address>/preview` the owner layout of any wallet.
In the simulate and preview pages every action button is blocked in code and only shows a "nothing was sent" message.

## To confirm before moving to mainnet
- Confirm the memory of the AI.
- Confirm the code snippet previewed on the Home page (Network audit trail: the `tools/readback.ts` command and its output) is definitely correct.
- Test the entire pipeline again on devnet before moving to mainnet.
- Test the real time data against the 3D simulation of the network, to make sure the experience is the same now that it is a 3D render.

## Still to add
- The white paper. The [Read our docs] button on Home is disabled for now; link it to the white paper / docs once they exist.

## Colour codes to confirm
Used for ownership everywhere (network key, profiles, tallies, PFPs):
- Yours: pink `#ff3fa4`
- Bought by others: raspberry (maroon) `#a3135f`
- Available: navy `#0b1f6b`

## Liquidity water scales with market cap (wired, please verify)
In the 3D network (`hero-lab/world.ts`, search `LIQ_FULL`) the liquidity water now sizes itself from the token's market cap. Its full drawn size stands for a $1M market cap; below that it shrinks, above it grows (radius = cube root of market cap / $1M, kept between 0.22x and 1.35x so it never vanishes or bursts through the lines). The market cap is read every minute from DexScreener's free public API by the mint from `/config`. If that returns nothing (devnet, or before the pair is indexed) the water stays at the full drawn size. Add `&mcap=250000` to the network URL to preview any market cap. You may prefer to serve market cap from the indexer instead.

**Right now this is a mock up at a $1M market cap.** On devnet there is no market data, so the water shows at the $1M size. At go live it must be connected to the actual token: the live mint in `/config` (or an indexer market cap endpoint) so the water starts small at launch and grows as the market cap grows.

## Please check (backend / data)
- After buying a listed checkpoint on mainnet, the buyer's My neurons page showed nothing in the In wallet box. The 2 neurons only appear under In checkpoints, inside the bought checkpoint. The page shows what the indexer returns (`/wallet/<address>`: `slots` empty, the checkpoint listed under `checkpoints`). If buying is meant to put neurons straight into the buyer's wallet, or the wallet view should count checkpoint neurons as held, that needs a change on the indexer or program side. The front end will show them as soon as the data has them.
- The chat page polls `receiptJob` every 2 seconds after a paid message until the receipt is done (read only, unchanged from before).

## Front end not yet restyled (old look, still reachable)
- `#/buy` (Buy page), `#/receipt/<hash>/<signature>` (receipt detail), `#/about` (old overview info). The chat receipt row now links straight to Solscan, so the receipt page is only reached from old links.

## Main front end changes
- New Home landing page (default route); the 3D network moved to `#/network`.
- Sidebar tree nav, page titles, black active row, pink connected wallet.
- New Rarities page; restyled Constraints, Glossary (60 terms, draft wording) and the part page (`#/slot/<n>`, now titled by the part).
- Market cards, the review, verify and buy pop up (checkout box, inline wallet connect, bought state with pink neuron).
- Seller and owner profile pages (same layout, profile banner, In wallet, Earnings chart, In checkpoints, Your tools, seal pop up, "Show me in the network" which flies the 3D network to a part via `postMessage({ goto: partNumber })`).
- Chat restyle (bubbles, live blob avatar, receipt row with Solscan link).
- New part and stage icons (`site-v2/src/icons.ts`), neuron count icons (`NeuronCount` in `ui.tsx`).
