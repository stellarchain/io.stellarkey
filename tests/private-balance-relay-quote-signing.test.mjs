import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { signOptedInPrivateRelayQuote } from '../src/lib/private-relay-quote-signing.ts';
import { verifyPrivateRelayQuoteAuthorization } from '../src/features/private-balance/relay/account-authorization.ts';
import { initializeVault, loadVault, lockVault, saveNetworkPref } from '../src/lib/vault.ts';

const PASSWORD = 'correct horse battery staple';
const POOL = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';
const NETWORK_ID = createHash('sha256').update('Test SDF Network ; September 2015').digest('hex');
const PREFERENCES_KEY = 'stellarkey.private-relay.preferences.v1';

class MemoryStorage {
  #items = new Map();
  get length() { return this.#items.size; }
  key(index) { return [...this.#items.keys()][index] ?? null; }
  getItem(key) { return this.#items.get(key) ?? null; }
  setItem(key, value) { this.#items.set(key, String(value)); }
  removeItem(key) { this.#items.delete(key); }
}

function consent(storage, helpRelay = true, feeAtomic = '10000') {
  storage.setItem(PREFERENCES_KEY, JSON.stringify({
    useRelay: false,
    helpRelay,
    feeAtomic,
    relayUrls: ['wss://relay.one', 'wss://relay.two'],
  }));
}

function quoteInput(account, overrides = {}) {
  const request = {
    version: 3, type: 'request', requestId: '11'.repeat(32), networkId: NETWORK_ID,
    poolContractId: POOL, replyPubkey: '22'.repeat(32),
    nonce: '33'.repeat(32), expiresAt: Math.floor(Date.now() / 1_000) + 60,
  };
  return {
    request,
    quote: {
      version: 3, type: 'quote', requestId: request.requestId, quoteId: '44'.repeat(32),
      peerAccount: account.publicKey(), peerPubkey: '55'.repeat(32), feeAtomic: '10000',
      nonce: '66'.repeat(32), expiresAt: request.expiresAt,
    },
    expectedAccount: account.publicKey(), expectedNetworkId: NETWORK_ID,
    expectedPoolContractId: POOL, signal: new AbortController().signal,
    ...overrides,
  };
}

test('vault quote authentication requires current helper opt-in, fee, account and deployment', async () => {
  const storage = new MemoryStorage();
  globalThis.window = { localStorage: storage };
  lockVault();
  const signer = Keypair.random();
  await initializeVault(PASSWORD, { secret: signer.secret(), requirePasswordForSigning: true });
  try {
    const input = quoteInput(signer);
    await assert.rejects(signOptedInPrivateRelayQuote(input), /consent/iu);
    consent(storage);
    const signature = await signOptedInPrivateRelayQuote(input);
    assert.equal(verifyPrivateRelayQuoteAuthorization(input.request, { ...input.quote, accountSignature: signature }), true);
    assert.equal(JSON.stringify([...Array(storage.length)].map((_, i) => storage.getItem(storage.key(i)))).includes(signature), false);
    for (const overrides of [
      { expectedAccount: Keypair.random().publicKey() },
      { expectedPoolContractId: 'wrong-pool' },
      { expectedNetworkId: '77'.repeat(32) },
    ]) await assert.rejects(signOptedInPrivateRelayQuote({ ...input, ...overrides }), /account|deployment/iu);
    consent(storage, true, '1');
    await assert.rejects(signOptedInPrivateRelayQuote(input), /consent/iu);
    consent(storage);
    saveNetworkPref('mainnet');
    await assert.rejects(signOptedInPrivateRelayQuote(input), /deployment/iu);
    saveNetworkPref('testnet');
    lockVault();
    await assert.rejects(signOptedInPrivateRelayQuote(input), /locked/iu);
  } finally {
    lockVault();
    delete globalThis.window;
  }
});

test('quote authentication rechecks consent and revocation after real vault decryption', async t => {
  for (const scenario of ['disabled', 'fee', 'account', 'network', 'abort', 'lock']) {
    await t.test(scenario, async t => {
      const storage = new MemoryStorage();
      globalThis.window = { localStorage: storage };
      lockVault();
      const signer = Keypair.random();
      await initializeVault(PASSWORD, { secret: signer.secret() });
      consent(storage);
      const controller = new AbortController();
      const input = quoteInput(signer, { signal: controller.signal });
      const realDecrypt = crypto.subtle.decrypt.bind(crypto.subtle);
      let release;
      let reached;
      const decrypted = new Promise(resolve => { reached = resolve; });
      const pause = new Promise(resolve => { release = resolve; });
      const wrappedDecrypt = t.mock.method(crypto.subtle, 'decrypt', async (...args) => {
        const result = await realDecrypt(...args);
        reached();
        await pause;
        return result;
      });
      try {
        const pending = signOptedInPrivateRelayQuote(input);
        await decrypted;
        if (scenario === 'disabled') consent(storage, false);
        if (scenario === 'fee') consent(storage, true, '1');
        if (scenario === 'account') {
          const vault = loadVault();
          vault.activeAccountId = 'different-account';
          storage.setItem('stellarkey.vault.v1', JSON.stringify(vault));
        }
        if (scenario === 'network') saveNetworkPref('mainnet');
        if (scenario === 'abort') controller.abort();
        if (scenario === 'lock') lockVault();
        release();
        await assert.rejects(pending, /consent|account|deployment|cancelled|locked|session/iu);
      } finally {
        release();
        wrappedDecrypt.mock.restore();
        lockVault();
        delete globalThis.window;
      }
    });
  }
});
