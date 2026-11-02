# Neurals — Specification v0 (draft)

Status: working draft. Nothing here is final until the commit memo is posted (§6).
Open decisions are marked **OPEN**.

Design in one line: **an AI brain written byte for byte onto Solana, its neurons numbered and owned
through a pump.fun token, and every paid thought paying the neurons that fired.**

---

## 1. Decisions so far

| Topic | Decision |
|---|---|
| Launchpad | pump.fun (curve-buy decoding, launch watcher, commit-reveal) |
| Network | Devnet first with a mock curve, then mainnet |
| Repo | `C:\git\neurals`, new: ledger, checkpoints, launch ops, inscription and runner |
| Brain | Qwen2.5-1.5B-Instruct class, GGUF Q4_K_M (~1.1 GB), inscribed in full |
| Fees | Activation-weighted: each paid message's fee is split by how much each segment fired |
| Message price | 0.001 SOL per paid message (decided 2026-11-02; can change before launch) |
| Epochs | One day |
| Market fee | 1.5% to the treasury (treasury wallet set before mainnet) |
| Traits | Measured; a part with a trait earns a bonus share (§4) |
| Token moves | Neurons never die: dormant and wake by default, checkpoints for trading, carry transfer for gifts (§5) |

## 2. The brain

Reference architecture (Qwen2.5-1.5B): 28 layers, hidden size 1536, FFN width 8960,
12 attention heads (2 KV heads) per layer, vocabulary 151,936.

Inscription: 960-byte chunks, one SPL Noop transaction each, a tag account per file,
a manifest with SHA-256 per file. ~1.1 GB is about 1.15 million transactions: roughly 6 SOL in base
fees (plus any priority fees) and several hours of writing. The runner (llama.cpp → WebAssembly)
is inscribed too, so the brain can be rebuilt from Solana alone.

## 3. Segments

Sizing comes from the model, not from round token counts. The unit is the **neuron**:
**every 3,000 tokens bought off the curve is one MLP neuron.** Segments are real parts of the model,
so they have different sizes.

Every name below is the model's own anatomy: the parts of a transformer and what
interpretability research has found inside them. There are no human-brain names.

| Segment | Count | Part of the model | Tokens each | Tokens in all |
|---|---|---|---|---|
| Embedding | 1 | Token embeddings: where text enters the model | 3,430,000 | 3,430,000 |
| Attention head | 336 = 28 layers × 12 | One attention head | 100,000 | 33,600,000 |
| Neuron column | 980 = 28 layers × 35 | 256 MLP neurons of one layer (8960 / 35) | 768,000 (256 × 3,000) | 752,640,000 |
| Unembedding | 1 | Output head: where the model chooses its next token | 3,430,000 | 3,430,000 |
| **Total** | **1,318** | | | **793,100,000** |

The total is pump.fun's saleable curve supply exactly. Every MLP neuron in the model
(28 × 8,960 = 250,880) is owned, at 3,000 tokens each.

**Slots, then parts.** Position 0 is the first token bought. Positions fill **slots** in a
fixed pattern, and the reveal (§6) decides which real part of the model each slot is:

1. The Embedding slot (positions 0 – 3,429,999): always the Embedding.
2. 28 bands of 28,080,000 tokens, each with 12 attention-head slots then 35 neuron-column slots.
3. The Unembedding slot (the last 3,430,000 tokens): always the Unembedding.

At the reveal, a permutation drawn from the seed block assigns the 336 real attention heads to the
336 head slots, and the 980 real neuron columns to the 980 column slots. The first buyers still own
where text enters and the last where words come out; in between, a buyer knows the kind of part
they bought (a head or a column) but not which one, and so not its layer or trait.

This is what lets traits be measured (§4): the traits of every real part are public before launch,
but nobody can aim a buy at one, because nobody knows which slot it will land in.

Each part's stage comes from its layer. The stages follow what research broadly finds each depth
of a language model doing:

| Layers | Stage | What that depth does |
|---|---|---|
| 0–3 | Tokenizer layers | Join word pieces back into words |
| 4–7 | Syntax layers | Grammar and sentence structure |
| 8–13 | Semantic layers | Meaning, and how words relate to each other |
| 14–19 | Memory layers | Stored facts (the MLP layers act as the model's memory) |
| 20–24 | Reasoning layers | Combining facts and following the thread |
| 25–27 | Prediction layers | Shaping the final choice of the next token |

## 4. Rare traits

**Traits are measured, not drawn.** Every trait is a true, checkable fact about a real part of the
inscribed model. They are found before launch by a published measurement tool, run on the exact
inscribed GGUF file (the brain people own, quantization included) with a committed reference text.
The tool, its settings, the reference text and the full results go into the rules file, whose hash is
posted before the token exists (§6). Anyone can rerun the tool and get the same list.

Luck is in which part a buyer gets (§3 slots), not in what the parts are.

| Trait | Found in | What it is | How it is measured | Count | Points |
|---|---|---|---|---|---|
| Super Weight | neuron columns | Holds one of the model's largest outlier weights: a single number in an MLP down-projection far larger than the weights around it | Every MLP down-projection weight is scanned; a weight qualifies if its magnitude is at least 100× its layer's typical (root-mean-square) weight | top 3 | 100 |
| Induction Head | attention heads | The circuit that spots a pattern earlier in the context and continues it | Induction score on repeated random token sequences: attention from each token to the token that followed its earlier copy | top 6, score ≥ 0.4 | 85 |
| Massive Activation | neuron columns | Holds a neuron whose activation is thousands of times larger than typical, which the model depends on | Largest absolute MLP activation over the reference text, relative to that layer's median | top 6, ≥ 1,000× median | 70 |
| Attention Sink | attention heads | A head that parks its attention on the first token when it has nowhere useful to look, which keeps the model stable | Average share of attention on the first token over the reference text | top 12, share ≥ 0.8 | 50 |
| Monosemantic | neuron columns | Holds a neuron that responds to one clear thing (rare: most neurons mix many) | Selectivity: of a neuron's 8 strongest activations on the reference text, at least 7 fall on the same token, and that token is at least 20× over-represented there compared with its share of the text (a neuron that fires on commas is consistent, not selective) | top 24 | 30 |

Rules:
- A part qualifies only if it passes the threshold; "top N" is a cap. If the model has fewer parts
  that pass, fewer are given. All the counts are fixed in the rules file before launch.
- A neuron column holds 256 neurons; it takes a neuron trait if any of its neurons (or, for Super
  Weight, any of its neurons' outgoing weights) qualifies.
- At most one trait per part. Traits are given from the most points down; a part already given one
  is skipped, and the next qualifying part takes its place.
- The Embedding and Unembedding are one of a kind and take no trait.
- The thresholds above are proposals, to be set once the tool has been run on the model, so that
  each trait is genuinely rare. Once committed they never change.

**Measured on the inscribed model** (`probe/neurals-traits`, 2026-11-02, Super Weight by the redefinition below; 502-token reference text
`rules/reference.txt`; draft in `rules/neurals-v1.draft.json`):

| Trait | Given | Qualified | Strongest |
|---|---|---|---|
| Super Weight | 3 | 34 | layer 1 column 21: a weight of −11.84, 1,437× the layer's RMS weight (the 34 qualifying weights all feed the massive-activation dimensions) |
| Induction Head | 6 | 15 | layer 14 head 3, score 0.98 |
| Massive Activation | 6 | 74 | layer 1 neuron 7401, 8,544× the layer median (all into hidden dimension 408) |
| Attention Sink | 3 | 6 | layer 14 head 5, 97.6% on the first token (3 of the 6 were already Induction Heads) |
| Monosemantic | 24 | 199 | 7–8 of the top 8 on one rare word, 56–63× chance |

**Super Weight was redefined** (decided 2026-11-02). It first meant a single weight that, removed,
wrecks the model (perplexity ×10 or more), as in the original research. None exists here: removing
the weight behind each of the 6 largest MLP output spikes changed perplexity by at most 1%, including
a genuine outlier (layer 2, value 4.78, about 200× a typical weight, feeding the massive-activation
dimension). This compressed Qwen2.5-1.5B does not depend on one weight. The trait now names the
largest outlier weights, which is true and measurable, without claiming they are critical.

Polysemantic is not a trait: mixing many concepts is what almost every neuron does, so it cannot be rare.

**Traits earn a bonus** (decided 2026-11-02). After the reveal, a part with a trait counts
(100 + points) / 100 times in the fee split: a Super Weight 2×, an Induction Head 1.85×, a Massive
Activation 1.7×, an Attention Sink 1.5×, a Monosemantic neuron 1.3×. The bonus works inside each
kind's budget (§7): it moves share between the parts of a kind, never between kinds. Activation still
decides most of the split: segments that fire more earn more.

## 5. Ownership

**Neurons never die.** Once a position is issued it stays owned for good. Moving tokens can make
neurons **dormant** (they earn nothing for a while), never destroyed. Three rules work together.

### 5.1 Registration
A curve buy registers its fresh positions to the **buying wallet** (the owner of the token account
the curve paid). Positions are issued once: tokens sold back to the curve and bought again carry
no positions, because those positions still belong to their first buyer.

### 5.2 Dormant and wake (the default; nobody has to do anything)
A wallet's registered neurons are **awake** as far as its own token balance covers them:

- **Balance** is the wallet's total balance of the token across all its token accounts. Any
  tokens count, however they got there (bought on Jupiter, sent by someone else, bought back).
- If the balance covers all its registered positions, all are awake. If not, the awake amount is
  the balance, and the **rarest neurons stay awake first** (most trait points, then lowest
  position; before the reveal, lowest position only). The rest are dormant.
- Selling or sending tokens therefore never loses neurons: it puts some to sleep. Buying back
  wakes them.
- **For fees, the balance of an epoch is its lowest point during that epoch**, computed from the
  finalized transactions (pre- and post-balances) of the wallet's token accounts. Buying just before
  a payout and selling straight after earns nothing. **Epoch length: one day** (216,000 slots at
  400 ms; decided 2026-11-02; test runs use shorter epochs).
- **A position earns in an epoch only if it was with the same holder (wallet or checkpoint) at the
  start and at the end of the epoch.** Positions bought, carried or sealed during an epoch start
  earning the next one. This stops a wallet whose neurons are dormant from buying back and sealing
  them into a checkpoint just before the payout to earn for an epoch it did not hold.
- Dormant neurons earn nothing. Their share of each fee is not lost: it goes to the awake neurons
  (the shares are renormalised over the awake portion of the brain).

### 5.3 Checkpoints (for trading neurons)
In machine learning, a checkpoint is a saved, frozen snapshot of a model's weights: the file kept so
nothing is lost and work can be picked up later. Here a **checkpoint** is an account controlled by
the program that freezes a set of neurons together with their tokens, so they can be held, sold or
gifted without anything moving. *"Seal your neurons into a checkpoint."*

- **Seal:** the owner moves tokens into a checkpoint and names the positions they carry (which must
  be registered to them and awake at that moment). A seal naming more positions than the tokens it
  moves carries none. Neurons in a checkpoint are always awake, because their tokens
  cannot leave.
- **List, cancel, buy:** a checkpoint can be listed at a price on the neuron market. A buyer pays and
  becomes the holder in one transaction; the tokens never move. **Market fee: 1.5%** of the price,
  to the treasury (decided 2026-11-02; the program caps it at 5%). The treasury wallet is a
  placeholder on devnet and must be set before mainnet.
- **Gift:** the holder hands the checkpoint to another wallet.
- **Withdraw:** tokens and positions go back to the holder's wallet and are registered to the holder
  (rule 5.2 applies from then on). Nothing is lost.

### 5.4 Carry transfer (for gifts and wallet moves without a sale)
A program instruction sends tokens **and** the positions they carry to another wallet in one
transaction. The positions are registered to the recipient. A plain transfer, done from a wallet
app or a swap, moves tokens only: the positions stay with the sender (and may go dormant).

### 5.5 Checking seals and carries
The program guarantees custody: who controls a checkpoint and that tokens only leave it by withdraw.
The indexer checks the positions named in a seal or carry against the ledger. Named positions the
sender does not own, or that are dormant, are ignored; the tokens still move, and no one else's
neurons are affected. The site checks this before signing, so honest users never send an invalid one.

### 5.6 What the indexer must watch
Only the curve, the registered wallets' token accounts and the checkpoints. It never needs to follow
AMM pools or exchanges, so trading volume elsewhere does not slow it down.

## 6. Launch

1. Before the token: the measurement tool is run on the inscribed model. Commit memo with the SHA-256 of
   the rules file: slot layout, the measured traits of every real part, the tool and reference text
   hashes, and the seed rule.
2. Token created on pump.fun; a watcher records the mint on-chain and the site goes live.
3. After sellout or deadline: the seed block draws the permutation of real parts into slots (§3). The
   reveal is posted and anyone can recompute, in their browser, which part (and so which trait) every
   slot holds.
4. **The reveal takes effect at the first epoch boundary after the seed block**: a point fixed by the
   chain, so every indexer applies it at the same place in the event order and settles identically,
   whenever it reads the reveal.

**Safety rules in the program** (checked by `tools/attacks.ts`):
- Only the program's upgrade authority can initialize it, so nobody can take the admin, settler or
  treasury roles between deployment and initialization.
- A posted payout root can be claimed only after a **challenge window** (about an hour on mainnet).
  During it the admin (a multisig) can veto the root; the indexer raises an alert when a posted root
  differs from the one it computed. A stolen settler key cannot drain the pool unnoticed.
- The admin can replace the settler and the treasury, and change the market fee within its 5% cap.

## 7. Usage fees and activation receipts

A **paid message** goes through the official brain: the hosted chat, the API, the agent's public
account, or a new agent born on the brain. A brain run privately in a visitor's browser cannot be
made to pay; it stays free.

For each paid message:
1. The brain generates the reply (greedy, fixed build). It is then measured by the **canonical
   pass**: a fresh context, the prompt and reply fed teacher-forced in one batch, flash attention off
   (never "auto", which can differ by machine). Generating one token at a time uses different
   arithmetic from a batch, so measuring during generation would not match a verifier's replay.
   **The canonical pass is the WebAssembly build** (`probe/neurals-wasm.cpp`, single thread, built by
   `scripts/build-wasm.sh` and committed in `site/public/wasm/`). WebAssembly arithmetic is specified
   exactly, so it computes bit-identical masses on every machine and in every browser. Native builds
   do not: their kernels depend on the CPU (AVX2 and WebAssembly differed by up to 18 ppm on one part
   of a real receipt). The brain still generates natively, for speed.
   Each part's **activation mass** is the sum of |activation| over the positions that produced the reply:
   - a neuron column: its 256 MLP neurons, at the input of the layer's MLP down-projection;
   - an attention head: its 128 output values, at the input of the layer's attention output;
   - the Embedding: the embedding of each token fed in;
   - the Unembedding: the final hidden state fed to the output head.
2. **Budgets by kind.** The four kinds are measured on different tensors, so their raw numbers are
   not comparable. Each kind gets a fixed part of every fee, in proportion to the tokens it was sold
   for (neuron columns 94.9%, attention heads 4.24%, Embedding and Unembedding 0.43% each), and
   within a kind the budget is split by activation mass. A head and a column that fire at their
   kind's average earn the same per token held.
3. Shares are whole parts per million and add up to exactly 1,000,000 (largest remainder).
   (With 1,318 parts the average share is about 760 ppm; basis points would be too coarse.)
4. A **receipt** (model hash, prompt tokens, reply tokens, the 1,318 shares) is hashed and posted
   with the fee payment.
5. **Checking a receipt.** A verifier replays it **teacher-forced**: it feeds the posted reply
   instead of generating its own, so a near-tie between two next tokens on another machine cannot
   change the reply. The receipt is valid if every replayed share is within a small tolerance of the
   posted one (proposed: ±1 ppm; set by the milestone 1 results). Exact equality is not required,
   because different CPUs and thread counts add floating-point numbers in different orders.
6. **Settlement, once per epoch.** Each part's weight is the sum over the epoch's messages of fee ×
   share. Before the reveal nobody knows which part is in which slot, so a kind's weight is split evenly
   over the slots of that kind. Owners are paid by weight per position held awake for the whole epoch
   (§5.2); dormant and unissued positions are renormalised away. Rounding dust, and the whole pot of
   an epoch where nothing was awake, carries to the next epoch: no lamport is lost. A pot carried
   from an epoch where nothing was awake keeps its fee weights, so it is still paid by what fired; a
   pot with no weights of its own (dust alone) is split evenly within each kind's budget.
   In short, the fee is split by the shares over the awake portion of the brain; each part's share goes
   to the owners of its slot's awake positions, by how much of the slot each holds (§5). Fees can be
   collected per epoch and paid as one transaction per owner, so costs stay low.

pump.fun creator fees on trading volume can be swept into the same pool.

**Main technical risk:** replayed shares must land within the tolerance on other machines, thread
counts and in WebAssembly. Milestone 1 measures this before anything else is built
(`tools/determinism.ts`).

## 8. Milestones

Status as of 2026-11-02.

1. **Activation receipts.** Done. Native: 20 runs bit-identical at 1, 2 and 4 threads, and a
   receipt from the hosted brain on Railway replayed at 0 ppm on the development PC. But native and
   WebAssembly differ (up to 18 ppm), so receipts are now measured by the WebAssembly build, which is
   bit-identical everywhere, and replayed with it in Node and in the browser.
2. **Traits.** Measured on the inscribed model (§4); rules draft in `rules/neurals-v1.draft.json`.
   **Open:** Super Weight (none qualify); the deadline slot is set at launch.
3. **Program.** Done: checkpoints, carry, fee pool, epoch roots and claims; contract test against
   `brain/program.ts`; unit tests.
4. **Inscription.** Done as tooling (resumable, verified on localnet). The full model on devnet or
   mainnet is ~1.15 million transactions (~6 SOL of fees).
5. **Indexer, hosted brain and site.** Done, and online on devnet: the site and indexer at
   https://neurals-production.up.railway.app, the brain at https://brain-production-ec65.up.railway.app.
   The site checks receipts in the browser (hash, model, shares, on-chain payment).
6. **Rehearsal.** Done on localnet (`tools/rehearse.ts`, all checks pass) and on devnet: both programs
   deployed, a test token launched, the indexer following the public cluster, two epochs posted and
   every payout pushed exactly (`tools/devnet-payout.ts`). Writing chunks through the public devnet RPC
   is throttled to a few per second; the full model needs a paid RPC with higher send limits.
   Mainnet is not started.
