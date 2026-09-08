'use client';

import { AssetAvatar } from '@/components/AssetAvatar';
import type { PrivateBalanceAssetOption } from '@/hooks/usePrivateBalanceRuntime';
import { lookupKnownAsset } from '@/lib/assets';
import { fmtFiat, type FiatCurrency } from '@/lib/format';
import type { NetworkKey } from '@/lib/stellar';
import type { PrivatePortfolioEntry } from '../runtime/portfolio';
import { privatePortfolioRepresentativeUsd } from '../runtime/portfolio';
import { formatPrivateBalanceAmount } from '../runtime/selectors';

/**
 * The selected private balance as a row in Your Assets.
 *
 * It marks the different custody mode with the shield asset mark. The section
 * heading already names the list as private, so the row does not repeat it.
 * Row geometry matches the public asset rows exactly
 * — same avatar size, same gaps, same right-aligned amount over fiat — so the
 * list keeps one rhythm and the pairing reads at a glance.
 */
export function PrivateBalanceAssetRow({
  option,
  entry,
  paymentsEnabled,
  prepared,
  separated = false,
  privacyMode,
  network,
  xlmPriceUsd,
  fiatCurrency,
  fiatRates,
  onOpen,
}: {
  option: PrivateBalanceAssetOption;
  entry: PrivatePortfolioEntry | null;
  paymentsEnabled: boolean;
  prepared: boolean;
  separated?: boolean;
  privacyMode: boolean;
  network: NetworkKey;
  xlmPriceUsd: number | null;
  fiatCurrency: FiatCurrency;
  fiatRates: Partial<Record<FiatCurrency, number>> | null;
  onOpen(): void;
}) {
  const { asset } = option;
  const ready = prepared && entry !== null;
  const stroops = ready ? BigInt(entry.verifiedBalanceAtomicUnits) : 0n;
  const decimals = asset.decimals;
  const assetCode = asset.code;
  const known = lookupKnownAsset(asset.code, asset.issuer, network);
  const amount = formatPrivateBalanceAmount(stroops, decimals);
  const confirming = (ready ? entry.pendingActions : []).filter(action =>
    action.status === 'signed' || action.status === 'broadcast'
  ).length;
  const detail = !paymentsEnabled
    ? 'Not enabled'
    : !ready
      ? 'Available'
    : confirming > 0
      ? `${confirming} ${confirming === 1 ? 'payment' : 'payments'} confirming`
      : asset.status === 'exit-only'
        ? 'Exit only'
        : 'Ready';

  const representativeUsd = ready
    ? privatePortfolioRepresentativeUsd([entry], xlmPriceUsd)
    : null;
  const fiat = !privacyMode && representativeUsd !== null
    ? fmtFiat(representativeUsd, fiatCurrency, fiatRates ?? undefined)
    : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open private ${assetCode}. ${detail}. ${!paymentsEnabled ? 'Turn on' : !ready ? 'Add funds' : privacyMode ? 'Balance hidden' : `${amount} ${assetCode}`}`}
      className={`row-hover flex w-full min-w-0 items-center gap-3.5 px-4 py-3.5 text-left ${separated ? 'ios-sep' : ''}`}
    >
      <AssetAvatar
        code={asset.code}
        isNative={asset.kind === 'native'}
        logoUrl={known?.iconUrl}
        background={known?.color}
        privatePayment
      />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15.5px] font-semibold leading-tight text-white">
          {assetCode}
        </span>
        <span className="mt-0.5 block truncate text-[12px] leading-tight text-neutral-400">
          {detail}
        </span>
      </span>

      <span className="min-w-0 max-w-[48%] text-right">
        <span className={`${paymentsEnabled && ready ? 'mono ' : ''}block break-words text-[13px] font-medium leading-tight text-white sm:text-[15.5px]`}>
          {!paymentsEnabled ? 'Turn on' : !ready ? 'Add funds' : privacyMode ? '••••••' : amount}
        </span>
        {fiat && (
          <span className="block break-words text-[11px] leading-tight text-neutral-400 sm:text-[12px]">
            {fiat}
          </span>
        )}
      </span>

      <svg
        className="chevron"
        width="8"
        height="14"
        viewBox="0 0 8 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M1 1l5 6-5 6" />
      </svg>
    </button>
  );
}
