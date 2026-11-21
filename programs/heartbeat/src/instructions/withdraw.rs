use anchor_lang::prelude::*;

use crate::{constants::VAULT_SEED, errors::HeartbeatError, events::Withdrawn, state::Vault};

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner,
    )]
    pub vault: Account<'info, Vault>,
}

/// Withdrawals also count as a check-in. The vault keeps its rent-exempt minimum.
pub fn handle_withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, HeartbeatError::ZeroAmount);
    let vault_info = ctx.accounts.vault.to_account_info();
    let rent_min = Rent::get()?.minimum_balance(vault_info.data_len());
    let available = vault_info
        .lamports()
        .checked_sub(rent_min)
        .ok_or_else(|| error!(HeartbeatError::MathOverflow))?;
    require!(amount <= available, HeartbeatError::InsufficientFunds);

    vault_info.sub_lamports(amount)?;
    ctx.accounts.owner.add_lamports(amount)?;

    let vault = &mut ctx.accounts.vault;
    vault.last_ping = Clock::get()?.unix_timestamp;
    emit!(Withdrawn {
        vault: vault.key(),
        amount
    });
    Ok(())
}
