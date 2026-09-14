'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Keypair } from '@stellar/stellar-sdk';
import { getSessionSnapshot, initializeVault, lockVault, unlockVault } from '@/lib/vault';
import { PRIVATE_ADDRESS_TESTNET_ASCII_BYTES } from '@stellarkey/private-balance';
import { Button, Modal, ModalHeader, Tabs } from '@/components/ui';
import { initialPrivateBalanceRuntimeData, PrivateBalanceRuntimeDataProvider } from '@/hooks/usePrivateBalanceRuntime';
import { PrivateReceiveContent } from '@/features/private-balance/components/ReceivePrivate';
import type { PrivateReceiveRequest } from '@/features/private-balance/components/usePrivateReceiveRequest';

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
  const [rotationCount, setRotationCount] = useState(0);
  const [request, setRequest] = useState<PrivateReceiveRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [offlineSaved, setOfflineSaved] = useState(false);
  const [rotationMode, setRotationMode] = useState<'normal' | 'delay' | 'fail'>('normal');
  const [accountVersion, setAccountVersion] = useState(0);
  const [assetVersion, setAssetVersion] = useState(false);
  const [poolVersion, setPoolVersion] = useState(0);
  const pendingRotations = useRef<Array<{ resolve(): void; reject(): void }>>([]);
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
      setRequest(null); setReceiveSessionId(getSessionSnapshot()); setOpen(true);
    })(); }}>Open QR freshness checks</Button>
    <Modal open={open} busy={busy} onClose={() => { setTab('public'); setOpen(false); }}>
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
        <Button onClick={() => setOfflineSaved(true)}>Keep saved address offline</Button>
        <Button onClick={() => setRotationMode('delay')}>Delay synthetic address creation</Button>
        <Button onClick={() => setRotationMode('fail')}>Fail synthetic address creation</Button>
        <Button onClick={() => setRotationMode('normal')}>Resume synthetic address creation</Button>
        <Button onClick={() => pendingRotations.current.shift()?.resolve()}>Complete oldest synthetic address</Button>
        <Button onClick={() => pendingRotations.current.shift()?.reject()}>Reject oldest synthetic address</Button>
        <Button onClick={() => setAccountVersion(value => value + 1)}>Replace synthetic receive account</Button>
        <Button onClick={() => setAssetVersion(value => !value)}>Change synthetic receive asset</Button>
        <Button onClick={() => setPoolVersion(value => value + 1)}>Change synthetic receive pool</Button>
        <Button onClick={() => setVersion(value => value + 1)}>Replace saved receive address elsewhere</Button>
        <Button onClick={() => {
          const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
            .find(element => element.textContent?.trim() === 'New address');
          button?.click(); button?.click();
        }}>Double activate new address</Button>
        <Button onClick={() => lockVault()}>Revoke synthetic receive session</Button>
        <Button onClick={() => { lockVault(); void unlockVault(password); }}>Replace synthetic receive session</Button>
        <Button onClick={() => queue.current.splice(0).forEach(item => item.resolve())}>Complete initial synthetic QRs</Button>
        </div>
        <p data-testid="qr-request-count">{requested}</p>
        <p data-testid="receive-retry-count">{retryCount}</p>
        <p data-testid="receive-rotation-count">{rotationCount}</p>
        <Tabs ariaLabel="Synthetic receive tabs" activationMode="manual" options={[{ value: 'public', label: 'Public', disabled: busy }, { value: 'private', label: 'Private', disabled: busy }]} value={tab} onChange={setTab}>
          {!open || tab === 'public' ? <p>Public placeholder</p> : <PrivateBalanceRuntimeDataProvider value={{
            ...initialPrivateBalanceRuntimeData, configured: true, isLeader: !follower, networkLabel: 'Testnet',
            receiveSessionId,
            publicAddress: `synthetic-receive-account-${accountVersion}`,
            deployment: { ...initialPrivateBalanceRuntimeData.deployment, poolContractId: `synthetic-pool-${poolVersion}` },
            phase: stopped || offlineSaved ? 'safe-error' : 'current', error: stopped ? 'Synthetic receive sync unavailable.' : null,
            refreshSync: async () => {
              setRetryCount(value => value + 1);
              if (delay) await new Promise<void>((resolve, reject) => { pendingAction.current = { resolve, reject: () => reject(new Error('Synthetic retired receive retry')) }; });
              setStopped(false); setOfflineSaved(false);
            },
            refreshStealth: async () => { setRetryCount(value => value + 1); setReusableMissing(false); },
            takeoverLeadership: () => { setFollower(false); setStopped(false); },
            privateAddress: stopped ? null : 'tskpay_' + String(version).repeat(PRIVATE_ADDRESS_TESTNET_ASCII_BYTES - 7),
            stealthMetaAddress: reusableMissing ? null : 'tsm1' + 'q'.repeat(160),
            stealthError: reusableMissing ? 'Synthetic reusable discovery unavailable.' : null,
            asset: { index: assetVersion ? 1 : 0, kind: assetVersion ? 'stellar' : 'native', code: assetVersion ? 'USDC' : 'XLM', issuer: null, name: 'Synthetic asset', decimals: 7, displayDecimals: 7, contractId: assetVersion ? 'synthetic-second-asset' : 'synthetic', status: 'active' },
            rotatePrivateAddress: async () => {
              setRotationCount(current => current + 1);
              if (rotationMode === 'fail') throw new Error('Synthetic address issuance unavailable.');
              if (rotationMode === 'delay') await new Promise<void>((resolve, reject) => {
                pendingRotations.current.push({ resolve, reject: () => reject(new Error('Synthetic retired address creation.')) });
              });
              setVersion(current => current + 1);
              return 'tskpay_' + String(version + 1).repeat(PRIVATE_ADDRESS_TESTNET_ASCII_BYTES - 7);
            },
          }}><PrivateReceiveContent request={request} onRequestChange={setRequest} onBusyChange={setBusy} /></PrivateBalanceRuntimeDataProvider>}
        </Tabs>
      </div>
    </Modal>
  </>;
}
