'use client';

import { useState } from 'react';
import { IconShieldStellar } from '@/components/icons';
import { Button } from '@/components/ui';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { triggerHaptic } from '@/lib/haptics';
import { PrivateAssetSelector } from './PrivateAssetSelector';
import { PrivateBalanceSetup } from './PrivateBalanceSetup';

export function PrivateSetupContent({ action }: { action: 'send' | 'receive' | 'add' }) {
  const { asset } = usePrivateBalanceRuntimeData();
  const [setupOpen, setSetupOpen] = useState(false);
  const code = asset?.code ?? 'asset';
  const purpose = action === 'send'
    ? 'send it privately'
    : action === 'receive'
      ? 'receive it privately'
      : 'move it into your private balance';

  return (
    <div className="p-4 sm:p-6">
      <div className="flex justify-center">
        <PrivateAssetSelector />
      </div>
      <div className="mx-auto flex min-h-56 max-w-[360px] flex-col items-center justify-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0A84FF]/12 text-[#0A84FF]">
          <IconShieldStellar size={22} />
        </span>
        <h3 className="mt-4 text-[17px] font-semibold tracking-tight text-white">
          Set up private {code}
        </h3>
        <p className="mt-1.5 max-w-[34ch] text-[12.5px] leading-relaxed text-neutral-400">
          Create your encrypted private balance before you {purpose}.
        </p>
        <Button
          type="button"
          className="mt-6 min-w-48"
          onClick={() => {
            triggerHaptic('selection');
            setSetupOpen(true);
          }}
        >
          Set up private {code}
        </Button>
      </div>
      <PrivateBalanceSetup open={setupOpen} onClose={() => setSetupOpen(false)} />
    </div>
  );
}
