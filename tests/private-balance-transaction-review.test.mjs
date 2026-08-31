import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewPrivateBalanceTransaction } from '../src/features/private-balance/runtime/transaction-review.ts';

test('private transaction review fails closed before approving malformed XDR', () => {
  assert.throws(
    () => reviewPrivateBalanceTransaction({
      envelopeXdr: 'not-xdr',
      manifest: {
        networkPassphrase: 'Test SDF Network ; September 2015',
        poolContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAITA4',
        assetContractId: 'CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF',
      },
      source: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      sequence: '1',
      timeBounds: { minTime: '0', maxTime: '1' },
      operation: undefined,
      simulationTransactionDataXdr: '',
      maximumClassicFeeStroops: 100n,
      maximumResourceFeeStroops: 0n,
    }),
    /invalid|xdr|envelope/i,
  );
});
