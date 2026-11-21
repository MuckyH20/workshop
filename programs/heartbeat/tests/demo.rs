//! Narrated end-to-end demo. Run: `bash scripts/demo.sh`
mod common;
use common::*;
use solana_signer::Signer;

fn sol(l: u64) -> String {
    format!("{:.4} SOL", l as f64 / SOL as f64)
}

fn days_left(e: &Env) -> i64 {
    let v = read_vault(&e.svm, &e.vault).unwrap();
    (v.deadline().unwrap() - now(&e.svm)) / DAY
}

#[test]
fn demo() {
    let mut e = setup();
    let (o, h) = (e.owner.pubkey(), e.heir.pubkey());
    println!("\n💓  HEARTBEAT — a dead-man's-switch vault on Solana (LiteSVM, in-process)\n");
    println!(
        "   Alice (owner): {o}\n   Bob   (heir):  {h}\n   Vault PDA:     {}\n",
        e.vault
    );

    let cu = send(&mut e.svm, ix_initialize(&o, h, 30 * DAY), &e.owner).unwrap();
    println!("1. Alice creates a vault: Bob inherits if she's silent for 30 days.   [{cu} CU]");
    let cu = send(&mut e.svm, ix_deposit(&o, e.vault, 5 * SOL), &e.owner).unwrap();
    println!(
        "2. Alice deposits 5 SOL. Vault balance: {}   [{cu} CU]",
        sol(e.svm.get_balance(&e.vault).unwrap())
    );

    warp(&mut e.svm, 10 * DAY);
    println!(
        "\n   ⏩ 10 days pass… {} days left on the clock",
        days_left(&e)
    );
    let r = send(&mut e.svm, ix_claim(&h, e.vault), &e.heir);
    println!(
        "3. Bob tries to claim early → rejected ({})",
        if r.unwrap_err()
            .contains(&err(heartbeat::errors::HeartbeatError::StillAlive))
        {
            "StillAlive"
        } else {
            "?"
        }
    );

    warp(&mut e.svm, 15 * DAY);
    let cu = send(&mut e.svm, ix_ping(&o, e.vault), &e.owner).unwrap();
    println!(
        "\n   ⏩ 15 more days… Alice pings 💓 — clock resets to {} days   [{cu} CU]",
        days_left(&e)
    );

    warp(&mut e.svm, 31 * DAY);
    println!(
        "\n   ⏩ 31 days of silence… deadline passed {} day(s) ago 🪦",
        -days_left(&e)
    );
    let before = e.svm.get_balance(&h).unwrap();
    let cu = send(&mut e.svm, ix_claim(&h, e.vault), &e.heir).unwrap();
    let gained = e.svm.get_balance(&h).unwrap() - before;
    println!(
        "4. Bob claims: +{} (deposit + rent refund, minus fee). Vault closed: {}   [{cu} CU]",
        sol(gained),
        read_vault(&e.svm, &e.vault).is_none()
    );
    println!("\n✅ Demo complete.\n");
}
