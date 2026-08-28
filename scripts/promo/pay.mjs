/**
 * The customer side of the counter.
 *
 * A second funded testnet account that pays a charge for real, so the till's
 * watcher matches it from Horizon and the order flips to Paid on camera.
 */
import * as Sdk from "@stellar/stellar-sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CACHE = "/tmp/promo/customer.json";
const HORIZON = "https://horizon-testnet.stellar.org";

export async function customer({ fresh = false } = {}) {
  mkdirSync("/tmp/promo", { recursive: true });
  if (!fresh && existsSync(CACHE)) {
    const { secret } = JSON.parse(readFileSync(CACHE, "utf8"));
    return Sdk.Keypair.fromSecret(secret);
  }
  const kp = Sdk.Keypair.random();
  const res = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}`);
  writeFileSync(CACHE, JSON.stringify({ secret: kp.secret(), publicKey: kp.publicKey() }, null, 2));
  return kp;
}

/** Pay `amount` XLM to `destination` carrying `memo`, and wait for the ledger. */
export async function pay({ from, destination, amount, memo }) {
  const server = new Sdk.Horizon.Server(HORIZON);
  const source = await server.loadAccount(from.publicKey());
  const tx = new Sdk.TransactionBuilder(source, {
    fee: "100000",
    networkPassphrase: Sdk.Networks.TESTNET,
  })
    .addOperation(Sdk.Operation.payment({
      destination,
      asset: Sdk.Asset.native(),
      amount: String(amount),
    }))
    .addMemo(Sdk.Memo.text(memo))
    .setTimeout(60)
    .build();
  tx.sign(from);
  const res = await server.submitTransaction(tx);
  return res.hash;
}
