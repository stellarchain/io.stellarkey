import * as Sdk from "@stellar/stellar-sdk";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Rebuilds the demo testnet account. The previous seed account ended up in a
 * 2-of-3 multisig with ephemeral cosigner keys during E2E testing (locked).
 * This creates a fresh main + counterparty (both friendbot-funded), issues
 * GOLD/USDC demo assets, and recreates representative balances + activity.
 * Both secrets are persisted so future tests can always sign/clean up.
 */

const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";
const old = JSON.parse(readFileSync("/tmp/polaris-seed.json", "utf8"));

const mainKp = Sdk.Keypair.random();
const counterKp = Sdk.Keypair.random();
const server = new Sdk.Horizon.Server(HORIZON);

async function friendbot(pub) {
  const res = await fetch(`${FRIENDBOT}?addr=${pub}`);
  if (!res.ok) throw new Error(`friendbot failed: ${res.status}`);
}

async function submit(tx, ...signers) {
  tx.sign(...signers);
  const res = await server.submitTransaction(tx);
  return res.hash;
}

async function account(pub) {
  const res = await fetch(`${HORIZON}/accounts/${pub}`);
  return res.json();
}

async function buildTx(pub) {
  const acc = await account(pub);
  return new Sdk.TransactionBuilder(new Sdk.Account(pub, acc.sequence), {
    fee: "100",
    networkPassphrase: Sdk.Networks.TESTNET,
  }).setTimeout(180);
}

console.log("main:        ", mainKp.publicKey());
console.log("counterparty:", counterKp.publicKey());

await friendbot(mainKp.publicKey());
console.log("main funded");
await friendbot(counterKp.publicKey());
console.log("counterparty funded");

const GOLD = new Sdk.Asset("GOLD", counterKp.publicKey());
const USDC = new Sdk.Asset("USDC", counterKp.publicKey());

// Main trusts both assets
await submit(
  (await buildTx(mainKp.publicKey()))
    .addOperation(Sdk.Operation.changeTrust({ asset: GOLD }))
    .addOperation(Sdk.Operation.changeTrust({ asset: USDC }))
    .build(),
  mainKp,
);
console.log("trustlines added");

// Counterparty funds main with demo assets + starter payments
await submit(
  (await buildTx(counterKp.publicKey()))
    .addOperation(Sdk.Operation.payment({ destination: mainKp.publicKey(), asset: USDC, amount: "1250" }))
    .addOperation(Sdk.Operation.payment({ destination: mainKp.publicKey(), asset: GOLD, amount: "250" }))
    .addOperation(Sdk.Operation.payment({ destination: mainKp.publicKey(), asset: Sdk.Asset.native(), amount: "43.21" }))
    .build(),
  counterKp,
);
console.log("demo assets + activity payments sent");

// One outgoing payment for the Sent row
await submit(
  (await buildTx(mainKp.publicKey()))
    .addOperation(Sdk.Operation.payment({ destination: counterKp.publicKey(), asset: Sdk.Asset.native(), amount: "100" }))
    .build(),
  mainKp,
);
console.log("outgoing payment sent");

const seed = {
  password: old.password,
  mainSecret: mainKp.secret(),
  mainPublic: mainKp.publicKey(),
  counterpartyPublic: counterKp.publicKey(),
  counterpartySecret: counterKp.secret(),
  rebuiltAt: new Date().toISOString(),
  note: "Previous main account was locked by a 2-of-3 multisig E2E test with ephemeral cosigner keys. Rebuilt via scripts/rebuild-demo-account.mjs",
};
writeFileSync("/tmp/polaris-seed.json", JSON.stringify(seed, null, 2));
console.log("seed file updated");

const finalAcc = await account(mainKp.publicKey());
console.log("final balances:", finalAcc.balances.map((b) => `${b.balance} ${b.asset_code ?? "XLM"}`).join(", "));
