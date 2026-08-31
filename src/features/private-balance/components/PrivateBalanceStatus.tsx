'use client';

import { useState } from 'react';
import {
  IconAlert,
  IconCheck,
  IconChevronDown,
  IconRefresh,
  IconShieldStellar,
} from '@/components/icons';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { formatTrezorAddress } from '@/lib/address-display';
import { triggerHaptic } from '@/lib/haptics';
import { humanizePrivateError, STATUS_LINE } from '../copy';

const PHASE_LABELS = {
  disabled: 'Not set up',
  locked: 'Wallet locked',
  'loading-artifacts': 'Getting ready…',
  'reading-meta': 'Updating…',
  'scanning-live': 'Updating…',
  current: 'Up to date',
  'safe-error': 'Stopped safely',
} as const;

function manifestLabel(status: 'development' | 'testnet-beta' | 'production' | null) {
  if (status === 'testnet-beta') return 'Testnet beta';
  if (status === 'production') return 'Production';
  if (status === 'development') return 'Development only';
  return 'Not recorded';
}

function evidenceLabel(value: 'not-recorded' | 'recorded') {
  return value === 'recorded' ? 'Recorded' : 'Not recorded';
}

/**
 * A friendly error block: plain-words title and body via humanizePrivateError,
 * with the raw runtime message tucked behind a collapsed "Technical details"
 * disclosure — the only place identifiers are allowed to surface.
 */
export function HumanizedErrorNotice({
  cause,
  className = '',
}: {
  cause: unknown;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const friendly = humanizePrivateError(cause);
  return (
    <div
      role="alert"
      className={`rounded-xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 p-3 text-left ${className}`}
    >
      <p className="text-[12.5px] font-semibold text-[#FFB340]">{friendly.title}</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-300">{friendly.body}</p>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          triggerHaptic('selection');
          setExpanded(value => !value);
        }}
        className="mt-1.5 flex min-h-8 items-center gap-1 text-[11px] font-semibold text-neutral-500"
      >
        Technical details
        <IconChevronDown
          size={11}
          className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      {expanded ? (
        <p className="mono mt-1 break-words text-[10.5px] leading-relaxed text-neutral-500">
          {friendly.technical}
        </p>
      ) : null}
    </div>
  );
}

export function PrivateBalanceStatus({ detailed = false }: { detailed?: boolean }) {
  const { phase, error, deployment } = usePrivateBalanceRuntimeData();
  const caution = phase === 'safe-error' || deployment.depositsPaused === true;
  const Icon = caution ? IconAlert : phase === 'current' ? IconCheck :
    phase === 'disabled' ? IconShieldStellar : IconRefresh;
  const label = deployment.depositsPaused === true
    ? STATUS_LINE.depositsPaused
    : PHASE_LABELS[phase];

  return (
    <div
      role="status"
      aria-label={`Private payments status: ${label}`}
      className={`rounded-2xl border px-3.5 py-3 ${
        caution
          ? 'border-[#FF9F0A]/30 bg-[#FF9F0A]/8'
          : 'border-white/[0.09] bg-white/[0.035]'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <Icon
          size={16}
          className={`mt-0.5 shrink-0 ${caution ? 'text-[#FF9F0A]' : 'text-[#0A84FF]'}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-white">{label}</p>
          {deployment.latestLedger !== null ? (
            <p className="mt-0.5 text-[11px] text-neutral-500">
              Verified through ledger {deployment.latestLedger.toLocaleString()}
            </p>
          ) : null}
        </div>
      </div>
      {error ? <HumanizedErrorNotice cause={error} className="mt-2.5" /> : null}

      {detailed ? (
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 border-t border-white/[0.07] pt-3 text-[11.5px] sm:grid-cols-2">
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-neutral-500">Release</dt>
            <dd className="text-right font-medium text-neutral-200 sm:text-left">
              {manifestLabel(deployment.manifestStatus)}
            </dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-neutral-500">Independent audit</dt>
            <dd className="text-right font-medium text-neutral-200 sm:text-left">
              {evidenceLabel(deployment.auditStatus)}
            </dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-neutral-500">Trusted setup</dt>
            <dd className="text-right font-medium text-neutral-200 sm:text-left">
              {evidenceLabel(deployment.ceremonyStatus)}
            </dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-neutral-500">Network</dt>
            <dd className="text-right font-medium capitalize text-neutral-200 sm:text-left">
              {deployment.network ?? 'Not recorded'}
            </dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-neutral-500">Network activity</dt>
            <dd className="text-right font-medium text-neutral-200 sm:text-left">
              {deployment.actionCount === null
                ? 'Not recorded'
                : `${deployment.actionCount.toLocaleString()} private actions so far`}
            </dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-neutral-500">Measured recovery</dt>
            <dd className="text-right font-medium text-neutral-200 sm:text-left">
              {deployment.recoveryEvidence
                ? `${deployment.recoveryEvidence.timeRange} · ${deployment.recoveryEvidence.feeRange}`
                : 'Not recorded'}
            </dd>
          </div>
          {deployment.poolContractId ? (
            <div className="flex justify-between gap-3 sm:col-span-2 sm:block">
              <dt className="text-neutral-500">Contract</dt>
              <dd className="mono text-right text-[11px] text-neutral-300 sm:text-left">
                {formatTrezorAddress(deployment.poolContractId)}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}
