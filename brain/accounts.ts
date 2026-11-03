// Addresses and instruction builders for the Neurals program, from the contract in program.ts.
// Shared by the indexer (settler), the admin tools, the end-to-end test and the site.

import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { createHash } from 'node:crypto';
import { ACCOUNTS, encode, type Instruction, type InstructionName } from './program.ts';
import type { Range } from './ranges.ts';

const u64le = (n: number | bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

export class NeuralsAccounts {
  readonly programId: PublicKey;
  readonly tokenProgram: PublicKey;

  constructor(programId: PublicKey | string, tokenProgram: PublicKey = TOKEN_2022_PROGRAM_ID) {
    this.programId = new PublicKey(programId);
    this.tokenProgram = tokenProgram;
  }

  private pda(...seeds: Buffer[]): PublicKey {
    return PublicKey.findProgramAddressSync(seeds, this.programId)[0];
  }

  config = () => this.pda(Buffer.from('config'));
  pool = () => this.pda(Buffer.from('pool'));
  checkpoint = (id: number | bigint) => this.pda(Buffer.from('checkpoint'), u64le(id));
  checkpointTokens = (checkpoint: PublicKey) => this.pda(Buffer.from('tokens'), checkpoint.toBuffer());
  epoch = (epoch: number) => this.pda(Buffer.from('epoch'), u64le(epoch));
  ata = (owner: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, this.tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);

  /** Builds an instruction from named accounts; the order comes from the contract. */
  private ix(data: Instruction, accounts: Record<string, PublicKey>, writable: string[], signers: string[]): TransactionInstruction {
    const names = ACCOUNTS[data.name as InstructionName] as readonly string[];
    return new TransactionInstruction({
      programId: this.programId,
      data: encode(data),
      keys: names.map((n) => {
        const pubkey = accounts[n];
        if (!pubkey) throw new Error(`${data.name}: missing account ${n}`);
        return { pubkey, isSigner: signers.includes(n), isWritable: writable.includes(n) };
      }),
    });
  }

  seal(o: { owner: PublicKey; mint: PublicKey; nextId: number | bigint; positions: Range[]; amount: number }): TransactionInstruction {
    const checkpoint = this.checkpoint(o.nextId);
    return this.ix({ name: 'seal', positions: o.positions, amount: o.amount }, {
      owner: o.owner, config: this.config(), checkpoint, checkpointTokens: this.checkpointTokens(checkpoint),
      ownerTokens: this.ata(o.owner, o.mint), mint: o.mint, tokenProgram: this.tokenProgram, systemProgram: SystemProgram.programId,
    }, ['owner', 'config', 'checkpoint', 'checkpointTokens', 'ownerTokens'], ['owner']);
  }

  carry(o: { from: PublicKey; to: PublicKey; mint: PublicKey; positions: Range[]; amount: number }): TransactionInstruction {
    return this.ix({ name: 'carry', positions: o.positions, amount: o.amount }, {
      from: o.from, to: o.to, fromTokens: this.ata(o.from, o.mint), toTokens: this.ata(o.to, o.mint),
      mint: o.mint, tokenProgram: this.tokenProgram, config: this.config(),
    }, ['fromTokens', 'toTokens'], ['from']);
  }

  list = (holder: PublicKey, checkpoint: PublicKey, price: bigint) =>
    this.ix({ name: 'list', price }, { holder, checkpoint }, ['checkpoint'], ['holder']);

  cancel = (holder: PublicKey, checkpoint: PublicKey) =>
    this.ix({ name: 'cancel' }, { holder, checkpoint }, ['checkpoint'], ['holder']);

  gift = (holder: PublicKey, checkpoint: PublicKey, newHolder: PublicKey) =>
    this.ix({ name: 'gift', newHolder: newHolder.toBase58() }, { holder, checkpoint }, ['checkpoint'], ['holder']);

  buy(o: { buyer: PublicKey; checkpoint: PublicKey; holder: PublicKey; treasury: PublicKey; maxPrice: bigint }): TransactionInstruction {
    return this.ix({ name: 'buy', maxPrice: o.maxPrice }, {
      buyer: o.buyer, checkpoint: o.checkpoint, holder: o.holder, treasury: o.treasury, config: this.config(), systemProgram: SystemProgram.programId,
    }, ['buyer', 'checkpoint', 'holder', 'treasury'], ['buyer']);
  }

  withdraw(o: { holder: PublicKey; checkpoint: PublicKey; mint: PublicKey }): TransactionInstruction {
    return this.ix({ name: 'withdraw' }, {
      holder: o.holder, checkpoint: o.checkpoint, checkpointTokens: this.checkpointTokens(o.checkpoint),
      holderTokens: this.ata(o.holder, o.mint), mint: o.mint, tokenProgram: this.tokenProgram,
    }, ['holder', 'checkpoint', 'checkpointTokens', 'holderTokens'], ['holder']);
  }

  payFee = (payer: PublicKey, receipt: string, lamports: number) =>
    this.ix({ name: 'payFee', receipt, lamports }, { payer, config: this.config(), pool: this.pool(), systemProgram: SystemProgram.programId }, ['payer', 'pool'], ['payer']);

  postEpoch(o: { settler: PublicKey; epoch: number; root: Buffer; total: bigint; count: number }): TransactionInstruction {
    return this.ix({ name: 'postEpoch', epoch: o.epoch, root: o.root.toString('hex'), total: o.total, count: o.count }, {
      settler: o.settler, config: this.config(), epoch: this.epoch(o.epoch), pool: this.pool(), systemProgram: SystemProgram.programId,
    }, ['settler', 'epoch', 'pool'], ['settler']);
  }

  claim(o: { payer: PublicKey; wallet: PublicKey; epoch: number; index: number; amount: bigint; proof: Buffer[] }): TransactionInstruction {
    return this.ix({ name: 'claim', epoch: o.epoch, index: o.index, amount: o.amount, proof: o.proof.map((p) => p.toString('hex')) }, {
      payer: o.payer, wallet: o.wallet, epoch: this.epoch(o.epoch), pool: this.pool(),
    }, ['wallet', 'epoch', 'pool'], ['payer']);
  }

  /** The program's ProgramData account (upgradeable loader), which records its upgrade authority. */
  programData = () => PublicKey.findProgramAddressSync([this.programId.toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0];

  setRoles = (admin: PublicKey, settler: PublicKey, treasury: PublicKey, feeBps: number) =>
    this.ix({ name: 'setRoles', settler: settler.toBase58(), treasury: treasury.toBase58(), feeBps }, { admin, config: this.config() }, ['config'], ['admin']);

  adminOffer = () => this.pda(Buffer.from('admin_offer'));

  offerAdmin = (admin: PublicKey, newAdmin: PublicKey) =>
    this.ix({ name: 'offerAdmin', newAdmin: newAdmin.toBase58() }, { admin, config: this.config(), offer: this.adminOffer(), systemProgram: SystemProgram.programId }, ['admin', 'offer'], ['admin']);

  acceptAdmin = (newAdmin: PublicKey) =>
    this.ix({ name: 'acceptAdmin' }, { newAdmin, config: this.config(), offer: this.adminOffer() }, ['newAdmin', 'config', 'offer'], ['newAdmin']);

  vetoEpoch = (admin: PublicKey, epoch: number) =>
    this.ix({ name: 'vetoEpoch', epoch }, { admin, config: this.config(), epoch: this.epoch(epoch), pool: this.pool() }, ['admin', 'epoch', 'pool'], ['admin']);

  /** Admin instructions (not part of the decoded contract): initialize and set_mint. Initialize
   *  must be signed by the program's upgrade authority. */
  initialize(o: { admin: PublicKey; treasury: PublicKey; feeBps: number; settler: PublicKey }): TransactionInstruction {
    const data = Buffer.alloc(8 + 32 + 2 + 32);
    anchorDiscriminator('initialize').copy(data, 0);
    o.treasury.toBuffer().copy(data, 8);
    data.writeUInt16LE(o.feeBps, 40);
    o.settler.toBuffer().copy(data, 42);
    return new TransactionInstruction({
      programId: this.programId, data,
      keys: [
        { pubkey: o.admin, isSigner: true, isWritable: true },
        { pubkey: this.config(), isSigner: false, isWritable: true },
        { pubkey: this.pool(), isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: this.programId, isSigner: false, isWritable: false },
        { pubkey: this.programData(), isSigner: false, isWritable: false },
      ],
    });
  }

  setMint(o: { admin: PublicKey; mint: PublicKey; curveTokenAccount: PublicKey }): TransactionInstruction {
    const data = Buffer.concat([anchorDiscriminator('set_mint'), o.curveTokenAccount.toBuffer()]);
    return new TransactionInstruction({
      programId: this.programId, data,
      keys: [
        { pubkey: o.admin, isSigner: true, isWritable: false },
        { pubkey: this.config(), isSigner: false, isWritable: true },
        { pubkey: o.mint, isSigner: false, isWritable: false },
      ],
    });
  }
}

export const anchorDiscriminator = (name: string) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);

/** Reads the config account: admin, mint, curve token account, treasury, settler, fee, next checkpoint id. */
export function parseConfig(data: Buffer) {
  let o = 8;
  const key = () => { const k = new PublicKey(data.subarray(o, o + 32)); o += 32; return k; };
  const admin = key(), mint = key(), curveTokenAccount = key(), treasury = key(), settler = key();
  const feeBps = data.readUInt16LE(o); o += 2;
  const nextId = data.readBigUInt64LE(o);
  return { admin, mint, curveTokenAccount, treasury, settler, feeBps, nextId };
}

/** Reads a checkpoint account. */
export function parseCheckpoint(data: Buffer) {
  let o = 8;
  const id = data.readBigUInt64LE(o); o += 8;
  const holder = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const tokens = new PublicKey(data.subarray(o, o + 32)); o += 32;
  const amount = data.readBigUInt64LE(o); o += 8;
  const listed = data[o] === 1; o += 1;
  const price = data.readBigUInt64LE(o); o += 8;
  const sealedSlot = data.readBigUInt64LE(o);
  return { id, holder, tokens, amount, listed, price, sealedSlot };
}
