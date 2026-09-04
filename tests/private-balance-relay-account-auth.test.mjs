import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { PrivateRelayHelperSession, PrivateRelayMessenger, PrivateRelaySenderSession } from '../src/features/private-balance/relay/session.ts';
import { PRIVATE_RELAY_PROTOCOL_VERSION, decodePrivateRelayMessage, encodePrivateRelayMessage } from '../src/features/private-balance/relay/protocol.ts';
import { PRIVATE_RELAY_TOPIC } from '../src/features/private-balance/relay/nostr.ts';
import { BoundedPrivateRelayTransport } from '../src/features/private-balance/relay/transport.ts';
import { signPrivateRelayQuoteAuthorization, verifyPrivateRelayQuoteAuthorization } from '../src/features/private-balance/relay/account-authorization.ts';

const NETWORK_ID = '11'.repeat(32);
const POOL = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

function request(overrides = {}) {
  return {
    version: PRIVATE_RELAY_PROTOCOL_VERSION,
    type: 'request',
    requestId: '10'.repeat(32),
    networkId: NETWORK_ID,
    poolContractId: POOL,
    replyPubkey: '22'.repeat(32),
    nonce: '66'.repeat(32),
    expiresAt: Math.floor(Date.now() / 1_000) + 60,
    ...overrides,
  };
}

// Independently encode the documented fixed-order account-possession statement.
function statement(request, quote) {
  return Buffer.from(JSON.stringify([
    'stellarkey/private-relay/account-key-quote',
    request.version,
    request.networkId,
    request.poolContractId,
    request.requestId,
    request.replyPubkey,
    request.nonce,
    request.expiresAt,
    quote.quoteId,
    quote.peerPubkey,
    quote.peerAccount,
    quote.feeAtomic,
    quote.nonce,
    quote.expiresAt,
  ]), 'utf8');
}

function signedQuote(request, signer, overrides = {}) {
  const quote = {
    version: PRIVATE_RELAY_PROTOCOL_VERSION,
    type: 'quote',
    requestId: request.requestId,
    quoteId: '44'.repeat(32),
    peerPubkey: '33'.repeat(32),
    peerAccount: signer.publicKey(),
    feeAtomic: '10000',
    nonce: '55'.repeat(32),
    expiresAt: request.expiresAt,
    ...overrides,
  };
  return { ...quote, accountSignature: Buffer.from(signer.sign(statement(request, quote))).toString('hex') };
}

test('unauthenticated helper impersonation never reaches quote observers or ranking', async () => {
  const peerAccount = Keypair.random().publicKey();
  const observed = [];
  let receive;
  const messenger = {
    publicKey: '22'.repeat(32),
    subscribe(input) {
      receive = input.onMessage;
      return { close() {} };
    },
    async publish(request) {
      receive({
        event: { pubkey: '33'.repeat(32) },
        message: {
          version: PRIVATE_RELAY_PROTOCOL_VERSION,
          type: 'quote',
          requestId: request.requestId,
          quoteId: '44'.repeat(32),
          peerPubkey: '33'.repeat(32),
          peerAccount,
          feeAtomic: '1',
          nonce: '55'.repeat(32),
          expiresAt: request.expiresAt,
        },
      });
    },
  };
  const session = new PrivateRelaySenderSession(messenger);
  const result = await session.requestQuotes({
    networkId: NETWORK_ID,
    poolContractId: POOL,
    actionKind: 'transfer',
    quoteWindowMs: 1_000,
    settleWindowMs: 25,
    onQuotes: quotes => observed.push(quotes),
  });
  assert.deepEqual(observed, []);
  assert.deepEqual(result.quotes, []);
});

test('a cheaper impersonating Nostr peer cannot replace an authenticated helper quote', async () => {
  const signer = Keypair.random();
  const attacker = Keypair.random();
  const observed = [];
  let receive;
  const messenger = {
    publicKey: '22'.repeat(32),
    subscribe(input) { receive = input.onMessage; return { close() {} }; },
    async publish(request) {
      const valid = signedQuote(request, signer);
      receive({ event: { pubkey: valid.peerPubkey }, message: valid });
      const impersonation = signedQuote(request, attacker, {
        peerAccount: signer.publicKey(),
        peerPubkey: '77'.repeat(32),
        quoteId: '88'.repeat(32),
        feeAtomic: '1',
      });
      receive({ event: { pubkey: impersonation.peerPubkey }, message: impersonation });
    },
  };
  const session = new PrivateRelaySenderSession(messenger);
  const result = await session.requestQuotes({
    networkId: NETWORK_ID, poolContractId: POOL, actionKind: 'transfer',
    quoteWindowMs: 1_000, settleWindowMs: 25,
    onQuotes: quotes => observed.push(quotes.map(quote => quote.feeAtomic)),
  });
  assert.deepEqual(observed, [['10000']]);
  assert.deepEqual(result.quotes.map(quote => quote.feeAtomic), ['10000']);
});

test('selection rejects modified account, fee, keys, context and stale offers before disclosing metadata', async () => {
  const signer = Keypair.random();
  const originalRequest = request();
  const originalQuote = signedQuote(originalRequest, signer);
  const mutations = [
    ['account', {}, { peerAccount: Keypair.random().publicKey() }],
    ['fee', {}, { feeAtomic: '1' }],
    ['peer key', {}, { peerPubkey: '77'.repeat(32) }],
    ['quote id', {}, { quoteId: '88'.repeat(32) }],
    ['quote nonce', {}, { nonce: '88'.repeat(32) }],
    ['signature', {}, { accountSignature: '00'.repeat(64) }],
    ['network', { networkId: '99'.repeat(32) }, {}],
    ['pool', { poolContractId: StrKey.encodeContract(Buffer.alloc(32, 9)) }, {}],
    ['sender key', { replyPubkey: '99'.repeat(32) }, {}],
    ['request id', { requestId: '99'.repeat(32) }, {}],
    ['request nonce', { nonce: '99'.repeat(32) }, {}],
    ['action', { actionKind: 'withdraw' }, {}],
    ['expiry', {}, { expiresAt: originalQuote.expiresAt + 1 }],
    ['expired', {}, { expiresAt: Math.floor(Date.now() / 1_000) - 1 }],
    ['version', { version: 1 }, { version: 1 }],
  ];
  for (const [name, requestChange, quoteChange] of mutations) {
    let publications = 0;
    const messenger = {
      publicKey: originalRequest.replyPubkey,
      async waitFor(input) {
        await input.publish();
        return { type: 'payout', peerAccount: originalQuote.peerAccount, feeAtomic: originalQuote.feeAtomic };
      },
      async publish() { publications += 1; },
    };
    const session = new PrivateRelaySenderSession(messenger);
    await assert.rejects(session.selectQuote({
      request: { ...originalRequest, ...requestChange },
      quote: { ...originalQuote, ...quoteChange },
      actionKind: 'transfer',
      assetIndex: 0,
      actionDiversifier: '01020304',
    }), /authenticat|expired|context/iu, name);
    assert.equal(publications, 0, name);
  }
});

test('account authorization uses canonical, bounded, domain-separated protocol v2 statements', () => {
  const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
  const current = request();
  const reference = signedQuote(current, signer);
  const { accountSignature, ...unsigned } = reference;
  assert.equal(signPrivateRelayQuoteAuthorization(current, unsigned, signer), accountSignature);
  assert.equal(verifyPrivateRelayQuoteAuthorization(current, reference), true);
  assert.equal(PRIVATE_RELAY_PROTOCOL_VERSION, 2);
  assert.equal(PRIVATE_RELAY_TOPIC, 'stellarkey-private-relay-v2');
  assert.deepEqual(decodePrivateRelayMessage(encodePrivateRelayMessage(reference)), reference);
  assert.throws(() => signPrivateRelayQuoteAuthorization(current, unsigned, Keypair.random()), /key/iu);
  assert.throws(() => signPrivateRelayQuoteAuthorization(current, {
    ...unsigned, feeAtomic: '01',
  }, signer), /fee/iu);
  for (const signature of [undefined, '', 'a'.repeat(127), 'g'.repeat(128), accountSignature.toUpperCase(), 'a'.repeat(130)]) {
    assert.equal(verifyPrivateRelayQuoteAuthorization(current, { ...reference, accountSignature: signature }), false);
  }
  const wrongDomain = Buffer.from(statement(current, reference).toString().replace(
    'stellarkey/private-relay/account-key-quote', 'another-protocol/account-key-quote',
  ));
  assert.equal(verifyPrivateRelayQuoteAuthorization(current, {
    ...reference, accountSignature: Buffer.from(signer.sign(wrongDomain)).toString('hex'),
  }), false);
  const now = Math.floor(Date.now() / 1_000);
  assert.equal(verifyPrivateRelayQuoteAuthorization(current, signedQuote(current, signer, { expiresAt: now }), now), false);
  assert.equal(verifyPrivateRelayQuoteAuthorization(current, signedQuote(current, signer, { expiresAt: now - 1 }), now), false);
  assert.equal(verifyPrivateRelayQuoteAuthorization(current, signedQuote(current, signer, { expiresAt: current.expiresAt + 1 })), false);
  assert.equal(verifyPrivateRelayQuoteAuthorization({ ...current, expiresAt: current.expiresAt - 1 }, reference), false);
});

test('selection rechecks expiry immediately before publication and snapshots the quoted context', async () => {
  const signer = Keypair.random();
  const original = request();
  const quote = signedQuote(original, signer);
  const realNow = Date.now;
  let publications = 0;
  const messenger = {
    publicKey: original.replyPubkey,
    async waitFor(input) {
      Date.now = () => quote.expiresAt * 1_000;
      try { await input.publish(); } finally { Date.now = realNow; }
    },
    async publish() { publications += 1; },
  };
  await assert.rejects(new PrivateRelaySenderSession(messenger).selectQuote({
    request: original, quote, actionKind: 'transfer', assetIndex: 0, actionDiversifier: '01020304',
  }), /expired/iu);
  assert.equal(publications, 0);

  let selectedPeer;
  const originalPeer = quote.peerPubkey;
  messenger.waitFor = async input => {
    quote.peerPubkey = '77'.repeat(32);
    await input.publish();
    return { type: 'payout', peerAccount: quote.peerAccount, feeAtomic: quote.feeAtomic };
  };
  messenger.publish = async (_selection, peer) => { selectedPeer = peer; };
  await new PrivateRelaySenderSession(messenger).selectQuote({
    request: original, quote, actionKind: 'transfer', assetIndex: 0, actionDiversifier: '01020304',
  });
  assert.equal(selectedPeer, originalPeer);
});

test('account proof cannot be sent publicly by the relay messenger', async () => {
  let publications = 0;
  const messenger = await PrivateRelayMessenger.create([], {
    async publish() { publications += 1; },
    close() {},
  });
  try {
    await assert.rejects(
      messenger.publish(signedQuote(request(), Keypair.random())),
      /encrypt/iu,
    );
    assert.equal(publications, 0);
  } finally {
    messenger.close();
  }
});

test('relay messages that expire during encryption never reach transport', async () => {
  const realNow = Date.now;
  const current = request();
  const quote = signedQuote(current, Keypair.random());
  let publications = 0;
  let clockReads = 0;
  const messenger = await PrivateRelayMessenger.create([], {
    async publish() { publications += 1; }, close() {},
  });
  try {
    // The first read validates encoding; subsequent reads model crypto yielding
    // until the message expires before the transport receives any ciphertext.
    Date.now = () => (++clockReads === 1 ? realNow() : quote.expiresAt * 1_000);
    await assert.rejects(messenger.publish(quote, messenger.publicKey), /expired/iu);
    assert.equal(publications, 0);
  } finally {
    Date.now = realNow;
    messenger.close();
  }
});

test('real encrypted helper negotiation authenticates the account before selection', async () => {
  const subscribers = new Set();
  const events = [];
  const adapter = {
    async publish(urls, event) {
      events.push(event);
      for (const receive of subscribers) queueMicrotask(() => receive(event));
      return new Map(urls.map(url => [url, true]));
    },
    subscribe(_urls, _filters, receive) {
      subscribers.add(receive);
      return { close: () => subscribers.delete(receive) };
    },
    close() {},
  };
  const urls = ['wss://relay.one', 'wss://relay.two'];
  const sender = new PrivateRelaySenderSession(await PrivateRelayMessenger.create(
    urls, new BoundedPrivateRelayTransport(urls, adapter),
  ));
  const helper = new PrivateRelayHelperSession(await PrivateRelayMessenger.create(
    urls, new BoundedPrivateRelayTransport(urls, adapter),
  ));
  const signer = Keypair.random();
  const operations = [];
  try {
    helper.listenForRequests(request => {
      operations.push(helper.offerQuote({
        request,
        peerAccount: signer.publicKey(),
        feeAtomic: '10000',
        async signAccountQuote(request, quote) {
          return signPrivateRelayQuoteAuthorization(request, quote, signer);
        },
      }));
    });
    helper.listenForPrivateMessages((selection, quote) => {
      if (selection.type === 'prepare-job') {
        const result = { preparedEnvelopeXdr: 'AQIDBA==', accountSequence: '7', simulationLedger: 123 };
        operations.push(helper.sendPrepared({ job: { ...selection, prepareId: '99'.repeat(32) }, ...result })
          .then(() => helper.sendPrepared({ job: selection, ...result })));
        return;
      }
      assert.equal(selection.type, 'selection');
      operations.push(helper.sendPayout({ selection, quote, privateFeeAddress: 'synthetic-private-fee-address' }));
    });
    const discovery = await sender.requestQuotes({
      networkId: NETWORK_ID, poolContractId: POOL, actionKind: 'transfer',
      quoteWindowMs: 1_000, settleWindowMs: 25,
    });
    assert.ok(discovery.request.expiresAt - Math.floor(Date.now() / 1_000) >= 290);
    assert.equal(discovery.quotes.length, 1);
    assert.equal(verifyPrivateRelayQuoteAuthorization(discovery.request, discovery.quotes[0]), true);
    const payout = await sender.selectQuote({
      request: discovery.request,
      quote: discovery.quotes[0],
      actionKind: 'transfer',
      assetIndex: 0,
      actionDiversifier: '01020304',
    });
    assert.equal(payout.peerAccount, signer.publicKey());
    const prepared = await sender.requestPreparation({
      quote: discovery.quotes[0], payout, operationXdr: 'AAAA',
      maxTime: payout.expiresAt, classicFeeStroops: '100', maximumResourceFeeStroops: '1000',
    });
    assert.equal(prepared.accountSequence, '7');
    assert.notEqual(prepared.prepareId, '99'.repeat(32));
    await Promise.all(operations);
    assert.equal(events.length, 7);
    const publicEvents = events.filter(event => !event.tags.some(tag => tag[0] === 'p'));
    assert.equal(publicEvents.length, 1);
    assert.equal(JSON.parse(publicEvents[0].content).type, 'request');
    assert.doesNotMatch(publicEvents[0].content, /actionKind|assetIndex|actionDiversifier/iu);
    for (const event of events) {
      assert.equal(JSON.stringify(event).includes(signer.publicKey()), false);
      assert.equal(JSON.stringify(event).includes(discovery.quotes[0].accountSignature), false);
    }
  } finally {
    sender.close();
    helper.close();
  }
});

test('helper retains negotiation before publish acknowledgement and rolls back after failure', async () => {
  const signer = Keypair.random();
  const current = request();
  let receive;
  let received = 0;
  let publishedQuote;
  const helper = new PrivateRelayHelperSession({
    publicKey: '33'.repeat(32),
    subscribe(input) { receive = input.onMessage; return { close() {} }; },
    async publish(quote) {
      publishedQuote = quote;
      receive({ event: { pubkey: current.replyPubkey }, message: {
        version: 2, type: 'selection', requestId: current.requestId, quoteId: quote.quoteId,
        actionKind: 'transfer', assetIndex: 0, actionDiversifier: '01020304', nonce: '77'.repeat(32), expiresAt: quote.expiresAt,
      } });
      assert.equal(received, 1, 'selection was dropped before quote publication acknowledged');
      throw new Error('acknowledgement failed');
    },
    close() {},
  });
  helper.listenForPrivateMessages(() => { received += 1; });
  try {
    await assert.rejects(helper.offerQuote({
      request: current, peerAccount: signer.publicKey(), feeAtomic: '10000',
      async signAccountQuote(request, quote) { return signPrivateRelayQuoteAuthorization(request, quote, signer); },
    }), /acknowledgement failed/iu);
    receive({ event: { pubkey: current.replyPubkey }, message: {
      version: 2, type: 'selection', requestId: current.requestId, quoteId: publishedQuote.quoteId,
      actionKind: 'transfer', assetIndex: 0, actionDiversifier: '01020304', nonce: '88'.repeat(32), expiresAt: publishedQuote.expiresAt,
    } });
    assert.equal(received, 1);
  } finally { helper.close(); }
});
