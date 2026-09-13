'use client';

import { IconShieldStellar } from '@/components/icons';
import { Button } from '@/components/ui';

export function PrivateSetupContent({
  action,
  onTurnOn,
}: {
  action: 'send' | 'receive' | 'add';
  onTurnOn(): void;
}) {
  const purpose = action === 'send'
    ? 'send it privately'
    : action === 'receive'
      ? 'receive it privately'
      : 'move it into your private balance';

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto flex min-h-56 max-w-[360px] flex-col items-center justify-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0A84FF]/12 text-[#0A84FF]">
          <IconShieldStellar size={22} />
        </span>
        <h3 className="mt-4 text-[17px] font-semibold tracking-tight text-white">
          Turn on Private Payments
        </h3>
        <p className="mt-1.5 max-w-[34ch] text-[12.5px] leading-relaxed text-neutral-400">
          Enable it once for this wallet. Each supported asset is prepared automatically when
          you first {purpose}.
        </p>
        <Button
          type="button"
          className="mt-6 min-w-48"
          onClick={onTurnOn}
        >
          Turn On Private Payments
        </Button>
      </div>
    </div>
  );
}
