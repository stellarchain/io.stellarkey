'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { PrivateRelayEntry } from '@/features/private-balance/components/PrivateRelayEntry';
import { PrivateRelayHelperManager } from '@/features/private-balance/components/PrivateRelayHelperManager';
import { PrivateRelayHelperSession } from '@/features/private-balance/relay/session';
import { loadPrivateRelayPreferences, savePrivateRelayPreferences } from '@/features/private-balance/relay/preferences';
import { initialPrivateBalanceRuntimeData, PrivateBalanceRuntimeControlProvider, PrivateBalanceRuntimeDataProvider,
  usePrivateBalanceRuntime, type PrivateBalanceRuntimePhase } from '@/hooks/usePrivateBalanceRuntime';
import { shouldMountPrivateBalanceRuntime } from '@/lib/private-balance-bootstrap';

// No key, offer, signing or chain access. Only the external session boundary is
// substituted; real controls, intent gate, manager and status store cooperate.
function StartupPanel() {
  const { requested } = usePrivateBalanceRuntime();
  const [phase, setPhase] = useState<PrivateBalanceRuntimePhase>('reading-meta');
  const [creates, setCreates] = useState(0);
  const [closes, setCloses] = useState(0);
  const pending = useRef(new Set<{ resolve(): void; reject(): void }>());
  const connected = useRef(false);

  useEffect(() => {
    const original = PrivateRelayHelperSession.create;
    PrivateRelayHelperSession.create = async () => {
      setCreates(value => value + 1);
      return {
        listenForRequests: () => ({ close() {} }),
        listenForPrivateMessages: () => ({ close() {} }),
        waitUntilConnected: (signal: AbortSignal) => new Promise((resolve, reject) => {
          const finish = (success: boolean) => {
            signal.removeEventListener('abort', abort);
            pending.current.delete(waiter);
            if (success) { connected.current = true; resolve({ connected: 1, total: 2 }); }
            else reject(new Error('Synthetic connection unavailable'));
          };
          const abort = () => finish(false);
          const waiter = { resolve: () => finish(true), reject: abort };
          pending.current.add(waiter);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        }),
        connectionStatus: async () => ({ connected: connected.current ? 1 : 0, total: 2 }),
        close: () => { connected.current = false; setCloses(value => value + 1); },
      } as unknown as PrivateRelayHelperSession;
    };
    return () => { PrivateRelayHelperSession.create = original; };
  }, []);

  const runtime = useMemo(() => ({ ...initialPrivateBalanceRuntimeData,
    phase: requested ? phase : 'disabled' as const,
    error: phase === 'safe-error' ? 'Synthetic runtime failure' : null,
    publicAddress: 'synthetic-not-a-private-address',
    deployment: { ...initialPrivateBalanceRuntimeData.deployment, networkId: 'synthetic-network', poolContractId: 'synthetic-pool' },
  }), [phase, requested]);
  const mounted = shouldMountPrivateBalanceRuntime({
    accountReady: true, deploymentReady: true, encryptedStateExists: true, requested,
  });

  return <PrivateBalanceRuntimeDataProvider value={runtime}>
    <PrivateRelayEntry />
    <p data-testid="startup-requested">{String(requested)}</p>
    <p data-testid="startup-creates">{creates}</p>
    <p data-testid="startup-closes">{closes}</p>
    <Button onClick={() => setPhase('current')}>Finish wallet preparation</Button>
    <Button onClick={() => setPhase('safe-error')}>Fail wallet preparation</Button>
    <Button onClick={() => { for (const waiter of pending.current) waiter.resolve(); }}>Connect relay transport</Button>
    <Button onClick={() => { for (const waiter of pending.current) waiter.reject(); }}>Fail relay transport</Button>
    <Button onClick={() => savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), useRelay: true })}>Change sender preference only</Button>
    <Button onClick={() => window.dispatchEvent(new StorageEvent('storage', { key: 'synthetic-unrelated-preference' }))}>Unrelated storage update</Button>
    <Button onClick={() => savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), feeAtomic: '20000' })}>Change real helper fee</Button>
    <Button onClick={() => savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), helpRelay: false })}>Stop relay elsewhere</Button>
    {mounted ? <PrivateRelayHelperManager /> : null}
  </PrivateBalanceRuntimeDataProvider>;
}

export function RelayStartupFixture() {
  const [scope, setScope] = useState('synthetic-unlock-a');
  return <main data-app-surface className="min-h-screen p-6">
    <h1>Relay startup checks</h1>
    <Button onClick={() => setScope(value => `${value}-next`)}>Fresh unlock or account</Button>
    <PrivateBalanceRuntimeControlProvider scopeKey={scope}>
      <StartupPanel key={scope} />
    </PrivateBalanceRuntimeControlProvider>
  </main>;
}
