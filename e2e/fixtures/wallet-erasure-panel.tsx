'use client';
import { useRef, useState } from 'react';
import { StorageRecoveryScreen } from '@/components/StorageRecoveryScreen';
import { Button } from '@/components/ui';

export function WalletErasureFixture() {
  const finish = useRef<(() => void) | null>(null);
  const [attempts, setAttempts] = useState(0);
  return <>
    <StorageRecoveryScreen issue={{ kind: 'erasure-incomplete', raw: '',
      message: 'Signing is disabled. Erasure is incomplete and some local wallet data may remain.' }}
      onReset={() => { setAttempts(value => value + 1); return new Promise<void>(resolve => { finish.current = resolve; }); }} />
    <Button onClick={() => finish.current?.()}>Finish synthetic cleanup</Button>
    <output data-testid="erasure-attempts">{attempts}</output>
  </>;
}
