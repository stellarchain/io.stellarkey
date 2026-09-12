'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Keypair } from '@stellar/stellar-sdk';
import { getSessionSnapshot, initializeVault, lockVault, unlockVault } from '@/lib/vault';
import { PRIVATE_ADDRESS_TESTNET_ASCII_BYTES } from '@stellarkey/private-balance';
import { Button, Modal, ModalHeader, Tabs } from '@/components/ui';
import { initialPrivateBalanceRuntimeData, PrivateBalanceRuntimeDataProvider } from '@/hooks/usePrivateBalanceRuntime';
import { PrivateReceiveContent } from '@/features/private-balance/components/ReceivePrivate';

// Syntactically shaped but cryptographically invalid synthetic addresses only.
// Isolated non-usable vault; no network, screenshots, traces, or key display.
export function QrFreshnessFixture() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('public');
  const [version, setVersion] = useState(1);
  const [stopped, setStopped] = useState(false);
  const [follower, setFollower] = useState(false);
  const [reusableMissing, setReusableMissing] = useState(false);
  const [delay, setDelay] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const pendingAction = useRef<{ resolve(): void; reject(): void } | null>(null);
  const [receiveSessionId, setReceiveSessionId] = useState<number | null>(null);
  const password = 'synthetic QR correct horse battery staple';
  const [requested, setRequested] = useState(0);
  const queue = useRef<Array<{ resolve(): void; reject(): void }>>([]);
  useEffect(() => {
    if (!open) return;
    const original = QRCode.toDataURL;
    QRCode.toDataURL = (() => new Promise<string>((resolve, reject) => {
      setRequested(count => count + 1);
      queue.current.push({ resolve: () => resolve('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="black"/></svg>'), reject: () => reject(new Error('Synthetic QR failure')) });
    })) as typeof QRCode.toDataURL;
    return () => { QRCode.toDataURL = original; };
  }, [open]);
  return <>
    <Button onClick={() => { void (async () => {
      if (getSessionSnapshot() === null) await initializeVault(password, { secret: Keypair.random().secret() });
      setReceiveSessionId(getSessionSnapshot()); setOpen(true);
    })(); }}>Open QR freshness checks</Button>
    <Modal open={open} onClose={() => { setTab('public'); setOpen(false); }}>
      <ModalHeader title="Synthetic receive continuity" onClose={() => { setTab('public'); setOpen(false); }} />
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-3 gap-1 [&_button]:!min-h-8 [&_button]:!p-1 [&_button]:!text-[10px]">
        <Button onClick={() => queue.current.shift()?.resolve()}>Complete next synthetic QR</Button>
        <Button onClick={() => queue.current.splice(0).forEach(item => item.reject())}>Fail pending synthetic QRs</Button>
        <Button onClick={() => { setFollower(true); setStopped(true); }}>Move synthetic receive to another tab</Button>
        <Button onClick={() => setReusableMissing(true)}>Remove synthetic reusable address</Button>
        <Button onClick={() => { setDelay(true); setStopped(true); }}>Delay synthetic receive retry</Button>
        <Button onClick={() => pendingAction.current?.reject()}>Fail old synthetic receive retry</Button>
        <Button onClick={() => setStopped(true)}>Stop synthetic receive runtime</Button>
        <Button onClick={() => lockVault()}>Revoke synthetic receive session</Button>
        <Button onClick={() => { lockVault(); void unlockVault(password); }}>Replace synthetic receive session</Button>
        <Button onClick={() => queue.current.splice(0).forEach(item => item.resolve())}>Complete initial synthetic QRs</Button>
        </div>
        <p data-testid="qr-request-count">{requested}</p>
        <p data-testid="receive-retry-count">{retryCount}</p>
        <Tabs ariaLabel="Synthetic receive tabs" options={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]} value={tab} onChange={setTab}>
          {tab === 'public' ? <p>Public placeholder</p> : <PrivateBalanceRuntimeDataProvider value={{
            ...initialPrivateBalanceRuntimeData, configured: true, isLeader: !follower, networkLabel: 'Testnet',
            receiveSessionId,
            phase: stopped ? 'safe-error' : 'current', error: stopped ? 'Synthetic receive sync unavailable.' : null,
            refreshSync: async () => {
              setRetryCount(value => value + 1);
              if (delay) await new Promise<void>((resolve, reject) => { pendingAction.current = { resolve, reject: () => reject(new Error('Synthetic retired receive retry')) }; });
              setStopped(false);
            },
            refreshStealth: async () => { setRetryCount(value => value + 1); setReusableMissing(false); },
            takeoverLeadership: () => { setFollower(false); setStopped(false); },
            privateAddress: stopped ? null : 'tskpay_' + String(version).repeat(PRIVATE_ADDRESS_TESTNET_ASCII_BYTES - 7),
            stealthMetaAddress: reusableMissing ? null : 'tsm1' + 'q'.repeat(160),
            stealthError: reusableMissing ? 'Synthetic reusable discovery unavailable.' : null,
            asset: { index: 0, kind: 'native', code: 'XLM', issuer: null, name: 'Synthetic asset', decimals: 7, displayDecimals: 7, contractId: 'synthetic', status: 'active' },
            rotatePrivateAddress: async () => {
              setVersion(current => current + 1);
              return 'tskpay_' + String(version + 1).repeat(PRIVATE_ADDRESS_TESTNET_ASCII_BYTES - 7);
            },
          }}><PrivateReceiveContent /></PrivateBalanceRuntimeDataProvider>}
        </Tabs>
      </div>
    </Modal>
  </>;
}
