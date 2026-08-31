import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeUnexpectedError } from '../src/lib/safe-error.ts';

const sensitiveMessage = [
  'secret SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'phrase apple banana cherry dolphin eagle forest galaxy harbor island jungle kiwi lemon',
  'password Correct-Horse-2026!',
  'private tks1_AAEAAIOpWWwID-xqa5vUlTl87Zg',
  'xdr AAAAAgAAAAA=',
].join(' · ');

test('unexpected errors never expose the thrown message or object', () => {
  const thrown = Object.assign(new Error(sensitiveMessage), {
    digest: 'render_7F3-ux',
    proofInput: '11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
  });

  const safe = safeUnexpectedError(thrown);
  const rendered = JSON.stringify(safe);

  assert.equal(rendered.includes('SAAAA'), false);
  assert.equal(rendered.includes('apple banana'), false);
  assert.equal(rendered.includes('Correct-Horse'), false);
  assert.equal(rendered.includes('tks1_'), false);
  assert.equal(rendered.includes('AAAAAg'), false);
  assert.equal(rendered.includes('112233'), false);
  assert.equal(safe.reference, 'render_7F3-ux');
  assert.deepEqual(safe.diagnostic, {
    code: 'wallet-render-error',
    reference: 'render_7F3-ux',
  });
});

test('unexpected errors reject untrusted or oversized digest values', () => {
  const malicious = safeUnexpectedError({
    digest: 'secret SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    message: sensitiveMessage,
  });
  const oversized = safeUnexpectedError({ digest: 'a'.repeat(97) });

  assert.equal(malicious.reference, null);
  assert.deepEqual(malicious.diagnostic, { code: 'wallet-render-error' });
  assert.equal(oversized.reference, null);
});

test('unexpected errors use stable actionable copy for unknown thrown values', () => {
  const safe = safeUnexpectedError(sensitiveMessage);

  assert.equal(safe.title, 'Something went wrong');
  assert.match(safe.description, /Try again/);
  assert.equal(safe.reference, null);
});

test('global and startup boundaries cannot bypass the safe presenter', () => {
  const boundary = readFileSync(new URL('../src/app/error.tsx', import.meta.url), 'utf8');
  const wallet = readFileSync(new URL('../src/hooks/useWallet.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(boundary, /error\.message/);
  assert.doesNotMatch(boundary, /console\.error\([^\n]*,\s*error\s*\)/);
  assert.match(boundary, /safeUnexpectedError\(error\)/);
  assert.match(boundary, /safeError\.diagnostic/);
  assert.doesNotMatch(
    wallet,
    /Wallet startup could not access browser storage\.\",\s*error/,
  );
});
