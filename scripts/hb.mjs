#!/usr/bin/env node
// Heartbeat CLI for a local validator. One instruction per command.
//
//   node scripts/hb.mjs status                     [--owner alice]
//   node scripts/hb.mjs init <beneficiary> <secs>  [--as alice]   beneficiary: bob | mallory | <address>
//   node scripts/hb.mjs deposit <sol>              [--as alice]
//   node scripts/hb.mjs ping                       [--as alice]
//   node scripts/hb.mjs withdraw <sol>             [--as alice]
//   node scripts/hb.mjs claim                      [--as bob] [--owner alice]
//   node scripts/hb.mjs whoami
//
// Demo wallets are derived from fixed public seeds ("heartbeat-demo:<name>"), so they are the same on
// every run and nothing is written to disk. Because anyone can derive them, the CLI only talks to localhost.
import { createHash } from "node:crypto";
import {
  address, AccountRole, airdropFactory, appendTransactionMessageInstruction, createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc, createSolanaRpcSubscriptions, createTransactionMessage, getAddressDecoder, getAddressEncoder,
  getBase64EncodedWireTransaction, getI64Encoder, getProgramDerivedAddress, getSignatureFromTransaction,
  getU64Encoder, isAddress, lamports, pipe, sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
} from "@solana/kit";

const RPC = process.env.HB_RPC ?? "http://localhost:8899";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(RPC)) {
  console.error(`Refusing ${RPC}: demo wallets are public, so this CLI only runs against a local validator.`);
  process.exit(1);
}
const WS = RPC.replace("http", "ws").replace(/:(\d+)$/, (_, p) => `:${Number(p) + 1}`);
const PROGRAM = address("7ouoJM4gLY56rhSQxaySYmZWksmvsXeBm1wed9EjTKrQ");
const SYSTEM = address("11111111111111111111111111111111");
const SOL = 1_000_000_000n;
const ERRORS = {
  6000: "InvalidInterval: interval must be 60s to ~10 years", 6001: "InvalidBeneficiary: can't be yourself or the zero address",
  6002: "ZeroAmount: amount must be > 0", 6003: "MathOverflow", 6004: "InsufficientFunds: vault keeps its rent reserve",
  6005: "StillAlive: the deadline hasn't passed yet", 2001: "ConstraintHasOne: you're not this vault's owner/beneficiary",
  2006: "ConstraintSeeds: that vault doesn't belong to the signer", 3012: "AccountNotInitialized: no vault here (run init, or it was claimed)",
  0: "AccountAlreadyInUse: this owner already has a vault",
};

const rpc = createSolanaRpc(RPC);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
const airdrop = airdropFactory({ rpc, rpcSubscriptions });
const link = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(RPC)}`;
const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const data = (name, ...parts) => new Uint8Array(Buffer.concat([disc(name), ...parts.map((p) => Buffer.from(p))]));
const toLamports = (s) => {
  if (!/^\d+(\.\d{1,9})?$/.test(s ?? "")) fail(`Amount must be a number of SOL like 1 or 0.25 (got "${s}")`);
  const [w, f = ""] = s.split(".");
  return BigInt(w) * SOL + BigInt(f.padEnd(9, "0"));
};
const fmt = (l) => `${(Number(l) / 1e9).toFixed(4)} SOL`;
function fail(msg) { console.error(`✕ ${msg}`); process.exit(1); }

async function wallet(name) {
  const seed = createHash("sha256").update(`heartbeat-demo:${name}`).digest();
  const signer = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(seed));
  const { value: bal } = await rpc.getBalance(signer.address).send();
  if (bal < SOL / 10n) await airdrop({ recipientAddress: signer.address, lamports: lamports(5n * SOL), commitment: "confirmed" });
  return signer;
}
async function resolve(who) {
  if (isAddress(who)) return address(who);
  if (/^[a-z]+$/.test(who)) return (await wallet(who)).address;
  fail(`"${who}" is not a demo name (alice, bob, mallory) or a base58 address`);
}
const vaultOf = async (owner) =>
  (await getProgramDerivedAddress({ programAddress: PROGRAM, seeds: ["vault", getAddressEncoder().encode(owner)] }))[0];

async function readVault(vault) {
  const { value } = await rpc.getAccountInfo(vault, { encoding: "base64" }).send();
  if (!value) return null;
  const b = Buffer.from(value.data[0], "base64"), ad = getAddressDecoder();
  return {
    owner: ad.decode(b.subarray(8, 40)), beneficiary: ad.decode(b.subarray(40, 72)),
    interval: b.readBigInt64LE(72), lastPing: b.readBigInt64LE(80), lamports: value.lamports,
  };
}
async function chainNow() {
  const slot = await rpc.getSlot().send();
  return BigInt(await rpc.getBlockTime(slot).send());
}

function errorText(err, logs = []) {
  const code = err?.InstructionError?.[1]?.Custom ?? null;
  if (code !== null) return ERRORS[Number(code)] ?? `custom program error ${code}`;
  return `${JSON.stringify(err, (_, v) => (typeof v === "bigint" ? v.toString() : v))}\n  ${logs.slice(-3).join("\n  ")}`;
}

async function send(label, signer, accounts, ixData) {
  const instruction = {
    programAddress: PROGRAM, data: ixData,
    accounts: accounts.map(([a, role, s]) => ({ address: a, role, ...(s ? { signer: s } : {}) })),
  };
  console.log(`→ ${label}\n  cluster ${RPC} · payer ${signer.address}\n  accounts ${accounts.map(([a]) => a).join(", ")}`);
  const { value: bh } = await rpc.getLatestBlockhash().send();
  const tx = await signTransactionMessageWithSigners(pipe(createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m), (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstruction(instruction, m)));
  const sim = await rpc.simulateTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", commitment: "confirmed" }).send();
  if (sim.value.err) fail(`Rejected in simulation, nothing sent: ${errorText(sim.value.err, sim.value.logs ?? [])}`);
  await sendAndConfirm(tx, { commitment: "confirmed", skipPreflight: true });
  console.log(`✓ confirmed · ${sim.value.unitsConsumed} CU\n  ${link(getSignatureFromTransaction(tx))}`);
}

async function status(ownerName) {
  const owner = await resolve(ownerName), vault = await vaultOf(owner), v = await readVault(vault);
  console.log(`Vault ${vault}  (owner ${ownerName})`);
  if (!v) return console.log("  no vault: run `init`, or it has already been claimed");
  const left = v.lastPing + v.interval - (await chainNow());
  const human = (s) => { s = s < 0n ? -s : s; return `${s / 86400n}d ${(s % 86400n) / 3600n}h ${(s % 3600n) / 60n}m ${s % 60n}s`; };
  console.log(`  balance      ${fmt(v.lamports)}\n  beneficiary  ${v.beneficiary}\n  interval     ${v.interval}s`);
  console.log(left >= 0n ? `  status       ● alive, ${human(left)} until the beneficiary can claim`
                         : `  status       ● silent past deadline by ${human(left)}: claimable now`);
}

// ---- argument parsing ----
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const as = flag("as"), ownerName = flag("owner", "alice");
const [cmd, ...args] = argv;

try {
  await rpc.getHealth().send();
} catch {
  fail(`No validator at ${RPC}. Start one:\n  source scripts/env.sh && solana-test-validator --reset --ledger test-ledger --bpf-program ${PROGRAM} target/deploy/heartbeat.so`);
}

switch (cmd) {
  case "whoami":
    for (const n of ["alice", "bob", "mallory"]) {
      const w = await wallet(n);
      console.log(`${n.padEnd(8)} ${w.address}  ${fmt((await rpc.getBalance(w.address).send()).value)}`);
    }
    break;
  case "status":
    await status(ownerName);
    break;
  case "init": {
    const [ben, secs] = args;
    if (!ben || !/^\d+$/.test(secs ?? "")) fail("usage: init <beneficiary> <interval_secs>   e.g. init bob 120");
    const me = await wallet(as ?? "alice"), beneficiary = await resolve(ben), vault = await vaultOf(me.address);
    await send(`initialize(beneficiary=${ben}, interval_secs=${secs})`, me,
      [[me.address, AccountRole.WRITABLE_SIGNER, me], [vault, AccountRole.WRITABLE], [SYSTEM, AccountRole.READONLY]],
      data("initialize", getAddressEncoder().encode(beneficiary), getI64Encoder().encode(BigInt(secs))));
    break;
  }
  case "deposit":
  case "withdraw": {
    const amount = toLamports(args[0]), me = await wallet(as ?? "alice"), vault = await vaultOf(me.address);
    const accounts = [[me.address, AccountRole.WRITABLE_SIGNER, me], [vault, AccountRole.WRITABLE]];
    if (cmd === "deposit") accounts.push([SYSTEM, AccountRole.READONLY]);
    await send(`${cmd}(${fmt(amount)})`, me, accounts, data(cmd, getU64Encoder().encode(amount)));
    break;
  }
  case "ping": {
    const me = await wallet(as ?? "alice"), vault = await vaultOf(me.address);
    await send("ping()", me, [[me.address, AccountRole.READONLY_SIGNER, me], [vault, AccountRole.WRITABLE]], data("ping"));
    break;
  }
  case "claim": {
    const me = await wallet(as ?? "bob"), vault = await vaultOf(await resolve(ownerName));
    await send(`claim() on ${ownerName}'s vault`, me, [[me.address, AccountRole.WRITABLE_SIGNER, me], [vault, AccountRole.WRITABLE]], data("claim"));
    break;
  }
  default:
    console.log("commands: whoami | status | init <beneficiary> <secs> | deposit <sol> | ping | withdraw <sol> | claim");
    console.log("flags:    --as <alice|bob|mallory>   --owner <name|address>   env HB_RPC=http://localhost:8899");
}
process.exit(0);
