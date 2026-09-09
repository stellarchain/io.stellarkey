import assert from 'node:assert/strict';
import test from 'node:test';
import { Account, Contract, Keypair, Memo, SorobanDataBuilder, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { prepareReviewedPrivateBalanceTransaction } from '../src/features/private-balance/runtime/action-transaction.ts';
import { PrivateBalanceTransactionBuilder } from '../src/features/private-balance/runtime/transaction-builder.ts';
import { preparePrivateRelayJob } from '../src/features/private-balance/relay/preparation.ts';
import * as preparation from '../src/features/private-balance/relay/preparation.ts';

const NOW = 1_800_000_000;
const NETWORK = 'Test SDF Network ; September 2015';
const POOL = StrKey.encodeContract(Buffer.alloc(32));
const SOURCE = Keypair.random().publicKey();
const manifest = { networkPassphrase: NETWORK, poolContractId: POOL, assets: [] };
const bytes = (length, value) => new Uint8Array(length).fill(value);

function operation(value = 1) {
  const output = index => {
    const recipientEnvelope = bytes(181, index);
    recipientEnvelope[0] = 1;
    recipientEnvelope.set([1, 2, 3, 4], 1);
    return { commitment: bytes(32, index), recipientEnvelope, outgoingEnvelope: bytes(157, index) };
  };
  return new PrivateBalanceTransactionBuilder(manifest).buildTransferOperation({
    action: {
      actionNonce: bytes(32, value), anchorRoot: bytes(32, 2),
      nullifiers: [bytes(32, 3), bytes(32, 4)],
      outputs: [output(5), output(6), output(7)], publicValue: 0n,
    },
    proof: { a: bytes(64, 1), b: bytes(128, 2), c: bytes(64, 3) },
  });
}

function preparedEnvelope(op, options = {}) {
  let suppliedOperation = options.operation ?? op;
  if (options.auth) {
    suppliedOperation = xdr.Operation.fromXDR(op.toXDR());
    suppliedOperation.body.invokeHostFunctionOp.auth.push(new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          suppliedOperation.body.invokeHostFunctionOp.hostFunction.invokeContract,
        ), subInvocations: [],
      }),
    }));
  }
  const builder = new TransactionBuilder(new Account(options.source ?? SOURCE, options.sequence ?? '7'), {
    fee: options.classicFee ?? '100', networkPassphrase: NETWORK,
    timebounds: { minTime: options.minTime ?? 0, maxTime: options.maxTime ?? NOW + 240 },
  }).addOperation(suppliedOperation);
  if (options.memo) builder.addMemo(Memo.text('unexpected'));
  if (options.extraOperation) builder.addOperation(op);
  if (options.ledgerBounds) builder.setLedgerbounds(1, 100);
  if (options.extraSigner) builder.setExtraSigners([SOURCE]);
  if (options.minSequence) builder.setMinAccountSequence('1');
  if (!options.missingData) builder.setSorobanData(new SorobanDataBuilder().setResourceFee(options.resourceFee ?? '500').build());
  const transaction = builder.build();
  if (options.sign) transaction.sign(options.sign);
  return transaction.toXdr();
}

function inputFor(op, prepare, overrides = {}) {
  return {
    operation: op, manifest, source: SOURCE, classicFeeStroops: 100n,
    maximumResourceFeeStroops: 1_000n, nowSeconds: NOW,
    submissionMode: 'relay',
    relayPreparation: { expiresAt: NOW + 240, prepare },
    rpc: {
      async getAccount() { assert.fail('sender RPC account lookup leaked relay intent'); },
      async simulateTransaction() { assert.fail('sender RPC simulation leaked relay action'); },
    },
    ...overrides,
  };
}

test('relay preparation never sends the source or proved operation to sender RPC', async () => {
  const op = operation();
  let requested;
  const result = await prepareReviewedPrivateBalanceTransaction(inputFor(op, async request => {
    requested = request;
    return { preparedEnvelopeXdr: preparedEnvelope(op), accountSequence: '7', simulationLedger: 123 };
  }));
  assert.equal(requested.operationXdr, op.toXDR('base64'));
  assert.equal(requested.maxTime, NOW + 240);
  assert.equal(requested.classicFeeStroops, '100');
  assert.equal(requested.maximumResourceFeeStroops, '1000');
  assert.equal(result.review.classicFeeStroops, 100n);
  assert.equal(result.review.resourceFeeStroops, 500n);
  assert.equal(result.simulationLedger, 123);
});

test('relay preparation fails closed without a callback or after a helper error', async () => {
  const op = operation();
  await assert.rejects(prepareReviewedPrivateBalanceTransaction(inputFor(op, null, { relayPreparation: undefined })), /relay.*preparation/iu);
  for (const message of ['helper timeout', 'requires restoration', 'helper simulation failed']) {
    await assert.rejects(prepareReviewedPrivateBalanceTransaction(inputFor(op, async () => { throw new Error(message); })), error => error.message === message);
  }
});

test('relay prepared envelopes must preserve independent operation, source, headers and fee limits', async () => {
  const op = operation();
  const alterations = [
    { operation: operation(9) }, { operation: new Contract(POOL).call('touch_root') },
    { source: Keypair.random().publicKey() }, { sequence: '8' },
    { maxTime: NOW + 241 }, { minTime: 1 }, { memo: true }, { extraOperation: true },
    { classicFee: '101' }, { classicFee: '99' }, { resourceFee: '1001' },
    { missingData: true }, { sign: Keypair.random() },
    { auth: true }, { ledgerBounds: true }, { extraSigner: true }, { minSequence: true },
  ];
  for (const alteration of alterations) {
    await assert.rejects(prepareReviewedPrivateBalanceTransaction(inputFor(op, async () => ({
      preparedEnvelopeXdr: preparedEnvelope(op, alteration), accountSequence: '7', simulationLedger: 123,
    }))), error => error.name !== 'AssertionError' && /private|relay/iu.test(error.message));
  }
});

test('helper-controlled preparation metadata cannot bypass sequence or size bounds', async () => {
  const op = operation();
  for (const alteration of [
    { accountSequence: '-1' }, { accountSequence: '07' }, { accountSequence: '9223372036854775807' },
    { accountSequence: 7 }, { simulationLedger: 0 }, { simulationLedger: Number.MAX_SAFE_INTEGER },
    { preparedEnvelopeXdr: 'AAAA'.repeat(7_000) },
  ]) {
    await assert.rejects(prepareReviewedPrivateBalanceTransaction(inputFor(op, async () => ({
      preparedEnvelopeXdr: preparedEnvelope(op), accountSequence: '7', simulationLedger: 123, ...alteration,
    }))));
  }
});

test('helper account sequence must still match at manual signing', () => {
  assert.equal(typeof preparation.assertPrivateRelayAccountSequence, 'function');
  const transaction = TransactionBuilder.fromXdr(preparedEnvelope(operation()), NETWORK);
  assert.doesNotThrow(() => preparation.assertPrivateRelayAccountSequence(transaction, new Account(SOURCE, '7')));
  assert.throws(() => preparation.assertPrivateRelayAccountSequence(transaction, new Account(SOURCE, '8')), /sequence/iu);
  assert.throws(() => preparation.assertPrivateRelayAccountSequence(transaction, new Account(Keypair.random().publicKey(), '7')), /account/iu);
});

function helperInput(overrides = {}) {
  const job = {
    version: 3, type: 'job', requestId: '11'.repeat(32), quoteId: '22'.repeat(32), prepareId: '33'.repeat(32),
    operationXdr: operation().toXDR('base64'), maxTime: NOW + 240, classicFeeStroops: '100',
    maximumResourceFeeStroops: '1000', nonce: '44'.repeat(32), expiresAt: NOW + 240,
  };
  return {
    job, manifest, source: SOURCE, assetIndex: 0, actionDiversifier: '01020304', expectedMethod: 'transfer',
    quoteExpiresAt: NOW + 240, maximumClassicFeeStroops: 100n, maximumResourceFeeStroops: 1000n,
    nowSeconds: NOW, async verifyFee() {}, ...overrides,
  };
}

test('helper validates selected action and fee note before fetching its sequence or simulating', async () => {
  const calls = [];
  const input = helperInput({
    async verifyFee(review) { calls.push('fee'); assert.equal(review.outputs.length, 3); },
    createRpc() {
      calls.push('rpc');
      return {
        async getAccount(account) { calls.push('account'); assert.equal(account, SOURCE); return new Account(SOURCE, '7'); },
        async simulateTransaction() {
          calls.push('simulate');
          return { _parsed: true, id: 'synthetic', latestLedger: 123, events: [],
            transactionData: new SorobanDataBuilder().setResourceFee('500'), minResourceFee: '500',
            result: { auth: [], retval: xdr.ScVal.scvVoid() } };
        },
      };
    },
  });
  const result = await preparePrivateRelayJob(input);
  assert.deepEqual(calls, ['fee', 'rpc', 'account', 'simulate']);
  assert.equal(result.accountSequence, '7');
  assert.equal(TransactionBuilder.fromXdr(result.preparedEnvelopeXdr, NETWORK).signatures.length, 0);

  for (const override of [
    { expectedMethod: 'withdraw' }, { actionDiversifier: '05060708' },
    { manifest: { ...manifest, poolContractId: StrKey.encodeContract(Buffer.alloc(32, 9)) } },
    { async verifyFee() { throw new Error('fee note does not belong to helper'); } },
  ]) {
    await assert.rejects(preparePrivateRelayJob({ ...input, ...override,
      createRpc() { assert.fail('helper leaked an unreviewed action to RPC'); },
    }), error => error.name !== 'AssertionError');
  }
});

test('helper preparation rejects restoration and cancellation without signing or a fallback', async () => {
  for (const scenario of ['restore', 'error', 'abort']) {
    const controller = new AbortController();
    let simulationCalls = 0;
    const input = helperInput({
      signal: controller.signal,
      async verifyFee() { if (scenario === 'abort') controller.abort(); },
      createRpc() {
        assert.notEqual(scenario, 'abort');
        return {
          async getAccount() { return new Account(SOURCE, '7'); },
          async simulateTransaction() {
            simulationCalls += 1;
            if (scenario === 'error') return { error: 'synthetic failure', latestLedger: 123 };
            return { _parsed: true, id: 'synthetic', latestLedger: 123, events: [],
              transactionData: new SorobanDataBuilder(), minResourceFee: '0',
              result: { auth: [], retval: xdr.ScVal.scvVoid() },
              restorePreamble: { minResourceFee: '1', transactionData: new SorobanDataBuilder() } };
          },
        };
      },
    });
    await assert.rejects(preparePrivateRelayJob(input), /restoration|simulation|cancelled/iu);
    assert.equal(simulationCalls, scenario === 'abort' ? 0 : 1);
  }
});

test('rejecting a prepared helper quote frees the next quote and stale work cannot restore it', () => {
  assert.equal(typeof preparation.PrivateRelayPreparationLease, 'function');
  const lease = new preparation.PrivateRelayPreparationLease();
  const first = lease.begin('first');
  const prepared = { preparedEnvelopeXdr: 'synthetic', accountSequence: '7', simulationLedger: 123 };
  assert.equal(lease.complete(first, prepared), true);
  assert.equal(lease.begin('second'), null);
  lease.release('first'); // Manual reject, expiry and publication failure share this cleanup.
  const second = lease.begin('second');
  assert.ok(second);
  assert.equal(lease.get('first'), undefined);
  assert.equal(lease.complete(first, prepared), false);
  assert.equal(lease.complete(second, prepared), true);
  lease.clear();
  assert.equal(lease.get('second'), undefined);
  assert.equal(lease.complete(second, prepared), false);
});
