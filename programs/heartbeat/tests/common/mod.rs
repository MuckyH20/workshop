#![allow(dead_code)]
use anchor_lang::{
    prelude::{Clock, Pubkey},
    solana_program::{instruction::Instruction, system_program},
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use heartbeat::state::Vault;
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

pub const SOL: u64 = 1_000_000_000;
pub const DAY: i64 = 86_400;

pub struct Env {
    pub svm: LiteSVM,
    pub owner: Keypair,
    pub heir: Keypair,
    pub vault: Pubkey,
}

pub fn setup() -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../target/deploy/heartbeat.so"
    ));
    svm.add_program(heartbeat::id(), bytes).unwrap();
    let owner = Keypair::new();
    let heir = Keypair::new();
    svm.airdrop(&owner.pubkey(), 10 * SOL).unwrap();
    svm.airdrop(&heir.pubkey(), SOL).unwrap();
    let vault = vault_pda(&owner.pubkey());
    Env {
        svm,
        owner,
        heir,
        vault,
    }
}

pub fn vault_pda(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[heartbeat::VAULT_SEED, owner.as_ref()], &heartbeat::id()).0
}

/// Sends one instruction; Ok(compute units) or Err(debug string of the tx error).
pub fn send(svm: &mut LiteSVM, ix: Instruction, signer: &Keypair) -> Result<u64, String> {
    svm.expire_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    svm.send_transaction(tx)
        .map(|m| m.compute_units_consumed)
        .map_err(|e| format!("{:?}", e.err))
}

pub fn custom(code: u32) -> String {
    format!("Custom({code})")
}

pub fn err(e: heartbeat::errors::HeartbeatError) -> String {
    custom(6000 + e as u32)
}

pub fn warp(svm: &mut LiteSVM, secs: i64) {
    let mut clock: Clock = svm.get_sysvar();
    clock.unix_timestamp += secs;
    svm.set_sysvar(&clock);
}

pub fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
}

pub fn read_vault(svm: &LiteSVM, vault: &Pubkey) -> Option<Vault> {
    let acc = svm.get_account(vault)?;
    if acc.data.is_empty() {
        return None;
    }
    Vault::try_deserialize(&mut acc.data.as_slice()).ok()
}

fn ix(data: Vec<u8>, metas: Vec<anchor_lang::prelude::AccountMeta>) -> Instruction {
    Instruction::new_with_bytes(heartbeat::id(), &data, metas)
}

pub fn ix_initialize(owner: &Pubkey, beneficiary: Pubkey, interval_secs: i64) -> Instruction {
    ix(
        heartbeat::instruction::Initialize {
            beneficiary,
            interval_secs,
        }
        .data(),
        heartbeat::accounts::Initialize {
            owner: *owner,
            vault: vault_pda(owner),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_deposit(owner: &Pubkey, vault: Pubkey, amount: u64) -> Instruction {
    ix(
        heartbeat::instruction::Deposit { amount }.data(),
        heartbeat::accounts::Deposit {
            owner: *owner,
            vault,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_ping(owner: &Pubkey, vault: Pubkey) -> Instruction {
    ix(
        heartbeat::instruction::Ping {}.data(),
        heartbeat::accounts::Ping {
            owner: *owner,
            vault,
        }
        .to_account_metas(None),
    )
}

pub fn ix_withdraw(owner: &Pubkey, vault: Pubkey, amount: u64) -> Instruction {
    ix(
        heartbeat::instruction::Withdraw { amount }.data(),
        heartbeat::accounts::Withdraw {
            owner: *owner,
            vault,
        }
        .to_account_metas(None),
    )
}

pub fn ix_claim(beneficiary: &Pubkey, vault: Pubkey) -> Instruction {
    ix(
        heartbeat::instruction::Claim {}.data(),
        heartbeat::accounts::Claim {
            beneficiary: *beneficiary,
            vault,
        }
        .to_account_metas(None),
    )
}
