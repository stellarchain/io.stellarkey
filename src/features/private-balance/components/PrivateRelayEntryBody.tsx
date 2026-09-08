'use client';

import { useState } from 'react';
import { IconChevronDown, IconShield } from '@/components/icons';
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
  statusTone: string;
  headline: string;
  helperDescription: string;
}

// A static connection motif, not a traffic or earnings visualization.
function RelayMark({ large = false }: { large?: boolean }) {
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 80 80" fill="none"
    className={large ? 'h-20 w-20 shrink-0 text-accent' : 'h-10 w-10 shrink-0 text-accent'}>
    <path d="M17 24 40 40 64 20M40 40 62 62M40 40 17 60" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.5" />
    <circle cx="40" cy="40" r="17" stroke="currentColor" strokeOpacity=".2" />
    <circle cx="40" cy="40" r="10" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="40" cy="40" r="3" fill="currentColor" />
    <g fill="var(--color-panel)" stroke="currentColor" strokeWidth="1.5">
      <circle cx="17" cy="24" r="4" /><circle cx="64" cy="20" r="4" />
      <circle cx="62" cy="62" r="4" /><circle cx="17" cy="60" r="4" />
    </g>
  </svg>;
}

/**
 * The Earn dialog's content: relay status, the helper settings form and the
 * peer availability check. It mounts only while the dialog is open, so peer
 * information leaves with the dialog and a reopen starts collapsed.
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
  const { helpRelay, status, statusTone, headline, helperDescription } = presentation;

  return (
    <ModalBody gap={3}>
      <section aria-label="Your relay status">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
          <span role="status" className={`inline-flex items-center gap-2 font-semibold ${statusTone}`}>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
            {helpRelay ? status : 'Not relaying'}
          </span>
          <span className="inline-flex items-center gap-1.5 text-muted"><IconShield size={13} />Manual approval</span>
        </div>
        <div className="mt-3 flex min-h-24 items-center justify-between gap-3">
          <div className="min-w-0 max-w-80">
            <h3 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.035em] text-ink sm:text-[34px]">{headline}</h3>
            <p className="mt-2.5 text-[13px] leading-relaxed text-muted">
              {helpRelay ? helperDescription : 'Help another wallet keep its sending account private. Choose a fee and review each request.'}
            </p>
          </div>
          <span className="hidden min-[360px]:block"><RelayMark large /></span>
        </div>
      </section>
      <PrivateRelaySettings helperOnly onDirtyChange={onDirtyChange} />
      <details className="group/peers border-t border-white/[0.08]" open={exploring}
        onToggle={event => setExploring(event.currentTarget.open)}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 text-[13px] font-medium text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
          Explore other peers
          <IconChevronDown size={14} className="shrink-0 group-open/peers:rotate-180" />
        </summary>
        {exploring ? <div className="space-y-3 pb-2">
          <p className="px-1 text-[12px] leading-relaxed text-muted">Compare other helpers’ fees. This check is separate from your own relay connection.</p>
          <PrivateRelayAvailability
            networkId={deployment.networkId}
            poolContractId={deployment.poolContractId}
            publicAddress={publicAddress}
            code={asset?.code ?? 'Asset'}
            decimals={asset?.decimals ?? 7}
          />
        </div> : null}
      </details>
    </ModalBody>
  );
}
