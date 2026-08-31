import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('home keeps one welcome shell while the account funding state resolves', () => {
  const dashboard = read('src/components/Dashboard.tsx');
  const welcome = read('src/components/WelcomeHome.tsx');

  assert.match(
    dashboard,
    /view === "home" && \(balances === null \|\| unfunded \|\| fundBusy\) \? \([\s\S]{0,220}?<WelcomeHome[\s\S]{0,220}?checking=\{balances === null\}/,
  );
  assert.match(welcome, /checking:\s*boolean/);
  assert.match(welcome, /aria-busy=\{checking\}/);
  assert.match(welcome, /checking\s*\?\s*"Checking your Stellar account…"/);
  assert.match(welcome, /role="status"/);
});

test('the client shell loader becomes recoverable instead of spinning forever', () => {
  const walletApp = read('src/components/WalletApp.tsx');

  assert.match(walletApp, /OPENING_WALLET_SLOW_MS/);
  assert.match(walletApp, /Still opening/);
  assert.match(walletApp, /Reload StellarKey/);
  assert.match(walletApp, /window\.location\.reload\(\)/);
});
