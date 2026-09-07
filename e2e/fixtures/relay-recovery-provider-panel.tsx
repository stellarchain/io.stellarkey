'use client';

// Non-usable synthetic vault. The actual wallet/provider, worker thread,
// recovery card, signing API and scanner run; only proof/transport are doubles.
import { useEffect, useRef, useState } from 'react';
import { Keypair } from '@stellar/stellar-sdk';
import { Button } from '@/components/ui';
import { SigningPasswordPrompt } from '@/components/SigningPasswordPrompt';
import { useWallet } from '@/hooks/useWallet';
import { initialPrivateBalanceRuntimeData, PrivateBalanceRuntimeControlProvider, usePrivateBalanceRuntimeData } from '@/hooks/usePrivateBalanceRuntime';
import { PrivateBalanceProvider } from '@/features/private-balance/runtime/provider';
import { PrivateBalanceCard } from '@/features/private-balance/components/PrivateBalanceCard';
import { IndexedDbEncryptedRecordDriver } from '@/lib/indexed-db';
import { lockVault, unlockVault, withPrivacySessionRoot } from '@/lib/vault';
import type { AccountMeta } from '@/lib/types';
import type { PrivateBalanceManifest } from '@/lib/private-balance-manifest';
import { createRelayRecoveryScenario } from './relay-recovery-scenario';
import development from '../../protocol/private-balance/manifests/development.json';

type Scenario = Awaited<ReturnType<typeof createRelayRecoveryScenario>>;
const asset = { ...development.assets[0], kind: 'native' as const, status: 'active' as const };
const deployment = { ...initialPrivateBalanceRuntimeData.deployment };
const password = 'synthetic recovery correct horse battery staple';

function Controls({ scenario }: { scenario: Scenario }) {
  const runtime = usePrivateBalanceRuntimeData();
  const [result, setResult] = useState('idle');
  return <>
    <p data-testid="recovery-provider-phase">{runtime.phase}</p>
    <p data-testid="recovery-provider-balance">{runtime.verifiedBalanceStroops}</p>
    <p data-testid="recovery-provider-outcome">{runtime.spendRecovery?.outcome ?? 'none'}</p>
    <p data-testid="recovery-provider-pending">{runtime.pendingActions.length}</p>
    <p data-testid="recovery-provider-result">{result}</p>
    <p data-testid="recovery-provider-shared">{scenario.shared}</p>
    <p data-testid="recovery-provider-submissions">{scenario.submissions}</p>
    <Button onClick={() => { void runtime.refreshSync().catch(() => setResult('sync-failed')); }}>Refresh real recovery provider</Button>
    <Button onClick={() => { void (async () => {
      await scenario.confirm(true, false); await runtime.refreshSync(); setResult('canonical-delivered');
    })().catch(() => setResult('delivery-failed')); }}>Deliver real provider recovery record</Button>
    <Button onClick={() => { void (async () => {
      await scenario.confirm(false, false); await runtime.refreshSync(); setResult('canonical-delivered');
    })().catch(() => setResult('delivery-failed')); }}>Deliver real provider original record</Button>
    <PrivateBalanceCard privacyMode showAssetSelector={false} />
  </>;
}

export function RelayRecoveryProviderFixture() {
  const wallet = useWallet();
  const [account, setAccount] = useState<AccountMeta | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [stage, setStage] = useState('idle');
  const [authority, setAuthority] = useState('unchanged');
  const [signs, setSigns] = useState(0);
  const [retired, setRetired] = useState(false);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  useEffect(() => {
    const original = Keypair.prototype.sign;
    Keypair.prototype.sign = function (...args) { setSigns(value => value + 1); return original.apply(this, args); };
    return () => { Keypair.prototype.sign = original; };
  }, []);
  return <main data-app-surface className="min-h-screen space-y-4 p-6">
    <h1>Synthetic real-provider recovery</h1>
    <Button disabled={stage !== 'idle'} onClick={() => { setStage('preparing'); let boundary = 'vault'; void (async () => {
      const created = await wallet.createWallet(password, { secret: Keypair.random().secret(), requirePasswordForSigning: true });
      wallet.completeSetup();
      boundary = 'scenario';
      const prepared = await withPrivacySessionRoot(created.account.id, development, async (root, storageKey) =>
        createRelayRecoveryScenario(development as PrivateBalanceManifest, new IndexedDbEncryptedRecordDriver(), {
          bob: { accountId: created.account.id, publicKey: created.account.publicKey, root, storageKey },
        }));
      boundary = 'hold';
      try { await prepared.prepare('helper-reject'); } catch (error) {
        if (!(error instanceof Error) || error.name !== 'PrivateProofExposedError') throw error;
      }
      boundary = 'transport';
      cleanup.current = prepared.installProviderTransport();
      wallet.completeSetup(); setAccount(created.account); setScenario(prepared); setSigns(0); setStage('ready');
    })().catch(() => setStage(`failed-${boundary}`)); }}>Prepare real recovery provider</Button>
    <p data-testid="recovery-provider-setup">{stage}</p>
    <p data-testid="recovery-provider-authority">{authority}</p>
    <p data-testid="recovery-provider-signs">{signs}</p>
    <div hidden>
      <Button onClick={() => { lockVault(); void unlockVault(password).then(() => setAuthority('session-replaced')); }}>Replace synthetic recovery session</Button>
      <Button onClick={() => { wallet.switchNetwork('mainnet'); wallet.switchNetwork('testnet'); setAuthority('network-replaced'); }}>Replace synthetic recovery network</Button>
      <Button onClick={() => { setRetired(true); setAuthority('provider-retired'); }}>Retire synthetic recovery provider</Button>
    </div>
    <SigningPasswordPrompt />
    {account && scenario && !retired ? <PrivateBalanceRuntimeControlProvider scopeKey="synthetic-held-recovery-control"><PrivateBalanceProvider accountId={account.id} accountPublicKey={account.publicKey}
      accountCreatedAt={0} network="testnet" manifest={scenario.manifest} manifestHash={'09'.repeat(32)} storageScope={scenario.scope}
      encryptedStateExists deployment={deployment} asset={asset} registryAssets={scenario.manifest.assets}
      runtimeKey="synthetic-recovery-runtime" portfolioKey="synthetic-recovery-portfolio" deploymentId="synthetic-recovery-deployment">
      <Controls scenario={scenario} />
    </PrivateBalanceProvider></PrivateBalanceRuntimeControlProvider> : null}
  </main>;
}
