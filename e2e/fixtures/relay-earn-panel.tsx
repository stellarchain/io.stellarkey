'use client';

import { useState } from 'react';
import { Button, Modal, ModalHeader } from '@/components/ui';
import { PrivateRelayEntry } from '@/features/private-balance/components/PrivateRelayEntry';
import { PrivateRelaySettings } from '@/features/private-balance/components/PrivateRelaySettings';
import { publishPrivateRelayHelperStatus } from '@/features/private-balance/relay/helper-status';
import { loadPrivateRelayPreferences, savePrivateRelayPreferences } from '@/features/private-balance/relay/preferences';
import { PrivateBalanceRuntimeControlProvider, PrivateBalanceRuntimeDataProvider, usePrivateBalanceRuntime, usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';

// Real controls and preference/status stores; deliberately no helper manager,
// wallet key, offer signing, chain access, or background network session.
export function RelayEarnFixture() {
  const runtime = usePrivateBalanceRuntimeData();
  return <PrivateBalanceRuntimeControlProvider scopeKey="synthetic-earn">
    <PrivateBalanceRuntimeDataProvider value={{ ...runtime, phase: 'current' }}>
      <RelayEarnPanel />
    </PrivateBalanceRuntimeDataProvider>
  </PrivateBalanceRuntimeControlProvider>;
}

function RelayEarnPanel() {
  const { requested } = usePrivateBalanceRuntime();
  const [advanced, setAdvanced] = useState(false);
  return <section aria-label="Synthetic earn checks" className="my-6 max-w-lg">
    <PrivateRelayEntry />
    <p data-testid="earn-runtime-requested">{String(requested)}</p>
    <Button variant="secondary" onClick={() => savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), helpRelay: true })}>Restore saved helper preference</Button>
    <Button variant="secondary" onClick={() => publishPrivateRelayHelperStatus({ phase: 'connected', connectedRelays: 1, totalRelays: 2 })}>Connect synthetic helper</Button>
    <Button variant="secondary" onClick={() => publishPrivateRelayHelperStatus({ phase: 'reconnecting', connectedRelays: 0, totalRelays: 2 })}>Reconnect synthetic helper</Button>
    <Button variant="secondary" onClick={() => publishPrivateRelayHelperStatus({ phase: 'unavailable', connectedRelays: 0, totalRelays: 2 })}>Disconnect synthetic helper</Button>
    <Button variant="secondary" onClick={() => savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), useRelay: true })}>Enable independent sender preference</Button>
    <Button variant="secondary" onClick={() => savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), helpRelay: false })}>Stop helper elsewhere</Button>
    <Button variant="secondary" onClick={() => savePrivateRelayPreferences({ ...loadPrivateRelayPreferences(), wakuPeers: ['/dns4/node-one.example/tcp/8000/wss/p2p/16Uiu2HAkykgaECHswi3YKJ5dMLbq2kPVCo89fcyTd38UcQD6ej5W'], feeAtomic: '20000' })}>Change external relay settings</Button>
    <Button variant="secondary" onClick={() => setAdvanced(true)}>Open advanced relay settings</Button>
    <Modal open={advanced} onClose={() => setAdvanced(false)}>
      <ModalHeader title="Synthetic advanced relay settings" onClose={() => setAdvanced(false)} />
      {advanced ? <div className="p-4"><PrivateRelaySettings /></div> : null}
    </Modal>
  </section>;
}
