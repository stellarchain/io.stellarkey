'use client';

import { Select } from '@/components/ui';
import {
  usePrivateBalancePortfolio,
  usePrivateBalanceRuntime,
} from '@/hooks/usePrivateBalanceRuntime';
import { useWalletLedger } from '@/hooks/useWallet';
import { fmtAmount } from '@/lib/format';
import { formatPrivateBalanceAmount } from '../runtime/selectors';

export function PrivateAssetSelector({
  presentation = 'pill',
  balance = null,
  balanceScope = 'private',
}: {
  presentation?: 'pill' | 'field';
  balance?: string | null;
  balanceScope?: 'private' | 'public';
} = {}) {
  const {
    availableAssets,
    selectedDeploymentId,
    selectAsset,
  } = usePrivateBalanceRuntime();
  const { entries } = usePrivateBalancePortfolio();
  const { balances } = useWalletLedger();
  const selected = availableAssets.find(option => option.deploymentId === selectedDeploymentId)
    ?? availableAssets[0]
    ?? null;

  const balanceFor = (deploymentId: string) => {
    const option = availableAssets.find(candidate => candidate.deploymentId === deploymentId);
    if (!option) return null;
    if (deploymentId === selected?.deploymentId && balance !== null) return balance;

    if (balanceScope === 'public') {
      const publicBalance = balances?.find(candidate =>
        option.asset.kind === 'native'
          ? candidate.isNative
          : !candidate.isNative
            && candidate.code === option.asset.code
            && candidate.issuer === option.asset.issuer,
      );
      return publicBalance?.balance ?? null;
    }

    const entry = entries.find(candidate => candidate.deploymentId === deploymentId);
    if (!entry) return null;
    return formatPrivateBalanceAmount(
      BigInt(entry.verifiedBalanceAtomicUnits),
      option.asset.decimals,
    );
  };

  return (
    <Select
      value={selected?.deploymentId ?? ''}
      onChange={selectAsset}
      ariaLabel="Asset"
      placeholder="Choose asset"
      size={presentation === 'field' ? 'md' : 'sm'}
      className={presentation === 'field' ? 'w-full' : ''}
      preserveOptionLabels
      options={availableAssets.map(option => {
        const optionBalance = balanceFor(option.deploymentId);
        return {
          value: option.deploymentId,
          label: option.asset.code,
          sublabel: optionBalance === null ? undefined : 'Balance: ' + fmtAmount(optionBalance),
        };
      })}
    />
  );
}
