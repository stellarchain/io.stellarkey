import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

const nestedSdkOwners = ['@trezor/blockchain-link', '@trezor/blockchain-link-utils'];

for (const owner of nestedSdkOwners) {
  const ownerRequire = createRequire(require.resolve(`${owner}/package.json`));
  const sdkRequire = createRequire(ownerRequire.resolve('@stellar/stellar-sdk'));
  const { Resolver } = sdkRequire('./stellartoml');
  const { httpClient } = sdkRequire('./http-client');

  test(`${owner} resolves ordinary Stellar metadata through its installed parser`, async t => {
    t.mock.method(httpClient, 'get', async (url, options) => {
      assert.ok(url === 'https://metadata.invalid/.well-known/stellar.toml', 'resolver uses the synthetic HTTPS boundary');
      assert.equal(options.maxRedirects, 0);
      assert.equal(options.maxContentLength, 100 * 1024);
      return { data: 'VERSION="2.7.0"\n[DOCUMENTATION]\nORG_NAME="Synthetic issuer"\n[[CURRENCIES]]\ncode="TEST"\ndisplay_decimals=7\nis_asset_anchored=false\n' };
    });
    const metadata = await Resolver.resolve('metadata.invalid', { timeout: 0 });
    assert.equal(metadata.VERSION, '2.7.0');
    assert.equal(metadata.DOCUMENTATION.ORG_NAME, 'Synthetic issuer');
    assert.equal(metadata.CURRENCIES[0].code, 'TEST');
    assert.equal(metadata.CURRENCIES[0].display_decimals, 7);
    assert.equal(metadata.CURRENCIES[0].is_asset_anchored, false);
  });

  test(`${owner} rejects malformed metadata through the real resolver`, async t => {
    t.mock.method(httpClient, 'get', async () => ({ data: 'bad = [' }));
    const invalid = await Resolver.resolve('metadata.invalid', { timeout: 0 }).then(() => false, error =>
      error instanceof Error && error.message.startsWith('stellar.toml is invalid - Parsing error'));
    assert.equal(invalid, true, 'malformed metadata remains a resolver rejection');
  });

  test(`${owner} bounds recursive metadata before stack exhaustion`, async t => {
    t.mock.method(httpClient, 'get', async () => ({ data: `value=${'['.repeat(600)}0${']'.repeat(600)}` }));
    const bounded = await Resolver.resolve('metadata.invalid', { timeout: 0 }).then(() => false, error =>
      /Maximum nesting depth of 500 exceeded/.test(error.message));
    assert.equal(bounded, true, 'deep metadata must fail with the parser nesting bound');
  });

  test(`${owner} rejects prototype traversal without mutating shared prototypes`, () => {
    // The vulnerable baseline can pollute Object.prototype. Keep the witness in
    // a disposable process; report only fixed booleans, never parser payloads.
    const result = spawnSync(process.execPath, ['--input-type=commonjs', '-e', `
      const { createRequire } = require('node:module');
      const sdkRequire = createRequire(${JSON.stringify(ownerRequire.resolve('@stellar/stellar-sdk'))});
      const { Resolver } = sdkRequire('./stellartoml');
      const { httpClient } = sdkRequire('./http-client');
      const payloads = [
        '[a.b]\\ny = 1\\n[a.b.y.__proto__.__proto__]\\nparserWitness = true',
        'aa = 1\\n[[a]]\\n[aa.__proto__.__proto__]\\nparserWitness = true'
      ];
      (async () => {
        let rejected = true;
        for (const data of payloads) {
          httpClient.get = async () => ({ data });
          rejected = await Resolver.resolve('metadata.invalid', { timeout: 0 }).then(() => false, () => true) && rejected;
        }
        process.stdout.write(JSON.stringify({ rejected, clean: !Object.hasOwn(Object.prototype, 'parserWitness') }));
      })().catch(() => { process.exitCode = 2; });
    `], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, 'isolated prototype witness exits normally');
    assert.deepEqual(JSON.parse(result.stdout), { rejected: true, clean: true });
  });
}

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
const { signAndSubmit } = await import('../src/lib/api.ts');
const { captureSigningContextAuthorization } = await import('../src/lib/signing-authorization.ts');

async function testInstalledAdapterConversion(t) {
  const { AssertWeak } = require('@trezor/schema-utils');
  const { StellarSignTransaction } = require('@trezor/connect/lib/types/api/stellar');
  const { stellarSignTx } = require('@trezor/connect/lib/api/stellar/stellarSignTx');
  const { validatePath } = require('@trezor/connect/lib/utils/pathUtils');
  // AssertWeak can warn and continue for invalid parameters. Make that a fixed,
  // payload-free failure so compatibility cannot pass on weak validation alone.
  t.mock.method(console, 'warn', () => { throw new Error('Installed Trezor schema rejected synthetic input.'); });
  const source = Keypair.random();
  const destination = Keypair.random().publicKey();
  const operationSource = Keypair.random().publicKey();
  const asset = new Asset('TEST', Keypair.random().publicKey());
  const memoBytes = 'ab'.repeat(32);

  for (const networkPassphrase of [Networks.TESTNET, Networks.PUBLIC]) {
    for (const memo of [Memo.text('Synthetic'), Memo.return(memoBytes)]) {
      const tx = new TransactionBuilder(new Account(source.publicKey(), '1'), { fee: '100', networkPassphrase })
        .addOperation(Operation.payment({ source: operationSource, destination, asset: Asset.native(), amount: '922337203685.4775807' }))
        .addOperation(Operation.manageSellOffer({ selling: asset, buying: Asset.native(), amount: '1.0000001', price: { n: 2, d: 3 }, offerId: '17' }))
        .addOperation(Operation.changeTrust({ asset, limit: '12.3456789' }))
        .addMemo(memo).setTimebounds(0, 2_000_000_000).build();
      const calls = [];
      mockTrezorMethod('stellarSignTransaction', async request => {
        try {
          AssertWeak(StellarSignTransaction, request);
        } catch {
          throw new Error('Installed Trezor schema rejected synthetic input.');
        }
        const path = validatePath(request.path, 3);
        const signed = await stellarSignTx(async (type, responseType, message) => {
          calls.push({ type, responseType, message });
          // Only the physical-device boundary is simulated. No RPC or popup is opened.
          return { message: responseType === 'StellarSignedTx'
            ? { public_key: rawPublicKeyHex(source.publicKey()), signature: transactionSignatureHex(source, tx) }
            : {} };
        }, path, request.networkPassphrase, request.transaction);
        return { success: true, payload: { publicKey: signed.public_key, signature: signed.signature } };
      });
      await hardware.signHardwareTx(tx, { device: 'trezor', publicKey: source.publicKey(), path: "m/44'/148'/0'" });
      assert.equal(calls.length, 4);
      const header = calls[0].message;
      assert.equal(calls[0].type, 'StellarSignTx');
      assert.deepEqual(header.address_n, [0x8000002c, 0x80000094, 0x80000000]);
      assert.ok(header.source_account === source.publicKey(), 'transaction source survives conversion');
      assert.ok(header.network_passphrase === networkPassphrase, 'network survives conversion');
      assert.ok(header.fee === Number(tx.fee) && header.sequence_number === tx.sequence, 'fee and sequence survive conversion');
      assert.equal(header.timebounds_end, 2_000_000_000);
      assert.equal(header.num_operations, 3);
      assert.equal(header.memo_type, memo.type === 'text' ? 1 : 4);
      assert.ok(memo.type === 'text' ? header.memo_text === 'Synthetic' : Buffer.from(header.memo_hash).toString('hex') === memoBytes, 'memo survives conversion');
      assert.equal(calls[1].type, 'StellarPaymentOp');
      assert.ok(calls[1].message.source_account === operationSource && calls[1].message.destination_account === destination, 'operation endpoints survive conversion');
      assert.ok(calls[1].message.amount === '9223372036854775807', 'maximum exact amount survives conversion');
      assert.equal(calls[2].type, 'StellarManageSellOfferOp');
      assert.ok(calls[2].message.amount === '10000001' && calls[2].message.offer_id === '17', 'offer amount and identifier survive conversion');
      assert.equal(calls[2].message.price_n, 2);
      assert.equal(calls[2].message.price_d, 3);
      assert.ok(calls[2].message.selling_asset.code === asset.code && calls[2].message.selling_asset.issuer === asset.issuer, 'issued asset survives conversion');
      assert.equal(calls[3].type, 'StellarChangeTrustOp');
      assert.ok(calls[3].message.limit === '123456789', 'trustline limit survives conversion');
      assert.equal(calls[3].responseType, 'StellarSignedTx');
      assert.equal(tx.signatures.length, 1);
      assert.ok(source.verify(tx.hash(), tx.signatures[0].signature), 'returned signature verifies against the original transaction');
    }
  }
}

test('installed Trezor Stellar utility builders remain interoperable with the application SDK', () => {
  const utils = require('@trezor/blockchain-link-utils/lib/stellar');
  const descriptor = Keypair.random().publicKey();
  const destination = Keypair.random().publicKey();
  const asset = { code: 'TEST', issuer: Keypair.random().publicKey() };
  const common = { descriptor, sequence: '1', fee: '100', isTestnet: true };
  const sent = utils.buildSendTransaction({ ...common, destinationActivated: true, destination, amount: '1.0000001', asset, destinationTag: 'Synthetic' });
  const added = utils.buildAddTrustlineTransaction({ ...common, asset });
  const removed = utils.buildRemoveTrustlineTransaction({ ...common, asset });
  for (const tx of [sent, added, removed]) {
    const decoded = TransactionBuilder.fromXDR(tx.toXDR(), Networks.TESTNET);
    assert.ok(decoded.source === descriptor && decoded.sequence === '2', 'source and sequence survive the nested SDK boundary');
    assert.equal(decoded.operations.length, 1);
  }
  assert.ok(sent.operations[0].amount === '1.0000001', 'send builder preserves precision');
  assert.equal(added.operations[0].type, 'changeTrust');
  assert.ok(removed.operations[0].limit === '0.0000000', 'removal retains a zero limit');
  const transformed = utils.transformTransaction({ envelope_xdr: sent.toXDR(), hash: 'synthetic', fee_charged: 100, created_at: '2026-01-01T00:00:00Z', ledger_attr: 1, source_account: descriptor, successful: true }, descriptor, {});
  assert.equal(transformed.type, 'sent');
  assert.ok(transformed.tokens[0].amount === '10000001', 'transaction transformation preserves exact token precision');
});

test('hardware initialization cannot continue a revoked originating operation', async () => {
  const signer = Keypair.random();
  const tx = new TransactionBuilder(new Account(signer.publicKey(), '0'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' })).setTimeout(180).build();
  let finishInit;
  let enteredInit;
  let current = true;
  let deviceRequests = 0;
  const waiting = new Promise(resolve => { enteredInit = resolve; });
  mockTrezorMethod('init', async settings => {
    initSettings = settings;
    enteredInit();
    await new Promise(resolve => { finishInit = resolve; });
  });
  mockTrezorMethod('stellarSignTransaction', async () => {
    deviceRequests++;
    return { success: true, payload: { signature: transactionSignatureHex(signer, tx) } };
  });
  const outcome = hardware.signHardwareTx(tx, {
    device: 'trezor', publicKey: signer.publicKey(), path: "m/44'/148'/0'",
    assertSessionActive: () => { if (!current) throw new Error('Originating signing context was revoked.'); },
  });
  const rejection = assert.rejects(outcome, /context was revoked/);
  await waiting;
  current = false;
  finishInit();
  await rejection;
  assert.equal(deviceRequests, 0);
  assert.equal(tx.signatures.length, 0);
});

test('adapter payloads pass the installed Trezor schema and device protocol conversion', testInstalledAdapterConversion);

for (const revoke of [true, false]) test(`public payment ${revoke ? 'rejects revoked' : 'retains unchanged'} context after deferred hardware approval`, async t => {
  const signer = Keypair.random();
  const tx = new TransactionBuilder(new Account(signer.publicKey(), '0'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: '1' })).setTimeout(180).build();
  const origin = {};
  let current = origin;
  const guard = captureSigningContextAuthorization(() => current === origin);
  let finishDevice;
  let enteredDevice;
  let posts = 0;
  let prepared = 0;
  const waiting = new Promise(resolve => { enteredDevice = resolve; });
  mockTrezorMethod('stellarSignTransaction', async () => {
    enteredDevice();
    await new Promise(resolve => { finishDevice = resolve; });
    return { success: true, payload: { signature: transactionSignatureHex(signer, tx) } };
  });
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    if (init?.method === 'POST') posts++;
    return new Response('{}', { status: init?.method === 'POST' ? 200 : 503, headers: { 'Content-Type': 'application/json' } });
  });
  const outcome = signAndSubmit(tx, 'testnet', null, {
    device: 'trezor', publicKey: signer.publicKey(), path: "m/44'/148'/0'", assertSessionActive: guard,
  }, () => { prepared++; guard(); }, guard);
  const result = outcome.then(value => value.status, () => 'rejected');
  await waiting;
  if (revoke) current = {};
  finishDevice();
  assert.equal(await result, revoke ? 'rejected' : 'status_unknown');
  assert.equal(tx.signatures.length, revoke ? 0 : 1);
  assert.equal(prepared, revoke ? 0 : 1);
  assert.equal(posts, revoke ? 0 : 1);
});

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

test("receive-address verification requires an exact Trezor match", async () => {
  const expected = Keypair.random().publicKey();
  let request;
  mockTrezorMethod("stellarGetAddress", async (nextRequest) => {
    request = nextRequest;
    return { success: true, payload: { address: expected } };
  });
  await hardware.verifyTrezorAddress("m/44'/148'/7'", expected);
  assert.deepEqual(request, { path: "m/44'/148'/7'", showOnTrezor: true });

  mockTrezorMethod("stellarGetAddress", async () => ({
    success: true,
    payload: { address: Keypair.random().publicKey() },
  }));
  await assert.rejects(
    hardware.verifyTrezorAddress("m/44'/148'/7'", expected),
    /does not match/i,
  );
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

test("hardware signing rejects approval completed after wallet authority is revoked", async () => {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      asset: Asset.native(),
      amount: "1",
    }))
    .setTimeout(60)
    .build();
  let active = true;
  let checks = 0;
  mockTrezorMethod("stellarSignTransaction", async () => {
    active = false;
    return {
      success: true,
      payload: {
        publicKey: rawPublicKeyHex(source.publicKey()),
        signature: transactionSignatureHex(source, tx),
      },
    };
  });

  await assert.rejects(
    hardware.signHardwareTx(tx, {
      device: "trezor",
      path: "m/44'/148'/0'",
      publicKey: source.publicKey(),
      assertSessionActive: () => {
        checks += 1;
        if (!active) throw new Error("Vault signing authority was revoked.");
      },
    }),
    /authority was revoked/i,
  );
  assert.equal(checks, 3);
  assert.equal(tx.signatures.length, 0);
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
