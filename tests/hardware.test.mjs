import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import {
  Account,
  Asset,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const require = createRequire(import.meta.url);
const trezorPackage = require("@trezor/connect-web");
const trezorConnect = trezorPackage.default;

function mockTrezorMethod(name, implementation) {
  // Node exposes this CommonJS package through a nested default export while
  // Next.js unwraps it. Patch both shapes so the test exercises our adapter.
  trezorPackage[name] = implementation;
  trezorConnect[name] = implementation;
}

function rawPublicKeyHex(publicKey) {
  return Buffer.from(Keypair.fromPublicKey(publicKey).rawPublicKey()).toString("hex");
}

function transactionSignatureHex(signer, tx) {
  return Buffer.from(signer.sign(tx.hash())).toString("hex");
}

let initSettings;
mockTrezorMethod("init", async (settings) => {
  initSettings = settings;
});
mockTrezorMethod("stellarGetAddress", async () => ({
  success: true,
  payload: { address: Keypair.random().publicKey() },
}));

const hardware = await import("../src/lib/hardware.ts");
const { cosignTransaction } = await import("../src/lib/multisig.ts");

test("rejects invalid Stellar derivation indices", () => {
  assert.throws(() => hardware.getStellarDerivationPath(-1), /index/i);
  assert.throws(() => hardware.getStellarDerivationPath(1.5), /index/i);
  assert.throws(() => hardware.getStellarDerivationPath(2 ** 31), /index/i);
});

test("rejects a malformed public address returned by Trezor", async () => {
  mockTrezorMethod("stellarGetAddress", async () => ({
    success: true,
    payload: { address: "not-a-stellar-address" },
  }));
  await assert.rejects(hardware.connectTrezorDevice(0), /invalid Stellar address/i);
  mockTrezorMethod("stellarGetAddress", async () => ({
    success: true,
    payload: { address: Keypair.random().publicKey() },
  }));
});

test("rejects Ledger connection instead of creating a simulated account", async () => {
  const previousNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { usb: { requestDevice: async () => ({}) } },
  });
  try {
    await assert.rejects(hardware.connectLedgerDevice(0), /not supported/i);
  } finally {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: previousNavigator,
    });
  }
});

test("initializes Trezor Connect in popup mode so WebUSB is not trapped in an iframe", async () => {
  await hardware.connectTrezorDevice(0);

  assert.equal(initSettings.coreMode, "popup");
  assert.notEqual(initSettings.popup, false);
  assert.equal(initSettings.transports, undefined);
});

test("serializes the complete Stellar transaction fee for device signing", async () => {
  const source = Keypair.random();
  const destination = Keypair.random().publicKey();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({ destination, asset: Asset.native(), amount: "1" }),
    )
    .addOperation(
      Operation.payment({ destination, asset: Asset.native(), amount: "2" }),
    )
    .setTimeout(60)
    .build();

  let signingRequest;
  mockTrezorMethod("stellarSignTransaction", async (request) => {
    signingRequest = request;
    return {
      success: true,
      payload: {
        publicKey: rawPublicKeyHex(source.publicKey()),
        signature: transactionSignatureHex(source, tx),
      },
    };
  });

  await hardware.signTrezorTransaction(tx, "m/44'/148'/0'");

  assert.equal(signingRequest.transaction.fee, Number(tx.fee));
});

test("cosigning rechecks expiry after asynchronous Trezor signing", async (t) => {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: "1",
    }))
    .setTimebounds(0, 200)
    .build();
  let nowMs = 100_000;
  let submitted = false;
  t.mock.method(Date, "now", () => nowMs);
  t.mock.method(globalThis, "fetch", async (url) => {
    const stringUrl = String(url);
    if (stringUrl.endsWith(`/accounts/${source.publicKey()}`)) {
      return new Response(JSON.stringify({
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
        signers: [{ key: source.publicKey(), weight: 1, type: "ed25519_public_key" }],
      }), { status: 200 });
    }
    if (stringUrl.endsWith("/transactions")) {
      submitted = true;
      return new Response(JSON.stringify({ hash: "must-not-submit" }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });
  mockTrezorMethod("stellarSignTransaction", async () => {
    nowMs = 200_000;
    return {
      success: true,
      payload: {
        publicKey: rawPublicKeyHex(source.publicKey()),
        signature: transactionSignatureHex(source, tx),
      },
    };
  });

  await assert.rejects(
    cosignTransaction({
      network: "testnet",
      confirmedNetwork: "testnet",
      xdr: tx.toXdr(),
      signerPublicKey: source.publicKey(),
      hardwareSigner: {
        device: "trezor",
        path: "m/44'/148'/0'",
        publicKey: source.publicKey(),
      },
    }),
    /expired/i,
  );
  assert.equal(submitted, false);
});

test("converts Stellar decimal amounts to stroops without floating-point loss", async () => {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "922337203685.4775807",
      }),
    )
    .setTimeout(60)
    .build();

  let signingRequest;
  mockTrezorMethod("stellarSignTransaction", async (request) => {
    signingRequest = request;
    return {
      success: true,
      payload: {
        publicKey: rawPublicKeyHex(source.publicKey()),
        signature: transactionSignatureHex(source, tx),
      },
    };
  });

  await hardware.signTrezorTransaction(tx, "m/44'/148'/0'");

  assert.equal(
    signingRequest.transaction.operations[0].amount,
    "9223372036854775807",
  );
});

test("preserves an operation source account in the Trezor signing payload", async () => {
  const source = Keypair.random();
  const operationSource = Keypair.random().publicKey();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        source: operationSource,
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(60)
    .build();

  let signingRequest;
  mockTrezorMethod("stellarSignTransaction", async (request) => {
    signingRequest = request;
    return {
      success: true,
      payload: {
        publicKey: rawPublicKeyHex(source.publicKey()),
        signature: transactionSignatureHex(source, tx),
      },
    };
  });

  await hardware.signTrezorTransaction(tx, "m/44'/148'/0'");

  assert.equal(signingRequest.transaction.operations[0].source, operationSource);
});

test("preserves a return-hash memo in the Trezor signing payload", async () => {
  const source = Keypair.random();
  const returnHash = "ab".repeat(32);
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .addMemo(Memo.return(returnHash))
    .setTimeout(60)
    .build();

  let signingRequest;
  mockTrezorMethod("stellarSignTransaction", async (request) => {
    signingRequest = request;
    return {
      success: true,
      payload: {
        publicKey: rawPublicKeyHex(source.publicKey()),
        signature: transactionSignatureHex(source, tx),
      },
    };
  });

  await hardware.signTrezorTransaction(tx, "m/44'/148'/0'");

  assert.deepEqual(signingRequest.transaction.memo, {
    type: 4,
    hash: Buffer.from(returnHash, "hex"),
  });
});

test("decodes a Stellar text memo before sending it to Trezor", async () => {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .addMemo(Memo.text("Hello, Trezor!"))
    .setTimeout(60)
    .build();

  let signingRequest;
  mockTrezorMethod("stellarSignTransaction", async (request) => {
    signingRequest = request;
    return {
      success: true,
      payload: {
        publicKey: rawPublicKeyHex(source.publicKey()),
        signature: transactionSignatureHex(source, tx),
      },
    };
  });

  await hardware.signTrezorTransaction(tx, "m/44'/148'/0'");

  assert.deepEqual(signingRequest.transaction.memo, {
    type: 1,
    text: "Hello, Trezor!",
  });
});

test("maps multisig setOptions operations into the Trezor schema", async () => {
  const source = Keypair.random();
  const cosigner = Keypair.random().publicKey();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.setOptions({
        signer: { ed25519PublicKey: cosigner, weight: 2 },
      }),
    )
    .addOperation(
      Operation.setOptions({
        masterWeight: 1,
        lowThreshold: 1,
        medThreshold: 2,
        highThreshold: 2,
      }),
    )
    .setTimeout(60)
    .build();

  let signingRequest;
  mockTrezorMethod("stellarSignTransaction", async (request) => {
    signingRequest = request;
    return {
      success: true,
      payload: {
        publicKey: rawPublicKeyHex(source.publicKey()),
        signature: transactionSignatureHex(source, tx),
      },
    };
  });

  await hardware.signTrezorTransaction(tx, "m/44'/148'/0'");

  assert.deepEqual(signingRequest.transaction.operations, [
    {
      type: "setOptions",
      source: undefined,
      signer: {
        type: 0,
        key: Buffer.from(Keypair.fromPublicKey(cosigner).rawPublicKey()),
        weight: 2,
      },
      inflationDest: undefined,
      clearFlags: undefined,
      setFlags: undefined,
      masterWeight: undefined,
      lowThreshold: undefined,
      medThreshold: undefined,
      highThreshold: undefined,
      homeDomain: undefined,
    },
    {
      type: "setOptions",
      source: undefined,
      signer: undefined,
      inflationDest: undefined,
      clearFlags: undefined,
      setFlags: undefined,
      masterWeight: 1,
      lowThreshold: 1,
      medThreshold: 2,
      highThreshold: 2,
      homeDomain: undefined,
    },
  ]);
});

test("maps classic offer and allow-trust operations accepted by cosigning", async () => {
  const source = Keypair.random();
  const issuer = Keypair.random().publicKey();
  const trustor = Keypair.random().publicKey();
  const usd = new Asset("USD", issuer);
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.manageSellOffer({
        selling: Asset.native(),
        buying: usd,
        amount: "1.25",
        price: { n: 1, d: 3 },
        offerId: "7",
      }),
    )
    .addOperation(
      Operation.manageBuyOffer({
        selling: Asset.native(),
        buying: usd,
        buyAmount: "2.5",
        price: { n: 2, d: 3 },
        offerId: "8",
      }),
    )
    .addOperation(
      Operation.createPassiveSellOffer({
        selling: Asset.native(),
        buying: usd,
        amount: "3.75",
        price: { n: 3, d: 4 },
      }),
    )
    .addOperation(Operation.allowTrust({ trustor, assetCode: "USD", authorize: true }))
    .addOperation(Operation.inflation())
    .setTimeout(60)
    .build();

  let signingRequest;
  mockTrezorMethod("stellarSignTransaction", async (request) => {
    signingRequest = request;
    return {
      success: true,
      payload: {
        publicKey: rawPublicKeyHex(source.publicKey()),
        signature: transactionSignatureHex(source, tx),
      },
    };
  });

  await hardware.signTrezorTransaction(tx, "m/44'/148'/0'");

  assert.deepEqual(signingRequest.transaction.operations, [
    {
      type: "manageSellOffer",
      source: undefined,
      buying: { type: 1, code: "USD", issuer },
      selling: { type: 0 },
      amount: "12500000",
      price: { n: 1, d: 3 },
      offerId: "7",
    },
    {
      type: "manageBuyOffer",
      source: undefined,
      buying: { type: 1, code: "USD", issuer },
      selling: { type: 0 },
      amount: "25000000",
      price: { n: 2, d: 3 },
      offerId: "8",
    },
    {
      type: "createPassiveSellOffer",
      source: undefined,
      buying: { type: 1, code: "USD", issuer },
      selling: { type: 0 },
      amount: "37500000",
      price: { n: 3, d: 4 },
    },
    {
      type: "allowTrust",
      source: undefined,
      trustor,
      assetCode: "USD",
      assetType: 1,
      authorize: true,
    },
    {
      type: "inflation",
      source: undefined,
    },
  ]);
});

test("rejects a signature returned for a different Trezor account", async () => {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(60)
    .build();

  mockTrezorMethod("stellarSignTransaction", async () => ({
    success: true,
    payload: {
      publicKey: rawPublicKeyHex(Keypair.random().publicKey()),
      signature: "00".repeat(64),
    },
  }));

  await assert.rejects(
    hardware.signTrezorTransaction(tx, "m/44'/148'/0'", source.publicKey()),
    /does not match the imported hardware account/i,
  );
  assert.equal(tx.signatures.length, 0);
});

test("verifies a Trezor signature when the response omits publicKey", async () => {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(60)
    .build();

  mockTrezorMethod("stellarSignTransaction", async () => ({
    success: true,
    payload: {
      signature: transactionSignatureHex(source, tx),
    },
  }));

  await hardware.signTrezorTransaction(tx, "m/44'/148'/0'", source.publicKey());

  assert.equal(tx.signatures.length, 1);
});

test("rejects a malformed publicKey instead of treating it as omitted", async () => {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(60)
    .build();

  mockTrezorMethod("stellarSignTransaction", async () => ({
    success: true,
    payload: {
      publicKey: null,
      signature: transactionSignatureHex(source, tx),
    },
  }));

  await assert.rejects(
    hardware.signTrezorTransaction(tx, "m/44'/148'/0'", source.publicKey()),
    /invalid public key/i,
  );
  assert.equal(tx.signatures.length, 0);
});

test("rejects Stellar preconditions that Trezor Connect cannot serialize", async () => {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimebounds(0, 60)
    .setLedgerbounds(1, 100)
    .build();

  await assert.rejects(
    hardware.signTrezorTransaction(tx, "m/44'/148'/0'", source.publicKey()),
    /advanced Stellar preconditions are not supported by Trezor Connect/i,
  );
});

test("rejects time bounds that cannot be represented exactly by Trezor Connect", async () => {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: Keypair.random().publicKey(),
        asset: Asset.native(),
        amount: "1",
      }),
    )
    // TransactionBuilder accepts millisecond-like bounds and normalizes them
    // to seconds; this input yields a uint64 bound above Number.MAX_SAFE_INTEGER.
    .setTimebounds("0", "9007199254740993000")
    .build();

  await assert.rejects(
    hardware.signTrezorTransaction(tx, "m/44'/148'/0'", source.publicKey()),
    /time bounds are too large for Trezor Connect/i,
  );
});
