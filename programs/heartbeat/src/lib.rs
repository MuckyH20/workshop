pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("7ouoJM4gLY56rhSQxaySYmZWksmvsXeBm1wed9EjTKrQ");

/// Heartbeat: a dead-man's-switch SOL vault. The owner must check in every
/// `interval_secs`; once the deadline passes the beneficiary may claim everything.
#[program]
pub mod heartbeat {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        beneficiary: Pubkey,
        interval_secs: i64,
    ) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, beneficiary, interval_secs)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handle_deposit(ctx, amount)
    }

    pub fn ping(ctx: Context<Ping>) -> Result<()> {
        instructions::ping::handle_ping(ctx)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handle_withdraw(ctx, amount)
    }

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::claim::handle_claim(ctx)
    }
}
