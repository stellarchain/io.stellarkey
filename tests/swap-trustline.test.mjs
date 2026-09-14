import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { swapStrictSend, swapStrictReceive } from '../src/lib/swap.ts';
import * as assets from '../src/lib/assets.ts';

const issuer = assets.POPULAR_ASSETS[0].testnetIssuer;
const native = { key: 'native', code: 'XLM', issuer: null, isNative: true, balance: '20', sellingLiabilities: '0', limit: null };
const credit = { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: issuer,
  balance: '0', limit: '100', is_authorized: true, selling_liabilities: '0', buying_liabilities: '0' };

function fixture(t, overrides = {}) {
  const signer = Keypair.random();
  const state = { transactions: [], signs: 0, authRequired: false, reserve: 5000000,
    account: { sequence: '1', subentry_count: 0, num_sponsoring: 0, num_sponsored: 0,
      balances: [{ asset_type: 'native', balance: '20', selling_liabilities: '0' }] }, ...overrides };
  const sign = signer.sign.bind(signer);
  t.mock.method(signer, 'sign', (...args) => { state.signs++; return sign(...args); });
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(String(input));
    const json = body => new Response(JSON.stringify(body), { status: 200 });
    if (url.pathname === `/accounts/${signer.publicKey()}`) return json(state.account);
    if (url.pathname === `/accounts/${issuer}`) return json({ flags: { auth_required: state.authRequired } });
    if (url.pathname === '/ledgers') return json({ _embedded: { records: [{ base_reserve_in_stroops: state.reserve }] } });
    if (url.pathname === '/transactions' && init.method === 'POST') {
      const transaction = TransactionBuilder.fromXDR(new URLSearchParams(init.body).get('tx'), Networks.TESTNET);
      state.transactions.push(transaction);
      return json({ hash: Buffer.from(transaction.hash()).toString('hex') });
    }
    throw new Error('Unexpected synthetic request');
  });
  const params = { network: 'testnet', softwareSigner: signer, sendCode: 'XLM', sendAmount: '2', sendMax: '2',
    destCode: 'USDC', destIssuer: issuer, destMin: '1', destinationAmount: '1', intermediates: [], feeStroops: 100,
    destinationTrustline: { maximumReserveXlm: '0.5' } };
  return { state, params, signer };
}

test('Swap offers the configured preferred assets for the selected network without requiring existing trustlines', () => {
  assert.equal(typeof assets.swapDestinationAssets, 'function');
  for (const network of ['mainnet', 'testnet']) {
    const options = assets.swapDestinationAssets([native], network);
    assert.deepEqual(options.map(option => option.code), ['XLM', ...assets.knownAssetsForNetwork(network).map(asset => asset.code)]);
    for (const known of assets.knownAssetsForNetwork(network)) {
      const option = options.find(candidate => candidate.key === `${known.code}:${assets.knownAssetIssuer(known, network)}`);
      assert.equal(option?.requiresTrustline, true);
      assert.equal(option?.preferred, true);
      assert.equal(option?.balance, '0');
    }
  }
});

test('Swap keeps exact issuer identities, existing zero-balance trustlines and holdings without duplicating preferred assets', () => {
  assert.equal(typeof assets.swapDestinationAssets, 'function');
  const holding = { ...native, key: `USDC:${issuer}`, code: 'USDC', issuer, isNative: false, balance: '0', limit: '100', isAuthorized: false };
  const otherIssuer = Keypair.random().publicKey();
  const unrelated = { ...holding, key: `USDC:${otherIssuer}`, issuer: otherIssuer };
  const options = assets.swapDestinationAssets([native, holding, unrelated], 'testnet');
  assert.equal(options.filter(option => option.key === holding.key).length, 1);
  assert.equal(options.find(option => option.key === holding.key)?.requiresTrustline, false);
  assert.equal(options.find(option => option.key === holding.key)?.isAuthorized, false);
  assert.equal(options.find(option => option.key === unrelated.key)?.preferred, false);
});

for (const [mode, swap] of [['strict-send', swapStrictSend], ['strict-receive', swapStrictReceive]]) {
  test(`${mode} adds changeTrust before the swap in one signed transaction with a two-operation fee`, async t => {
    const { state, params } = fixture(t);
    const result = await swap(params);
    assert.equal(state.transactions.length, 1);
    assert.equal(state.signs, 1);
    const transaction = state.transactions[0];
    assert.deepEqual(transaction.operations.map(operation => operation.type), ['changeTrust', mode === 'strict-send' ? 'pathPaymentStrictSend' : 'pathPaymentStrictReceive']);
    assert.equal(transaction.operations[0].line.getIssuer(), issuer);
    assert.equal(transaction.operations[0].line.getCode(), 'USDC');
    assert.equal(transaction.fee, '200');
    assert.equal(transaction.operations[1].destination, transaction.source);
    assert.equal(result.status, 'accepted');
  });

  test(`${mode} does not add or widen an existing trustline, including one created after review`, async t => {
    const { state, params } = fixture(t);
    state.account.balances.push(credit);
    await swap(params);
    assert.equal(state.transactions[0].operations.length, 1);
    assert.equal(state.transactions[0].fee, '100');
  });

  for (const reason of ['unreviewed', 'reserve', 'liabilities', 'send-maximum', 'issuer-authorization', 'unknown-authorization', 'reserve-increase', 'missing-balances', 'revoked-signing']) {
    test(`${mode} refuses ${reason} before signing or submitting a trustline`, async t => {
      const { state, params } = fixture(t);
      let message;
      if (reason === 'unreviewed') { delete params.destinationTrustline; message = /trustline.*review|review.*trustline/i; }
      if (reason === 'reserve') { state.account.balances[0].balance = '1.5'; message = /XLM.*reserve|reserve.*XLM/i; }
      if (reason === 'liabilities') { state.account.balances[0].selling_liabilities = '19'; message = /XLM.*reserve|reserve.*XLM/i; }
      if (reason === 'send-maximum') { params.sendAmount = params.sendMax = '18.5'; message = /XLM.*reserve|reserve.*XLM/i; }
      if (reason === 'issuer-authorization') { state.authRequired = true; message = /issuer.*authoriz/i; }
      if (reason === 'unknown-authorization') { state.authRequired = undefined; message = /issuer.*authoriz/i; }
      if (reason === 'reserve-increase') { state.reserve = 6000000; message = /reserve.*review|review.*reserve/i; }
      if (reason === 'missing-balances') { delete state.account.balances; message = /account.*balance|balance.*account/i; }
      if (reason === 'revoked-signing') { params.authorizeBeforeSigning = () => { throw new Error('Synthetic signing revoked'); }; message = /revoked/i; }
      await assert.rejects(swap(params), message);
      assert.equal(state.signs, 0);
      assert.equal(state.transactions.length, 0);
    });
  }

  test(`${mode} never treats an unauthorized existing line as a missing trustline`, async t => {
    const { state, params } = fixture(t);
    state.account.balances.push({ ...credit, is_authorized: false });
    await assert.rejects(swap(params), /authoriz/i);
    assert.equal(state.signs, 0);
    assert.equal(state.transactions.length, 0);
  });

  test(`${mode} does not create a trustline for native XLM or the account's own issued asset`, async t => {
    const { state, params, signer } = fixture(t);
    await swap({ ...params, sendCode: 'USDC', sendIssuer: issuer, destCode: 'XLM', destIssuer: null });
    await swap({ ...params, destIssuer: signer.publicKey() });
    assert.deepEqual(state.transactions.map(transaction => transaction.operations.length), [1, 1]);
  });
}
