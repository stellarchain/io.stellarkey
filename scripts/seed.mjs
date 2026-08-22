import * as Sdk from "@stellar/stellar-sdk";
import { writeFileSync } from "node:fs";

const HORIZON = "https://horizon-testnet.stellar.org";
const PASSPHRASE = "Test SDF Network ; September 2015";
const server = new Sdk.Horizon.Server(HORIZON);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function friendbot(kp) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot failed for ${kp.publicKey()}: ${res.status}`);
  await sleep(2500);
}

async function submit(builderSourceKp, ops, memo) {
  const src = await server.loadAccount(builderSourceKp.publicKey());
  let tb = new Sdk.TransactionBuilder(src, {
    fee: Sdk.BASE_FEE,
    networkPassphrase: PASSPHRASE,
  });
  for (const op of ops) tb = tb.addOperation(op);
  if (memo) tb = tb.addMemo(Sdk.Memo.text(memo));
  const tx = tb.setTimeout(180).build();
  tx.sign(builderSourceKp);
  const res = await server.submitTransaction(tx);
  return res.hash;
}

async function pay(from, to, amount, asset = null) {
  return submit(
    from,
    [
      asset
        ? Sdk.Operation.payment({ destination: to.publicKey(), asset, amount })
        : Sdk.Operation.payment({
            destination: to.publicKey(),
            asset: Sdk.Asset.native(),
            amount,
          }),
    ],
    memoFromAmount(amount),
  );
}

function memoFromAmount(a) {
  return `demo ${a}`;
}

const A = Sdk.Keypair.random();
const B = Sdk.Keypair.random();

console.log("funding A…");
await friendbot(A);
console.log("funding B…");
await friendbot(B);

console.log("A pays B 100 XLM");
await pay(A, B, "100");

console.log("B pays A 43.21 XLM");
await pay(B, A, "43.21");

const GOLD = new Sdk.Asset("GOLD", B.publicKey());
const USDC = new Sdk.Asset("USDC", B.publicKey());

console.log("A trusts GOLD + USDC");
await submit(A, [
  Sdk.Operation.changeTrust({ asset: GOLD, limit: "10000" }),
  Sdk.Operation.changeTrust({ asset: USDC, limit: "50000" }),
]);

console.log("B issues 250 GOLD + 1250 USDC to A");
await submit(B, [
  Sdk.Operation.payment({ destination: A.publicKey(), asset: GOLD, amount: "250" }),
  Sdk.Operation.payment({ destination: A.publicKey(), asset: USDC, amount: "1250" }),
], "issue");

await sleep(3000);

const state = {
  password: "demo12345",
  mainSecret: A.secret(),
  mainPublic: A.publicKey(),
  counterpartyPublic: B.publicKey(),
};
writeFileSync("/tmp/polaris-seed.json", JSON.stringify(state, null, 2));
console.log(JSON.stringify(state, null, 2));
