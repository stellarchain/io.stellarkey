'use client';

import { useState } from 'react';
import { IconChevronDown } from '@/components/icons';
import { ModalBody } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { PrivateRelayAvailability } from './PrivateRelayAvailability';
import { PrivateRelaySettings } from './PrivateRelaySettings';

/**
 * The helper state the Earn trigger row already derives from the saved
 * preference, the helper status store and the private runtime phase, as the
 * dialog presents it. Deriving it once in the shell keeps the row and the
 * dialog from ever disagreeing.
 */
export interface PrivateRelayEntryPresentation {
  helpRelay: boolean;
  status: string;
  /** off · waiting · live · trouble — drives the status card's colour. */
  tone: 'off' | 'waiting' | 'live' | 'trouble';
  headline: string;
  helperDescription: string;
}

const TONES = {
  off: { ring: 'bg-[#0A84FF]/12 text-[#0A84FF]', pill: 'bg-white/[0.08] text-neutral-300' },
  waiting: { ring: 'bg-[#FF9F0A]/12 text-[#FF9F0A]', pill: 'bg-[#FF9F0A]/15 text-[#FFB340]' },
  live: { ring: 'bg-[#30D158]/12 text-[#30D158]', pill: 'bg-[#30D158]/15 text-[#30D158]' },
  trouble: { ring: 'bg-[#FF453A]/12 text-[#FF6961]', pill: 'bg-[#FF453A]/15 text-[#FF6961]' },
} as const;

// A static connection motif, not a traffic or earnings visualization.
function RelayMark() {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 80 80" fill="none" className="h-7 w-7 shrink-0">
    <path d="M17 24 40 40 64 20M40 40 62 62M40 40 17 60" stroke="currentColor" strokeOpacity=".5" strokeWidth="3" />
    <circle cx="40" cy="40" r="11" fill="currentColor" fillOpacity=".18" stroke="currentColor" strokeWidth="3" />
    <circle cx="40" cy="40" r="3.5" fill="currentColor" />
    <g fill="currentColor">
      <circle cx="17" cy="24" r="5" /><circle cx="64" cy="20" r="5" />
      <circle cx="62" cy="62" r="5" /><circle cx="17" cy="60" r="5" />
    </g>
  </svg>;
}

/**
 * The Earn dialog's content: a live status card, the fee and participation
 * controls, and the peer availability check. It mounts only while the dialog
 * is open, so peer information leaves with the dialog and a reopen starts
 * collapsed.
 */
export function PrivateRelayEntryBody({
  presentation,
  onDirtyChange,
}: {
  presentation: PrivateRelayEntryPresentation;
  onDirtyChange(dirty: boolean): void;
}) {
  const { asset, deployment, publicAddress } = usePrivateBalanceRuntimeData();
  const [exploring, setExploring] = useState(false);
  const { helpRelay, status, tone, headline, helperDescription } = presentation;
  const colours = TONES[tone];

  return (
    <ModalBody gap={4}>
      <section aria-label="Your relay status" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-start gap-3.5">
          <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${colours.ring}`}>
            <RelayMark />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <h3 className="text-[17px] font-semibold tracking-tight text-white">{headline}</h3>
              <span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${colours.pill}`}>
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                {helpRelay ? status : 'Not relaying'}
              </span>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-neutral-400">
              {helpRelay ? helperDescription : (
                <>
                  <span className="font-medium text-neutral-200">Relay on your terms.</span>{' '}
                  Help another wallet keep its sending account private, at a fee you set, and approve every transaction before it is signed.
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      <PrivateRelaySettings helperOnly onDirtyChange={onDirtyChange} extras={
        <details className="group/peers rounded-2xl border border-white/10 bg-white/[0.03]" open={exploring}
          onToggle={event => setExploring(event.currentTarget.open)}>
          <summary className="tap flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[13.5px] font-semibold text-white hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A84FF] [&::-webkit-details-marker]:hidden">
            Explore other peers
            <IconChevronDown size={14} className="shrink-0 text-neutral-400 transition-transform group-open/peers:rotate-180" />
          </summary>
          {exploring ? <div className="space-y-3 border-t border-white/[0.08] px-4 pb-4 pt-3">
            <p className="text-[12px] leading-relaxed text-neutral-400">This check is separate from your own relay connection and shares no payment details.</p>
            <PrivateRelayAvailability
              networkId={deployment.networkId}
              poolContractId={deployment.poolContractId}
              publicAddress={publicAddress}
              code={asset?.code ?? 'Asset'}
              decimals={asset?.decimals ?? 7}
            />
          </div> : null}
        </details>
      } />
    </ModalBody>
  );
}
