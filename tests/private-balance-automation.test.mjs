import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const provider = source('src/features/private-balance/runtime/provider.tsx');

test('background syncs of a current wallet never flip the visible phase', () => {
  // The quiet path publishes only the backgroundSyncing flag; the transient
  // reading-meta/scanning-live phases stay reserved for first sync, catch-up,
  // and explicit refresh.
  assert.match(provider, /const quiet = background && lastSyncCurrentRef\.current;/);
  assert.match(provider, /if \(quiet\) setSnapshot\(current => \(\{ \.\.\.current, backgroundSyncing: true \}\)\);/);
  assert.match(provider, /if \(!quiet\) \{\s*setSnapshot\(current => \(\{\s*\.\.\.current,\s*phase: 'reading-meta',/);
  // Progress may surface only for real catch-up work or an overlong pass.
  assert.match(provider, /BACKGROUND_PROGRESS_SURFACE_MS = 2_000/);
  assert.match(provider, /total <= 1 &&\s*Date\.now\(\) - syncStartedAt <= BACKGROUND_PROGRESS_SURFACE_MS/);
  assert.match(provider, /syncProgress: \{ current: currentRecord, total \}/);
});

test('ambient sync triggers re-verify leadership, unlock, and idle state', () => {
  assert.match(provider, /IDLE_SYNC_INTERVAL_MS = 30_000/);
  assert.match(provider, /idleTimer = setInterval\(maybeBackgroundSync, IDLE_SYNC_INTERVAL_MS\)/);
  assert.match(provider, /document\.addEventListener\('visibilitychange', onVisibilityChange\)/);
  assert.match(provider, /claimOrRenewLease\(\);\s*maybeBackgroundSync\(\);/);
  assert.match(provider, /walletPhaseRef\.current !== 'unlocked'/);
  assert.match(provider, /if \(actionBusyRef\.current \|\| mutex\.locked\) return;/);
});

test('the leader reuses one worker session per epoch instead of recreating it', () => {
  assert.match(provider, /let worker = workerRef\.current;\s*let identity = workerIdentityRef\.current;/);
  // A crashed or timed-out worker client marks itself failed; the next sync
  // rebuilds the session instead of reusing the dead client.
  assert.match(provider, /if \(!worker \|\| worker\.failed \|\| !identity\) \{/);
  assert.match(provider, /workerIdentityRef\.current = identity;/);
  // Termination stays reserved for lock, lease loss, teardown, and errors.
  assert.match(provider, /clearDecryptedState/);
});

test('a failed quiet background pass keeps the current snapshot instead of wiping it', () => {
  // The catch honors the same quiet split as the happy path: a transient
  // failure on a routine tick stashes its error and returns without
  // clearDecryptedState or a safe-error publish.
  assert.match(provider, /if \(quiet\) \{[\s\S]*?backgroundSyncErrorRef\.current = message;\s*return;\s*\}/);
  // Staying quiet means the last-current flag survives the failure, so the
  // next tick does not flip the visible phase either.
  const quietBranch = provider.match(/if \(quiet\) \{[\s\S]*?return;\s*\}/)?.[0] ?? '';
  assert.doesNotMatch(quietBranch, /clearDecryptedState|safe-error|lastSyncCurrentRef\.current = false/);
  // A successful sync clears the stashed error.
  assert.match(provider, /lastSyncCurrentRef\.current = true;\s*backgroundSyncErrorRef\.current = null;/);
});

test('losing leadership mid-sync presents as a follower, never as a safe-error', () => {
  assert.match(
    provider,
    /if \(!leaderRef\.current\) \{[\s\S]*?clearDecryptedState\(null\);[\s\S]*?isLeader: false,[\s\S]*?error: null,[\s\S]*?return;\s*\}/,
  );
});

test('an aborted prepare skips the automatic resync so Back returns instantly', () => {
  assert.match(
    provider,
    /signal\?\.aborted \|\|\s*\(error instanceof DOMException && error\.name === 'AbortError'\)/,
  );
  // The abort check comes before both resync paths in the prepare catch.
  const catchBody = provider.slice(
    provider.indexOf("signal?.aborted"),
    provider.indexOf('PrivateStaleChainStateError && attempt === 0'),
  );
  assert.match(catchBody, /throw error;/);
});

test('leader sync sweeps stale pre-broadcast pending actions beside the reservation TTL', () => {
  assert.match(provider, /releaseExpiredPrivateBuildReservations\(/);
  assert.match(
    provider,
    /releaseStalePrivatePendingActions\(\s*storageScope,\s*storageKey,\s*Date\.now\(\),\s*PRIVATE_PENDING_ACTION_PRE_BROADCAST_TTL_MS,/,
  );
});

test('the final chained step keeps the post-broadcast outcome watcher', () => {
  assert.match(
    provider,
    /submit: \(review, \{ isFinal \}\) =>\s*submitActionInternal\(review, \{ watchOutcome: isFinal \}\)/,
  );
});

test('stale chain state auto-resyncs and retries the preparation once', () => {
  assert.match(provider, /error instanceof PrivateStaleChainStateError && attempt === 0/);
  const actionFlow = source('src/features/private-balance/runtime/action-flow.ts');
  assert.match(actionFlow, /new PrivateStaleChainStateError\('Private Balance root changed/);
  assert.match(actionFlow, /new PrivateStaleChainStateError\('Private Balance root is too close to expiry/);
  assert.match(actionFlow, /new PrivateStaleChainStateError\('Private Balance commitment cache is incomplete/);
});

test('incoming private payments surface as one leader-side event per sync', () => {
  assert.match(provider, /previousAccount\.syncStatus === 'current' &&\s*previousAccount\.lastVerifiedActionIndex !== null/);
  assert.match(provider, /diffIncomingPrivateTransfers\(/);
  assert.match(provider, /onIncomingPrivatePayment/);
  assert.match(provider, /incomingListenersRef/);
});

test('immutable archive recovery reads authoritative contract records directly', () => {
  assert.doesNotMatch(provider, /PrivateBalanceMirrorArchiveReader|mirrorBaseUrl/);
  assert.match(provider, /readRecords: \(startActionIndex, count\) =>\s*archive\.readRecords\(startActionIndex, count\)/);
  assert.match(provider, /readLedgerCloseTimes: sequences => archive\.readLedgerCloseTimes\(sequences\)/);
});

test('follower takeover force-claims the lease through the runtime value', () => {
  assert.match(provider, /forceClaimPrivateBalanceLease\(/);
  assert.match(provider, /takeoverLeadership/);
  const runtimeHook = source('src/hooks/usePrivateBalanceRuntime.tsx');
  assert.match(runtimeHook, /takeoverLeadership\(\): void;/);
});

test('artifact prefetch starts only after explicit private-payment opt-in', () => {
  const occurrences = provider.match(/prefetchCircuitArtifacts\(manifest\)/g) ?? [];
  assert.equal(occurrences.length, 1);
  assert.ok(
    provider.indexOf('prefetchCircuitArtifacts(manifest)') >
      provider.indexOf('const optIn = useCallback'),
  );
  const artifacts = source('src/lib/private-balance-artifacts.ts');
  assert.match(artifacts, /export function prefetchCircuitArtifacts/);
  assert.match(artifacts, /inFlightLoad/);
});

test('the action controller exposes the typed cause beside the display string', () => {
  const controller = source('src/features/private-balance/components/usePrivateActionController.ts');
  assert.match(controller, /const \[errorCause, setErrorCause\] = useState<Error \| null>\(null\)/);
  assert.match(controller, /setErrorCause\(cause instanceof Error \? cause : null\)/);
  assert.match(controller, /errorCause,/);
});
