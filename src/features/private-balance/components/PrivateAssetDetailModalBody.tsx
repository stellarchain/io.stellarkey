'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { AssetAvatar } from '@/components/AssetAvatar';
import { Button, HashValue, ModalBody, ModalFooter, Notice } from '@/components/ui';
import { lookupKnownAsset } from '@/lib/assets';
import { fmtFiat, type FiatCurrency } from '@/lib/format';
import type { NetworkKey } from '@/lib/stellar';
import type { PrivatePortfolioEntry } from '../runtime/portfolio';
import { privatePortfolioRepresentativeUsd } from '../runtime/portfolio';
import { formatPrivateBalanceAmount } from '../runtime/selectors';
import { StealthReceipts } from './StealthReceipts';
import {
  PRIVATE_SETTINGS_STEP_HEADER,
  PrivateSettingsStepContent,
  type PrivateSettingsStep,
} from './PrivatePaymentsDetails';
import {
  useReportToOwner,
  type PrivateFlowHeader,
  type PrivateFlowHeaderChange,
} from './useReportToOwner';

type AssetSheetStep = 'asset' | PrivateSettingsStep;

export interface PrivateAssetDetailModalBodyProps {
  entry: PrivatePortfolioEntry;
  network: NetworkKey;
  privacyMode: boolean;
  xlmPriceUsd: number | null;
  fiatCurrency: FiatCurrency;
  fiatRates: Partial<Record<FiatCurrency, number>> | null;
  onClose(): void;
  onBusyChange(busy: boolean): void;
  onDirtyChange(dirty: boolean): void;
  onHeaderChange: PrivateFlowHeaderChange;
}

/**
 * A private asset uses the same information hierarchy as the public asset
 * sheet: identity, balance, value, then durable asset facts. Transaction
 * actions deliberately stay in the wallet's shared Send / Receive / Add /
 * Withdraw surfaces so opening an asset never reveals a second dashboard.
 * Private Payments settings, recovery and advanced privacy are steps of this
 * same sheet: the header back control returns, the close control leaves.
 * The shell in `PrivateAssetDetailModal.tsx` owns the dialog and shows the
 * header, busy and dirty state this body reports.
 */
export function PrivateAssetDetailModalBody({
  entry,
  network,
  privacyMode,
  xlmPriceUsd,
  fiatCurrency,
  fiatRates,
  onClose,
  onBusyChange,
  onDirtyChange,
  onHeaderChange,
}: PrivateAssetDetailModalBodyProps) {
  const [step, setStep] = useState<AssetSheetStep>('asset');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  // The asset step names the asset; the settings steps share the same header.
  const header = useMemo<PrivateFlowHeader>(
    () => step === 'asset'
      ? { title: entry.asset.code, subtitle: 'Private balance' }
      : {
          ...PRIVATE_SETTINGS_STEP_HEADER[step],
          onBack: () => setStep(step === 'details' ? 'asset' : 'details'),
        },
    [entry.asset.code, step],
  );
  useReportToOwner<PrivateFlowHeader | null>(onHeaderChange, header, null);
  useReportToOwner(onBusyChange, busy, false);
  useReportToOwner(onDirtyChange, dirty, false);

  const amount = formatPrivateBalanceAmount(
    BigInt(entry.verifiedBalanceAtomicUnits),
    entry.asset.decimals,
  );
  const displayBalance = privacyMode ? '••••••' : amount;
  const balanceDensity = displayBalance.length >= 18
    ? 'long'
    : displayBalance.length >= 13
      ? 'medium'
      : 'compact';
  const unitPriceUsd = entry.asset.kind === 'native'
    ? xlmPriceUsd
    : entry.asset.code === 'USDC'
      ? 1
      : null;
  const totalUsd = privatePortfolioRepresentativeUsd([entry], xlmPriceUsd);
  const known = lookupKnownAsset(entry.asset.code, entry.asset.issuer, network);
  const checked = entry.lastVerifiedLedger === null
    ? 'Saved locally; waiting for the first ledger check'
    : `Checked through ledger ${entry.lastVerifiedLedger.toLocaleString('en-US')}`;

  if (step !== 'asset') {
    return (
      <PrivateSettingsStepContent
        step={step}
        onNavigate={setStep}
        onClose={onClose}
        onRemoved={onClose}
        onBusyChange={setBusy}
        onDirtyChange={setDirty}
      />
    );
  }

  return (
    <ModalBody>
      <div className="flex flex-col items-center pb-2 pt-1 text-center">
        <AssetAvatar
          code={entry.asset.code}
          isNative={entry.asset.kind === 'native'}
          logoUrl={known?.iconUrl}
          background={known?.color}
          size={56}
          privatePayment
        />
        <p className="balance-display mt-4 text-white" data-density={balanceDensity}>
          <span className="balance-display-value">{displayBalance}</span>
          <span className="balance-display-unit">{entry.asset.code}</span>
        </p>
        <p className="mt-1.5 max-w-xs text-[12px] text-neutral-400">
          {entry.asset.name} held in your encrypted private balance
        </p>
        {!privacyMode && unitPriceUsd !== null && totalUsd !== null ? (
          <div className="mt-3 flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1">
            <span className="mono text-[14px] font-semibold text-[#30D158]">
              {fmtFiat(unitPriceUsd, fiatCurrency, fiatRates ?? undefined)}
            </span>
            <span className="text-[11px] text-neutral-500">per {entry.asset.code}</span>
            <span className="text-neutral-600">·</span>
            <span className="mono text-[12px] font-medium text-neutral-300">
              {fmtFiat(totalUsd, fiatCurrency, fiatRates ?? undefined)} total
            </span>
          </div>
        ) : null}
      </div>

      <Notice tone="accent" compact>
        <p className="text-[12px] leading-relaxed text-neutral-300">
          Private transfers hide their amount and recipient. Deposits and withdrawals remain
          visible on Stellar because they cross between public and private balances.
        </p>
      </Notice>

      {entry.asset.kind === 'native' ? <StealthReceipts onBusyChange={setBusy} /> : null}

      <div className="panel-inset divide-y divide-white/[0.08]">
        <Row label="Type">
          <span className="text-[13px] font-medium text-white">Private asset</span>
        </Row>
        <Row label="Network">
          <span className="text-[13px] capitalize text-white">{network}</span>
        </Row>
        <Row label="Last checked">
          <span className="text-[12px] leading-snug text-neutral-300">{checked}</span>
        </Row>
        {entry.asset.issuer ? (
          <Row label="Issuer">
            <HashValue
              value={entry.asset.issuer}
              className="justify-end text-[12px] text-neutral-300"
            />
          </Row>
        ) : null}
        <Row label="Asset contract">
          <HashValue
            value={entry.asset.contractId}
            className="justify-end text-[11px] text-neutral-400"
          />
        </Row>
      </div>

      <ModalFooter
        stack
        secondary={
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        }
        primary={
          <Button type="button" onClick={() => setStep('details')}>
            Private Payments settings
          </Button>
        }
      />
    </ModalBody>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="shrink-0 pt-0.5 text-[13px] font-medium text-neutral-400">{label}</span>
      <span className="min-w-0 max-w-[65%] text-right">{children}</span>
    </div>
  );
}
