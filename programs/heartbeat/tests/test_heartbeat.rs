mod common;
use common::*;
use heartbeat::errors::HeartbeatError as E;
use solana_keypair::Keypair;
use solana_signer::Signer;

const CU_BUDGET: u64 = 20_000;

fn funded() -> Env {
    let mut e = setup();
    let (o, h) = (e.owner.pubkey(), e.heir.pubkey());
    assert!(send(&mut e.svm, ix_initialize(&o, h, 30 * DAY), &e.owner).unwrap() < CU_BUDGET);
    assert!(send(&mut e.svm, ix_deposit(&o, e.vault, 2 * SOL), &e.owner).unwrap() < CU_BUDGET);
    e
}

#[test]
fn happy_path_ping_withdraw_claim() {
    let mut e = funded();
    let o = e.owner.pubkey();
    warp(&mut e.svm, 29 * DAY);
    assert!(send(&mut e.svm, ix_ping(&o, e.vault), &e.owner).unwrap() < CU_BUDGET);
    assert_eq!(read_vault(&e.svm, &e.vault).unwrap().last_ping, now(&e.svm));
    assert!(send(&mut e.svm, ix_withdraw(&o, e.vault, SOL / 2), &e.owner).unwrap() < CU_BUDGET);

    warp(&mut e.svm, 31 * DAY);
    let before = e.svm.get_balance(&e.heir.pubkey()).unwrap();
    let vault_lamports = e.svm.get_balance(&e.vault).unwrap();
    assert!(send(&mut e.svm, ix_claim(&e.heir.pubkey(), e.vault), &e.heir).unwrap() < CU_BUDGET);
    assert!(read_vault(&e.svm, &e.vault).is_none(), "vault closed");
    let after = e.svm.get_balance(&e.heir.pubkey()).unwrap();
    assert_eq!(after, before + vault_lamports - 5000);
}

#[test]
fn rejects_bad_interval() {
    let mut e = setup();
    let (o, h) = (e.owner.pubkey(), e.heir.pubkey());
    assert!(send(&mut e.svm, ix_initialize(&o, h, 59), &e.owner)
        .unwrap_err()
        .contains(&err(E::InvalidInterval)));
    let too_long = heartbeat::MAX_INTERVAL_SECS + 1;
    assert!(send(&mut e.svm, ix_initialize(&o, h, too_long), &e.owner)
        .unwrap_err()
        .contains(&err(E::InvalidInterval)));
}

#[test]
fn rejects_self_or_default_beneficiary() {
    let mut e = setup();
    let o = e.owner.pubkey();
    assert!(send(&mut e.svm, ix_initialize(&o, o, DAY), &e.owner)
        .unwrap_err()
        .contains(&err(E::InvalidBeneficiary)));
    let zero = Default::default();
    assert!(send(&mut e.svm, ix_initialize(&o, zero, DAY), &e.owner)
        .unwrap_err()
        .contains(&err(E::InvalidBeneficiary)));
}

#[test]
fn rejects_zero_amounts() {
    let mut e = funded();
    let o = e.owner.pubkey();
    assert!(send(&mut e.svm, ix_deposit(&o, e.vault, 0), &e.owner)
        .unwrap_err()
        .contains(&err(E::ZeroAmount)));
    assert!(send(&mut e.svm, ix_withdraw(&o, e.vault, 0), &e.owner)
        .unwrap_err()
        .contains(&err(E::ZeroAmount)));
}

#[test]
fn withdraw_keeps_rent_exempt_minimum() {
    let mut e = funded();
    let o = e.owner.pubkey();
    let r = send(&mut e.svm, ix_withdraw(&o, e.vault, 2 * SOL + 1), &e.owner);
    assert!(r.unwrap_err().contains(&err(E::InsufficientFunds)));
    assert!(send(&mut e.svm, ix_withdraw(&o, e.vault, 2 * SOL), &e.owner).is_ok());
}

#[test]
fn claim_before_deadline_fails() {
    let mut e = funded();
    warp(&mut e.svm, 30 * DAY); // exactly at deadline: still alive
    let r = send(&mut e.svm, ix_claim(&e.heir.pubkey(), e.vault), &e.heir);
    assert!(r.unwrap_err().contains(&err(E::StillAlive)));
}

#[test]
fn late_ping_revives_vault() {
    let mut e = funded();
    warp(&mut e.svm, 45 * DAY);
    send(&mut e.svm, ix_ping(&e.owner.pubkey(), e.vault), &e.owner).unwrap();
    let r = send(&mut e.svm, ix_claim(&e.heir.pubkey(), e.vault), &e.heir);
    assert!(r.unwrap_err().contains(&err(E::StillAlive)));
}

#[test]
fn stranger_cannot_claim() {
    let mut e = funded();
    warp(&mut e.svm, 31 * DAY);
    let thief = Keypair::new();
    e.svm.airdrop(&thief.pubkey(), SOL).unwrap();
    let r = send(&mut e.svm, ix_claim(&thief.pubkey(), e.vault), &thief);
    assert!(r.unwrap_err().contains(&custom(2001)), "ConstraintHasOne");
}

#[test]
fn stranger_cannot_ping_or_withdraw_someone_elses_vault() {
    let mut e = funded();
    let thief = Keypair::new();
    e.svm.airdrop(&thief.pubkey(), SOL).unwrap();
    // Vault PDA is derived from the signer, so the owner's vault fails the seeds constraint (2006).
    let r = send(&mut e.svm, ix_ping(&thief.pubkey(), e.vault), &thief);
    assert!(r.unwrap_err().contains(&custom(2006)));
    let r = send(
        &mut e.svm,
        ix_withdraw(&thief.pubkey(), e.vault, SOL),
        &thief,
    );
    assert!(r.unwrap_err().contains(&custom(2006)));
}

#[test]
fn cannot_initialize_twice() {
    let mut e = funded();
    let (o, h) = (e.owner.pubkey(), e.heir.pubkey());
    assert!(send(&mut e.svm, ix_initialize(&o, h, DAY), &e.owner).is_err());
}
