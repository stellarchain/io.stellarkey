'use client';

import { IconShieldStellar } from '@/components/icons';
import type { PrivateBalanceAssetOption } from '@/hooks/usePrivateBalanceRuntime';
import { fmtFiat, type FiatCurrency } from '@/lib/format';
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
  configured,
  separated = false,
  privacyMode,
  xlmPriceUsd,
  fiatCurrency,
  fiatRates,
  onOpen,
}: {
  option: PrivateBalanceAssetOption;
  entry: PrivatePortfolioEntry | null;
  configured: boolean;
  separated?: boolean;
  privacyMode: boolean;
  xlmPriceUsd: number | null;
  fiatCurrency: FiatCurrency;
  fiatRates: Partial<Record<FiatCurrency, number>> | null;
  onOpen(): void;
}) {
  const { asset } = option;
  const stroops = BigInt(entry?.verifiedBalanceAtomicUnits ?? '0');
  const decimals = asset.decimals;
  const assetCode = asset.code;
  const amount = formatPrivateBalanceAmount(stroops, decimals);
  const confirming = (entry?.pendingActions ?? []).filter(action =>
    action.status === 'signed' || action.status === 'broadcast'
  ).length;
  const detail = !configured
    ? 'Not set up'
    : confirming > 0
    ? `${confirming} ${confirming === 1 ? 'payment' : 'payments'} confirming`
    : 'Ready';

  /*
   * The dot repeats the subtitle in colour so the row's state survives a scan.
   * Green means the balance was verified against chain locally — a claim the
   * protocol actually makes — so it must not appear before setup or while a
   * scan is still running.
   */
  const dot = !configured ? '#636366' : confirming > 0 ? '#FF9F0A' : '#30D158';

  const representativeUsd = entry
    ? privatePortfolioRepresentativeUsd([entry], xlmPriceUsd)
    : null;
  const fiat = !privacyMode && representativeUsd !== null
    ? fmtFiat(representativeUsd, fiatCurrency, fiatRates ?? undefined)
    : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open private ${assetCode}. ${detail}. ${!configured ? 'Set up' : privacyMode ? 'Balance hidden' : `${amount} ${assetCode}`}`}
      className={`row-hover flex w-full min-w-0 items-center gap-3.5 px-4 py-3.5 text-left ${separated ? 'ios-sep' : ''}`}
    >
      <span className="relative shrink-0">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full text-white shadow-inner"
          style={{ background: 'linear-gradient(135deg, #0A84FF, #5E5CE6)' }}
        >
          <IconShieldStellar size={17} />
        </span>
        {/* a notch of the list ground so the badge reads as attached, not stacked */}
        {dot && (
          <span
            aria-hidden="true"
            className="absolute bottom-0 right-0 flex h-[15px] w-[15px] items-center justify-center rounded-full"
            style={{ background: 'var(--color-panel, #1c1c1e)' }}
          >
            <span className="h-[9px] w-[9px] rounded-full" style={{ background: dot }} />
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15.5px] font-semibold leading-tight text-white">
          {assetCode}
        </span>
        <span className="mt-0.5 block truncate text-[12px] leading-tight text-neutral-400">
          {detail}
        </span>
      </span>

      <span className="min-w-0 max-w-[48%] text-right">
        <span className="mono block break-words text-[13px] font-medium leading-tight text-white sm:text-[15.5px]">
          {!configured ? 'Set up' : privacyMode ? '••••••' : amount}
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
