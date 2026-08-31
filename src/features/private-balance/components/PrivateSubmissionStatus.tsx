'use client';

import { useEffect, useRef } from 'react';
import { IconAlert } from '@/components/icons';
import { Button } from '@/components/ui';
import { triggerHaptic } from '@/lib/haptics';
import { AMBIGUOUS_OUTCOME } from '../copy';
import { PrivateSuccess } from './PrivateSuccess';
import type { PrivateSubmissionOutcome } from './usePrivateActionController';

/**
 * The terminal moment of every action flow. A broadcast lands on the shared
 * success morph; an inconclusive network response gets calm warning copy —
 * money is safe, checking continues — never error styling.
 */
export function PrivateSubmissionStatus({
  status,
  title,
  explorerHref,
  celebrate = false,
  onDone,
}: {
  status: PrivateSubmissionOutcome;
  /** Success title, e.g. "Sent Privately" / "Deposit Sent" / "Withdrawal Sent". */
  title: string;
  explorerHref?: string;
  celebrate?: boolean;
  onDone(): void;
}) {
  const warnedRef = useRef(false);
  useEffect(() => {
    if (status !== 'ambiguous' || warnedRef.current) return;
    warnedRef.current = true;
    triggerHaptic('warning');
  }, [status]);

  if (status === 'broadcast') {
    return (
      <div className="p-4 sm:p-6">
        <PrivateSuccess
          title={title}
          subtitle="Verifying on Stellar — your balance updates in a moment"
          explorerHref={explorerHref}
          celebrate={celebrate}
          onDone={onDone}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6" aria-live="polite">
      <div className="flex flex-col items-center gap-3 py-3 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 text-[#FF9F0A]">
          <IconAlert size={28} />
        </span>
        <h3 className="display-h text-xl font-light text-white">{AMBIGUOUS_OUTCOME.title}</h3>
        <p className="max-w-[340px] text-[13px] leading-relaxed text-neutral-400">
          {AMBIGUOUS_OUTCOME.body}
        </p>
      </div>
      <Button type="button" variant="ghost" className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}
