'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { LoadingRegion, Modal, ModalHeader, useMountedThroughExit } from '@/components/ui';
import type { PrivateFlowHeader } from './useReportToOwner';

// The consent screen and the live setup progress pull the private runtime;
// they load on the first open while the dialog shell and its header are
// always ready.
const PrivateBalanceSetupBody = dynamic(
  () => import('./PrivateBalanceSetupBody').then((module) => module.PrivateBalanceSetupBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Loading" className="min-h-56" />,
  },
);

/**
 * The Private Payments setup dialog. The body reports its header ("Set up on
 * this device" until setup runs, then "Securing this device") and whether
 * setup is in flight, which blocks dismissal.
 */
export function PrivateBalanceSetup({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [header, setHeader] = useState<PrivateFlowHeader | null>(null);
  // Consent and progress are not secrets: the content stays through the exit
  // (the completed check mark is what leaves) and nothing loads while closed.
  const bodyMounted = useMountedThroughExit(open);
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      busyReason="Wait for setup to finish before closing."
    >
      <ModalHeader
        title={header?.title ?? 'Private Payments'}
        subtitle={header ? header.subtitle : 'Set up on this device'}
        onClose={onClose}
      />
      {bodyMounted ? (
        <PrivateBalanceSetupBody
          open={open}
          onClose={onClose}
          onBusyChange={setBusy}
          onHeaderChange={setHeader}
        />
      ) : null}
    </Modal>
  );
}
