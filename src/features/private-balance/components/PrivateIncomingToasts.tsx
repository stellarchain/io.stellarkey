'use client';

import { useEffect } from 'react';
import { useToast } from '@/components/Toast';
import { usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { useWalletPreferences } from '@/hooks/useWallet';
import { fmtAmount } from '@/lib/format';
import { playReceiveSound } from '@/lib/sounds';
import { formatPrivateBalanceAmount } from '../runtime/selectors';

/**
 * Headless listener mounted inside the private runtime: each verified batch of
 * incoming private transfers becomes one toast plus the receive chime — the
 * success toast already carries the success haptic. Privacy mode drops the
 * amount.
 */
export function PrivateIncomingToasts() {
  const { onIncomingPrivatePayment, asset } = usePrivateBalanceRuntimeData();
  const { privacyMode } = useWalletPreferences();
  const { toast } = useToast();

  useEffect(() => onIncomingPrivatePayment(event => {
    const amount = fmtAmount(
      formatPrivateBalanceAmount(BigInt(event.totalAmountStroops), asset?.decimals ?? 7),
    );
    const message = privacyMode
      ? 'Received a private payment'
      : `Received ${amount} ${asset?.code ?? ''} privately`.replace(/\s{2,}/g, ' ');
    toast(message, 'success');
    playReceiveSound();
  }), [asset, onIncomingPrivatePayment, privacyMode, toast]);

  return null;
}
