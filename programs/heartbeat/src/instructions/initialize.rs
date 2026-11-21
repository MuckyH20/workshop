use anchor_lang::prelude::*;

use crate::{constants::*, errors::HeartbeatError, events::VaultCreated, state::Vault};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    beneficiary: Pubkey,
    interval_secs: i64,
) -> Result<()> {
    require!(
        (MIN_INTERVAL_SECS..=MAX_INTERVAL_SECS).contains(&interval_secs),
        HeartbeatError::InvalidInterval
    );
    let owner = ctx.accounts.owner.key();
    require!(
        beneficiary != owner && beneficiary != Pubkey::default(),
        HeartbeatError::InvalidBeneficiary
    );

    let vault = &mut ctx.accounts.vault;
    vault.owner = owner;
    vault.beneficiary = beneficiary;
    vault.interval_secs = interval_secs;
    vault.last_ping = Clock::get()?.unix_timestamp;
    vault.bump = ctx.bumps.vault;

    emit!(VaultCreated {
        vault: vault.key(),
        owner,
        beneficiary,
        interval_secs
    });
    Ok(())
}
