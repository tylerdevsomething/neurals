//! LOCALNET AND DEVNET ONLY. A stand-in for pump.fun's bonding curve, so the whole system can be
//! rehearsed before the real token exists. It moves tokens the way pump.fun does (buy: curve to
//! buyer, sell: seller to curve) under the same Anchor instruction names, so the indexer only needs
//! this program's id in place of pump.fun's. There is no pricing: tokens are free.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("D9JSnremGMK5EVSDJM4cXXWaD3cMKchfH41chYwG2Uq8");

#[program]
pub mod test_curve {
    use super::*;

    pub fn initialize_curve(ctx: Context<InitializeCurve>) -> Result<()> {
        ctx.accounts.curve.mint = ctx.accounts.mint.key();
        ctx.accounts.curve.bump = ctx.bumps.curve;
        Ok(())
    }

    pub fn buy(ctx: Context<Buy>, amount: u64, _max_sol_cost: u64) -> Result<()> {
        out_of_curve(&ctx, amount)
    }

    /// One of pump.fun's newer buy variants: the indexer must count it as a buy without a change.
    pub fn buy_exact_sol_in(ctx: Context<Buy>, amount: u64, _min_tokens_out: u64) -> Result<()> {
        out_of_curve(&ctx, amount)
    }

    pub fn sell(ctx: Context<Sell>, amount: u64, _min_sol_output: u64) -> Result<()> {
        let a = &ctx.accounts;
        token_interface::transfer_checked(
            CpiContext::new(
                a.token_program.to_account_info(),
                TransferChecked {
                    from: a.source.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.curve_tokens.to_account_info(),
                    authority: a.seller.to_account_info(),
                },
            ),
            amount,
            a.mint.decimals,
        )
    }

    /// The same token movement as `buy` under pump.fun's migration name: the indexer must treat it
    /// as moving tokens without issuing positions.
    pub fn migrate(ctx: Context<Buy>, amount: u64) -> Result<()> {
        out_of_curve(&ctx, amount)
    }
}

fn out_of_curve(ctx: &Context<Buy>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    let mint_key = a.mint.key();
    let seeds: &[&[u8]] = &[b"curve", mint_key.as_ref(), &[a.curve.bump]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            a.token_program.to_account_info(),
            TransferChecked {
                from: a.curve_tokens.to_account_info(),
                mint: a.mint.to_account_info(),
                to: a.destination.to_account_info(),
                authority: a.curve.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        a.mint.decimals,
    )
}

#[derive(Accounts)]
pub struct InitializeCurve<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = payer, space = 8 + Curve::INIT_SPACE, seeds = [b"curve", mint.key().as_ref()], bump)]
    pub curve: Account<'info, Curve>,
    #[account(
        init,
        payer = payer,
        seeds = [b"curve_tokens", mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = curve,
        token::token_program = token_program,
    )]
    pub curve_tokens: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    pub buyer: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(seeds = [b"curve", mint.key().as_ref()], bump = curve.bump, has_one = mint)]
    pub curve: Account<'info, Curve>,
    #[account(mut, seeds = [b"curve_tokens", mint.key().as_ref()], bump)]
    pub curve_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Sell<'info> {
    pub seller: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(seeds = [b"curve", mint.key().as_ref()], bump = curve.bump, has_one = mint)]
    pub curve: Account<'info, Curve>,
    #[account(mut, seeds = [b"curve_tokens", mint.key().as_ref()], bump)]
    pub curve_tokens: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = seller)]
    pub source: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct Curve {
    pub mint: Pubkey,
    pub bump: u8,
}
