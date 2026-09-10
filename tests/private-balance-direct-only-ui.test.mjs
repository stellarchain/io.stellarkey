import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const component = name => read(`src/features/private-balance/components/${name}.tsx`);

test('wallet chrome never offers Earn or lazily mounts a relay helper', () => {
  for (const path of ['src/components/Dashboard.tsx', 'src/components/PrivateBalanceRuntimeBoundary.tsx']) {
    assert.doesNotMatch(read(path), /PrivateRelay|relayHelper|requestRelay|loadPrivateRelayPreferences/);
  }
  assert.match(read('src/components/Dashboard.tsx'), /requestPrivateRuntime\(\)/);
  assert.match(read('src/components/PrivateBalanceRuntimeBoundary.tsx'), /shouldMountPrivateBalanceRuntime/);
});

test('send and withdrawal expose direct review only, independent of old relay preferences', () => {
  for (const name of ['SendPrivate', 'WithdrawPrivate']) {
    const source = component(name);
    assert.doesNotMatch(source, /PrivateRelay|submissionMode|relayProgress|relayQuotes|relayApproval|selectRelayQuote/);
    assert.match(source, /<PrivateActionReview/);
    assert.match(source, /<Modal/);
    assert.match(source, /flow\.prepare\(/);
  }
});

test('review explicitly warns about direct submitting-account metadata without relay choices or fees', () => {
  const source = component('PrivateActionReview');
  assert.doesNotMatch(source, /PrivateRelay|relayProgress|relayQuotes|relayApproval|review\??\.relay|selectRelayQuote|Privacy relay fee/);
  assert.match(source, /Your Stellar account is public as the submitting account and pays network fees/);
  assert.match(source, /proof.*another transaction/i);
  assert.match(source, /'direct'/);
});

test('the action controller has no transport, peer selection, or alternate submission path', () => {
  const source = read('src/features/private-balance/components/usePrivateActionController.ts');
  assert.doesNotMatch(source, /PrivateRelay|\.\.\/relay\/|submissionMode|relayApproval|selectRelayQuote/);
  assert.match(source, /prepareAction\([\s\S]*?controller\.signal,\s*authorizeDisclosure,/);
  assert.match(source, /submitAction\(review\)/);
  assert.match(source, /prepareChainedSend\(chainedDraft\)/);
  assert.match(source, /submitChainedSend\(chained\.approval, chained\.draft, updateProgress\)/);
  assert.match(source, /proofConsentRef\.current\.cancel\(\)/);
  assert.match(source, /completePrivateActionOperation/);
});

test('protocol settings retain maintenance, history and recovery but remove all relay panels', () => {
  const source = component('PrivateProtocolSettings');
  assert.doesNotMatch(source, /PrivateRelay|relay settings/);
  assert.match(source, /PrivateOutgoingHistorySettings/);
  assert.match(source, /runFullVerification/);
  for (const name of ['PrivateRelayEntry', 'PrivateRelayHelperManager', 'PrivateRelaySettings', 'PrivateRelaySubmissionChoice', 'PrivateRelayQuotePicker']) {
    assert.equal(existsSync(new URL(`../src/features/private-balance/components/${name}.tsx`, import.meta.url)), false, name);
  }
});

test('direct action completion and proof consent stay bound to their originating operation', () => {
  const source = read('src/features/private-balance/components/usePrivateActionController.ts');
  assert.match(source, /const status = await submitAction\(review\);\s*if \(!ownsOperation\(\)\) return;/);
  assert.match(source, /const authorizeDisclosure = async[\s\S]*?abortRef\.current !== controller/);
  assert.match(source, /finally \{\s*if \(abortRef\.current === controller\) \{\s*abortRef\.current = null;\s*setWorking\(false\);/);
});

test('a stale non-direct chain cannot bypass the review mismatch gate', () => {
  const source = component('PrivateActionReview');
  assert.match(source, /assertDirectPrivateSubmission\(chained\.approval\)/);
  assert.match(source, /assertDirectPrivateSubmission\(chained\.draft\)/);
  assert.match(source, /const ready = mismatch === null &&/);
});
