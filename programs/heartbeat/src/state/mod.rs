use anchor_lang::prelude::*;

use crate::errors::HeartbeatError;

#[account]
#[derive(InitSpace)]
pub struct Vault {
    pub owner: Pubkey,
    pub beneficiary: Pubkey,
    pub interval_secs: i64,
    pub last_ping: i64,
    pub bump: u8,
}

impl Vault {
    pub fn deadline(&self) -> Result<i64> {
        self.last_ping
            .checked_add(self.interval_secs)
            .ok_or_else(|| error!(HeartbeatError::MathOverflow))
    }

    pub fn is_expired(&self, now: i64) -> Result<bool> {
        Ok(now > self.deadline()?)
    }
}
