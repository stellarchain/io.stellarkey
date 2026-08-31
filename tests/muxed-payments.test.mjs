import assert from "node:assert/strict";
import test from "node:test";

import {
  Account,
  Keypair,
  MuxedAccount,
  Networks,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { sendBatchPayments, sendPayment } from "../src/lib/api.ts";
import { isValidPaymentAddress, isValidPublicAddress } from "../src/lib/vault.ts";

function submittedTransaction(calls) {
  const submission = calls.find((call) => call.url.endsWith("/transactions"));
  assert.ok(submission, "expected a Horizon transaction submission");
  return TransactionBuilder.fromXdr(
    new URLSearchParams(submission.init.body).get("tx"),
    Networks.TESTNET,
  );
}

function mockHorizon(t, source, destinations) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const stringUrl = String(url);
    calls.push({ url: stringUrl, init });
    if (stringUrl.endsWith(`/accounts/${source}`)) {
      return new Response(JSON.stringify({ sequence: "0" }), { status: 200 });
    }
    if (destinations.some((destination) => stringUrl.endsWith(`/accounts/${destination}`))) {
      return new Response(JSON.stringify({ sequence: "0" }), { status: 200 });
    }
    if (stringUrl.endsWith("/transactions")) {
      const transaction = TransactionBuilder.fromXdr(
        new URLSearchParams(init.body).get("tx"),
        Networks.TESTNET,
      );
      return new Response(JSON.stringify({
        hash: Buffer.from(transaction.hash()).toString("hex"),
      }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });
  return calls;
}

test("payment addresses accept G and M addresses without widening account-management validation", () => {
  const base = Keypair.random().publicKey();
  const muxed = new MuxedAccount(new Account(base, "0"), "42").accountId();

  assert.equal(isValidPublicAddress(base), true);
  assert.equal(isValidPublicAddress(muxed), false);
  assert.equal(isValidPaymentAddress(base), true);
  assert.equal(isValidPaymentAddress(muxed), true);
  assert.equal(isValidPaymentAddress("not-an-address"), false);
});

test("a muxed payment queries the base account but keeps M in the payment operation", async (t) => {
  const source = Keypair.random();
  const base = Keypair.random().publicKey();
  const muxed = new MuxedAccount(new Account(base, "0"), "42").accountId();
  const calls = mockHorizon(t, source.publicKey(), [base]);

  await sendPayment({
    network: "testnet",
    secretKey: source.secret(),
    destination: muxed,
    amount: "1",
    assetCode: "XLM",
  });

  assert.ok(calls.some((call) => call.url.endsWith(`/accounts/${base}`)));
  assert.ok(!calls.some((call) => call.url.includes(`/accounts/${muxed}`)));
  const operation = submittedTransaction(calls).operations[0];
  assert.equal(operation.type, "payment");
  assert.equal(operation.destination, muxed);
});

test("batch payments deduplicate Horizon checks by underlying account", async (t) => {
  const source = Keypair.random();
  const base = Keypair.random().publicKey();
  const first = new MuxedAccount(new Account(base, "0"), "42").accountId();
  const second = new MuxedAccount(new Account(base, "0"), "43").accountId();
  const calls = mockHorizon(t, source.publicKey(), [base]);

  await sendBatchPayments({
    network: "testnet",
    secretKey: source.secret(),
    payments: [
      { destination: first, amount: "1", assetCode: "XLM" },
      { destination: second, amount: "2", assetCode: "XLM" },
    ],
  });

  assert.equal(calls.filter((call) => call.url.endsWith(`/accounts/${base}`)).length, 1);
  assert.deepEqual(
    submittedTransaction(calls).operations.map((operation) => operation.destination),
    [first, second],
  );
});

test("Trezor receives an actionable fallback message before an unsupported M payment", async () => {
  const source = Keypair.random();
  const base = Keypair.random().publicKey();
  const muxed = new MuxedAccount(new Account(base, "0"), "42").accountId();

  await assert.rejects(
    sendPayment({
      network: "testnet",
      hardwareSigner: {
        device: "trezor",
        publicKey: source.publicKey(),
        path: "m/44'/148'/0'",
      },
      destination: muxed,
      amount: "1",
      assetCode: "XLM",
    }),
    /hardware-compatible request|MEMO_ID/i,
  );
});
