'use client';

import { Notice, SegmentedControl } from '@/components/ui';
import type { PrivateSubmissionMode } from './usePrivateActionController';

export function PrivateRelaySubmissionChoice({
  value,
  onChange,
}: {
  value: PrivateSubmissionMode;
  onChange(value: PrivateSubmissionMode): void;
}) {
  return (
    <section aria-labelledby="private-submission-title" className="space-y-2.5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p id="private-submission-title" className="field-label !pb-0">Submitted by</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-500">
            Choose what appears as the transaction source on Stellar.
          </p>
        </div>
      </div>
      <SegmentedControl<PrivateSubmissionMode>
        ariaLabel="Choose how to submit this private payment"
        value={value}
        options={[
          { label: 'Privacy relay', value: 'relay' },
          { label: 'My account', value: 'direct' },
        ]}
        onChange={onChange}
      />
      {value === 'relay' ? (
        <Notice>
          An unrelated wallet submits the transaction for a private fee. No StellarKey relay
          server is used. If no peer answers, nothing is submitted and you can choose My account.
        </Notice>
      ) : (
        <Notice tone="warn">
          Your active Stellar account will be the public transaction source and pay the network fee.
        </Notice>
      )}
    </section>
  );
}
