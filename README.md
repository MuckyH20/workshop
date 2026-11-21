# 💓 Heartbeat — dead-man's-switch SOL vault

Alice locks SOL in a PDA vault and names Bob as heir. Every deposit, withdraw or `ping` resets a countdown.
If Alice goes silent past the deadline, Bob can `claim` the whole vault (it closes to him). A late ping still revives it.

## Verify in 30 seconds

```bash
bash scripts/check.sh   # fmt → SBF build → clippy -D warnings → 11 LiteSVM tests
bash scripts/demo.sh    # narrated offline demo (LiteSVM + clock warp), ~1s after first build
```

Expected tail of `check.sh`:

```
test result: ok. 1 passed; 0 failed   # demo.rs
test result: ok. 10 passed; 0 failed  # test_heartbeat.rs
```

No rustup on the box? `scripts/env.sh` builds with `cargo-build-sbf --no-rustup-override` and the platform-tools rustc.

## Run it: web UI on localhost

```bash
source scripts/env.sh
build_sbf                                                  # → target/deploy/heartbeat.so
solana-test-validator --reset --ledger test-ledger \
  --bpf-program 7ouoJM4gLY56rhSQxaySYmZWksmvsXeBm1wed9EjTKrQ target/deploy/heartbeat.so
# new terminal
pnpm install && pnpm app                                   # → http://127.0.0.1:5173
```

The page shows the vault with a live countdown ring, the three demo wallets (alice = owner, bob = heir,
mallory = attacker), and buttons for every instruction. Switch "Acting as" to try the attacks: Mallory
claiming, Bob claiming early, Alice over-withdrawing. Every transaction is **simulated first**, and rejections
show the decoded Anchor error without being sent.

Prefer a terminal? `node scripts/hb.mjs status | init bob 120 | deposit 1 | ping | withdraw 0.5 | claim --as bob`,
or `pnpm demo:live` for the whole story end-to-end (waits ~65s for the deadline in real time).

> Demo wallets are derived from public seeds (`heartbeat-demo:<name>`) so they're identical on every run and
> nothing touches disk. Because anyone can derive them, `app/server.mjs` and `hb.mjs` refuse any non-localhost
> RPC and the server binds to `127.0.0.1` only.

## Instructions

| ix | who | effect | CU |
|---|---|---|---|
| `initialize(beneficiary, interval_secs)` | owner | create vault PDA `["vault", owner]` | 7,282 |
| `deposit(amount)` | owner | SOL in + ping | 6,126 |
| `ping()` | owner | reset countdown | 4,220 |
| `withdraw(amount)` | owner | SOL out (keeps rent-exempt min) + ping | 4,824 |
| `claim()` | beneficiary | after deadline: sweep + close | ~4.2k |

CU measured by simulation on a local `solana-test-validator` (`claim` from the LiteSVM run).

## Security model

Every attack below has a negative test in `programs/heartbeat/tests/test_heartbeat.rs`.

| Threat | Defense | Test |
|---|---|---|
| Stranger claims the vault | `has_one = beneficiary` + `Signer` on claim | `stranger_cannot_claim` |
| Heir claims while owner is alive | `require!(now > last_ping + interval)` → `StillAlive` | `claim_before_deadline_fails` |
| Someone pings / withdraws another owner's vault | PDA `seeds = ["vault", owner]` + `has_one = owner` + `Signer` | `stranger_cannot_ping_or_withdraw_someone_elses_vault` |
| Re-initialize to hijack beneficiary | `init` (not `init_if_needed`) → account already in use | `cannot_initialize_twice` |
| Withdraw drains the rent reserve, leaving a zombie account | `available = lamports − rent_min`, checked → `InsufficientFunds` | `withdraw_keeps_rent_exempt_minimum` |
| Owner names self / zero address as heir | `beneficiary != owner && != default` → `InvalidBeneficiary` | `rejects_self_or_default_beneficiary` |
| Interval of 0 (instantly claimable) or overflow | `60s ≤ interval ≤ 10y` → `InvalidInterval`; `checked_add` for the deadline | `rejects_bad_interval` |
| Zero-amount no-op transactions | `amount > 0` → `ZeroAmount` | `rejects_zero_amounts` |
| Owner returns after the deadline but before a claim | intended: ping still works and revives the vault | `late_ping_revives_vault` |

Also: canonical bump stored at init and reused (`bump = vault.bump`); `claim` uses Anchor `close = beneficiary`
(lamports and data both go, no revival); all math is `checked_*`; events emitted for every state transition.

**Known limits / not yet done**
- No heir-rotation instruction: the beneficiary is fixed at init. If the heir loses their key, only the owner can get
  the funds out (by withdrawing); if both keys are gone, the SOL is stuck.
- Clients hand-encode instruction data (discriminator + args). A Codama client (`clients/js/`) isn't generated yet.
- Scripts send v0 transactions; the repo convention is v1 once the local validator path is confirmed.
- Not audited.

---

# workshop — Claude Code workspace for Solana (Anchor / Kit / Surfpool)

Drop-in `.claude/` + `CLAUDE.md` + `.mcp.json` for an Anchor project. Designed around three ideas:

1. **Context is cheap to load, expensive to keep.** `CLAUDE.md` stays under 100 lines of always-true facts. Everything else lives in path-scoped `.claude/rules/*.md` (loads only when Claude touches matching files) or skills (load only when invoked).
2. **Guardrails are enforced, not requested.** Permission deny rules + `PreToolUse` hooks make keypair access, mainnet mutation, and generated-code edits mechanically impossible, regardless of what the model decides.
3. **Fresh knowledge beats memory.** The official Solana MCP server and the Solana Foundation `solana-dev` skill are wired in so Claude checks current Anchor/Kit APIs instead of guessing from training data.

## Layout

```
CLAUDE.md                         project facts, commands, conventions, workflow  (~95 lines)
CLAUDE.local.md.example           personal notes template (gitignored once copied)
.mcp.json                         Solana Developer MCP (mcp.solana.com) + Context7
.gitignore                        anchor/node/secrets/claude-local ignores
scripts/setup.sh                  toolchain check, hook chmod, installs solana-dev skill
.claude/
  settings.json                   permissions (allow/ask/deny), env (NO_DNA=1), hooks
  settings.local.json.example     per-developer overrides (acceptEdits, notifications)
  rules/
    security.md                   always loaded — audit checklist + operational rules
    anchor-programs.md            paths: programs/**/*.rs — structure, idioms, deps, verification
    tests.md                      paths: tests/**, programs/**/tests/** — harness choice, coverage rules
    client.md                     paths: app/**, clients/**, scripts/**/*.ts — Kit/Codama rules
  hooks/
    session-context.sh            SessionStart: toolchain versions, CLI cluster, Anchor.toml programs
    protect-secrets.sh            PreToolUse Read/Edit/Write: blocks keypairs, .env, generated code
    guard-bash.sh                 PreToolUse Bash: denies secret dumps / keypair overwrite / piped installers; asks on mainnet or deploy
    format-on-edit.sh             PostToolUse: rustfmt / prettier / taplo
    post-build-check.sh           PostToolUse (anchor build): declare_id! == keypair == Anchor.toml, IDL vs client freshness
  skills/
    new-instruction/              /new-instruction <program> <ix> — full scaffold incl. tests + client regen
    audit/                        /audit [--diff|program] — forks the security-auditor subagent
    deploy/                       /deploy <cluster> — the only sanctioned deploy path (model can't self-invoke)
    test/                         /test — run suite + Anchor error-code triage table
    cu-profile/                   /cu-profile <program> <ix> — CU measurement + optimization playbook
    solana-dev/                   (installed by setup.sh) Solana Foundation's official skill + references
  agents/
    security-auditor.md           read-only, opus, project memory
    anchor-reviewer.md            read-only code-quality reviewer, sonnet
    test-engineer.md              writes tests only, sonnet, acceptEdits
    solana-docs.md                haiku doc-lookup via Solana MCP, no CLAUDE.md
```

## Install

**New project**
```bash
anchor init my-program --test-template litesvm --package-manager pnpm --install-agent-skills
cd my-program
# copy this scaffold's files in (CLAUDE.md, .mcp.json, .claude/, scripts/, merge .gitignore)
bash scripts/setup.sh
claude
```

**Existing project** — copy the same files into the repo root; if you already have a `.claude/settings.json`, merge the `permissions` and `hooks` blocks rather than overwriting. Then `bash scripts/setup.sh`.

In the first session run `/context` (confirm CLAUDE.md + 4 rules loaded), `/mcp` (trust `solana-mcp`), and `/hooks` (see 7 hooks registered).

## Daily flow

| You type | What happens |
|---|---|
| `add a withdraw instruction to vault that ...` | Claude loads `anchor-programs.md`, designs accounts/constraints first, then likely invokes `/new-instruction` |
| `/test` | runs `anchor test`, maps Anchor error codes to causes |
| `/audit --diff` | isolated opus subagent audits changed files, returns severity-ranked report |
| `/cu-profile vault withdraw` | baseline CU → optimizations → pinned budget test |
| `/deploy devnet` | preflight, explicit confirmation, deploy, IDL upload, post-deploy record |
| `@agent-anchor-reviewer review my diff` | code-quality pass before PR |

## Why these specific choices

- **`NO_DNA=1`** in `env`: Anchor and Surfpool detect a non-human operator and drop TUIs/prompts for parseable output.
- **Deny on `Read(…keypair.json)` *and* a Bash hook**: permission deny rules only cover Claude's file tools; `cat target/deploy/x-keypair.json` needs the hook. Both exist.
- **`ask` instead of `deny` for deploys**: you still deploy from the session, but every deploy is a visible approval with the cluster in the prompt.
- **`disable-model-invocation: true` on `/deploy`**: Claude can't decide to deploy because the code "looks ready"; only you can type it.
- **`context: fork` + `agent: security-auditor` on `/audit`**: the audit runs in a clean context that hasn't seen the implementation reasoning — the work isn't grading itself.
- **`CLAUDE_CODE_SUBAGENT_MODEL=sonnet`** default with `model: opus` pinned only on the auditor: cheap exploration, expensive judgment where it matters.
- **Path-scoped rules** instead of one giant CLAUDE.md: the TS rules never consume context while you're in Rust, and vice-versa.

## Customize

- Tighten/loosen `permissions.allow` in `.claude/settings.local.json` (gitignored) rather than the committed file.
- Add CU budgets per instruction in `.claude/rules/anchor-programs.md` once measured.
- Pinocchio instead of Anchor? Swap `anchor-programs.md` for a `pinocchio-programs.md` rule with `paths: programs/**/*.rs` and update the Stack section of `CLAUDE.md`; the hooks and agents are framework-agnostic.
- Run `/doctor prompt-audit` quarterly — it flags stale instructions and files that contradict each other.

## Versions this scaffold assumes (Nov 2026)

Anchor 1.x.x · Solana CLI (Agave) · Surfpool · Rust 1.89+ · Node 20.18+ · `@anchor-lang/core` · `@solana/kit` 8 · Claude Code 2.1.2xx+ (for `.claude/rules/` `paths:` frontmatter and hook `if:` filters). Check `.claude/skills/solana-dev/references/compatibility-matrix.md` after `setup.sh` for the live matrix.
