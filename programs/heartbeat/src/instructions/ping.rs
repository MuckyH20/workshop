use anchor_lang::prelude::*;

use crate::{constants::VAULT_SEED, events::Pinged, state::Vault};

#[derive(Accounts)]
pub struct Ping<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner,
    )]
    pub vault: Account<'info, Vault>,
}

/// "I'm alive." Resets the countdown. The owner keeps control until the
/// beneficiary actually claims, so a late ping still revives the vault.
pub fn handle_ping(ctx: Context<Ping>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.last_ping = Clock::get()?.unix_timestamp;
    emit!(Pinged {
        vault: vault.key(),
        deadline: vault.deadline()?
    });
    Ok(())
}
