use anchor_lang::prelude::*;

#[event]
pub struct VaultCreated {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub beneficiary: Pubkey,
    pub interval_secs: i64,
}
#[event]
pub struct Deposited {
    pub vault: Pubkey,
    pub amount: u64,
}
#[event]
pub struct Pinged {
    pub vault: Pubkey,
    pub deadline: i64,
}
#[event]
pub struct Withdrawn {
    pub vault: Pubkey,
    pub amount: u64,
}
#[event]
pub struct Claimed {
    pub vault: Pubkey,
    pub beneficiary: Pubkey,
    pub lamports: u64,
}
