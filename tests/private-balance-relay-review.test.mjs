import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Account, Contract, SorobanDataBuilder, TransactionBuilder } from '@stellar/stellar-sdk';

import { reviewPrivateRelayJob } from '../src/features/private-balance/relay/review.ts';
import { PrivateBalanceTransactionBuilder } from '../src/features/private-balance/runtime/transaction-builder.ts';

const NETWORK = 'Test SDF Network ; September 2015';
const SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const POOL = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function validRelayTransaction() {
  const recipientEnvelope = new Uint8Array(181);
  recipientEnvelope[0] = 1;
  recipientEnvelope.set([1, 2, 3, 4], 1);
  recipientEnvelope[5] = 1;
  recipientEnvelope[37] = 1;
  const outgoingEnvelope = new Uint8Array(157);
  outgoingEnvelope[0] = 1;
  const output = value => ({
    commitment: Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? value : 0),
    recipientEnvelope,
    outgoingEnvelope,
  });
  const operation = new PrivateBalanceTransactionBuilder({ poolContractId: POOL })
    .buildTransferOperation({
      action: {
        actionNonce: Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 7 : 0),
        anchorRoot: Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 8 : 0),
        nullifiers: [
          Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 9 : 0),
          Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 10 : 0),
        ],
        outputs: [output(1), output(2), output(3)],
        publicValue: 0n,
      },
      proof: {
        a: new Uint8Array(64),
        b: new Uint8Array(128),
        c: new Uint8Array(64),
      },
    });
  return new TransactionBuilder(new Account(SOURCE, '1'), {
    fee: '100',
    networkPassphrase: NETWORK,
    timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 120 },
  })
    .addOperation(operation)
    .setSorobanData(new SorobanDataBuilder().setResourceFee('500').build())
    .build();
}

test('helper review accepts only the exact unsigned, fee-capped, matched-lane pool action', () => {
  const transaction = validRelayTransaction();
  const reviewed = reviewPrivateRelayJob({
    unsignedEnvelopeXdr: transaction.toXdr(),
    transactionHash: Buffer.from(transaction.hash()).toString('hex'),
    networkPassphrase: NETWORK,
    expectedSource: SOURCE,
    poolContractId: POOL,
    assetIndex: 0,
    actionDiversifier: '01020304',
    maximumClassicFeeStroops: 100n,
    maximumResourceFeeStroops: 500n,
  });

  assert.equal(reviewed.method, 'transfer');
  assert.equal(reviewed.classicFeeStroops, 100n);
  assert.equal(reviewed.resourceFeeStroops, 500n);
  assert.equal(reviewed.outputs.length, 3);
});

test('helper review rejects a transaction that does not invoke the selected private pool method', () => {
  const transaction = new TransactionBuilder(new Account(SOURCE, '1'), {
    fee: '100',
    networkPassphrase: NETWORK,
    timebounds: { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 120 },
  }).addOperation(new Contract(POOL).call('add_asset')).build();

  assert.throws(() => reviewPrivateRelayJob({
    unsignedEnvelopeXdr: transaction.toXdr(),
    transactionHash: Buffer.from(transaction.hash()).toString('hex'),
    networkPassphrase: NETWORK,
    expectedSource: SOURCE,
    poolContractId: POOL,
    assetIndex: 0,
    actionDiversifier: '01020304',
    maximumClassicFeeStroops: 100n,
    maximumResourceFeeStroops: 1_000_000n,
  }), /transfer or withdraw/iu);
});

test('helper policy includes local fee-note decryption and exact simulation before signing', () => {
  const worker = read('src/features/private-balance/worker/private-balance.worker.ts');
  const provider = read('src/features/private-balance/runtime/provider.tsx');

  assert.match(worker, /VERIFY_RELAY_FEE/);
  assert.match(worker, /openRecipientEnvelope/);
  assert.match(provider, /verifyRelayFee/);
  assert.match(provider, /simulateTransaction/);
  assert.match(provider, /signPrivateBalanceEnvelope/);
});
