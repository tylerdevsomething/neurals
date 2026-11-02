// The program (Rust) and brain/program.ts must agree on every instruction's accounts and
// arguments: the decoder reads accounts by position. This reads the Rust source directly, so a
// drift fails here without needing the Solana toolchain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACCOUNTS, type InstructionName } from '../brain/program.ts';

const src = readFileSync(new URL('../programs/neurals/src/lib.rs', import.meta.url), 'utf8');
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Field names of `pub struct <name><'info> { ... }`, in order. */
function accountsOf(struct: string): string[] {
  const m = new RegExp(`pub struct ${struct}<'info> \\{([\\s\\S]*?)\\n\\}`).exec(src);
  if (!m) throw new Error(`no accounts struct ${struct}`);
  return [...m[1].matchAll(/^\s*pub (\w+):/gm)].map((x) => camel(x[1]));
}

/** The handler's accounts struct and argument list: `pub fn <name>(ctx: Context<S>, args) -> ...`. */
function handler(name: string): { struct: string; args: string[] } {
  const m = new RegExp(`pub fn ${name}\\(ctx: Context<(\\w+)>(?:, ([^)]*))?\\)`).exec(src);
  if (!m) throw new Error(`no handler ${name}`);
  return { struct: m[1], args: (m[2] ?? '').split(',').map((a) => a.trim()).filter(Boolean) };
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Argument names and Rust types brain/program.ts encodes, in order. */
const ARGS: Record<InstructionName, string[]> = {
  seal: ['positions: Vec<Position>', 'amount: u64'],
  carry: ['positions: Vec<Position>', 'amount: u64'],
  list: ['price: u64'],
  cancel: [],
  buy: ['max_price: u64'],
  gift: ['new_holder: Pubkey'],
  withdraw: [],
  payFee: ['receipt: [u8; 32]', 'lamports: u64'],
  postEpoch: ['epoch: u64', 'root: [u8; 32]', 'total: u64', 'count: u32'],
  claim: ['epoch: u64', 'index: u32', 'amount: u64', 'proof: Vec<[u8; 32]>'],
};

for (const name of Object.keys(ACCOUNTS) as InstructionName[]) {
  test(`${name}: accounts and arguments match brain/program.ts`, () => {
    const h = handler(snake(name));
    assert.deepEqual(accountsOf(h.struct), [...ACCOUNTS[name]], 'account order');
    assert.deepEqual(h.args, ARGS[name], 'arguments');
  });
}

test('a position is (start: u64, len: u64), as brain/program.ts encodes it', () => {
  assert.match(src, /pub struct Position \{\s*pub start: u64,\s*pub len: u64,\s*\}/);
});
