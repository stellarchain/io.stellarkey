import assert from 'node:assert/strict';
import test from 'node:test';
import { Account, Contract, SorobanDataBuilder, StrKey, xdr } from '@stellar/stellar-sdk';
import { humanizePrivateError } from '../src/features/private-balance/copy.ts';
import { prepareReviewedPrivateBalanceTransaction } from '../src/features/private-balance/runtime/action-transaction.ts';
import { MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS } from '../src/features/private-balance/runtime/fee-policy.ts';
import { PrivateProofExposedError } from '../src/features/private-balance/runtime/proof-exposure.ts';

const capError = 'Private Balance simulated resource fee exceeds the approved cap.';

test('fee-limit preparation errors explain the limit without inventing a payment outcome', () => {
  const shown = humanizePrivateError(new Error(capError));
  assert.equal(shown.title, 'Network fee exceeds the limit');
  assert.match(shown.body, /preparation stopped/i);
  assert.match(shown.body, /approved limit/i);
  assert.match(shown.body, /check private activity/i);
  assert.doesNotMatch(shown.body, /nothing was sent|nothing left|try again|status could not be determined/i);
  assert.equal(shown.action, 'details');
  assert.equal(shown.technical, capError);
});

test('a disclosed spend retains its unknown-status warning even when the cause is the fee limit', () => {
  const shown = humanizePrivateError(new PrivateProofExposedError(new Error(capError)));
  assert.equal(shown.title, 'Payment status unknown');
  assert.match(shown.body, /remain reserved/);
  assert.doesNotMatch(shown.body, /nothing was sent|try again/i);
  assert.equal(shown.action, undefined);
});

test('the real SDK preparation refuses cold-restoration fees without raising the action cap', async () => {
  assert.equal(MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS, 10_000_000n);
  const source = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  const poolContractId = StrKey.encodeContract(Buffer.alloc(32, 91));
  const operation = new Contract(poolContractId).call('touch_root');
  let simulations = 0;
  const rpc = {
    async getAccount() { return new Account(source, '7'); },
    async simulateTransaction() {
      simulations++;
      return {
        _parsed: true, id: 'synthetic-fee-limit', latestLedger: 100, events: [],
        transactionData: new SorobanDataBuilder().setResourceFee('50514133'),
        minResourceFee: '50514133',
        result: { auth: [], retval: xdr.ScVal.scvVoid() },
      };
    },
    async sendTransaction() { assert.fail('Preparation must never submit a transaction'); },
  };
  await assert.rejects(prepareReviewedPrivateBalanceTransaction({
    rpc, operation, source,
    manifest: { networkPassphrase: 'Test SDF Network ; September 2015', poolContractId, assets: [] },
    classicFeeStroops: 100n,
    maximumResourceFeeStroops: MAX_PRIVATE_ACTION_RESOURCE_FEE_STROOPS,
    nowSeconds: 10,
  }), { message: capError });
  assert.equal(simulations, 1);
});
