'use client';

import { useMemo, useState } from 'react';
import { Button, Field, Notice } from '@/components/ui';
import {
  usePrivateBalanceRuntime,
  usePrivateBalanceRuntimeData,
} from '@/hooks/usePrivateBalanceRuntime';
import { useWalletIdentity, useWalletTransactions } from '@/hooks/useWallet';
import { NETWORKS } from '@/lib/stellar';
import { getRpcUrl } from '@/lib/stellar-endpoints';
import {
  executePrivateAssetAdminAction,
  type PrivateAssetAdminAction,
  type PrivateAssetAdminStage,
} from '../runtime/asset-admin';

const STAGE_LABEL: Record<PrivateAssetAdminStage, string> = {
  preparing: 'Checking contract…',
  signing: 'Waiting for signature…',
  submitting: 'Submitting…',
  pending: 'Waiting for the ledger…',
  confirmed: 'Confirmed',
};

export function PrivateAssetRegistryAdmin() {
  const { network } = useWalletIdentity();
  const { signPrivateBalanceEnvelope } = useWalletTransactions();
  const { availableAssets, retryRuntime } = usePrivateBalanceRuntime();
  const { deployment, publicAddress } = usePrivateBalanceRuntimeData();
  const [contractId, setContractId] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [stage, setStage] = useState<PrivateAssetAdminStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const isAdmin = Boolean(
    publicAddress &&
    deployment.assetAdminAddress &&
    publicAddress === deployment.assetAdminAddress,
  );
  const poolAssets = useMemo(() => availableAssets
    .map(option => option.asset)
    .sort((left, right) => left.index - right.index), [availableAssets]);

  if (!isAdmin || !deployment.poolContractId) return null;

  const execute = async (action: PrivateAssetAdminAction, key: string) => {
    const rpcUrl = getRpcUrl(network);
    if (!rpcUrl) {
      setError('Configure a Stellar RPC endpoint before changing the private asset registry.');
      return;
    }
    setWorking(key);
    setStage('preparing');
    setError(null);
    setResult(null);
    try {
      const outcome = await executePrivateAssetAdminAction({
        action,
        poolContractId: deployment.poolContractId!,
        adminPublicKey: publicAddress!,
        networkPassphrase: NETWORKS[network].networkPassphrase,
        rpcUrl,
        sign: signPrivateBalanceEnvelope,
        onStage: setStage,
      });
      setResult(outcome.transactionHash);
      if (action.type === 'add') setContractId('');
      retryRuntime();
    } catch {
      setError('The private asset registry was not changed. Check the contract, account, and network, then try again.');
    } finally {
      setWorking(null);
      setStage(null);
    }
  };

  return (
    <section aria-labelledby="private-asset-admin-title">
      <h3 id="private-asset-admin-title" className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
        Asset administrator
      </h3>
      <div className="list-group">
        <div className="space-y-3 p-4">
          <div>
            <p className="text-[13.5px] font-semibold text-white">Admitted private assets</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-500">
              Added contracts receive a permanent index. Exit only stops new deposits while preserving withdrawals; registry entries are never deleted.
            </p>
          </div>
          <Field label="Stellar Asset Contract address">
            <input
              className="input font-mono text-base sm:text-[13px]"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              value={contractId}
              onChange={event => setContractId(event.target.value.trim().toUpperCase())}
              placeholder="C…"
            />
          </Field>
          <Button
            type="button"
            loading={working === 'add'}
            disabled={working !== null || contractId.length !== 56}
            onClick={() => void execute({ type: 'add', contractId }, 'add')}
          >
            Add asset contract
          </Button>
        </div>
        <div className="border-t border-white/[0.07]">
          {poolAssets.map(asset => {
            const nextStatus = asset.status === 'active' ? 'exit-only' : 'active';
            const key = `status-${asset.index}`;
            return (
              <div key={asset.contractId} className="ios-sep flex min-h-16 items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-white">{asset.code}</p>
                  <p className="mt-0.5 truncate font-mono text-[10.5px] text-neutral-500" title={asset.contractId}>
                    #{asset.index} · {asset.contractId}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={asset.status === 'active' ? 'secondary' : 'primary'}
                  className="!min-h-9 !px-3 !py-1.5 text-[12px]"
                  loading={working === key}
                  disabled={working !== null}
                  onClick={() => void execute({
                    type: 'status',
                    index: asset.index,
                    status: nextStatus,
                  }, key)}
                >
                  {asset.status === 'active' ? 'Set exit only' : 'Allow deposits'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
      <div aria-live="polite" className="mt-2 space-y-2">
        {stage ? <p className="px-1 text-[11.5px] text-neutral-400">{STAGE_LABEL[stage]}</p> : null}
        {error ? <Notice tone="warn">{error}</Notice> : null}
        {result ? (
          <a
            href={NETWORKS[network].explorerTxUrl(result)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center px-1 text-[12.5px] font-semibold text-[#0A84FF]"
          >
            View registry transaction
          </a>
        ) : null}
      </div>
    </section>
  );
}
