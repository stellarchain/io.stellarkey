'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { LoadingRegion, Modal, ModalHeader, useRetainedForExit } from '@/components/ui';
import type { FiatCurrency } from '@/lib/format';
import type { NetworkKey } from '@/lib/stellar';
import type { PrivatePortfolioEntry } from '../runtime/portfolio';
import type { PrivateFlowHeader } from './useReportToOwner';

// The balance, receipts and settings steps pull the private runtime; they
// load on the first open while the dialog shell and its header are always
// ready.
const PrivateAssetDetailModalBody = dynamic(
  () => import('./PrivateAssetDetailModalBody').then((module) => module.PrivateAssetDetailModalBody),
  {
    ssr: false,
    loading: () => <LoadingRegion label="Loading" className="min-h-56" />,
  },
);

/** Mirrors PRIVATE_SETTINGS_BUSY_REASON without loading the settings steps into the shell. */
const PRIVATE_ASSET_BUSY_REASON = 'Wait for the current check to finish before closing.';

/**
 * The private asset sheet: identity, balance, value and durable asset facts,
 * with Private Payments settings, recovery and advanced privacy as further
 * steps of the same dialog. The body reports the step header, busy and dirty
 * state; until it does, the header names the asset over "Private balance".
 */
export function PrivateAssetDetailModal({
  open = true,
  entry,
  network,
  privacyMode,
  xlmPriceUsd,
  fiatCurrency,
  fiatRates,
  onClose,
}: {
  open?: boolean;
  entry: PrivatePortfolioEntry | null;
  network: NetworkKey;
  privacyMode: boolean;
  xlmPriceUsd: number | null;
  fiatCurrency: FiatCurrency;
  fiatRates: Partial<Record<FiatCurrency, number>> | null;
  onClose(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [header, setHeader] = useState<PrivateFlowHeader | null>(null);
  const shown = open && entry !== null;
  // The asset code is a label, not a balance: it stays on the header through
  // the exit so the title does not change while the sheet leaves.
  const assetCode = useRetainedForExit(entry?.asset.code) ?? 'Private asset';
  // Balances are sensitive: the content leaves the moment the sheet closes
  // while the shell keeps its geometry through the exit.
  return (
    <Modal
      open={shown}
      onClose={onClose}
      wide
      busy={busy}
      busyReason={PRIVATE_ASSET_BUSY_REASON}
      dirty={dirty}
    >
      <ModalHeader
        title={header?.title ?? assetCode}
        subtitle={header ? header.subtitle : 'Private balance'}
        onClose={onClose}
        onBack={header?.onBack}
      />
      {shown && entry ? (
        <PrivateAssetDetailModalBody
          key={entry.asset.contractId}
          entry={entry}
          network={network}
          privacyMode={privacyMode}
          xlmPriceUsd={xlmPriceUsd}
          fiatCurrency={fiatCurrency}
          fiatRates={fiatRates}
          onClose={onClose}
          onBusyChange={setBusy}
          onDirtyChange={setDirty}
          onHeaderChange={setHeader}
        />
      ) : null}
    </Modal>
  );
}
