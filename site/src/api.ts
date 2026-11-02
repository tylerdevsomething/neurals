// The indexer and brain APIs, as the site sees them.
import type { Range } from '../../brain/ranges.ts';

// Hosted, the indexer serves the site and answers at /api on the same origin; in development it
// runs separately on :8787.
export const INDEXER: string = import.meta.env.VITE_INDEXER_URL ?? (import.meta.env.DEV ? 'http://127.0.0.1:8787' : `${location.origin}/api`);

export type SiteConfig = {
  programId: string;
  mint: string;
  curveTokenAccount: string;
  pumpProgramId?: string;
  startSlot: number;
  epochSlots: number;
  model: string;
  rpcUrl: string;
  brainUrl?: string;
  cluster?: string;
};

export type PartInfo = { index: number; kind: string; layer: number | null; within: number | null; stage: string | null; points: number; trait: string | null } | null;
export type BrainSlot = { index: number; kind: string; start: number; end: number; issued: number; part: PartInfo };
export type Brain = { revealed: boolean; issued: number; slots: BrainSlot[] };
export type Health = { synced: number; finalized: number; epoch: number; issued: number; revealed: boolean; fingerprint: string };
export type Holder = { holder: string; checkpoint?: string; amount: number };
export type SlotDetail = BrainSlot & { holders: Holder[] };
export type Payout = { epoch: number; index: number; amount: string; proof: string[] };
export type WalletView = {
  wallet: string;
  balance: number;
  positions: Range[];
  awake: Range[];
  slots: { slot: number; amount: number; awake: number; part: PartInfo }[];
  checkpoints: { checkpoint: string; holder: string; positions: Range[] }[];
  payouts: Payout[];
};
export type CheckpointView = { checkpoint: string; holder: string; positions: Range[] };
export type Activity = { messages: number; shares: number[] };
export type EpochView = { epoch: number; fees: string; carried: string; payouts: number; root?: string };
export type ChatReply = { reply: string; tokens: number; job: string; fee: number };
export type ReceiptJob = { status: 'measuring' | 'paying' | 'done' | 'failed'; receipt?: string; signature?: string; fee: number; error?: string };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${INDEXER}${path}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  config: () => get<SiteConfig>('/config'),
  health: () => get<Health>('/health'),
  brain: () => get<Brain>('/brain'),
  slot: (i: number) => get<SlotDetail>(`/slot/${i}`),
  wallet: (w: string) => get<WalletView>(`/wallet/${w}`),
  checkpoints: () => get<CheckpointView[]>('/checkpoints'),
  epochs: () => get<EpochView[]>('/epochs'),
  activity: () => get<Activity>('/activity'),
};

export async function receiptJob(brainUrl: string, job: string): Promise<ReceiptJob> {
  const res = await fetch(`${brainUrl}/jobs/${job}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as ReceiptJob;
}

export async function chat(brainUrl: string, message: string): Promise<ChatReply> {
  const res = await fetch(`${brainUrl}/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as ChatReply;
}

// ---- formatting ----
export const UNIT = 1_000_000;
export const tokens = (base: number) => base / UNIT;
export const fmt = (n: number, digits = 0) => n.toLocaleString('en-US', { maximumFractionDigits: digits });
export const fmtTokens = (base: number) => fmt(tokens(base));
export const neurons = (base: number) => tokens(base) / 3000;
export const sol = (lamports: string | number | bigint) => Number(lamports) / 1e9;
export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
