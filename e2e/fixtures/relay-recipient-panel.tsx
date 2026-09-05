'use client';

import { useMemo, useRef, useState } from 'react';
import { encodePrivateAddress } from '@stellarkey/private-balance';
import { Button } from '@/components/ui';
import { SendPrivate } from '@/features/private-balance/components/SendPrivate';
import { PrivateActionInFlightError } from '@/features/private-balance/runtime/action-flow';
import { PrivateBalanceRuntimeDataProvider, usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';

const defaultAddress = encodePrivateAddress({ deploymentTag: new Uint8Array(16).fill(1), diversifier: new Uint8Array(4),
  ownerCommitment: new Uint8Array(32).fill(1), hpkePublicKey: new Uint8Array(32).fill(2) }, 'tskpay_');

export function RelayRecipientFixture() {
  const parent = usePrivateBalanceRuntimeData();
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState(0);
  const [delay, setDelay] = useState(false);
  const finishes = useRef<Array<() => void>>([]);
  const runtime = useMemo(() => ({ ...parent, networkLabel: 'Testnet' as const, verifiedBalanceStroops: '100000000',
    validateRecipient: async () => {
      if (delay) await new Promise<void>(resolve => { finishes.current.push(resolve); });
      return { fingerprint: 'synthetic-check-code' };
    },
    prepareAction: async () => { setCalls(value => value + 1); throw new PrivateActionInFlightError(); },
  }), [parent, delay]);
  return <section aria-label="Synthetic recipient checks">
    <Button onClick={() => setOpen(true)}>Open synthetic private send</Button>
    <Button onClick={() => setDelay(true)}>Delay recipient validation</Button>
    <Button onClick={() => finishes.current.shift()?.()}>Finish recipient validation</Button>
    <Button onClick={() => setDelay(false)}>Resume recipient validation</Button>
    <p data-testid="recipient-preparations">{calls}</p>
    {open ? <PrivateBalanceRuntimeDataProvider value={runtime}>
      <SendPrivate prefill={{ recipient: defaultAddress }} onClose={() => setOpen(false)} />
    </PrivateBalanceRuntimeDataProvider> : null}
  </section>;
}
