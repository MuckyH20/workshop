#!/usr/bin/env node
// Heartbeat web UI for a local validator.  Usage: node app/server.mjs   →  http://127.0.0.1:5173
//
// Uses the same public demo wallets as scripts/hb.mjs (derived from "heartbeat-demo:<name>"), signed
// server-side. Anyone can derive those keys, so this server only talks to a localhost RPC and only
// listens on 127.0.0.1. No keypair files are read or written.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import {
  address, AccountRole, airdropFactory, appendTransactionMessageInstruction, createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc, createSolanaRpcSubscriptions, createTransactionMessage, getAddressDecoder, getAddressEncoder,
  getBase64EncodedWireTransaction, getI64Encoder, getProgramDerivedAddress, getSignatureFromTransaction,
  getU64Encoder, isAddress, lamports, pipe, sendAndConfirmTransactionFactory, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
} from "@solana/kit";

const RPC = process.env.HB_RPC ?? "http://localhost:8899";
const PORT = Number(process.env.PORT ?? 5173);
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(RPC)) {
  console.error(`Refusing ${RPC}: demo wallets are public, so this UI only runs against a local validator.`);
  process.exit(1);
}
const WS = RPC.replace("http", "ws").replace(/:(\d+)$/, (_, p) => `:${Number(p) + 1}`);
const PROGRAM = address("7ouoJM4gLY56rhSQxaySYmZWksmvsXeBm1wed9EjTKrQ");
const SYSTEM = address("11111111111111111111111111111111");
const SOL = 1_000_000_000n;
const NAMES = ["alice", "bob", "mallory"];
const ERRORS = {
  6000: "InvalidInterval: interval must be 60s to ~10 years",
  6001: "InvalidBeneficiary: can't be yourself or the zero address",
  6002: "ZeroAmount: amount must be > 0",
  6003: "MathOverflow",
  6004: "InsufficientFunds: the vault keeps its rent-exempt reserve",
  6005: "StillAlive: the owner's deadline hasn't passed yet",
  2001: "ConstraintHasOne: signer isn't this vault's owner / beneficiary",
  2006: "ConstraintSeeds: that vault doesn't belong to the signer",
  3012: "AccountNotInitialized: no vault here (create one, or it was already claimed)",
  0: "AccountAlreadyInUse: this owner already has a vault",
};

const rpc = createSolanaRpc(RPC);
const rpcSubscriptions = createSolanaRpcSubscriptions(WS);
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
const airdrop = airdropFactory({ rpc, rpcSubscriptions });
const explorer = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(RPC)}`;
const disc = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const ixData = (name, ...parts) => new Uint8Array(Buffer.concat([disc(name), ...parts.map((p) => Buffer.from(p))]));

class UserError extends Error {}
const toLamports = (s) => {
  s = String(s ?? "").trim();
  if (!/^\d+(\.\d{1,9})?$/.test(s)) throw new UserError(`Amount must be SOL like 1 or 0.25 (got "${s}")`);
  const [w, f = ""] = s.split(".");
  return BigInt(w) * SOL + BigInt(f.padEnd(9, "0"));
};

const signers = new Map();
async function wallet(name) {
  if (!NAMES.includes(name)) throw new UserError(`Unknown demo wallet "${name}"`);
  if (!signers.has(name)) {
    const seed = createHash("sha256").update(`heartbeat-demo:${name}`).digest();
    signers.set(name, await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(seed)));
  }
  const signer = signers.get(name);
  const { value: bal } = await rpc.getBalance(signer.address).send();
  if (bal < SOL / 10n) await airdrop({ recipientAddress: signer.address, lamports: lamports(5n * SOL), commitment: "confirmed" });
  return signer;
}
async function resolve(who) {
  if (NAMES.includes(who)) return (await wallet(who)).address;
  if (typeof who === "string" && isAddress(who)) return address(who);
  throw new UserError(`"${who}" is not a demo name (${NAMES.join(", ")}) or a base58 address`);
}
const vaultOf = async (owner) =>
  (await getProgramDerivedAddress({ programAddress: PROGRAM, seeds: ["vault", getAddressEncoder().encode(owner)] }))[0];

async function readVault(vault) {
  const { value } = await rpc.getAccountInfo(vault, { encoding: "base64" }).send();
  if (!value) return null;
  const b = Buffer.from(value.data[0], "base64"), ad = getAddressDecoder();
  return {
    owner: ad.decode(b.subarray(8, 40)), beneficiary: ad.decode(b.subarray(40, 72)),
    interval: Number(b.readBigInt64LE(72)), lastPing: Number(b.readBigInt64LE(80)), lamports: value.lamports.toString(),
  };
}
async function chainNow() {
  const slot = await rpc.getSlot().send();
  return Number(await rpc.getBlockTime(slot).send());
}

function errorText(err, logs = []) {
  const code = err?.InstructionError?.[1]?.Custom ?? null;
  if (code !== null) return ERRORS[Number(code)] ?? `custom program error ${code}`;
  return `${JSON.stringify(err, (_, v) => (typeof v === "bigint" ? v.toString() : v))} ${logs.slice(-2).join(" ")}`;
}

async function send(label, signer, accounts, data) {
  const instruction = {
    programAddress: PROGRAM, data,
    accounts: accounts.map(([a, role, s]) => ({ address: a, role, ...(s ? { signer: s } : {}) })),
  };
  const summary = { label, cluster: RPC, payer: signer.address, accounts: accounts.map(([a]) => a) };
  const { value: bh } = await rpc.getLatestBlockhash().send();
  const tx = await signTransactionMessageWithSigners(pipe(createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m), (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstruction(instruction, m)));
  const sim = await rpc.simulateTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", commitment: "confirmed" }).send();
  if (sim.value.err) return { ...summary, ok: false, stage: "simulation", error: errorText(sim.value.err, sim.value.logs ?? []) };
  await sendAndConfirm(tx, { commitment: "confirmed", skipPreflight: true });
  const sig = getSignatureFromTransaction(tx);
  return { ...summary, ok: true, sig, cu: Number(sim.value.unitsConsumed ?? 0), link: explorer(sig) };
}

async function state(ownerName) {
  const [wallets, now] = await Promise.all([
    Promise.all(NAMES.map(async (n) => {
      const w = await wallet(n);
      return { name: n, address: w.address, lamports: (await rpc.getBalance(w.address).send()).value.toString() };
    })),
    chainNow(),
  ]);
  const owner = await resolve(ownerName), vault = await vaultOf(owner);
  return { rpc: RPC, program: PROGRAM, now, owner: ownerName, ownerAddress: owner, vaultAddress: vault, vault: await readVault(vault), wallets };
}

async function act({ action, as, owner = "alice", beneficiary, secs, sol }) {
  const W = AccountRole.WRITABLE, WS_ = AccountRole.WRITABLE_SIGNER, RS = AccountRole.READONLY_SIGNER, R = AccountRole.READONLY;
  switch (action) {
    case "init": {
      if (!/^\d+$/.test(String(secs ?? ""))) throw new UserError("Interval must be a whole number of seconds");
      const me = await wallet(as), ben = await resolve(beneficiary), vault = await vaultOf(me.address);
      return send(`initialize(beneficiary=${beneficiary}, interval=${secs}s)`, me,
        [[me.address, WS_, me], [vault, W], [SYSTEM, R]],
        ixData("initialize", getAddressEncoder().encode(ben), getI64Encoder().encode(BigInt(secs))));
    }
    case "deposit":
    case "withdraw": {
      const amount = toLamports(sol), me = await wallet(as), vault = await vaultOf(me.address);
      const accounts = [[me.address, WS_, me], [vault, W]];
      if (action === "deposit") accounts.push([SYSTEM, R]);
      return send(`${action}(${sol} SOL)`, me, accounts, ixData(action, getU64Encoder().encode(amount)));
    }
    case "ping": {
      const me = await wallet(as), vault = await vaultOf(me.address);
      return send("ping()", me, [[me.address, RS, me], [vault, W]], ixData("ping"));
    }
    case "claim": {
      const me = await wallet(as), vault = await vaultOf(await resolve(owner));
      return send(`claim() on ${owner}'s vault`, me, [[me.address, WS_, me], [vault, W]], ixData("claim"));
    }
    default:
      throw new UserError(`Unknown action "${action}"`);
  }
}

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((ok, bad) => {
  let s = "";
  req.on("data", (c) => { s += c; if (s.length > 10_000) { bad(new UserError("Body too large")); req.destroy(); } });
  req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch { bad(new UserError("Invalid JSON")); } });
});

const INDEX = new URL("./index.html", import.meta.url);
createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(await readFile(INDEX));
    }
    if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, await state(url.searchParams.get("owner") ?? "alice"));
    if (req.method === "POST" && url.pathname === "/api/tx") {
      // Same-origin only: a page on another site can't make this server sign for the demo wallets.
      if (req.headers["content-type"] !== "application/json") return json(res, 415, { error: "JSON only" });
      return json(res, 200, await act(await readBody(req)));
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    const user = e instanceof UserError;
    if (!user) console.error(e);
    const offline = /fetch failed|ECONNREFUSED/.test(String(e?.cause?.message ?? e?.message));
    json(res, user ? 400 : 502, { error: offline ? `No validator at ${RPC}` : e.message });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`💓 Heartbeat UI → http://127.0.0.1:${PORT}   (RPC ${RPC})`));
