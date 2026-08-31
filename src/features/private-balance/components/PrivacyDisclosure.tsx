import { IconEye, IconEyeOff } from '@/components/icons';

/**
 * The honest two-row framing of what Private Payments hides and what stays
 * public. Setup, the details sheet, and any embed use this same block so the
 * claim never drifts.
 */
export function PrivacyDisclosure({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#0A84FF]/12 text-[#0A84FF]">
          <IconEyeOff size={17} />
        </span>
        <p className="text-[13px] leading-relaxed text-neutral-300">
          <span className="font-semibold text-white">Private:</span> the amount, the recipient,
          and the memo stay encrypted.
        </p>
      </div>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-neutral-300">
          <IconEye size={16} />
        </span>
        <p className="text-[12.5px] leading-relaxed text-neutral-400">
          <span className="font-semibold text-neutral-200">Public:</span> money moving in or out,
          network fees paid by your Stellar account, and timing. Privacy grows with more
          independent activity — it is context, not a guarantee.
        </p>
      </div>
    </div>
  );
}
