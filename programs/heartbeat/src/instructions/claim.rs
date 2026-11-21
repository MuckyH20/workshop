use anchor_lang::prelude::*;

use crate::{constants::VAULT_SEED, errors::HeartbeatError, events::Claimed, state::Vault};

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub beneficiary: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, vault.owner.as_ref()],
        bump = vault.bump,
        has_one = beneficiary,
        close = beneficiary,
    )]
    pub vault: Account<'info, Vault>,
}

/// After the deadline, the beneficiary sweeps every lamport and the vault closes.
pub fn handle_claim(ctx: Context<Claim>) -> Result<()> {
    let vault = &ctx.accounts.vault;
    require!(
        vault.is_expired(Clock::get()?.unix_timestamp)?,
        HeartbeatError::StillAlive
    );
    emit!(Claimed {
        vault: vault.key(),
        beneficiary: vault.beneficiary,
        lamports: vault.to_account_info().lamports(),
    });
    Ok(())
}
