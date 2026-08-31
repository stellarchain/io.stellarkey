import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planPrivateChainedSend,
  runPrivateChainedSend,
  PrivateChainedFeePreflightError,
  PrivateChainedStepRejectedError,
  PRIVATE_CHAINED_APPROVAL_WINDOW_SECONDS,
} from '../src/features/private-balance/runtime/chained-send.ts';

const OWN_FINGERPRINT = 'ABCD EF01';
const RECIPIENT = `tks1${'p'.repeat(115)}`;
const DRAFT = { kind: 'transfer', amount: '2.5', recipientAddress: RECIPIENT };

function approvalFixture(overrides = {}) {
  return {
    id: 'chain-1',
    steps: 3,
    perStepMaxFeeStroops: '1000',
    cumulativeMaxFeeStroops: '3000',
    expiresAtSeconds: 10_000,
    ...overrides,
  };
}

function reviewFixture(step, overrides = {}) {
  const isFinal = overrides.kind === 'transfer';
  return {
    id: `action-${step}`,
    kind: 'consolidate',
    rpcUrl: 'https://rpc.example.test',
    amountStroops: isFinal ? '25000000' : '5000000',
    inputValueStroops: '25000000',
    changeValueStroops: '0',
    recipientAddress: isFinal ? RECIPIENT : null,
    recipientFingerprint: OWN_FINGERPRINT,
    publicRecipient: null,
    anchorExpiresAtLedger: 500,
    latestLedger: 400,
    transaction: {
      envelopeXdr: 'AAAA',
      transactionHash: 'ab'.repeat(32),
      method: 'transfer',
      classicFeeStroops: 100n,
      resourceFeeStroops: 400n,
      expiresAt: 9_000,
    },
    ...overrides,
  };
}

function driverHarness({ reviews, submitResults, confirmations }) {
  const calls = [];
  const advances = [];
  const progress = [];
  let prepared = 0;
  return {
    calls,
    advances,
    progress,
    input: {
      approval: approvalFixture(),
      draft: DRAFT,
      ownFingerprint: OWN_FINGERPRINT,
      assetDecimals: 7,
      prepare: async draft => {
        calls.push(['prepare', draft.kind]);
        prepared += 1;
        return reviews[prepared - 1];
      },
      submit: async (review, { isFinal }) => {
        calls.push(['submit', review.id, isFinal]);
        return submitResults.shift() ?? 'broadcast';
      },
      cancel: async actionId => {
        calls.push(['cancel', actionId]);
      },
      awaitConfirmation: async review => {
        calls.push(['await', review.id]);
        return confirmations.shift() ?? true;
      },
      advanceApprovedFee: async stepFee => {
        advances.push(stepFee);
      },
      onProgress: update => progress.push(update),
      now: () => 1_000_000,
    },
  };
}

test('the chained approval plan preflights public XLM for the whole chain', () => {
  const approval = planPrivateChainedSend({
    approvalId: 'chain-1',
    consolidationActionCount: 2,
    perStepMaxFeeStroops: 1_000n,
    publicXlmBalanceStroops: 3_000n,
    nowSeconds: 500,
  });
  assert.equal(approval.steps, 3);
  assert.equal(approval.perStepMaxFeeStroops, '1000');
  assert.equal(approval.cumulativeMaxFeeStroops, '3000');
  assert.equal(approval.expiresAtSeconds, 500 + PRIVATE_CHAINED_APPROVAL_WINDOW_SECONDS);

  assert.throws(
    () => planPrivateChainedSend({
      approvalId: 'chain-2',
      consolidationActionCount: 2,
      perStepMaxFeeStroops: 1_000n,
      publicXlmBalanceStroops: 2_999n,
      nowSeconds: 500,
    }),
    error => {
      assert.ok(error instanceof PrivateChainedFeePreflightError);
      assert.equal(error.missingStroops, '1');
      return true;
    },
  );
});

test('the chained driver runs consolidations then the send under one approval', async () => {
  const harness = driverHarness({
    reviews: [
      reviewFixture(1),
      reviewFixture(2),
      reviewFixture(3, { kind: 'transfer' }),
    ],
    submitResults: ['broadcast', 'broadcast', 'broadcast'],
    confirmations: [true, true],
  });
  const result = await runPrivateChainedSend(harness.input);
  assert.equal(result.status, 'broadcast');
  // The final send's hash flows back so the success screen can link it.
  assert.equal(result.finalTransactionHash, 'ab'.repeat(32));
  assert.deepEqual(harness.calls, [
    ['prepare', 'consolidate'],
    ['submit', 'action-1', false],
    ['await', 'action-1'],
    ['prepare', 'consolidate'],
    ['submit', 'action-2', false],
    ['await', 'action-2'],
    ['prepare', 'transfer'],
    ['submit', 'action-3', true],
  ]);
  // The durable running total advances before every broadcast.
  assert.deepEqual(harness.advances, [500n, 500n, 500n]);
  assert.deepEqual(
    harness.progress.map(update => `${update.step}/${update.totalSteps}:${update.stage}`),
    [
      '1/3:preparing', '1/3:confirming', '1/3:waiting',
      '2/3:preparing', '2/3:confirming', '2/3:waiting',
      '3/3:preparing', '3/3:confirming',
    ],
  );
});

test('a consolidation step not addressed to the wallet aborts before broadcast', async () => {
  const harness = driverHarness({
    reviews: [reviewFixture(1, { recipientFingerprint: '9999 9999' })],
    submitResults: [],
    confirmations: [],
  });
  await assert.rejects(
    runPrivateChainedSend(harness.input),
    PrivateChainedStepRejectedError,
  );
  assert.deepEqual(harness.calls, [
    ['prepare', 'consolidate'],
    ['cancel', 'action-1'],
  ]);
  assert.deepEqual(harness.advances, []);
});

test('a step fee over the approved cap aborts before broadcast', async () => {
  const overCap = reviewFixture(1);
  overCap.transaction = { ...overCap.transaction, resourceFeeStroops: 901n };
  const harness = driverHarness({
    reviews: [overCap],
    submitResults: [],
    confirmations: [],
  });
  await assert.rejects(
    runPrivateChainedSend(harness.input),
    /per-step cap/,
  );
  assert.deepEqual(harness.calls, [
    ['prepare', 'consolidate'],
    ['cancel', 'action-1'],
  ]);
  assert.deepEqual(harness.advances, []);
});

test('the final send must match the approved amount and recipient', async () => {
  const harness = driverHarness({
    reviews: [
      reviewFixture(1),
      reviewFixture(2),
      reviewFixture(3, { kind: 'transfer', amountStroops: '25000001' }),
    ],
    submitResults: ['broadcast', 'broadcast'],
    confirmations: [true, true],
  });
  await assert.rejects(
    runPrivateChainedSend(harness.input),
    /no longer matches the approved amount/,
  );
  assert.deepEqual(harness.calls.at(-1), ['cancel', 'action-3']);
  assert.deepEqual(harness.advances, [500n, 500n]);
});

test('the chain dies on its first failure without preparing further steps', async () => {
  const harness = driverHarness({
    reviews: [reviewFixture(1), reviewFixture(2)],
    submitResults: ['broadcast'],
    confirmations: [false],
  });
  await assert.rejects(
    runPrivateChainedSend(harness.input),
    /still confirming/,
  );
  // The unconfirmed step never leads to a second preparation.
  assert.deepEqual(harness.calls, [
    ['prepare', 'consolidate'],
    ['submit', 'action-1', false],
    ['await', 'action-1'],
  ]);
});

test('a rejected fee advance cancels the prepared step instead of orphaning it', async () => {
  const harness = driverHarness({
    reviews: [reviewFixture(1)],
    submitResults: [],
    confirmations: [],
  });
  // The 15-minute approval lapsed (or a cross-tab commit won the CAS) between
  // the loop-top expiry check and the durable fee advance.
  harness.input.advanceApprovedFee = async () => {
    throw new Error('Private Balance chained approval expired.');
  };
  await assert.rejects(
    runPrivateChainedSend(harness.input),
    /approval expired/i,
  );
  // The just-prepared step is released before the error surfaces, so its
  // reserved notes never wedge as a durable orphan.
  assert.deepEqual(harness.calls, [
    ['prepare', 'consolidate'],
    ['cancel', 'action-1'],
  ]);
});

test('the final send must match the approved memo', async () => {
  const memoDraft = { ...DRAFT, memo: '  Rent  ' };
  const expectedMemoHex = Array.from(
    new TextEncoder().encode('Rent'),
    byte => byte.toString(16).padStart(2, '0'),
  ).join('');

  // A built transfer whose memo drifted from the approved draft is rejected
  // and cancelled before signing.
  const mismatch = driverHarness({
    reviews: [
      reviewFixture(1),
      reviewFixture(2),
      reviewFixture(3, { kind: 'transfer', memoHex: 'ff'.repeat(4) }),
    ],
    submitResults: ['broadcast', 'broadcast'],
    confirmations: [true, true],
  });
  mismatch.input.draft = memoDraft;
  await assert.rejects(
    runPrivateChainedSend(mismatch.input),
    /no longer matches the approved amount/,
  );
  assert.deepEqual(mismatch.calls.at(-1), ['cancel', 'action-3']);

  // A missing memo on the built transfer is also a mismatch.
  const missing = driverHarness({
    reviews: [
      reviewFixture(1),
      reviewFixture(2),
      reviewFixture(3, { kind: 'transfer' }),
    ],
    submitResults: ['broadcast', 'broadcast'],
    confirmations: [true, true],
  });
  missing.input.draft = memoDraft;
  await assert.rejects(
    runPrivateChainedSend(missing.input),
    /no longer matches the approved amount/,
  );

  // The matching memo (same trim-then-encode normalization as the
  // preparation flow) passes.
  const matching = driverHarness({
    reviews: [
      reviewFixture(1),
      reviewFixture(2),
      reviewFixture(3, { kind: 'transfer', memoHex: expectedMemoHex }),
    ],
    submitResults: ['broadcast', 'broadcast', 'broadcast'],
    confirmations: [true, true],
  });
  matching.input.draft = memoDraft;
  const result = await runPrivateChainedSend(matching.input);
  assert.equal(result.status, 'broadcast');
});

test('an expired approval refuses to drive any further step', async () => {
  const harness = driverHarness({
    reviews: [reviewFixture(1)],
    submitResults: [],
    confirmations: [],
  });
  harness.input.now = () => 10_001_000;
  await assert.rejects(
    runPrivateChainedSend(harness.input),
    /approval expired/i,
  );
  assert.deepEqual(harness.calls, []);
});
