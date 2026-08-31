import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Account,
  Address,
  Contract,
  Keypair,
  Memo,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { PrivateBalanceTransactionBuilder } from '../src/features/private-balance/runtime/transaction-builder.ts';
import { reviewPrivateBalanceTransaction } from '../src/features/private-balance/runtime/transaction-review.ts';
import { prepareReviewedPrivateBalanceTransaction } from '../src/features/private-balance/runtime/action-transaction.ts';

const manifest = {
  poolContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
  assetContractId: StrKey.encodeContract(Buffer.alloc(32, 2)),
};
const bytes = (length, value) => new Uint8Array(length).fill(value);
const proof = { a: bytes(64, 1), b: bytes(128, 2), c: bytes(64, 3) };
const output = (value) => ({ commitment: bytes(32, value), recipientEnvelope: bytes(181, value) });
const relayer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function invocation(operation) {
  return operation.body.invokeHostFunctionOp.hostFunction.invokeContract;
}

test('private transaction builder matches the fixed deposit/transfer/withdraw ABI', () => {
  const builder = new PrivateBalanceTransactionBuilder(manifest);
  const common = {
    assetContractId: manifest.assetContractId,
    actionNonce: bytes(32, 4),
    anchorRoot: bytes(32, 5),
    nullifiers: [bytes(32, 6), bytes(32, 7)],
    outputs: [output(8), output(9)],
    publicValue: 10n,
  };

  const deposit = invocation(builder.buildDepositOperation({
    action: {
      ...common,
      anchorRoot: bytes(32, 0),
      nullifiers: [bytes(32, 0), bytes(32, 0)],
      depositSource: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    },
    proof,
  }));
  assert.equal(deposit.functionName.toString(), 'deposit');
  assert.equal(deposit.args.length, 2);
  assert.deepEqual(Object.keys(scValToNative(deposit.args[0])), [
    'action_nonce',
    'anchor_root',
    'asset',
    'deposit_source',
    'nullifier_0',
    'nullifier_1',
    'output_0',
    'output_1',
    'public_value',
  ]);

  const transfer = invocation(builder.buildTransferOperation({
    action: { ...common, relayerFee: 0n, relayer },
    proof,
  }));
  assert.equal(transfer.functionName.toString(), 'transfer');
  assert.equal(transfer.args.length, 2);

  const withdraw = invocation(builder.buildWithdrawOperation({
    action: {
      ...common,
      publicRecipient: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      relayerFee: 0n,
      relayer,
    },
    proof,
  }));
  assert.equal(withdraw.functionName.toString(), 'withdraw');
  assert.equal(withdraw.args.length, 2);
});

test('private transaction builder rejects malformed fixed proof widths', () => {
  const builder = new PrivateBalanceTransactionBuilder(manifest);
  assert.throws(
    () => builder.buildTransferOperation({
      action: {
        assetContractId: manifest.assetContractId,
        actionNonce: bytes(32, 1),
        anchorRoot: bytes(32, 2),
        nullifiers: [bytes(32, 3), bytes(32, 0)],
        outputs: [output(4), output(5)],
        publicValue: 0n,
        relayerFee: 0n,
        relayer,
      },
      proof: { ...proof, a: bytes(63, 1) },
    }),
    /64 bytes/,
  );
});

test('private transaction reviewer approves only the exact prepared envelope', () => {
  const source = Keypair.random().publicKey();
  const operation = new PrivateBalanceTransactionBuilder(manifest).buildTransferOperation({
    action: {
      assetContractId: manifest.assetContractId,
      actionNonce: bytes(32, 1),
      anchorRoot: bytes(32, 2),
      nullifiers: [bytes(32, 3), bytes(32, 4)],
      outputs: [output(5), output(6)],
      publicValue: 0n,
      relayerFee: 0n,
      relayer,
    },
    proof,
  });
  const sorobanData = new SorobanDataBuilder().setResourceFee('500').build();
  const build = ({ fee = '100', memo = Memo.none(), extraOperation = false, data = sorobanData } = {}) => {
    const builder = new TransactionBuilder(new Account(source, '7'), {
      fee,
      memo,
      networkPassphrase: 'Test SDF Network ; September 2015',
      timebounds: { minTime: 1, maxTime: 2_000_000_000 },
    }).addOperation(operation);
    if (extraOperation) builder.addOperation(operation);
    return builder.setSorobanData(data).build().toXdr();
  };
  const expected = {
    envelopeXdr: build(),
    manifest: {
      networkPassphrase: 'Test SDF Network ; September 2015',
      poolContractId: manifest.poolContractId,
    },
    assetContractId: manifest.assetContractId,
    source,
    sequence: '8',
    timeBounds: { minTime: '1', maxTime: '2000000000' },
    operation,
    simulationTransactionDataXdr: sorobanData.toXDR('base64'),
    maximumClassicFeeStroops: 100n,
    maximumResourceFeeStroops: 500n,
  };

  const review = reviewPrivateBalanceTransaction(expected);
  assert.equal(review.method, 'transfer');
  assert.equal(review.classicFeeStroops, 100n);
  assert.equal(review.resourceFeeStroops, 500n);
  assert.match(review.transactionHash, /^[0-9a-f]{64}$/);

  assert.throws(
    () => reviewPrivateBalanceTransaction({ ...expected, envelopeXdr: build({ fee: '101' }) }),
    /classic fee exceeds/i,
  );
  assert.throws(
    () => reviewPrivateBalanceTransaction({ ...expected, envelopeXdr: build({ memo: Memo.text('x') }) }),
    /memo/i,
  );
  assert.throws(
    () => reviewPrivateBalanceTransaction({ ...expected, envelopeXdr: build({ extraOperation: true }) }),
    /exactly one operation/i,
  );
  assert.throws(
    () => reviewPrivateBalanceTransaction({
      ...expected,
      simulationTransactionDataXdr: new SorobanDataBuilder().setResourceFee('499').build().toXDR('base64'),
    }),
    /simulation/i,
  );
});

test('private transaction preparation binds simulation, fees, source, and time bounds', async () => {
  const source = Keypair.random().publicKey();
  const operation = new PrivateBalanceTransactionBuilder(manifest).buildTransferOperation({
    action: {
      assetContractId: manifest.assetContractId,
      actionNonce: bytes(32, 1),
      anchorRoot: bytes(32, 2),
      nullifiers: [bytes(32, 3), bytes(32, 4)],
      outputs: [output(5), output(6)],
      publicValue: 0n,
      relayerFee: 0n,
      relayer,
    },
    proof,
  });
  const simulationData = new SorobanDataBuilder().setResourceFee('500');
  const rpc = {
    async getAccount(address) {
      assert.equal(address, source);
      return new Account(source, '7');
    },
    async simulateTransaction() {
      return {
        _parsed: true,
        id: 'simulation-1',
        latestLedger: 100,
        events: [],
        transactionData: simulationData,
        minResourceFee: '500',
        result: { auth: [], retval: xdr.ScVal.scvVoid() },
      };
    },
  };
  const prepared = await prepareReviewedPrivateBalanceTransaction({
    rpc,
    operation,
    manifest: {
      networkPassphrase: 'Test SDF Network ; September 2015',
      poolContractId: manifest.poolContractId,
    },
    assetContractId: manifest.assetContractId,
    source,
    classicFeeStroops: 100n,
    maximumResourceFeeStroops: 1_000n,
    nowSeconds: 10,
  });
  assert.equal(prepared.review.method, 'transfer');
  assert.equal(prepared.review.classicFeeStroops, 100n);
  assert.equal(prepared.review.resourceFeeStroops, 500n);
  assert.deepEqual(prepared.timeBounds, { minTime: '0', maxTime: '310' });
});

test('private deposit review accepts only its exact source-account SAC transfer authorization', () => {
  const source = Keypair.random().publicKey();
  const operation = new PrivateBalanceTransactionBuilder(manifest).buildDepositOperation({
    action: {
      assetContractId: manifest.assetContractId,
      actionNonce: bytes(32, 1),
      anchorRoot: bytes(32, 0),
      nullifiers: [bytes(32, 0), bytes(32, 0)],
      outputs: [output(5), output(0)],
      publicValue: 10n,
      depositSource: source,
    },
    proof,
  });
  const transfer = new Contract(manifest.assetContractId).call(
    'transfer',
    Address.fromString(source).toScVal(),
    Address.fromString(manifest.poolContractId).toScVal(),
    nativeToScVal(10n),
  ).body.invokeHostFunctionOp.hostFunction.invokeContract;
  const authorized = (contractFn, subInvocations = []) => new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(contractFn),
    subInvocations,
  });
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: authorized(
      operation.body.invokeHostFunctionOp.hostFunction.invokeContract,
      [authorized(transfer)],
    ),
  });
  const assembledOperation = xdr.Operation.fromXDR(operation.toXDR());
  assembledOperation.body.invokeHostFunctionOp.auth = [entry];
  const sorobanData = new SorobanDataBuilder().setResourceFee('500').build();
  const transaction = new TransactionBuilder(new Account(source, '7'), {
    fee: '100',
    networkPassphrase: 'Test SDF Network ; September 2015',
    timebounds: { minTime: 1, maxTime: 2_000_000_000 },
  }).addOperation(assembledOperation).setSorobanData(sorobanData).build();

  const review = reviewPrivateBalanceTransaction({
    envelopeXdr: transaction.toXdr(),
    manifest: {
      networkPassphrase: 'Test SDF Network ; September 2015',
      poolContractId: manifest.poolContractId,
    },
    assetContractId: manifest.assetContractId,
    source,
    sequence: '8',
    timeBounds: { minTime: '1', maxTime: '2000000000' },
    operation,
    simulationTransactionDataXdr: sorobanData.toXDR('base64'),
    maximumClassicFeeStroops: 100n,
    maximumResourceFeeStroops: 500n,
  });
  assert.equal(review.method, 'deposit');
});
