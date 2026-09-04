import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  checkPrivateRelayAvailability,
  rankPrivateRelayQuotes,
} from '../src/features/private-balance/relay/availability.ts';

const NOW_SECONDS = 1_800_000_000;
const NETWORK_ID = '11'.repeat(32);
const POOL = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

const sessionSource = readFileSync(
  new URL('../src/features/private-balance/relay/session.ts', import.meta.url),
  'utf8',
);

function quote({
  quoteId,
  peerPubkey,
  peerAccount,
  feeAtomic,
  expiresAt = NOW_SECONDS + 30,
}) {
  return {
    version: 1,
    type: 'quote',
    requestId: '22'.repeat(32),
    quoteId,
    peerPubkey,
    peerAccount,
    feeAtomic,
    nonce: '33'.repeat(32),
    expiresAt,
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
  const result = await checkPrivateRelayAvailability({
    relayUrls: ['wss://relay.one', 'wss://relay.two'],
    networkId: NETWORK_ID,
    poolContractId: POOL,
    quoteWindowMs: 1_000,
  }, undefined, async () => ({
    requestQuotes: async input => {
      requestInput = input;
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

test('quote discovery bounds untrusted replies before retaining them', () => {
  assert.match(sessionSource, /MAX_RELAY_QUOTES/);
  assert.match(sessionSource, /quotes\.size >= MAX_RELAY_QUOTES/);
});
