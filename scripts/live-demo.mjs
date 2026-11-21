// Live Heartbeat demo against a local validator (http://localhost:8899). Usage: node scripts/live-demo.mjs
// Burner signers are generated in memory and airdropped; no keypair files are read or written.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  address, AccountRole, airdropFactory, appendTransactionMessageInstruction, createSolanaRpc,
  createSolanaRpcSubscriptions, createTransactionMessage, generateKeyPairSigner, getAddressEncoder,
  getI64Encoder, getProgramDerivedAddress, getSignatureFromTransaction, getU64Encoder, lamports, pipe,
  sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
} from "@solana/kit";

const RPC = "http://localhost:8899";
const PROGRAM = address("7ouoJM4gLY56rhSQxaySYmZWksmvsXeBm1wed9EjTKrQ");
const SYSTEM = address("11111111111111111111111111111111");
const INTERVAL = 60n; // seconds (program minimum)
const rpc = createSolanaRpc(RPC);
const rpcSubscriptions = createSolanaRpcSubscriptions("ws://localhost:8900");
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
const link = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(RPC)}`;
const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const data = (name, ...parts) => new Uint8Array(Buffer.concat([disc(name), ...parts.map((p) => Buffer.from(p))]));
const W = AccountRole.WRITABLE, WS = AccountRole.WRITABLE_SIGNER, RS = AccountRole.READONLY_SIGNER, R = AccountRole.READONLY;
const ix = (accounts, d) => ({ programAddress: PROGRAM, accounts: accounts.map(([a, role, signer]) => ({ address: a, role, ...(signer ? { signer } : {}) })), data: d });

const steps = [];
async function send(label, signer, instruction, expectFail = false) {
  const { value: bh } = await rpc.getLatestBlockhash().send();
  const tx = await signTransactionMessageWithSigners(pipe(createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m), (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstruction(instruction, m)));
  const sig = getSignatureFromTransaction(tx);
  let ok = true, err = "";
  try { await sendAndConfirm(tx, { commitment: "confirmed", skipPreflight: expectFail }); }
  catch (e) { ok = false; err = (e?.context?.__code ?? e?.cause?.message ?? e.message ?? "").toString().slice(0, 80); }
  if (ok === expectFail) throw new Error(`${label}: expected ${expectFail ? "failure" : "success"} (${err})`);
  steps.push({ label, sig, ok, link: link(sig) });
  console.log(`${ok ? "✅" : "❌ (rejected on-chain, as expected)"} ${label}\n   ${link(sig)}`);
}

const alice = await generateKeyPairSigner(), bob = await generateKeyPairSigner();
const airdrop = airdropFactory({ rpc, rpcSubscriptions });
await airdrop({ recipientAddress: alice.address, lamports: lamports(10_000_000_000n), commitment: "confirmed" });
await airdrop({ recipientAddress: bob.address, lamports: lamports(1_000_000_000n), commitment: "confirmed" });
const [vault] = await getProgramDerivedAddress({ programAddress: PROGRAM, seeds: ["vault", getAddressEncoder().encode(alice.address)] });
console.log(`\n💓 HEARTBEAT live on ${RPC}\n   Alice ${alice.address}\n   Bob   ${bob.address}\n   Vault ${vault}\n`);

const owner = [alice.address, WS, alice], v = [vault, W];
await send("Alice creates vault (heir: Bob, 60s interval)", alice,
  ix([owner, v, [SYSTEM, R]], data("initialize", getAddressEncoder().encode(bob.address), getI64Encoder().encode(INTERVAL))));
await send("Alice deposits 5 SOL", alice, ix([owner, v, [SYSTEM, R]], data("deposit", getU64Encoder().encode(5_000_000_000n))));
await send("Bob claims too early → StillAlive", bob, ix([[bob.address, WS, bob], v], data("claim")), true);
await send("Alice pings 💓", alice, ix([[alice.address, RS, alice], v], data("ping")));
console.log(`\n⏳ Alice goes silent… waiting ${INTERVAL + 5n}s for the deadline to pass`);
await new Promise((r) => setTimeout(r, Number(INTERVAL + 5n) * 1000));
await send("Bob claims the vault (deadline passed)", bob, ix([[bob.address, WS, bob], v], data("claim")));
const closed = (await rpc.getAccountInfo(vault).send()).value === null;
console.log(`\nVault closed: ${closed}. Bob balance: ${Number((await rpc.getBalance(bob.address).send()).value) / 1e9} SOL\n`);
writeFileSync("target/live-demo.json", JSON.stringify({ rpc: RPC, alice: alice.address, bob: bob.address, vault, steps }, null, 2));
