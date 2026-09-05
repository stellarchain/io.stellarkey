'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { PRIVATE_ADDRESS_TESTNET_ASCII_BYTES } from '@stellarkey/private-balance';
import { Button, Modal, ModalHeader, Tabs } from '@/components/ui';
import { initialPrivateBalanceRuntimeData, PrivateBalanceRuntimeDataProvider } from '@/hooks/usePrivateBalanceRuntime';
import { PrivateReceiveContent } from '@/features/private-balance/components/ReceivePrivate';

// Syntactically shaped but cryptographically invalid synthetic addresses only.
// No network, wallet keys, screenshots, trace payloads, or usable receive data.
export function QrFreshnessFixture() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('public');
  const [version, setVersion] = useState(1);
  const [requested, setRequested] = useState(0);
  const queue = useRef<Array<() => void>>([]);
  useEffect(() => {
    if (!open) return;
    const original = QRCode.toDataURL;
    QRCode.toDataURL = (() => new Promise<string>(resolve => {
      setRequested(count => count + 1);
      queue.current.push(() => resolve('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="black"/></svg>'));
    })) as typeof QRCode.toDataURL;
    return () => { QRCode.toDataURL = original; };
  }, [open]);
  return <>
    <Button onClick={() => setOpen(true)}>Open QR freshness checks</Button>
    <Modal open={open} onClose={() => { setTab('public'); setOpen(false); }}>
      <ModalHeader title="Synthetic receive continuity" onClose={() => { setTab('public'); setOpen(false); }} />
      <div className="space-y-3 p-4">
        <Button onClick={() => queue.current.shift()?.()}>Complete next synthetic QR</Button>
        <Button onClick={() => queue.current.splice(0).forEach(complete => complete())}>Complete initial synthetic QRs</Button>
        <p data-testid="qr-request-count">{requested}</p>
        <Tabs ariaLabel="Synthetic receive tabs" options={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]} value={tab} onChange={setTab}>
          {tab === 'public' ? <p>Public placeholder</p> : <PrivateBalanceRuntimeDataProvider value={{
            ...initialPrivateBalanceRuntimeData, configured: true, isLeader: true, networkLabel: 'Testnet',
            privateAddress: 'tskpay_' + String(version).repeat(PRIVATE_ADDRESS_TESTNET_ASCII_BYTES - 7),
            stealthMetaAddress: 'tsm1' + 'q'.repeat(160),
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
