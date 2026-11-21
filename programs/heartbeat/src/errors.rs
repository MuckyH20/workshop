use anchor_lang::prelude::*;

#[error_code]
pub enum HeartbeatError {
    #[msg("Interval must be between MIN_INTERVAL_SECS and MAX_INTERVAL_SECS")]
    InvalidInterval,
    #[msg("Beneficiary cannot be the owner or the default pubkey")]
    InvalidBeneficiary,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Withdrawal would leave the vault below rent exemption")]
    InsufficientFunds,
    #[msg("Owner is still alive: the heartbeat deadline has not passed")]
    StillAlive,
}
