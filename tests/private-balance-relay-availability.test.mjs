import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';

import {
  checkPrivateRelayAvailability,
  rankPrivateRelayQuotes,
} from '../src/features/private-balance/relay/availability.ts';
import { PrivateRelaySenderSession } from '../src/features/private-balance/relay/session.ts';
import { signPrivateRelayQuoteAuthorization } from '../src/features/private-balance/relay/account-authorization.ts';
import * as chainChoice from '../src/features/private-balance/relay/chain-choice.ts';

const NOW_SECONDS = 1_800_000_000;
const NETWORK_ID = '11'.repeat(32);
const POOL = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const namedSigners = new Map();
const accountSigners = new Map();
function account(name) {
  if (!namedSigners.has(name)) {
    const signer = Keypair.random();
    namedSigners.set(name, signer);
    accountSigners.set(signer.publicKey(), signer);
  }
  return namedSigners.get(name).publicKey();
}

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
    version: 3,
    type: 'quote',
    requestId,
    quoteId,
    peerPubkey,
    peerAccount,
    feeAtomic,
    accountSignature: '00'.repeat(64),
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
      const message = quote({
        ...input,
        requestId: publishedRequest.requestId,
        expiresAt: publishedRequest.expiresAt,
      });
      message.accountSignature = signPrivateRelayQuoteAuthorization(
        publishedRequest, message, accountSigners.get(message.peerAccount),
      );
      onMessage({ event: { pubkey: message.peerPubkey }, message });
    },
    closed: () => closed,
  };
}

test('availability ranks unique live peers by their lowest quoted fee', () => {
  const ranked = rankPrivateRelayQuotes([
    quote({
      quoteId: '41'.repeat(32),
      peerPubkey: '51'.repeat(32),
      peerAccount: account('GPEERB'),
      feeAtomic: '40000',
    }),
    quote({
      quoteId: '42'.repeat(32),
      peerPubkey: '52'.repeat(32),
      peerAccount: account('GPEERA'),
      feeAtomic: '30000',
    }),
    quote({
      quoteId: '43'.repeat(32),
      peerPubkey: '53'.repeat(32),
      peerAccount: account('GPEERA'),
      feeAtomic: '10000',
    }),
    quote({
      quoteId: '44'.repeat(32),
      peerPubkey: '54'.repeat(32),
      peerAccount: account('GEXPIRED'),
      feeAtomic: '1',
      expiresAt: NOW_SECONDS - 1,
    }),
  ], NOW_SECONDS);

  assert.deepEqual(ranked.map(item => [item.peerAccount, item.feeAtomic]), [
    [account('GPEERA'), '10000'],
    [account('GPEERB'), '40000'],
  ]);
});

test('availability excludes the active account so self-relay never looks private', () => {
  const ranked = rankPrivateRelayQuotes([
    quote({
      quoteId: '47'.repeat(32),
      peerPubkey: '57'.repeat(32),
      peerAccount: account('GMYACCOUNT'),
      feeAtomic: '1',
    }),
    quote({
      quoteId: '48'.repeat(32),
      peerPubkey: '58'.repeat(32),
      peerAccount: account('GUNRELATED'),
      feeAtomic: '20000',
    }),
  ], NOW_SECONDS, [account('GMYACCOUNT')]);

  assert.deepEqual(ranked.map(item => item.peerAccount), [account('GUNRELATED')]);
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
          peerAccount: account('GLIVE'),
          feeAtomic: '15000',
        }),
      ]);
      return {
        request: {},
        quotes: [
          quote({
            quoteId: '45'.repeat(32),
            peerPubkey: '55'.repeat(32),
            peerAccount: account('GSECOND'),
            feeAtomic: '20000',
          }),
          quote({
            quoteId: '46'.repeat(32),
            peerPubkey: '56'.repeat(32),
            peerAccount: account('GFIRST'),
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
  assert.deepEqual(progressive.map(snapshot => snapshot.quotes[0]?.peerAccount), [account('GLIVE')]);
  assert.equal(typeof progressive[0]?.checkedAt, 'number');
  assert.deepEqual(result.quotes.map(item => item.peerAccount), [account('GFIRST'), account('GSECOND')]);
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
    peerAccount: account('GPEERB'),
    feeAtomic: '40000',
  }), 10);
  setTimeout(() => controlled.emit({
    quoteId: '62'.repeat(32),
    peerPubkey: '72'.repeat(32),
    peerAccount: account('GPEERA'),
    feeAtomic: '10000',
  }), 60);

  const result = await pending;
  const elapsedMs = performance.now() - startedAt;

  assert.ok(elapsedMs >= 110, `settled before the last offer's quiet window: ${elapsedMs}ms`);
  assert.ok(elapsedMs < 350, `waited near the hard deadline: ${elapsedMs}ms`);
  assert.deepEqual(snapshots, [
    [[account('GPEERB'), '40000']],
    [[account('GPEERA'), '10000'], [account('GPEERB'), '40000']],
  ]);
  assert.deepEqual(result.quotes.map(item => item.peerAccount), [account('GPEERA'), account('GPEERB')]);
  assert.equal(controlled.closed(), 1);
});

test('live offers include an isolated authenticated request before the comparison window ends', async () => {
  const controlled = controlledSenderSession();
  const controller = new AbortController();
  let context;
  let offered;
  const pending = controlled.session.requestQuotes({
    networkId: NETWORK_ID, poolContractId: POOL, actionKind: 'withdraw',
    onQuotes: (quotes, request) => { offered = quotes; context = request; },
  }, controller.signal);
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  try {
    controlled.emit({ quoteId: 'ab'.repeat(32), peerPubkey: 'cd'.repeat(32), peerAccount: account('GLIVESELECT'), feeAtomic: '100' });
    assert.equal(context?.requestId, offered[0].requestId);
    assert.equal(context?.replyPubkey, controlled.session.publicKey);
    assert.equal(controlled.closed(), 0, 'choice is exposed while discovery is still open');
  } finally {
    controller.abort();
    await cancelled;
  }
  assert.equal(controlled.closed(), 1);
});

test('live observers cannot mutate the retained quote or request', async () => {
  const controlled = controlledSenderSession();
  const pending = controlled.session.requestQuotes({
    networkId: NETWORK_ID, poolContractId: POOL, actionKind: 'withdraw', settleWindowMs: 25,
    onQuotes: (quotes, request) => {
      quotes[0].feeAtomic = '999';
      if (request) request.requestId = '00'.repeat(32);
    },
  });
  controlled.emit({ quoteId: 'ad'.repeat(32), peerPubkey: 'ce'.repeat(32), peerAccount: account('GISOLATED'), feeAtomic: '100' });
  const result = await pending;
  assert.equal(result.quotes[0].feeAtomic, '100');
  assert.equal(result.request.requestId, result.quotes[0].requestId);
});

test('a chain can choose a live authenticated offer before the quiet timer and keep its session', async () => {
  assert.equal(typeof chainChoice.discoverPrivateRelayChainQuote, 'function');
  const controlled = controlledSenderSession();
  const choice = new chainChoice.PrivateRelayChainChoice();
  const controller = new AbortController();
  let shown = [];
  const pending = chainChoice.discoverPrivateRelayChainQuote({
    session: controlled.session, choice, networkId: NETWORK_ID, poolContractId: POOL,
    maximumFeeAtomic: '100', onQuotes: quotes => { shown = quotes; },
  }, controller.signal);
  const outcome = pending.catch(error => error);
  try {
    controlled.emit({ quoteId: 'ae'.repeat(32), peerPubkey: 'cf'.repeat(32), peerAccount: account('GCHAINLIVE'), feeAtomic: '100' });
    assert.equal(shown.length, 1);
    assert.equal(controlled.closed(), 0);
    assert.equal(choice.choose(shown[0].quoteId), true);
    const selected = await outcome;
    assert.equal(selected.quote.quoteId, shown[0].quoteId);
    assert.equal(selected.request.requestId, selected.quote.requestId);
    assert.equal(controller.signal.aborted, false, 'discovery cancellation must not cancel the chain');
    assert.equal(controlled.closed(), 1);
  } finally { controller.abort(); await outcome; }
});

test('chain discovery waits for explicit choice after settling and respects the fee cap', async () => {
  assert.equal(typeof chainChoice.discoverPrivateRelayChainQuote, 'function');
  const controlled = controlledSenderSession();
  const choice = new chainChoice.PrivateRelayChainChoice();
  const controller = new AbortController();
  let settled = false;
  const pending = chainChoice.discoverPrivateRelayChainQuote({
    session: controlled.session, choice, networkId: NETWORK_ID, poolContractId: POOL,
    maximumFeeAtomic: '100', settleWindowMs: 25,
    onQuotes() {}, onSettled: () => { settled = true; },
  }, controller.signal);
  const outcome = pending.catch(error => error);
  try {
    controlled.emit({ quoteId: 'af'.repeat(32), peerPubkey: 'd0'.repeat(32), peerAccount: account('GCHAINCAPPED'), feeAtomic: '101' });
    assert.equal(choice.choose('af'.repeat(32)), false);
    controlled.emit({ quoteId: 'b0'.repeat(32), peerPubkey: 'd1'.repeat(32), peerAccount: account('GCHAINOK'), feeAtomic: '100' });
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(settled, true);
    assert.equal(choice.pending, true);
    assert.equal(choice.choose('b0'.repeat(32)), true);
    assert.equal((await outcome).quote.feeAtomic, '100');
  } finally { controller.abort(); await outcome; }
});

test('cancelling streaming chain discovery clears choice and ignores late authenticated replies', async () => {
  const controlled = controlledSenderSession();
  const choice = new chainChoice.PrivateRelayChainChoice();
  const controller = new AbortController();
  let updates = 0;
  const pending = chainChoice.discoverPrivateRelayChainQuote({
    session: controlled.session, choice, networkId: NETWORK_ID, poolContractId: POOL,
    maximumFeeAtomic: '100', onQuotes: () => { updates += 1; },
  }, controller.signal);
  const cancelled = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await cancelled;
  controlled.emit({ quoteId: 'b1'.repeat(32), peerPubkey: 'd2'.repeat(32), peerAccount: account('GCHAINLATE'), feeAtomic: '100' });
  assert.equal(updates, 0);
  assert.equal(choice.pending, false);
  assert.equal(choice.choose('b1'.repeat(32)), false);
  assert.equal(controlled.closed(), 1);
});

test('chain discovery rejects when every authenticated offer exceeds the approved cap', async () => {
  const controlled = controlledSenderSession();
  const choice = new chainChoice.PrivateRelayChainChoice();
  const controller = new AbortController();
  const pending = chainChoice.discoverPrivateRelayChainQuote({
    session: controlled.session, choice, networkId: NETWORK_ID, poolContractId: POOL,
    maximumFeeAtomic: '100', settleWindowMs: 25, onQuotes() {},
  }, controller.signal);
  const failed = assert.rejects(pending, /fee cap/);
  controlled.emit({ quoteId: 'b2'.repeat(32), peerPubkey: 'd3'.repeat(32), peerAccount: account('GCHAINEXPENSIVE'), feeAtomic: '101' });
  await failed;
  assert.equal(choice.pending, false);
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
    excludePeerAccounts: [account('GMYACCOUNT')],
    onQuotes: quotes => snapshots.push(quotes.map(item => item.feeAtomic)),
  });

  setTimeout(() => controlled.emit({
    quoteId: '63'.repeat(32),
    peerPubkey: '73'.repeat(32),
    peerAccount: account('GMYACCOUNT'),
    feeAtomic: '1',
  }), 5);
  setTimeout(() => controlled.emit({
    quoteId: '64'.repeat(32),
    peerPubkey: '74'.repeat(32),
    peerAccount: account('GPEER'),
    feeAtomic: '30000',
  }), 10);
  setTimeout(() => controlled.emit({
    quoteId: '65'.repeat(32),
    peerPubkey: '75'.repeat(32),
    peerAccount: account('GPEER'),
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
    excludePeerAccounts: [account('GMYACCOUNT')],
    onIneligiblePeerAccounts: count => {
      firstExcludedAt ??= performance.now();
      excludedSnapshots.push(count);
    },
  });

  setTimeout(() => controlled.emit({
    quoteId: '66'.repeat(32),
    peerPubkey: '76'.repeat(32),
    peerAccount: account('GMYACCOUNT'),
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
    excludePeerAccounts: [account('GMYACCOUNT')],
  });

  setTimeout(() => controlled.emit({
    quoteId: '67'.repeat(32),
    peerPubkey: '77'.repeat(32),
    peerAccount: account('GMYACCOUNT'),
    feeAtomic: '1',
  }), 10);
  setTimeout(() => controlled.emit({
    quoteId: '68'.repeat(32),
    peerPubkey: '78'.repeat(32),
    peerAccount: account('GELIGIBLE'),
    feeAtomic: '10000',
  }), 180);

  const result = await pending;
  assert.deepEqual(result.quotes.map(quote => quote.peerAccount), [account('GELIGIBLE')]);
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
