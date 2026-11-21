use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};

use crate::{constants::VAULT_SEED, errors::HeartbeatError, events::Deposited, state::Vault};

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner,
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

/// Deposits also count as a check-in.
pub fn handle_deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, HeartbeatError::ZeroAmount);
    transfer(
        CpiContext::new(
            System::id(),
            Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        amount,
    )?;
    let vault = &mut ctx.accounts.vault;
    vault.last_ping = Clock::get()?.unix_timestamp;
    emit!(Deposited {
        vault: vault.key(),
        amount
    });
    Ok(())
}
