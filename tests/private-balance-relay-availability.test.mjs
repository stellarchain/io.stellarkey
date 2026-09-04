import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  checkPrivateRelayAvailability,
  rankPrivateRelayQuotes,
} from '../src/features/private-balance/relay/availability.ts';
import { PrivateRelaySenderSession } from '../src/features/private-balance/relay/session.ts';

const NOW_SECONDS = 1_800_000_000;
const NETWORK_ID = '11'.repeat(32);
const POOL = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

const sessionSource = readFileSync(
  new URL('../src/features/private-balance/relay/session.ts', import.meta.url),
  'utf8',
);

function quote({
  requestId = '22'.repeat(32),
  quoteId,
  peerPubkey,
  peerAccount,
  feeAtomic,
  expiresAt = NOW_SECONDS + 30,
}) {
  return {
    version: 1,
    type: 'quote',
    requestId,
    quoteId,
    peerPubkey,
    peerAccount,
    feeAtomic,
    nonce: '33'.repeat(32),
    expiresAt,
  };
}

function controlledSenderSession() {
  let onMessage = null;
  let publishedRequest = null;
  let closed = 0;
  const messenger = {
    publicKey: '99'.repeat(32),
    subscribe(input) {
      onMessage = input.onMessage;
      return { close: () => { closed += 1; } };
    },
    async publish(message) {
      publishedRequest = message;
    },
    close() {},
  };
  return {
    session: new PrivateRelaySenderSession(messenger),
    emit(input) {
      assert.ok(onMessage);
      assert.ok(publishedRequest);
      onMessage({
        event: {},
        message: quote({ ...input, requestId: publishedRequest.requestId }),
      });
    },
    closed: () => closed,
  };
}

test('availability ranks unique live peers by their lowest quoted fee', () => {
  const ranked = rankPrivateRelayQuotes([
    quote({
      quoteId: '41'.repeat(32),
      peerPubkey: '51'.repeat(32),
      peerAccount: 'GPEERB',
      feeAtomic: '40000',
    }),
    quote({
      quoteId: '42'.repeat(32),
      peerPubkey: '52'.repeat(32),
      peerAccount: 'GPEERA',
      feeAtomic: '30000',
    }),
    quote({
      quoteId: '43'.repeat(32),
      peerPubkey: '53'.repeat(32),
      peerAccount: 'GPEERA',
      feeAtomic: '10000',
    }),
    quote({
      quoteId: '44'.repeat(32),
      peerPubkey: '54'.repeat(32),
      peerAccount: 'GEXPIRED',
      feeAtomic: '1',
      expiresAt: NOW_SECONDS - 1,
    }),
  ], NOW_SECONDS);

  assert.deepEqual(ranked.map(item => [item.peerAccount, item.feeAtomic]), [
    ['GPEERA', '10000'],
    ['GPEERB', '40000'],
  ]);
});

test('availability excludes the active account so self-relay never looks private', () => {
  const ranked = rankPrivateRelayQuotes([
    quote({
      quoteId: '47'.repeat(32),
      peerPubkey: '57'.repeat(32),
      peerAccount: 'GMYACCOUNT',
      feeAtomic: '1',
    }),
    quote({
      quoteId: '48'.repeat(32),
      peerPubkey: '58'.repeat(32),
      peerAccount: 'GUNRELATED',
      feeAtomic: '20000',
    }),
  ], NOW_SECONDS, ['GMYACCOUNT']);

  assert.deepEqual(ranked.map(item => item.peerAccount), ['GUNRELATED']);
});

test('availability check returns ranked peers and closes its ephemeral session', async () => {
  let closed = 0;
  let requestInput = null;
  const progressive = [];
  const result = await checkPrivateRelayAvailability({
    relayUrls: ['wss://relay.one', 'wss://relay.two'],
    networkId: NETWORK_ID,
    poolContractId: POOL,
    quoteWindowMs: 1_000,
    settleWindowMs: 80,
    onQuotes: snapshot => progressive.push(snapshot),
  }, undefined, async () => ({
    requestQuotes: async input => {
      requestInput = input;
      input.onQuotes?.([
        quote({
          quoteId: '49'.repeat(32),
          peerPubkey: '59'.repeat(32),
          peerAccount: 'GLIVE',
          feeAtomic: '15000',
        }),
      ]);
      return {
        request: {},
        quotes: [
          quote({
            quoteId: '45'.repeat(32),
            peerPubkey: '55'.repeat(32),
            peerAccount: 'GSECOND',
            feeAtomic: '20000',
          }),
          quote({
            quoteId: '46'.repeat(32),
            peerPubkey: '56'.repeat(32),
            peerAccount: 'GFIRST',
            feeAtomic: '10000',
          }),
        ],
      };
    },
    close: () => { closed += 1; },
  }));

  assert.equal(requestInput.actionKind, 'transfer');
  assert.equal(requestInput.quoteWindowMs, 1_000);
  assert.equal(requestInput.settleWindowMs, 80);
  assert.deepEqual(progressive.map(snapshot => snapshot.quotes[0]?.peerAccount), ['GLIVE']);
  assert.equal(typeof progressive[0]?.checkedAt, 'number');
  assert.deepEqual(result.quotes.map(item => item.peerAccount), ['GFIRST', 'GSECOND']);
  assert.equal(typeof result.checkedAt, 'number');
  assert.equal(closed, 1);
});

test('availability check closes its session when discovery fails', async () => {
  let closed = 0;
  await assert.rejects(
    checkPrivateRelayAvailability({
      relayUrls: ['wss://relay.one', 'wss://relay.two'],
      networkId: NETWORK_ID,
      poolContractId: POOL,
    }, undefined, async () => ({
      requestQuotes: async () => {
        throw new DOMException('cancelled', 'AbortError');
      },
      close: () => { closed += 1; },
    })),
    error => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.equal(closed, 1);
});

test('quote discovery streams offers immediately and settles after quote traffic becomes quiet', async () => {
  const controlled = controlledSenderSession();
  const snapshots = [];
  const startedAt = performance.now();
  const pending = controlled.session.requestQuotes({
    networkId: NETWORK_ID,
    poolContractId: POOL,
    actionKind: 'transfer',
    quoteWindowMs: 1_000,
    settleWindowMs: 70,
    onQuotes: quotes => snapshots.push(quotes.map(item => [item.peerAccount, item.feeAtomic])),
  });

  setTimeout(() => controlled.emit({
    quoteId: '61'.repeat(32),
    peerPubkey: '71'.repeat(32),
    peerAccount: 'GPEERB',
    feeAtomic: '40000',
  }), 10);
  setTimeout(() => controlled.emit({
    quoteId: '62'.repeat(32),
    peerPubkey: '72'.repeat(32),
    peerAccount: 'GPEERA',
    feeAtomic: '10000',
  }), 60);

  const result = await pending;
  const elapsedMs = performance.now() - startedAt;

  assert.ok(elapsedMs >= 110, `settled before the last offer's quiet window: ${elapsedMs}ms`);
  assert.ok(elapsedMs < 350, `waited near the hard deadline: ${elapsedMs}ms`);
  assert.deepEqual(snapshots, [
    [['GPEERB', '40000']],
    [['GPEERA', '10000'], ['GPEERB', '40000']],
  ]);
  assert.deepEqual(result.quotes.map(item => item.peerAccount), ['GPEERA', 'GPEERB']);
  assert.equal(controlled.closed(), 1);
});

test('quote discovery excludes self and emits a lower replacement fee once', async () => {
  const controlled = controlledSenderSession();
  const snapshots = [];
  const pending = controlled.session.requestQuotes({
    networkId: NETWORK_ID,
    poolContractId: POOL,
    actionKind: 'transfer',
    quoteWindowMs: 1_000,
    settleWindowMs: 70,
    excludePeerAccounts: ['GMYACCOUNT'],
    onQuotes: quotes => snapshots.push(quotes.map(item => item.feeAtomic)),
  });

  setTimeout(() => controlled.emit({
    quoteId: '63'.repeat(32),
    peerPubkey: '73'.repeat(32),
    peerAccount: 'GMYACCOUNT',
    feeAtomic: '1',
  }), 5);
  setTimeout(() => controlled.emit({
    quoteId: '64'.repeat(32),
    peerPubkey: '74'.repeat(32),
    peerAccount: 'GPEER',
    feeAtomic: '30000',
  }), 10);
  setTimeout(() => controlled.emit({
    quoteId: '65'.repeat(32),
    peerPubkey: '75'.repeat(32),
    peerAccount: 'GPEER',
    feeAtomic: '10000',
  }), 30);

  const result = await pending;
  assert.deepEqual(snapshots, [['30000'], ['10000']]);
  assert.deepEqual(result.quotes.map(item => item.feeAtomic), ['10000']);
});

test('a same-account helper is reported immediately but never becomes an eligible quote', async () => {
  const controlled = controlledSenderSession();
  const excludedSnapshots = [];
  let firstExcludedAt = null;
  const startedAt = performance.now();
  const pending = controlled.session.requestQuotes({
    networkId: NETWORK_ID,
    poolContractId: POOL,
    actionKind: 'transfer',
    quoteWindowMs: 1_000,
    settleWindowMs: 70,
    excludePeerAccounts: ['GMYACCOUNT'],
    onIneligiblePeerAccounts: count => {
      firstExcludedAt ??= performance.now();
      excludedSnapshots.push(count);
    },
  });

  setTimeout(() => controlled.emit({
    quoteId: '66'.repeat(32),
    peerPubkey: '76'.repeat(32),
    peerAccount: 'GMYACCOUNT',
    feeAtomic: '1',
  }), 10);

  const result = await pending;
  const elapsedMs = performance.now() - startedAt;
  assert.deepEqual(result.quotes, []);
  assert.equal(result.ineligiblePeerAccounts, 1);
  assert.deepEqual(excludedSnapshots, [1]);
  assert.ok(firstExcludedAt !== null && firstExcludedAt - startedAt < 150);
  assert.ok(elapsedMs >= 900, `an ineligible reply shortened discovery: ${elapsedMs}ms`);
});

test('an ineligible quote cannot end discovery before a slower eligible peer arrives', async () => {
  const controlled = controlledSenderSession();
  const pending = controlled.session.requestQuotes({
    networkId: NETWORK_ID,
    poolContractId: POOL,
    actionKind: 'transfer',
    quoteWindowMs: 1_000,
    settleWindowMs: 100,
    excludePeerAccounts: ['GMYACCOUNT'],
  });

  setTimeout(() => controlled.emit({
    quoteId: '67'.repeat(32),
    peerPubkey: '77'.repeat(32),
    peerAccount: 'GMYACCOUNT',
    feeAtomic: '1',
  }), 10);
  setTimeout(() => controlled.emit({
    quoteId: '68'.repeat(32),
    peerPubkey: '78'.repeat(32),
    peerAccount: 'GELIGIBLE',
    feeAtomic: '10000',
  }), 180);

  const result = await pending;
  assert.deepEqual(result.quotes.map(quote => quote.peerAccount), ['GELIGIBLE']);
  assert.equal(result.ineligiblePeerAccounts, 1);
});

test('quote discovery retains the hard deadline when no peer answers', async () => {
  const controlled = controlledSenderSession();
  const startedAt = performance.now();

  const result = await controlled.session.requestQuotes({
    networkId: NETWORK_ID,
    poolContractId: POOL,
    actionKind: 'transfer',
    quoteWindowMs: 1_000,
    settleWindowMs: 70,
  });

  assert.deepEqual(result.quotes, []);
  assert.ok(performance.now() - startedAt >= 900);
  assert.equal(controlled.closed(), 1);
});

test('quote discovery aborts before either discovery timer completes', async () => {
  const controlled = controlledSenderSession();
  const controller = new AbortController();
  const startedAt = performance.now();
  const pending = controlled.session.requestQuotes({
    networkId: NETWORK_ID,
    poolContractId: POOL,
    actionKind: 'transfer',
    quoteWindowMs: 1_000,
    settleWindowMs: 70,
  }, controller.signal);

  setTimeout(() => controller.abort(), 20);

  await assert.rejects(
    pending,
    error => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.ok(performance.now() - startedAt < 300);
  assert.equal(controlled.closed(), 1);
});

test('quote discovery rejects a signal that was already aborted', async () => {
  const controlled = controlledSenderSession();
  const controller = new AbortController();
  controller.abort();
  const startedAt = performance.now();

  await assert.rejects(
    controlled.session.requestQuotes({
      networkId: NETWORK_ID,
      poolContractId: POOL,
      actionKind: 'transfer',
      quoteWindowMs: 1_000,
      settleWindowMs: 70,
    }, controller.signal),
    error => error instanceof DOMException && error.name === 'AbortError',
  );

  assert.ok(performance.now() - startedAt < 300);
  assert.equal(controlled.closed(), 1);
});

test('quote discovery bounds untrusted replies before retaining them', () => {
  assert.match(sessionSource, /MAX_RELAY_QUOTES/);
  assert.match(sessionSource, /quotes\.size >= MAX_RELAY_QUOTES/);
});
