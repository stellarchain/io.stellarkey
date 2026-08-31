'use client';

import { useState, type ReactNode } from 'react';
import { Button, HashValue, Modal, ModalHeader } from '@/components/ui';
import { IconShieldStellar } from '@/components/icons';
import { fmtFiat, type FiatCurrency } from '@/lib/format';
import type { NetworkKey } from '@/lib/stellar';
import type { PrivatePortfolioEntry } from '../runtime/portfolio';
import { privatePortfolioRepresentativeUsd } from '../runtime/portfolio';
import { formatPrivateBalanceAmount } from '../runtime/selectors';
import { StealthReceipts } from './StealthReceipts';
import { PrivatePaymentsDetails } from './PrivatePaymentsDetails';

/**
 * A private asset uses the same information hierarchy as the public asset
 * sheet: identity, balance, value, then durable asset facts. Transaction
 * actions deliberately stay in the wallet's shared Send / Receive / Add /
 * Withdraw surfaces so opening an asset never reveals a second dashboard.
 */
export function PrivateAssetDetailModal({
  entry,
  network,
  privacyMode,
  xlmPriceUsd,
  fiatCurrency,
  fiatRates,
  onClose,
}: {
  entry: PrivatePortfolioEntry | null;
  network: NetworkKey;
  privacyMode: boolean;
  xlmPriceUsd: number | null;
  fiatCurrency: FiatCurrency;
  fiatRates: Partial<Record<FiatCurrency, number>> | null;
  onClose(): void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (!entry) return null;
  if (settingsOpen) {
    return (
      <PrivatePaymentsDetails
        onClose={() => setSettingsOpen(false)}
        onRemoved={onClose}
      />
    );
  }

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
  const checked = entry.lastVerifiedLedger === null
    ? 'Saved locally; waiting for the first ledger check'
    : `Checked through ledger ${entry.lastVerifiedLedger.toLocaleString('en-US')}`;

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title={entry.asset.code}
        subtitle="Private balance"
        onClose={onClose}
      />
      <div className="p-4 sm:p-6">
        <div className="flex flex-col items-center pb-2 pt-1 text-center">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-xl"
            style={{ background: 'linear-gradient(135deg, #0A84FF, #5E5CE6)' }}
            aria-hidden="true"
          >
            <IconShieldStellar size={25} />
          </span>
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

        <div className="mt-4 rounded-2xl border border-[#0A84FF]/20 bg-[#0A84FF]/[0.07] px-4 py-3">
          <p className="text-[12px] leading-relaxed text-neutral-300">
            Private transfers hide their amount and recipient. Deposits and withdrawals remain
            visible on Stellar because they cross between public and private balances.
          </p>
        </div>

        {entry.asset.kind === 'native' ? <StealthReceipts /> : null}

        <div className="panel-inset mt-5 divide-y divide-white/[0.08]">
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

        <Button
          variant="secondary"
          className="mt-4 w-full"
          onClick={() => setSettingsOpen(true)}
        >
          Private Payments settings
        </Button>
        <Button variant="ghost" className="mt-2 w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
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
