//! neurals: checkpoints, carry transfers, the neuron market and the fee pool (SPEC §5, §7).
//!
//! What this program guarantees:
//! - Checkpoints and their token accounts are PDAs of this program: no private keys.
//! - Only the token's mint is accepted. It is recorded once, by the admin, right after the token
//!   is created on pump.fun (`set_mint`), so the program can be deployed before the token exists.
//! - The only instruction that moves tokens out of a checkpoint is `withdraw`, by its holder.
//!   Sales and gifts change the holder record; the tokens never move.
//! - Fees paid in go to a program-owned pool. They leave it only by `claim`, against an epoch's
//!   Merkle root posted by the settler, at most once per payout, and never more than was posted.
//! - Only the program's upgrade authority can initialize it, so nobody can take the admin, settler
//!   or treasury roles between deployment and initialization.
//! - A posted root can only be claimed after a challenge window, during which the admin can veto
//!   it: a stolen settler key cannot drain the pool before anyone notices. The admin can replace
//!   the settler and the treasury (`set_roles`).
//!
//! What it does not do: it cannot see positions. Which neurons a seal or carry really moves is
//! decided by the ledger (SPEC §5.5); `positions` here is the sender's declaration, checked only for
//! shape and that it does not name more than the tokens moved.
//!
//! Instruction names, arguments and account order are the contract in brain/program.ts: the
//! decoder reads accounts by position, so they must not be reordered.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("9oaybEFAoXGv1Q6R15djkAiAw69cvyJbpAYJVrFXqcMR");

/// pump.fun tokens: 6 decimals, a fixed supply of 1,000,000,000.
pub const DECIMALS: u8 = 6;
pub const SUPPLY: u64 = 1_000_000_000 * 1_000_000;
/// The largest number of (start, length) pairs a seal or carry may name.
pub const MAX_POSITIONS: usize = 16;
/// The market fee can never be set above 5%.
pub const MAX_FEE_BPS: u16 = 500;
/// The most payouts one epoch can hold (its claim bitmap is sized for them when it is posted).
pub const MAX_CLAIMS: u32 = 50_000;
/// The deepest Merkle proof a claim may carry (2^24 leaves is far beyond MAX_CLAIMS).
pub const MAX_PROOF: usize = 24;
/// Slots between posting an epoch's root and its first claim, during which the admin can veto it:
/// about an hour on mainnet; short on devnet and local test chains (feature "devnet").
#[cfg(not(feature = "devnet"))]
pub const CHALLENGE_SLOTS: u64 = 9_000;
#[cfg(feature = "devnet")]
pub const CHALLENGE_SLOTS: u64 = 20;

/// The market's share of a sale price (rounded down); the seller receives the rest.
pub fn fee_for(price: u64, fee_bps: u16) -> u64 {
    ((price as u128) * (fee_bps as u128) / 10_000) as u64
}

#[program]
pub mod neurals {
    use super::*;

    /// Creates the config and the fee pool. Only the program's upgrade authority may call it (it
    /// becomes the admin), so the roles cannot be taken between deployment and initialization.
    pub fn initialize(ctx: Context<Initialize>, treasury: Pubkey, fee_bps: u16, settler: Pubkey) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, NeuralsError::FeeTooHigh);
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.mint = Pubkey::default();
        c.curve_token_account = Pubkey::default();
        c.treasury = treasury;
        c.settler = settler;
        c.fee_bps = fee_bps;
        c.next_id = 0;
        c.bump = ctx.bumps.config;
        ctx.accounts.pool.bump = ctx.bumps.pool;
        ctx.accounts.pool.outstanding = 0;
        Ok(())
    }

    /// Replaces the settler, the treasury or the market fee (admin only; the fee stays capped).
    pub fn set_roles(ctx: Context<SetRoles>, settler: Pubkey, treasury: Pubkey, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS, NeuralsError::FeeTooHigh);
        let c = &mut ctx.accounts.config;
        c.settler = settler;
        c.treasury = treasury;
        c.fee_bps = fee_bps;
        emit!(RolesSet { settler, treasury, fee_bps });
        Ok(())
    }

    /// Offers the admin role to `new_admin` (admin only). Nothing changes until the new admin
    /// accepts, so a mistyped key cannot lock the program out. A new offer replaces the old one.
    pub fn offer_admin(ctx: Context<OfferAdmin>, new_admin: Pubkey) -> Result<()> {
        let o = &mut ctx.accounts.offer;
        o.new_admin = new_admin;
        o.bump = ctx.bumps.offer;
        emit!(AdminOffered { admin: ctx.accounts.admin.key(), new_admin });
        Ok(())
    }

    /// The offered key accepts the admin role (for example, the treasury multisig's vault).
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let new_admin = ctx.accounts.new_admin.key();
        require_keys_eq!(ctx.accounts.offer.new_admin, new_admin, NeuralsError::NotOfferedAdmin);
        let old = ctx.accounts.config.admin;
        ctx.accounts.config.admin = new_admin;
        emit!(AdminChanged { old_admin: old, new_admin });
        Ok(())
    }

    /// Records the token's mint and its curve token account. Once only, by the admin; the mint must
    /// be fixed-supply with no mint or freeze authority. The curve account is for indexers.
    pub fn set_mint(ctx: Context<SetMint>, curve_token_account: Pubkey) -> Result<()> {
        let mint = &ctx.accounts.mint;
        require!(
            mint.decimals == DECIMALS && mint.supply == SUPPLY && mint.mint_authority.is_none() && mint.freeze_authority.is_none(),
            NeuralsError::BadMint
        );
        let c = &mut ctx.accounts.config;
        require!(c.mint == Pubkey::default(), NeuralsError::MintAlreadySet);
        c.mint = mint.key();
        c.curve_token_account = curve_token_account;
        emit!(MintSet { mint: c.mint, curve_token_account });
        Ok(())
    }

    /// Moves `amount` tokens into a new checkpoint, naming the positions they carry.
    pub fn seal(ctx: Context<Seal>, positions: Vec<Position>, amount: u64) -> Result<()> {
        check_positions(&positions, amount)?;
        let a = &mut *ctx.accounts;
        token_interface::transfer_checked(
            CpiContext::new(
                a.token_program.to_account_info(),
                TransferChecked {
                    from: a.owner_tokens.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.checkpoint_tokens.to_account_info(),
                    authority: a.owner.to_account_info(),
                },
            ),
            amount,
            a.mint.decimals,
        )?;
        // Rejects a mint that delivers less than was sent (for example, a transfer fee).
        a.checkpoint_tokens.reload()?;
        require!(a.checkpoint_tokens.amount == amount, NeuralsError::AmountMismatch);

        let cp = &mut a.checkpoint;
        cp.id = a.config.next_id;
        cp.holder = a.owner.key();
        cp.tokens = a.checkpoint_tokens.key();
        cp.amount = amount;
        cp.listed = false;
        cp.price = 0;
        cp.sealed_slot = Clock::get()?.slot;
        cp.bump = ctx.bumps.checkpoint;
        a.config.next_id = a.config.next_id.checked_add(1).ok_or(NeuralsError::Overflow)?;
        emit!(Sealed { checkpoint: cp.key(), id: cp.id, holder: cp.holder, amount });
        Ok(())
    }

    /// Sends `amount` tokens and the positions they carry to another wallet.
    pub fn carry(ctx: Context<Carry>, positions: Vec<Position>, amount: u64) -> Result<()> {
        check_positions_allow_empty(&positions, amount)?;
        let a = &ctx.accounts;
        require_keys_neq!(a.from.key(), a.to.key(), NeuralsError::SelfCarry);
        token_interface::transfer_checked(
            CpiContext::new(
                a.token_program.to_account_info(),
                TransferChecked {
                    from: a.from_tokens.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.to_tokens.to_account_info(),
                    authority: a.from.to_account_info(),
                },
            ),
            amount,
            a.mint.decimals,
        )?;
        emit!(Carried { from: a.from.key(), to: a.to.key(), amount });
        Ok(())
    }

    pub fn list(ctx: Context<HolderOnly>, price: u64) -> Result<()> {
        let cp = &mut ctx.accounts.checkpoint;
        require!(!cp.listed, NeuralsError::WrongState);
        require!(price > 0, NeuralsError::ZeroPrice);
        cp.listed = true;
        cp.price = price;
        emit!(Listed { checkpoint: cp.key(), price });
        Ok(())
    }

    pub fn cancel(ctx: Context<HolderOnly>) -> Result<()> {
        let cp = &mut ctx.accounts.checkpoint;
        require!(cp.listed, NeuralsError::WrongState);
        cp.listed = false;
        cp.price = 0;
        emit!(Cancelled { checkpoint: cp.key() });
        Ok(())
    }

    /// Pays the holder (price minus the market fee) and the treasury (the fee), and hands over the
    /// checkpoint, in one transaction. `max_price` protects the buyer if the listing changes first.
    pub fn buy(ctx: Context<Buy>, max_price: u64) -> Result<()> {
        let a = &mut *ctx.accounts;
        require!(a.checkpoint.listed, NeuralsError::WrongState);
        require_keys_eq!(a.holder.key(), a.checkpoint.holder, NeuralsError::WrongHolder);
        require_keys_neq!(a.buyer.key(), a.checkpoint.holder, NeuralsError::SelfPurchase);
        let price = a.checkpoint.price;
        require!(price <= max_price, NeuralsError::PriceChanged);

        let fee = fee_for(price, a.config.fee_bps);
        system_program::transfer(
            CpiContext::new(a.system_program.to_account_info(), system_program::Transfer { from: a.buyer.to_account_info(), to: a.holder.to_account_info() }),
            price - fee,
        )?;
        if fee > 0 {
            system_program::transfer(
                CpiContext::new(a.system_program.to_account_info(), system_program::Transfer { from: a.buyer.to_account_info(), to: a.treasury.to_account_info() }),
                fee,
            )?;
        }
        let cp = &mut a.checkpoint;
        let seller = cp.holder;
        cp.holder = a.buyer.key();
        cp.listed = false;
        cp.price = 0;
        emit!(Sold { checkpoint: cp.key(), seller, buyer: cp.holder, price, fee });
        Ok(())
    }

    pub fn gift(ctx: Context<HolderOnly>, new_holder: Pubkey) -> Result<()> {
        let cp = &mut ctx.accounts.checkpoint;
        require!(!cp.listed, NeuralsError::WrongState);
        require!(new_holder != Pubkey::default(), NeuralsError::WrongHolder);
        let from = cp.holder;
        cp.holder = new_holder;
        emit!(Gifted { checkpoint: cp.key(), from, to: new_holder });
        Ok(())
    }

    /// Sends every token in the checkpoint to the holder's token account and closes it. Nothing is
    /// lost: the ledger registers the checkpoint's positions to the holder.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let a = &mut *ctx.accounts;
        require!(!a.checkpoint.listed, NeuralsError::WrongState);
        let id = a.checkpoint.id.to_le_bytes();
        let bump = [a.checkpoint.bump];
        let seeds: &[&[u8]] = &[b"checkpoint", &id, &bump];
        let signer = &[seeds];
        let amount = a.checkpoint_tokens.amount;
        if amount > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    a.token_program.to_account_info(),
                    TransferChecked {
                        from: a.checkpoint_tokens.to_account_info(),
                        mint: a.mint.to_account_info(),
                        to: a.holder_tokens.to_account_info(),
                        authority: a.checkpoint.to_account_info(),
                    },
                    signer,
                ),
                amount,
                a.mint.decimals,
            )?;
        }
        token_interface::close_account(CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            CloseAccount {
                account: a.checkpoint_tokens.to_account_info(),
                destination: a.holder.to_account_info(),
                authority: a.checkpoint.to_account_info(),
            },
            signer,
        ))?;
        emit!(Withdrawn { checkpoint: a.checkpoint.key(), holder: a.holder.key(), amount });
        Ok(())
    }

    /// Pays a message's fee into the pool, naming the hash of its receipt (SPEC §7).
    pub fn pay_fee(ctx: Context<PayFee>, receipt: [u8; 32], lamports: u64) -> Result<()> {
        require!(lamports > 0, NeuralsError::ZeroFee);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer { from: ctx.accounts.payer.to_account_info(), to: ctx.accounts.pool.to_account_info() },
            ),
            lamports,
        )?;
        emit!(FeePaid { payer: ctx.accounts.payer.key(), receipt, lamports });
        Ok(())
    }

    /// Posts one epoch's payouts as a Merkle root (brain/claims.ts). Only the settler may post, once
    /// per epoch, and only what the pool can pay on top of everything posted and not yet claimed.
    pub fn post_epoch(ctx: Context<PostEpoch>, epoch: u64, root: [u8; 32], total: u64, count: u32) -> Result<()> {
        require!(count > 0 && count <= MAX_CLAIMS, NeuralsError::BadClaimCount);
        require!(total > 0, NeuralsError::ZeroAmount);
        let pool = &mut ctx.accounts.pool;
        let info = pool.to_account_info();
        let rent = Rent::get()?.minimum_balance(info.data_len());
        let committed = pool.outstanding.checked_add(total).ok_or(NeuralsError::Overflow)?;
        let needed = rent.checked_add(committed).ok_or(NeuralsError::Overflow)?;
        require!(info.lamports() >= needed, NeuralsError::PoolShort);
        pool.outstanding = committed;
        let e = &mut ctx.accounts.epoch;
        e.epoch = epoch;
        e.root = root;
        e.total = total;
        e.claimed = 0;
        e.count = count;
        e.bits = vec![0u8; bitmap_len(count)];
        e.bump = ctx.bumps.epoch;
        e.posted_slot = Clock::get()?.slot;
        emit!(EpochPosted { epoch, root, total, count });
        Ok(())
    }

    /// Pays one payout of a posted epoch to its wallet. Anyone may send it (the indexer pushes
    /// payouts out); the proof decides who is paid and how much, and each index pays once.
    pub fn claim(ctx: Context<Claim>, epoch: u64, index: u32, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        require!(proof.len() <= MAX_PROOF, NeuralsError::BadProof);
        let wallet = ctx.accounts.wallet.key();
        let e = &mut ctx.accounts.epoch;
        require!(e.epoch == epoch && index < e.count, NeuralsError::BadProof);
        let open = e.posted_slot.checked_add(CHALLENGE_SLOTS).ok_or(NeuralsError::Overflow)?;
        require!(Clock::get()?.slot >= open, NeuralsError::ChallengeWindow);
        let (byte, bit) = ((index / 8) as usize, 1u8 << (index % 8));
        require!(e.bits[byte] & bit == 0, NeuralsError::AlreadyClaimed);
        require!(verify_claim(&e.root, index, &wallet, epoch, amount, &proof), NeuralsError::BadProof);
        e.claimed = e.claimed.checked_add(amount).ok_or(NeuralsError::Overflow)?;
        require!(e.claimed <= e.total, NeuralsError::BadProof);
        e.bits[byte] |= bit;
        let pool = &mut ctx.accounts.pool;
        pool.outstanding = pool.outstanding.checked_sub(amount).ok_or(NeuralsError::Overflow)?;
        pool.sub_lamports(amount)?;
        ctx.accounts.wallet.add_lamports(amount)?;
        emit!(Claimed { epoch, index, wallet, amount });
        Ok(())
    }

    /// Vetoes a posted root during its challenge window (admin only): the epoch account is closed,
    /// its total is released back to the pool, and the settler can post a corrected root.
    pub fn veto_epoch(ctx: Context<VetoEpoch>, epoch: u64) -> Result<()> {
        let e = &ctx.accounts.epoch;
        require!(e.epoch == epoch, NeuralsError::BadProof);
        let open = e.posted_slot.checked_add(CHALLENGE_SLOTS).ok_or(NeuralsError::Overflow)?;
        require!(Clock::get()?.slot < open, NeuralsError::ChallengeOver);
        let unclaimed = e.total.checked_sub(e.claimed).ok_or(NeuralsError::Overflow)?;
        let pool = &mut ctx.accounts.pool;
        pool.outstanding = pool.outstanding.checked_sub(unclaimed).ok_or(NeuralsError::Overflow)?;
        emit!(EpochVetoed { epoch, root: e.root, total: e.total });
        Ok(())
    }
}

pub fn bitmap_len(count: u32) -> usize {
    ((count as usize) + 7) / 8
}

/// Leaf and node hashing exactly as brain/claims.ts: leaf = sha256(0x00 ‖ index u32 ‖ wallet ‖
/// epoch u64 ‖ amount u64), node = sha256(0x01 ‖ smaller ‖ larger).
pub fn verify_claim(root: &[u8; 32], index: u32, wallet: &Pubkey, epoch: u64, amount: u64, proof: &[[u8; 32]]) -> bool {
    use anchor_lang::solana_program::hash::hashv;
    let mut h = hashv(&[&[0u8], &index.to_le_bytes(), wallet.as_ref(), &epoch.to_le_bytes(), &amount.to_le_bytes()]).to_bytes();
    for p in proof {
        h = if h <= *p { hashv(&[&[1u8], &h, p]).to_bytes() } else { hashv(&[&[1u8], p, &h]).to_bytes() };
    }
    h == *root
}

/// Positions are sorted, non-overlapping, non-empty (start, length) pairs that together name no
/// more than `amount` base units. A seal must name at least one.
pub fn check_positions(positions: &[Position], amount: u64) -> Result<u64> {
    require!(!positions.is_empty(), NeuralsError::BadPositionCount);
    check_positions_allow_empty(positions, amount)
}

/// As `check_positions`, but a carry may name none (it then moves tokens only).
pub fn check_positions_allow_empty(positions: &[Position], amount: u64) -> Result<u64> {
    require!(amount > 0, NeuralsError::ZeroAmount);
    require!(positions.len() <= MAX_POSITIONS, NeuralsError::BadPositionCount);
    let mut total: u64 = 0;
    let mut prev_end: Option<u64> = None;
    for p in positions {
        require!(p.len > 0, NeuralsError::EmptyPosition);
        let end = p.start.checked_add(p.len).ok_or(NeuralsError::Overflow)?;
        if let Some(prev) = prev_end {
            require!(p.start >= prev, NeuralsError::UnsortedPositions);
        }
        prev_end = Some(end);
        total = total.checked_add(p.len).ok_or(NeuralsError::Overflow)?;
    }
    require!(total <= amount, NeuralsError::PositionsExceedAmount);
    Ok(total)
}

// ---- accounts (order is the contract in brain/program.ts) ----

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + Pool::INIT_SPACE, seeds = [b"pool"], bump)]
    pub pool: Account<'info, Pool>,
    pub system_program: Program<'info, System>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ NeuralsError::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::Neurals>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ NeuralsError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
}

#[derive(Accounts)]
pub struct SetRoles<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ NeuralsError::NotAdmin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct OfferAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ NeuralsError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(init_if_needed, payer = admin, space = 8 + AdminOffer::INIT_SPACE, seeds = [b"admin_offer"], bump)]
    pub offer: Account<'info, AdminOffer>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    #[account(mut)]
    pub new_admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// Closed on acceptance (its rent goes to the new admin), so an offer is used once.
    #[account(mut, seeds = [b"admin_offer"], bump = offer.bump, close = new_admin)]
    pub offer: Account<'info, AdminOffer>,
}

#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct VetoEpoch<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = admin @ NeuralsError::NotAdmin)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"epoch", epoch_id.to_le_bytes().as_ref()], bump = epoch.bump, close = admin)]
    pub epoch: Account<'info, Epoch>,
    #[account(mut, seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
}

#[derive(Accounts)]
pub struct SetMint<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin @ NeuralsError::NotAdmin)]
    pub config: Account<'info, Config>,
    pub mint: InterfaceAccount<'info, Mint>,
}

#[derive(Accounts)]
pub struct Seal<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, constraint = config.mint == mint.key() @ NeuralsError::WrongMint)]
    pub config: Account<'info, Config>,
    #[account(init, payer = owner, space = 8 + Checkpoint::INIT_SPACE, seeds = [b"checkpoint", config.next_id.to_le_bytes().as_ref()], bump)]
    pub checkpoint: Account<'info, Checkpoint>,
    #[account(
        init,
        payer = owner,
        seeds = [b"tokens", checkpoint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = checkpoint,
        token::token_program = token_program,
    )]
    pub checkpoint_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Carry<'info> {
    pub from: Signer<'info>,
    /// CHECK: only the owner recorded on `to_tokens`, which is checked below.
    pub to: UncheckedAccount<'info>,
    #[account(mut, token::mint = mint, token::authority = from, token::token_program = token_program)]
    pub from_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = to, token::token_program = token_program)]
    pub to_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    #[account(seeds = [b"config"], bump = config.bump, constraint = config.mint == mint.key() @ NeuralsError::WrongMint)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct HolderOnly<'info> {
    pub holder: Signer<'info>,
    #[account(mut, has_one = holder @ NeuralsError::WrongHolder)]
    pub checkpoint: Account<'info, Checkpoint>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub checkpoint: Account<'info, Checkpoint>,
    /// CHECK: checked against `checkpoint.holder` in the handler; only receives lamports.
    #[account(mut)]
    pub holder: UncheckedAccount<'info>,
    /// CHECK: must be the treasury in the config; only receives lamports.
    #[account(mut, address = config.treasury @ NeuralsError::WrongTreasury)]
    pub treasury: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub holder: Signer<'info>,
    #[account(
        mut,
        has_one = holder @ NeuralsError::WrongHolder,
        constraint = checkpoint.tokens == checkpoint_tokens.key() @ NeuralsError::WrongTokens,
        close = holder,
    )]
    pub checkpoint: Account<'info, Checkpoint>,
    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub checkpoint_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = holder, token::token_program = token_program)]
    pub holder_tokens: InterfaceAccount<'info, TokenAccount>,
    /// The checkpoint's mint (checked by `checkpoint_tokens`), which `seal` only accepts from config.
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct PayFee<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(epoch_id: u64, root: [u8; 32], total: u64, count: u32)]
pub struct PostEpoch<'info> {
    #[account(mut)]
    pub settler: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, constraint = config.settler == settler.key() @ NeuralsError::NotSettler)]
    pub config: Account<'info, Config>,
    #[account(init, payer = settler, space = 8 + Epoch::BASE_SPACE + bitmap_len(count), seeds = [b"epoch", epoch_id.to_le_bytes().as_ref()], bump)]
    pub epoch: Account<'info, Epoch>,
    #[account(mut, seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(epoch_id: u64)]
pub struct Claim<'info> {
    pub payer: Signer<'info>,
    /// CHECK: the wallet being paid; the Merkle proof binds the payout to this address.
    #[account(mut)]
    pub wallet: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"epoch", epoch_id.to_le_bytes().as_ref()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    #[account(mut, seeds = [b"pool"], bump = pool.bump)]
    pub pool: Account<'info, Pool>,
}

// ---- state ----

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub curve_token_account: Pubkey,
    pub treasury: Pubkey,
    /// The key that posts each epoch's payout root (the indexer).
    pub settler: Pubkey,
    pub fee_bps: u16,
    pub next_id: u64,
    pub bump: u8,
}

/// A pending handover of the admin role (offer_admin, accept_admin).
#[account]
#[derive(InitSpace)]
pub struct AdminOffer {
    pub new_admin: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub bump: u8,
    /// Lamports posted in epoch roots and not yet claimed.
    pub outstanding: u64,
}

#[account]
pub struct Epoch {
    pub epoch: u64,
    pub root: [u8; 32],
    pub total: u64,
    pub claimed: u64,
    pub count: u32,
    /// One bit per payout index, set once claimed.
    pub bits: Vec<u8>,
    pub bump: u8,
    /// When the root was posted; claims open CHALLENGE_SLOTS later.
    pub posted_slot: u64,
}

impl Epoch {
    /// Everything but the bitmap's bytes: epoch, root, total, claimed, count, vec length, bump,
    /// posted slot.
    pub const BASE_SPACE: usize = 8 + 32 + 8 + 8 + 4 + 4 + 1 + 8;
}

#[account]
#[derive(InitSpace)]
pub struct Checkpoint {
    pub id: u64,
    pub holder: Pubkey,
    pub tokens: Pubkey,
    pub amount: u64,
    pub listed: bool,
    pub price: u64,
    pub sealed_slot: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct Position {
    pub start: u64,
    pub len: u64,
}

// ---- events ----

#[event]
pub struct MintSet { pub mint: Pubkey, pub curve_token_account: Pubkey }
#[event]
pub struct Sealed { pub checkpoint: Pubkey, pub id: u64, pub holder: Pubkey, pub amount: u64 }
#[event]
pub struct Carried { pub from: Pubkey, pub to: Pubkey, pub amount: u64 }
#[event]
pub struct Listed { pub checkpoint: Pubkey, pub price: u64 }
#[event]
pub struct Cancelled { pub checkpoint: Pubkey }
#[event]
pub struct Sold { pub checkpoint: Pubkey, pub seller: Pubkey, pub buyer: Pubkey, pub price: u64, pub fee: u64 }
#[event]
pub struct Gifted { pub checkpoint: Pubkey, pub from: Pubkey, pub to: Pubkey }
#[event]
pub struct Withdrawn { pub checkpoint: Pubkey, pub holder: Pubkey, pub amount: u64 }
#[event]
pub struct FeePaid { pub payer: Pubkey, pub receipt: [u8; 32], pub lamports: u64 }
#[event]
pub struct EpochPosted { pub epoch: u64, pub root: [u8; 32], pub total: u64, pub count: u32 }
#[event]
pub struct Claimed { pub epoch: u64, pub index: u32, pub wallet: Pubkey, pub amount: u64 }
#[event]
pub struct EpochVetoed { pub epoch: u64, pub root: [u8; 32], pub total: u64 }
#[event]
pub struct AdminOffered { pub admin: Pubkey, pub new_admin: Pubkey }
#[event]
pub struct AdminChanged { pub old_admin: Pubkey, pub new_admin: Pubkey }
#[event]
pub struct RolesSet { pub settler: Pubkey, pub treasury: Pubkey, pub fee_bps: u16 }

#[error_code]
pub enum NeuralsError {
    #[msg("Mint is not the token's mint")]
    WrongMint,
    #[msg("The mint is already recorded")]
    MintAlreadySet,
    #[msg("Mint must have 6 decimals, a supply of 1,000,000,000 and no mint or freeze authority")]
    BadMint,
    #[msg("Only the admin can do this")]
    NotAdmin,
    #[msg("Signer is not the checkpoint holder")]
    WrongHolder,
    #[msg("Token account does not belong to this checkpoint")]
    WrongTokens,
    #[msg("Checkpoint is in the wrong state for this action")]
    WrongState,
    #[msg("Price must be greater than zero")]
    ZeroPrice,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Fee must be greater than zero")]
    ZeroFee,
    #[msg("Listing price is above the buyer's maximum")]
    PriceChanged,
    #[msg("Holder cannot buy their own checkpoint")]
    SelfPurchase,
    #[msg("A carry must go to another wallet")]
    SelfCarry,
    #[msg("Too many positions, or none for a seal")]
    BadPositionCount,
    #[msg("Positions must be non-empty")]
    EmptyPosition,
    #[msg("Positions must be sorted and non-overlapping")]
    UnsortedPositions,
    #[msg("Positions name more than the tokens moved")]
    PositionsExceedAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("The checkpoint received a different amount than was sent")]
    AmountMismatch,
    #[msg("Fee account is not the treasury")]
    WrongTreasury,
    #[msg("Market fee cannot exceed 5%")]
    FeeTooHigh,
    #[msg("Only the settler can post epochs")]
    NotSettler,
    #[msg("An epoch holds 1 to 50,000 payouts")]
    BadClaimCount,
    #[msg("The pool cannot cover this epoch on top of unclaimed payouts")]
    PoolShort,
    #[msg("The proof does not match the epoch's root")]
    BadProof,
    #[msg("This payout has already been claimed")]
    AlreadyClaimed,
    #[msg("Only the program's upgrade authority can initialize it")]
    NotUpgradeAuthority,
    #[msg("This epoch's challenge window is still open: claims are not yet allowed")]
    ChallengeWindow,
    #[msg("This epoch's challenge window is over: it can no longer be vetoed")]
    ChallengeOver,
    #[msg("This key was not offered the admin role")]
    NotOfferedAdmin,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(start: u64, len: u64) -> Position {
        Position { start, len }
    }

    #[test]
    fn market_fee() {
        assert_eq!(fee_for(1_000_000_000, 150), 15_000_000);
        assert_eq!(fee_for(66, 150), 0); // rounds down
        assert_eq!(fee_for(u64::MAX, 500), ((u64::MAX as u128) * 500 / 10_000) as u64);
        assert_eq!(fee_for(123, 0), 0);
    }

    #[test]
    fn claim_proofs() {
        use anchor_lang::solana_program::hash::hashv;
        let w1 = Pubkey::new_from_array([1; 32]);
        let w2 = Pubkey::new_from_array([2; 32]);
        let leaf = |i: u32, w: &Pubkey, a: u64| hashv(&[&[0u8], &i.to_le_bytes(), w.as_ref(), &7u64.to_le_bytes(), &a.to_le_bytes()]).to_bytes();
        let (l1, l2) = (leaf(0, &w1, 100), leaf(1, &w2, 200));
        let root = if l1 <= l2 { hashv(&[&[1u8], &l1, &l2]).to_bytes() } else { hashv(&[&[1u8], &l2, &l1]).to_bytes() };
        assert!(verify_claim(&root, 0, &w1, 7, 100, &[l2]));
        assert!(verify_claim(&root, 1, &w2, 7, 200, &[l1]));
        assert!(!verify_claim(&root, 0, &w1, 7, 101, &[l2]));
        assert!(!verify_claim(&root, 1, &w1, 7, 100, &[l2]));
        assert!(!verify_claim(&root, 0, &w1, 8, 100, &[l2]));
        assert_eq!(bitmap_len(1), 1);
        assert_eq!(bitmap_len(8), 1);
        assert_eq!(bitmap_len(9), 2);
    }

    #[test]
    fn positions() {
        assert_eq!(check_positions(&[p(0, 5), p(5, 3)], 8).unwrap(), 8);
        assert_eq!(check_positions(&[p(0, 5)], 100).unwrap(), 5); // naming fewer than moved is fine
        assert!(check_positions(&[p(0, 5)], 4).is_err()); // naming more than moved is not
        assert!(check_positions(&[], 5).is_err());
        assert_eq!(check_positions_allow_empty(&[], 5).unwrap(), 0);
        assert!(check_positions_allow_empty(&[], 0).is_err());
        assert!(check_positions(&[p(0, 0)], 5).is_err());
        assert!(check_positions(&[p(10, 5), p(0, 5)], 10).is_err());
        assert!(check_positions(&[p(0, 5), p(4, 5)], 10).is_err());
        assert!(check_positions(&[p(u64::MAX, 1)], u64::MAX).is_err());
        assert!(check_positions(&vec![p(0, 1); MAX_POSITIONS + 1], 100).is_err());
    }
}
